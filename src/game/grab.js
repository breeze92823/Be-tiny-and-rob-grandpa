// Stretchy grabber arms. Hold the grab button on something (crosshair ray from the camera, within reach
// of the player's chest): loot is carried in front of you, doors/windows/the garage door swing or slide
// where you pull them, switches click. Wheel / pinch = hold distance, right mouse / F = throw (toward the
// crosshair, plus your running speed). Heavy loot lags and sags (Strong Grip lifts more).
//
// Loot: a velocity controller at the centre of mass (no pendulum swing) that rides on the carrier's
// speed, turns with the view, stops short of walls and never collides with its holder.
// Jointed parts: a velocity spring applied as impulses AT the grabbed point (pulled along their joint).
import { CylinderGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3 } from 'three'
import { GRAB, PHYSICS } from '../config.js'
import { inputState } from '../input.js'
import { castRay, onTick, withoutPlayer } from '../physics.js'
import { player, playerCollider } from '../player.js'
import { isFirstPerson } from '../modes.js'

const tmpA = new Vector3()
const tmpB = new Vector3()
const tmpQ = new Quaternion()
const UP = new Vector3(0, 1, 0)

// --- Arm visuals (also used for other players) --------------------------------------------------------
const SEGS = 12
let segGeo = null
let gloveGeo = null
let thumbGeo = null
export function makeArms(parent) {
  segGeo ??= new CylinderGeometry(1, 0.86, 1, 10, 1, true).translate(0, 0.5, 0)
  gloveGeo ??= new SphereGeometry(1, 14, 10)
  thumbGeo ??= new SphereGeometry(1, 10, 8)
  const armMat = new MeshStandardMaterial({ color: GRAB.armColor, roughness: 0.35, metalness: 0.15 })
  const gloveMat = new MeshStandardMaterial({ color: GRAB.gloveColor, roughness: 0.45 })
  const root = new Group()
  root.visible = false
  parent.add(root)
  const arms = [0, 1].map(() => {
    const segs = []
    for (let i = 0; i < SEGS; i++) {
      const s = new Mesh(segGeo, armMat)
      s.castShadow = true
      root.add(s)
      segs.push(s)
    }
    const glove = new Mesh(gloveGeo, gloveMat)
    glove.castShadow = true
    const thumb = new Mesh(thumbGeo, gloveMat)
    thumb.scale.setScalar(0.4)
    thumb.position.set(0.55, 0.2, 0.2)
    glove.add(thumb)
    // cuff ring
    const cuff = new Mesh(segGeo, gloveMat)
    cuff.scale.set(1.08, 0.35, 1.08)
    cuff.position.y = -1.05
    glove.add(cuff)
    root.add(glove)
    return { segs, glove }
  })
  const pts = Array.from({ length: SEGS + 1 }, () => new Vector3())
  const ctrl = new Vector3()
  return {
    root,
    // shoulder L/R -> hand points (world), wobble 0..1, thickness scale
    update(shL, shR, handL, handR, wobble = 0, time = 0, thick = 1) {
      root.visible = true
      ;[[shL, handL], [shR, handR]].forEach(([a, b], k) => {
        const arm = arms[k]
        const len = a.distanceTo(b)
        // sag control point (droops a little, wobbles after a grab)
        ctrl.lerpVectors(a, b, 0.5)
        ctrl.y -= Math.min(1.5, len * 0.07)
        if (wobble > 0) {
          ctrl.x += Math.sin(time * 38 + k * 2) * wobble * len * 0.08
          ctrl.y += Math.cos(time * 31 + k) * wobble * len * 0.06
        }
        for (let i = 0; i <= SEGS; i++) {
          const t = i / SEGS
          const u = 1 - t
          pts[i].set(u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x, u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y, u * u * a.z + 2 * u * t * ctrl.z + t * t * b.z)
        }
        const r = 0.13 * thick * (1 / (1 + len * 0.012))
        for (let i = 0; i < SEGS; i++) {
          const s = arm.segs[i]
          tmpA.subVectors(pts[i + 1], pts[i])
          const l = tmpA.length()
          s.position.copy(pts[i])
          tmpQ.setFromUnitVectors(UP, tmpA.normalize())
          s.quaternion.copy(tmpQ)
          s.scale.set(r, l + 0.02, r)
        }
        arm.glove.position.copy(b)
        tmpA.subVectors(b, pts[SEGS - 1]).normalize()
        arm.glove.quaternion.setFromUnitVectors(UP, tmpA)
        arm.glove.scale.setScalar(0.3 * thick)
      })
    },
    hide() {
      root.visible = false
    },
  }
}

