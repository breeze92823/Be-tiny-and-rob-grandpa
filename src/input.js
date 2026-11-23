// Keyboard + mouse. WASD/arrows move (camera-relative, consumed by player.js),
// mouse look while pointer-locked (click grabs, Esc releases; drag where it is
// refused or not yet granted) and wheel
// zoom (consumed by camera.js), edge-triggered actions cleared by their consumer.
// Touch controls (touch.js) write look/zoom/jump directly and move/sprint via
// setTouchMove/setTouchSprint, which are merged with the keys here.
export const inputState = {
  move: { x: 0, z: 0 }, // x = strafe (+ right), z = forward (+ forward)
  look: { dx: 0, dy: 0 }, // raw pixels since the camera last read them
  zoom: 0, // wheel notches since the camera last read them (+ = away)
  sprint: false,
  jump: false, // edge: cleared by player.js
  crouch: false, // toggled by C / Ctrl / the touch button
  grab: false, // held: left mouse (while the cursor is locked) or the touch GRAB button
  throw: false, // edge: right mouse / F / the touch THROW button, cleared by grab.js
  slot: -1, // edge: hotbar slot 0..9 from the digit keys (0 = the 10th), cleared by the game
  facingLock: false, // set by grab.js: the body faces the view while holding something
  holding: false, // set by grab.js: the wheel / pinch sets the hold distance instead of zooming the camera
  struggle: 0, // presses since the game last read them (Space / taps while in Grandpa's hand)
}

// One wheel notch per WheelEvent.deltaMode (pixels, lines, pages), so a trackpad
// and a mouse zoom at the same rate.
const NOTCH_PER_DELTA = [1 / 100, 1 / 3, 1]

const held = new Set()
const keyActions = new Map() // code -> fn, for one-shot keys (mode toggle, day/night...)
let orbiting = false // right-drag fallback where pointer lock is refused
let canvas = null
const touch = { x: 0, z: 0, sprint: false }

export const isLocked = () => !!canvas && document.pointerLockElement === canvas
// While blocked (the death screen is up) the cursor is released and clicking the world does not grab it.
let lockBlocked = false
export function setLockBlocked(on) {
  lockBlocked = on
  if (on) {
    orbiting = false
    if (document.pointerLockElement) document.exitPointerLock?.()
  }
}
// Pointer lock can reject (sandboxed frame, post-Escape cooldown); that is not a fault.
export function requestLock() {
  if (!canvas || isLocked() || lockBlocked) return
  const r = canvas.requestPointerLock?.()
  if (r instanceof Promise) r.catch(() => {})
}

// Registers a one-shot key (fires on keydown, never on auto-repeat).
export function onKey(code, fn) {
  keyActions.set(code, fn)
}

function recomputeMove() {
  let x = 0
  let z = 0
  if (held.has('KeyW') || held.has('ArrowUp')) z += 1
  if (held.has('KeyS') || held.has('ArrowDown')) z -= 1
  if (held.has('KeyD') || held.has('ArrowRight')) x += 1
  if (held.has('KeyA') || held.has('ArrowLeft')) x -= 1
  inputState.move.x = Math.max(-1, Math.min(1, x + touch.x))
  inputState.move.z = Math.max(-1, Math.min(1, z + touch.z))
  inputState.sprint = held.has('ShiftLeft') || held.has('ShiftRight') || touch.sprint
}

// Joystick vector, each axis -1..1 (analog: a half tilt walks at half speed).
export function setTouchMove(x, z) {
  touch.x = x
  touch.z = z
  recomputeMove()
}

export function setTouchSprint(on) {
  touch.sprint = on
  recomputeMove()
}

export function install(showMenu, canvasEl) {
  canvas = canvasEl
  document.addEventListener('pointerlockchange', () => {
    if (isLocked()) orbiting = false
  })
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
    if (e.repeat) return
    if (e.code === 'Escape') {
      showMenu()
      return
    }
    held.add(e.code)
    if (e.code === 'Space') {
      inputState.jump = true
      inputState.struggle++
    }
    if (e.code === 'KeyC' || e.code === 'ControlLeft') inputState.crouch = !inputState.crouch
    if (e.code === 'KeyF') inputState.throw = true
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5))
      if (n >= 1 && n <= 9) inputState.slot = n - 1
      else if (n === 0) inputState.slot = 9 // the 10th hotbar slot
    }
    keyActions.get(e.code)?.()
    recomputeMove()
  })
  window.addEventListener('keyup', (e) => {
    held.delete(e.code)
    recomputeMove()
  })
  window.addEventListener('pointerdown', (e) => {
    const onWorld = e.target === canvas
    if (isLocked() && e.pointerType === 'mouse') {
      // Locked cursor: left = grab (held), right = throw.
      if (e.button === 0) inputState.grab = true
      if (e.button === 2) inputState.throw = true
      return
    }
    if (e.button === 2 && !isLocked()) orbiting = true
    if (e.button === 0 && onWorld && e.pointerType === 'mouse') {
      // A click on the world takes the cursor (Esc gives it back; never on touch: there is no
      // cursor), also mid-race, where the click is a boost tap too. Until the lock lands (or where
      // it is refused) the drag turns the camera instead.
      requestLock()
      if (!isLocked() && !lockBlocked) orbiting = true
    }
  })
  window.addEventListener('pointerup', (e) => {
    if (e.button === 0 || e.button === 2) orbiting = false
    if (e.button === 0 && e.pointerType === 'mouse') inputState.grab = false
  })
  document.addEventListener('pointerlockchange', () => {
    if (!isLocked()) inputState.grab = false
  })
  window.addEventListener('pointermove', (e) => {
    // Chorded mouse buttons (right pressed while left is held, left let go while right is held) never
    // fire pointerdown / pointerup, only a pointermove with `button` set: throw while holding, and
    // never stay stuck holding after letting go of the left button first.
    if (isLocked() && e.pointerType === 'mouse' && e.button >= 0) {
      if (e.button === 2 && e.buttons & 2) inputState.throw = true
      if (e.button === 0) inputState.grab = !!(e.buttons & 1)
    }
    if (!orbiting && !isLocked()) return
    inputState.look.dx += e.movementX || 0
    inputState.look.dy += e.movementY || 0
  })
  // Only the game world zooms: a wheel over a HUD panel must not also move the camera.
  window.addEventListener(
    'wheel',
    (e) => {
      if (e.target !== canvas) return
      e.preventDefault()
      inputState.zoom += e.deltaY * (NOTCH_PER_DELTA[e.deltaMode] ?? NOTCH_PER_DELTA[0])
    },
    { passive: false },
  )
  window.addEventListener('contextmenu', (e) => e.preventDefault())
  window.addEventListener('blur', () => {
    held.clear()
    orbiting = false
    inputState.jump = false
    inputState.grab = false
    recomputeMove()
  })
}