// One physics tick of the grab spring: pull the body's anchor point (body-local) toward `target`,
// limited by the lift capacity (kg). Returns { dist } (anchor -> target). Used for the local grab and,
// on the host, for crewmates pulling doors / windows (their pulls arrive over the network).
const pA = new Vector3()
const pB = new Vector3()
const pQ = new Quaternion()
export function pullBody(body, anchorLocal, target, capacity, dt, outAnchor = null) {
  const t = body.translation()
  const r = body.rotation()
  pQ.set(r.x, r.y, r.z, r.w)
  const anchor = (outAnchor ?? pB).copy(anchorLocal).applyQuaternion(pQ)
  anchor.x += t.x
  anchor.y += t.y
  anchor.z += t.z
  const err = pA.subVectors(target, anchor)
  const dist = err.length()
  const desired = err.multiplyScalar(GRAB.stiffness)
  if (desired.length() > GRAB.maxSpeed) desired.setLength(GRAB.maxSpeed)
  const lv = body.linvel()
  const av = body.angvel()
  const com = body.worldCom ? body.worldCom() : t
  const rx = anchor.x - com.x
  const ry = anchor.y - com.y
  const rz = anchor.z - com.z
  const vax = lv.x + (av.y * rz - av.z * ry)
  const vay = lv.y + (av.z * rx - av.x * rz)
  const vaz = lv.z + (av.x * ry - av.y * rx)
  const mass = body.mass()
  const ix = (desired.x - vax) * Math.min(mass, capacity * 1.4) * 0.55
  let iy = (desired.y - vay) * Math.min(mass, capacity * 1.4) * 0.55
  const iz = (desired.z - vaz) * Math.min(mass, capacity * 1.4) * 0.55
  const cap = capacity * GRAB.maxImpulsePerKg
  const len = Math.hypot(ix, iy, iz)
  const k = len > cap ? cap / len : 1
  iy *= k
  const g = body.gravityScale()
  if (g > 0) iy += Math.min(mass, capacity) * -PHYSICS.gravity * g * dt
  body.applyImpulseAtPoint({ x: ix * k, y: iy, z: iz * k }, { x: anchor.x, y: anchor.y, z: anchor.z }, true)
  return { dist }
}

// --- Carrying loot ---------------------------------------------------------------------------------------
// One physics tick of a carry: the held point chases `target` through a velocity controller applied at the
// centre of mass (no pendulum swing), riding on the carrier's own velocity so it keeps up while you run;
// its rotation eases to `targetQ`. Strength = lift capacity / mass (1 = light enough): heavier loot
// accelerates slower and, once the support budget cannot beat gravity, only drags along the floor.
const cA = new Vector3()
const cQ = new Quaternion()
const cE = new Quaternion()
export function carryBody(body, anchorLocal, target, targetQ, carrierVel, capacity, dt, outAnchor) {
  const t = body.translation()
  const r = body.rotation()
  cQ.set(r.x, r.y, r.z, r.w)
  const anchor = outAnchor.copy(anchorLocal).applyQuaternion(cQ)
  anchor.x += t.x
  anchor.y += t.y
  anchor.z += t.z
  const err = cA.subVectors(target, anchor)
  const dist = err.length()
  const strength = Math.min(1, capacity / Math.max(0.1, body.mass()))

  // velocity: ride along with the carrier + close the gap
  err.multiplyScalar(GRAB.stiffness)
  if (err.lengthSq() > GRAB.maxSpeed * GRAB.maxSpeed) err.setLength(GRAB.maxSpeed)
  const lv = body.linvel()
  // the support budget first cancels gravity (the world step adds it after this), the rest steers
  const g = -PHYSICS.gravity * body.gravityScale() * dt
  let budget = GRAB.carryAccel * strength * dt
  const lift = Math.min(g, budget)
  budget -= lift
  let cx = carrierVel.x + err.x - lv.x
  let cy = carrierVel.y + err.y - (lv.y + lift - g)
  let cz = carrierVel.z + err.z - lv.z
  const cl = Math.hypot(cx, cy, cz)
  if (cl > budget) {
    const k = budget / cl
    cx *= k
    cy *= k
    cz *= k
  }
  body.setLinvel({ x: lv.x + cx, y: lv.y + cy + lift, z: lv.z + cz }, true)

  // rotation: shortest arc to targetQ, as an angular velocity
  cE.copy(targetQ).multiply(cQ.invert())
  if (cE.w < 0) cE.set(-cE.x, -cE.y, -cE.z, -cE.w)
  const s = Math.sqrt(Math.max(0, 1 - cE.w * cE.w))
  let wx = 0
  let wy = 0
  let wz = 0
  if (s > 1e-4) {
    const k = (2 * Math.acos(Math.min(1, cE.w)) * GRAB.rotStiffness) / s
    wx = cE.x * k
    wy = cE.y * k
    wz = cE.z * k
    const wl = Math.hypot(wx, wy, wz)
    if (wl > GRAB.maxSpin) {
      wx *= GRAB.maxSpin / wl
      wy *= GRAB.maxSpin / wl
      wz *= GRAB.maxSpin / wl
    }
  }
  const av = body.angvel()
  const b = 0.25 + 0.75 * strength
  body.setAngvel({ x: av.x + (wx - av.x) * b, y: av.y + (wy - av.y) * b, z: av.z + (wz - av.z) * b }, true)
  return { dist, strength }
}

// --- The local player's grab ---------------------------------------------------------------------------
// hooks: { canGrab(), useSwitch(sw), pickup(owner), ride(owner, point) -> started?, rideAnchor(owner, out),
//          grabbed(owner), released(owner, thrown), isRemote(owner),
//          remotePull(owner, anchorLocal, target, on), upgrades() -> { arms, grip } }
//
// Loot is CARRIED (by its centre of mass, turning with your view, never colliding with you, keeping up
// while you run, stopping short of walls instead of grinding into them). Doors, windows, the garage door
// and other jointed parts are PULLED at the grabbed point so they swing / slide along their joint.
// The hold point sits under the crosshair at `holdDist` metres from the chest (wheel / pinch changes it).
export function createGrab(scene, camera, hooks) {
  const arms = makeArms(scene)
  const state = {
    held: null, // owner being held
    carry: false, // loot carried (vs a jointed part pulled)
    anchorLocal: new Vector3(), // grab point in the body's local space
    holdDist: 4, // metres from the CHEST to the held point, along the crosshair (independent of camera zoom)
    target: new Vector3(),
    anchorWorld: new Vector3(),
    qRel: new Quaternion(), // the held loot's rotation relative to the view yaw
    viewYaw: 0,
    hover: null, // { owner, point, dist }
    strain: 0,
    wobble: 0,
    extend: 0, // 0..1 arm shoot-out animation
    slip: 0,
    pressed: false,
    savedDamping: 0,
  }
  const viewDir = new Vector3()
  const camPos = new Vector3()
  const frameChest = new Vector3() // chest at the interpolated (rendered) position
  const tickChest = new Vector3() // chest at the latest physics position
  const camOff = new Vector3() // camera - chest this frame: each tick rebuilds the crosshair ray from it
  const lastChest = new Vector3()
  let haveLastChest = false
  const carrierVel = new Vector3()
  const targetQ = new Quaternion()
  const yawQ = new Quaternion()
  let clock = 0

  const range = () => GRAB.range + (hooks.upgrades?.().arms ?? 0) * GRAB.rangePerLevel
  const lift = () => GRAB.liftMass + (hooks.upgrades?.().grip ?? 0) * GRAB.liftPerLevel

  function chestAt(p, out) {
    return out.set(p.x, p.y + player.dims.height * 0.72, p.z)
  }

  // --- Held loot ignores the holder's capsule (and for a moment after letting go) ---
  const ghosts = [] // { o, body, saved: [[collider, groups]], until }
  function ghost(o) {
    let gh = ghosts.find((g) => g.o === o && g.body === o.body)
    if (!gh) {
      gh = { o, body: o.body, saved: [], until: Infinity }
      for (let i = 0; i < o.body.numColliders(); i++) {
        const c = o.body.collider(i)
        const g = c.collisionGroups()
        gh.saved.push([c, g])
        c.setCollisionGroups(withoutPlayer(g))
      }
      ghosts.push(gh)
    }
    gh.until = Infinity
  }
  function unghostLater(o, delay) {
    for (const gh of ghosts) if (gh.o === o) gh.until = clock + delay
  }
  function restoreGhosts() {
    for (let i = ghosts.length - 1; i >= 0; i--) {
      const gh = ghosts[i]
      if (clock < gh.until) continue
      ghosts.splice(i, 1)
      if (gh.o.body !== gh.body) continue // stolen / shattered: the body is gone
      for (const [c, g] of gh.saved) {
        try {
          c.setCollisionGroups(g)
        } catch {
          // collider removed meanwhile
        }
      }
    }
  }

  // The crosshair ray: from the camera through the screen centre.
  function aim() {
    chestAt(player.renderPosition, frameChest)
    const toChest = camPos.distanceTo(frameChest)
    // start the ray level with the player: nothing between the camera and the thief (a window the
    // camera backed through, a door frame) can be grabbed
    const along = tmpB.subVectors(frameChest, camPos).dot(viewDir)
    const skip = Math.max(0, along - 1.2)
    const ox = camPos.x + viewDir.x * skip
    const oy = camPos.y + viewDir.y * skip
    const oz = camPos.z + viewDir.z * skip
    const max = toChest - skip + range() + 1
    const hit = castRay(ox, oy, oz, viewDir.x, viewDir.y, viewDir.z, max, { exclude: playerCollider() })
    if (!hit || !hit.owner || !hit.owner.grabbable) return null
    const d = frameChest.distanceTo(tmpA.set(hit.point.x, hit.point.y, hit.point.z))
    return { owner: hit.owner, point: tmpA.clone(), dist: d, far: d > range() }
  }

  // The hold point: where the crosshair ray (rebuilt from the chest + this frame's camera offset) crosses
  // the sphere of radius holdDist around the chest, far side. Independent of camera zoom / wall pushes.
  function holdTarget(chest, out) {
    const R = state.holdDist
    const b = camOff.dot(viewDir)
    const c = camOff.lengthSq() - R * R
    const disc = b * b - c
    if (disc >= 0) {
      const t = -b + Math.sqrt(disc)
      if (t > 0) return out.copy(chest).add(camOff).addScaledVector(viewDir, t)
    }
    // the ray misses the sphere: the nearest point of the ray, pushed out to the sphere (continuous)
    const tc = Math.max(0, -b)
    tmpA.copy(camOff).addScaledVector(viewDir, tc)
    if (tmpA.lengthSq() < 1e-6) tmpA.copy(viewDir)
    return out.copy(chest).addScaledVector(tmpA.normalize(), R)
  }

  // Carried loot stops short of walls / floors between the chest and the hold point.
  function clampToWalls(o, chest, target) {
    const d = tmpA.subVectors(target, chest)
    const len = d.length()
    if (len < 1e-3) return
    d.divideScalar(len)
    const hit = castRay(chest.x, chest.y, chest.z, d.x, d.y, d.z, len + 0.5, { staticOnly: true, exclude: playerCollider() })
    if (!hit) return
    const size = o.half ? Math.max(o.half.x, o.half.y, o.half.z) : 0.3
    const keep = Math.max(0.3, Math.min(len, hit.toi - GRAB.wallGap - size))
    target.copy(chest).addScaledVector(d, keep)
  }

  function begin(h) {
    const o = h.owner
    if (o.kind === 'switch') {
      hooks.useSwitch?.(o)
      return
    }
    if (o.kind === 'pickup') {
      hooks.pickup?.(o)
      return
    }
    if (o.kind === 'ride') {
      // something you hang on to (the ceiling fan): the game moves the thief, the arms reach its anchor
      if (!hooks.ride?.(o, h.point)) return
      state.held = o
      state.carry = false
      state.wobble = 1
      state.extend = 0
      state.slip = 0
      return
    }
    if (!o.body) return
    if (hooks.canGrab && !hooks.canGrab(o)) return
    state.held = o
    state.carry = o.kind === 'loot' && !hooks.isRemote?.(o)
    // anchor in body-local space
    const t = o.body.translation()
    const r = o.body.rotation()
    tmpQ.set(r.x, r.y, r.z, r.w)
    state.qRel.setFromAxisAngle(UP, -state.viewYaw).multiply(tmpQ)
    tmpQ.invert()
    state.anchorLocal.set(h.point.x - t.x, h.point.y - t.y, h.point.z - t.z).applyQuaternion(tmpQ)
    state.holdDist = Math.max(GRAB.minHold, Math.min(range(), h.dist))
    state.wobble = 1
    state.extend = 0
    state.slip = 0
    state.strain = 0
    if (!hooks.isRemote?.(o)) {
      if (state.carry) ghost(o)
      else {
        // a part whose sweep comes back at you (the garage door's bottom edge) passes through its holder
        if (o.ghostWhileHeld) ghost(o)
        state.savedDamping = o.body.angularDamping()
        o.body.setAngularDamping(Math.max(state.savedDamping, GRAB.holdAngularDamping))
      }
      o.body.wakeUp()
    }
    hooks.grabbed?.(o, h.point)
  }

  // A throw: toward whatever the crosshair points at (so it lands where you aim, not parallel to the
  // camera ray), with a little arc, plus your running speed, and a forward tumble.
  function throwBody(o) {
    const body = o.body
    const k = Math.min(1, lift() / Math.max(0.5, body.mass()))
    const sp = GRAB.throwSpeed * (0.35 + 0.65 * k)
    const hit = castRay(camPos.x, camPos.y, camPos.z, viewDir.x, viewDir.y, viewDir.z, 150, { exclude: playerCollider(), excludeBody: body })
    const aimAt = hit ? tmpA.set(hit.point.x, hit.point.y, hit.point.z) : tmpA.copy(camPos).addScaledVector(viewDir, 150)
    const t = body.translation()
    const dir = tmpB.set(aimAt.x - t.x, aimAt.y - t.y, aimAt.z - t.z)
    if (dir.lengthSq() < 1 || dir.normalize().dot(viewDir) < 0.3) dir.copy(viewDir)
    const v = {
      x: dir.x * sp + carrierVel.x * GRAB.throwInherit,
      y: dir.y * sp + sp * GRAB.throwArc + Math.max(0, carrierVel.y) * GRAB.throwInherit,
      z: dir.z * sp + carrierVel.z * GRAB.throwInherit,
    }
    body.setLinvel(v, true)
    const rx = viewDir.z
    const rz = -viewDir.x // the view's right axis (flat): spin about it = a forward tumble
    const rl = Math.hypot(rx, rz) || 1
    const spin = GRAB.throwSpin * (0.6 + Math.random() * 0.4) * Math.min(1, 3 / Math.max(1, body.mass()) + 0.3)
    body.setAngvel({ x: (rx / rl) * spin + (Math.random() - 0.5) * 1.5, y: (Math.random() - 0.5) * 1.5, z: (rz / rl) * spin + (Math.random() - 0.5) * 1.5 }, true)
    // the launch itself is not an impact (fragile loot used to shatter the moment it left your hands)
    o.lastV?.set(v.x, v.y, v.z)
    if (o.hitCool !== undefined) o.hitCool = 0.2
  }

  function end(thrown = false) {
    const o = state.held
    if (!o) return
    const carried = state.carry
    state.held = null
    state.carry = false
    inputState.facingLock = false
    inputState.holding = false
    if (o.body && !hooks.isRemote?.(o)) {
      if (!carried && o.kind !== 'ride') o.body.setAngularDamping(state.savedDamping)
      if (thrown) throwBody(o)
      else if (carried) {
        // letting go keeps the carry momentum (drop it on the run), capped
        const lv = o.body.linvel()
        const s = Math.hypot(lv.x, lv.y, lv.z)
        if (s > GRAB.dropMaxSpeed) {
          const k = GRAB.dropMaxSpeed / s
          o.body.setLinvel({ x: lv.x * k, y: lv.y * k, z: lv.z * k }, true)
          o.lastV?.set(lv.x * k, lv.y * k, lv.z * k)
        }
      }
    }
    if (carried || o.ghostWhileHeld) unghostLater(o, GRAB.noCollideAfter)
    hooks.released?.(o, thrown)
  }

  // Physics tick: carry / pull the held point toward the target.
  onTick((dt) => {
    clock += dt
    restoreGhosts()
    // how fast the carrier moves (the chest between ticks; a teleport / respawn reads as standing still)
    chestAt(player.position, tickChest)
    if (haveLastChest) {
      carrierVel.subVectors(tickChest, lastChest).divideScalar(dt)
      if (carrierVel.lengthSq() > 30 * 30) carrierVel.set(0, 0, 0)
    }
    lastChest.copy(tickChest)
    haveLastChest = true

    const o = state.held
    if (!o || o.kind === 'ride') return
    if (!o.body || o.state === 'stolen' || o.state === 'broken') return end()
    holdTarget(tickChest, state.target)
    // jointed parts may put the hold point on their own path (the garage door: drag up = lift it)
    if (!state.carry) o.aimPull?.(state.anchorLocal, state.target)
    if (hooks.isRemote?.(o)) {
      hooks.remotePull?.(o, state.anchorLocal, state.target, true)
      return
    }
    let res
    if (state.carry) {
      clampToWalls(o, tickChest, state.target)
      const strength = Math.min(1, lift() / Math.max(0.1, o.body.mass()))
      state.target.y -= GRAB.carrySag * (1 - strength) // heavy loot hangs low
      targetQ.copy(yawQ.setFromAxisAngle(UP, state.viewYaw)).multiply(state.qRel)
      res = carryBody(o.body, state.anchorLocal, state.target, targetQ, carrierVel, lift(), dt, state.anchorWorld)
      state.strain = Math.min(1, res.dist / 4 + (1 - res.strength) * 0.5)
    } else {
      res = pullBody(o.body, state.anchorLocal, state.target, lift(), dt, state.anchorWorld)
      state.strain = Math.min(1, res.dist / 4)
    }
    if (res.dist > GRAB.breakDistance) {
      state.slip += dt
      if (state.slip > 0.35) return end()
    } else state.slip = 0
  })

  const shL = new Vector3()
  const shR = new Vector3()
  const hL = new Vector3()
  const hR = new Vector3()
  const right = new Vector3()

  return {
    state,
    get holding() {
      return state.held
    },
    get hover() {
      return state.hover
    },
    release: () => end(false),
    // Per frame (after the camera): input, hover, the arms.
    update(dt, time) {
      camera.getWorldPosition(camPos)
      camera.getWorldDirection(viewDir)
      state.viewYaw = Math.atan2(-viewDir.x, -viewDir.z)
      camOff.subVectors(camPos, chestAt(player.renderPosition, frameChest))
      const allowed = !hooks.blocked?.()
      // wheel / pinch = hold distance while holding (the camera leaves it alone then)
      if (state.held && inputState.zoom !== 0) {
        state.holdDist = Math.max(GRAB.minHold, Math.min(range(), state.holdDist - inputState.zoom * GRAB.wheelStep))
        inputState.zoom = 0
      }
      const down = inputState.grab && allowed
      if (!state.held) {
        state.hover = allowed ? aim() : null
        if (down && !state.pressed && state.hover && !state.hover.far) begin(state.hover)
      } else {
        state.hover = null
        // throw first: right click / F while holding (even on the frame the grab button is let go)
        if (inputState.throw && allowed && state.held.kind !== 'ride') end(true)
        else if (!down) end(false)
      }
      if (inputState.throw) inputState.throw = false
      state.pressed = down
      inputState.facingLock = !!state.held
      inputState.holding = !!state.held && state.held.kind !== 'ride'

      // arms
      if (!state.held) {
        state.extend = Math.max(0, state.extend - dt * 6)
        arms.hide()
        return
      }
      state.extend = Math.min(1, state.extend + dt * 9)
      state.wobble = Math.max(0, state.wobble - dt * 2.2)
      const o = state.held
      if (o.kind === 'ride') hooks.rideAnchor?.(o, state.anchorWorld)
      else if (o.body) {
        // the rendered (interpolated) mesh, so the gloves stay on it between physics ticks
        const m = o.mesh
        if (m && !hooks.isRemote?.(o)) state.anchorWorld.copy(state.anchorLocal).applyQuaternion(m.quaternion).add(m.position)
        else {
          const t = o.body.translation()
          const r = o.body.rotation()
          tmpQ.set(r.x, r.y, r.z, r.w)
          state.anchorWorld.copy(state.anchorLocal).applyQuaternion(tmpQ).add(tmpB.set(t.x, t.y, t.z))
        }
      }
      right.crossVectors(viewDir, UP).normalize()
      if (isFirstPerson()) {
        shL.copy(camPos).addScaledVector(right, -0.42).addScaledVector(UP, -0.45).addScaledVector(viewDir, 0.25)
        shR.copy(camPos).addScaledVector(right, 0.42).addScaledVector(UP, -0.45).addScaledVector(viewDir, 0.25)
      } else {
        const p = player.renderPosition
        const f = player.facing
        const rx = Math.cos(f)
        const rz = -Math.sin(f)
        const y = p.y + player.dims.height * 0.74
        shL.set(p.x - rx * 0.42 + Math.sin(f) * 0.35, y, p.z - rz * 0.42 + Math.cos(f) * 0.35)
        shR.set(p.x + rx * 0.42 + Math.sin(f) * 0.35, y, p.z + rz * 0.42 + Math.cos(f) * 0.35)
      }
      const e = 1 - Math.pow(1 - state.extend, 3)
      hL.copy(state.anchorWorld).addScaledVector(right, -0.28)
      hR.copy(state.anchorWorld).addScaledVector(right, 0.28)
      hL.lerpVectors(shL, hL, e)
      hR.lerpVectors(shR, hR, e)
      arms.update(shL, shR, hL, hR, state.wobble + state.strain * 0.25, time)
    },
    // What the others draw: the grab point (or null).
    netPoint() {
      return state.held ? state.anchorWorld : null
    },
  }
}
