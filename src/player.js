import { inputState } from './input.js'
import { getYaw, syncYawToPlayer } from './camera.js'
import { isFirstPerson } from './modes.js'
import { PLAYER_GROUPS, RAPIER, alpha, onTick, world } from './physics.js'
import { PHYSICS, PLAYER_DIMS, SPAWN, SPAWN_FACING, STAMINA } from './config.js'

// The local player singleton, mutated in place. A kinematic Rapier capsule
// driven by Rapier's KinematicCharacterController: it slides along walls,
// autosteps small ledges, climbs slopes up to PHYSICS.maxSlope, snaps down
// steps and shoves dynamic bodies (loot) with PHYSICS.pushMass.
// Gravity, jumping (with coyote time and a jump buffer), crouching (a shorter
// capsule that fits under furniture), stamina and acceleration are ours;
// collision resolution is Rapier's. Stepped once per physics tick.
export const player = {
  position: { x: 0, y: 0, z: 0 }, // capsule base (feet), at the latest tick
  renderPosition: { x: 0, y: 0, z: 0 }, // feet, interpolated for this frame
  velocity: { x: 0, y: 0, z: 0 },
  grounded: true,
  facing: SPAWN_FACING, // yaw the character model faces, radians
  dims: { ...PLAYER_DIMS },
  crouching: false,
  sprinting: false,
  stamina: STAMINA.max,
  frozen: false, // no control (cutscenes, results); gravity still applies
  // Set by the game every frame from upgrades / boosts.
  mods: { speed: 1, staminaMax: STAMINA.max, endless: false },
}

const HALF = PLAYER_DIMS.height / 2 // standing capsule centre above the feet
const CROUCH_HALF = PLAYER_DIMS.crouchHeight / 2
const prev = { x: 0, y: 0, z: 0 }
let body = null
let collider = null
let controller = null
let sinceGrounded = 0
let jumpQueued = 0 // s left on a buffered jump
let restTimer = 0 // s since stamina was last spent
let stride = 0 // m walked since the last footstep
let airVy = 0 // the fall speed just before landing
let spawnPoint = { ...SPAWN }
let spawnFacing = SPAWN_FACING
// A scripted mover (Grandpa's hand, the cage): fn(dt) -> { x, y, z } feet position, or null when done.
let driver = null
const respawnListeners = []
const stepListeners = []
const landListeners = []
const jumpListeners = []

export function setDriver(fn) {
  driver = fn
  if (!fn) return
  player.velocity.x = player.velocity.y = player.velocity.z = 0
}
export const isDriven = () => !!driver
export const currentDriver = () => driver
// Flings the player (the toaster, letting go of the ceiling fan). For `carry` seconds in the air the
// horizontal speed is kept (the stick only steers) instead of easing back to walking speed.
let carry = 0
let carryAge = 0
let carryCap = 0
export function launch(vx, vy, vz, carrySeconds = 1.5) {
  driver = null
  player.velocity.x = vx
  player.velocity.y = vy
  player.velocity.z = vz
  player.grounded = false
  sinceGrounded = PHYSICS.coyoteTime + 1
  jumpQueued = 0
  carry = carrySeconds
  carryAge = 0
  carryCap = Math.max(PHYSICS.sprintSpeed, Math.hypot(vx, vz))
}
// fn() runs whenever the player respawns (R, falling out of the world, the portal).
export const onRespawn = (fn) => respawnListeners.push(fn)
// fn({ x, y, z, sprint, crouch }) on every footstep on the ground.
export const onStep = (fn) => stepListeners.push(fn)
// fn({ x, y, z, speed }) when landing from a fall.
export const onLand = (fn) => landListeners.push(fn)
export const onJump = (fn) => jumpListeners.push(fn)
// Where R / falling out of the world puts you (the lobby, or the heist's sidewalk).
export function setSpawnPoint(p, facing = spawnFacing) {
  spawnPoint = { x: p.x, y: p.y ?? 0.05, z: p.z }
  spawnFacing = facing
}

export function createPlayerBody() {
  const r = PLAYER_DIMS.radius
  body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(SPAWN.x, SPAWN.y + HALF, SPAWN.z))
  collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF - r, r).setFriction(0).setCollisionGroups(PLAYER_GROUPS), body)

  controller = world.createCharacterController(0.02)
  controller.setUp({ x: 0, y: 1, z: 0 })
  controller.enableAutostep(PHYSICS.stepHeight, 0.2, false)
  controller.enableSnapToGround(PHYSICS.snapToGround)
  controller.setMaxSlopeClimbAngle((PHYSICS.maxSlope * Math.PI) / 180)
  controller.setMinSlopeSlideAngle(((PHYSICS.maxSlope + 5) * Math.PI) / 180)
  controller.setApplyImpulsesToDynamicBodies(true)
  controller.setCharacterMass(PHYSICS.pushMass)

  resetPlayer()
  onTick(step)
}
export const playerCollider = () => collider
export const playerBody = () => body

export function resetPlayer(spawn = spawnPoint, facing = spawnFacing) {
  player.position.x = prev.x = player.renderPosition.x = spawn.x
  player.position.y = prev.y = player.renderPosition.y = spawn.y
  player.position.z = prev.z = player.renderPosition.z = spawn.z
  player.velocity.x = player.velocity.y = player.velocity.z = 0
  player.grounded = true
  carry = 0
  player.facing = facing
  body?.setTranslation({ x: spawn.x, y: spawn.y + HALF, z: spawn.z }, true)
  body?.setNextKinematicTranslation({ x: spawn.x, y: spawn.y + HALF, z: spawn.z })
}

export function respawn() {
  driver = null
  resetPlayer()
  syncYawToPlayer()
  for (const fn of respawnListeners) fn()
}

// --- Crouch ------------------------------------------------------------------------------------------
// The capsule shrinks from the top (the feet stay put). Standing up needs head room: under a bed you
// stay crouched until you crawl out.
function setCrouchShape(on) {
  const r = PLAYER_DIMS.radius
  const half = on ? CROUCH_HALF : HALF
  collider.setHalfHeight(half - r)
  collider.setTranslationWrtParent({ x: 0, y: half - HALF, z: 0 })
  player.dims.height = on ? PLAYER_DIMS.crouchHeight : PLAYER_DIMS.height
  player.crouching = on
}
const STATIC_ONLY = () => RAPIER.QueryFilterFlags.EXCLUDE_DYNAMIC | RAPIER.QueryFilterFlags.EXCLUDE_SENSORS
function headRoom() {
  const r = PLAYER_DIMS.radius * 0.92
  const shape = new RAPIER.Capsule(HALF - PLAYER_DIMS.radius, r)
  const p = player.position
  const hit = world.intersectionWithShape({ x: p.x, y: p.y + HALF + 0.04, z: p.z }, { x: 0, y: 0, z: 0, w: 1 }, shape, STATIC_ONLY(), undefined, collider)
  return !hit
}
// True when standing up right now would hit something (the HUD shows "crawl out").
export const crouchLocked = () => player.crouching && !headRoom()

const TAU = Math.PI * 2
// Turns angle `from` toward `to` by at most maxDelta, the short way round.
function rotateTowards(from, to, maxDelta) {
  const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from))
  if (Math.abs(diff) <= maxDelta) return to
  return (from + Math.sign(diff) * maxDelta) % TAU
}

// Moves the (x, z) velocity toward the target as one 2D vector so it curves
// straight instead of warping axis-by-axis.
function approach2D(v, targetX, targetZ, maxDelta) {
  const dx = targetX - v.x
  const dz = targetZ - v.z
  const dist = Math.hypot(dx, dz)
  if (dist <= maxDelta || dist === 0) {
    v.x = targetX
    v.z = targetZ
  } else {
    v.x += (dx / dist) * maxDelta
    v.z += (dz / dist) * maxDelta
  }
}

function step(dt) {
  prev.x = player.position.x
  prev.y = player.position.y
  prev.z = player.position.z

  if (driver) {
    const p = driver(dt)
    if (p) {
      body.setNextKinematicTranslation({ x: p.x, y: p.y + HALF, z: p.z })
      player.position.x = p.x
      player.position.y = p.y
      player.position.z = p.z
      player.grounded = false
      player.velocity.x = player.velocity.z = 0
      player.velocity.y = 0
      player.sprinting = false
      if (p.facing !== undefined) player.facing = p.facing
      return
    }
    driver = null
    inputState.jump = false
    jumpQueued = 0
  }

  // Crouch: toggled by C / Ctrl / the touch button (input.js sets inputState.crouch).
  const wantCrouch = !!inputState.crouch && !player.frozen
  if (wantCrouch !== player.crouching) {
    if (wantCrouch) setCrouchShape(true)
    else if (headRoom()) setCrouchShape(false)
  }

  // Camera-relative ground basis.
  const yaw = getYaw()
  const fwdX = -Math.sin(yaw)
  const fwdZ = -Math.cos(yaw)
  const rightX = Math.cos(yaw)
  const rightZ = -Math.sin(yaw)
  const mv = player.frozen ? { x: 0, z: 0 } : inputState.move
  const len = Math.hypot(mv.x, mv.z)
  const scale = len > 1 ? 1 / len : 1
  const wishX = (fwdX * mv.z + rightX * mv.x) * scale
  const wishZ = (fwdZ * mv.z + rightZ * mv.x) * scale

  // Stamina: sprinting drains it, resting refills it.
  const maxSt = player.mods.staminaMax
  const moving = len > 0.1
  const canStart = player.stamina >= STAMINA.minToSprint || player.sprinting
  player.sprinting = !!inputState.sprint && moving && !player.crouching && player.stamina > 0 && canStart && !player.frozen
  if (player.sprinting && !player.mods.endless) {
    player.stamina = Math.max(0, player.stamina - STAMINA.sprintDrain * dt)
    restTimer = 0
  } else {
    restTimer += dt
    if (restTimer > STAMINA.regenDelay) player.stamina = Math.min(maxSt, player.stamina + STAMINA.regen * dt)
  }
  if (player.mods.endless) player.stamina = maxSt
  player.stamina = Math.min(player.stamina, maxSt)

  const base = player.crouching ? PHYSICS.crouchSpeed : player.sprinting ? PHYSICS.sprintSpeed : PHYSICS.walkSpeed
  const speed = base * player.mods.speed

  if (carry > 0 && (player.grounded && carryAge > 0.1)) carry = 0
  if (carry > 0) {
    // launched: keep the momentum, the stick only steers
    carry -= dt
    carryAge += dt
    player.velocity.x += wishX * PHYSICS.airAccel * 0.7 * dt
    player.velocity.z += wishZ * PHYSICS.airAccel * 0.7 * dt
    const h = Math.hypot(player.velocity.x, player.velocity.z)
    if (h > carryCap) {
      player.velocity.x *= carryCap / h
      player.velocity.z *= carryCap / h
    }
  } else {
    const rate = !player.grounded ? PHYSICS.airAccel : len > 0.01 ? PHYSICS.accel : PHYSICS.decel
    approach2D(player.velocity, wishX * speed, wishZ * speed, rate * dt)
  }

  // Jump: buffered a little before landing, and allowed a little after leaving a ledge.
  if (inputState.jump) {
    if (!player.frozen) jumpQueued = PHYSICS.jumpBuffer
    inputState.jump = false
  }
  sinceGrounded = player.grounded ? 0 : sinceGrounded + dt
  let jumped = false
  if (jumpQueued > 0 && sinceGrounded <= PHYSICS.coyoteTime && !player.crouching) {
    player.velocity.y = PHYSICS.jumpSpeed
    jumpQueued = 0
    sinceGrounded = PHYSICS.coyoteTime + 1
    jumped = true
    if (!player.mods.endless) player.stamina = Math.max(0, player.stamina - STAMINA.jumpCost)
    restTimer = 0
    for (const fn of jumpListeners) fn(player.position)
  }
  jumpQueued = Math.max(0, jumpQueued - dt)

  player.velocity.y += PHYSICS.gravity * dt
  if (player.grounded && !jumped && player.velocity.y < -2) player.velocity.y = -2 // stay pressed to slopes

  const wasGrounded = player.grounded
  if (!wasGrounded) airVy = Math.min(airVy, player.velocity.y)

  const desired = { x: player.velocity.x * dt, y: player.velocity.y * dt, z: player.velocity.z * dt }
  // the player's groups filter the sweep too: held loot (player bit cleared) never blocks or lifts you
  controller.computeColliderMovement(collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, PLAYER_GROUPS)
  const moved = controller.computedMovement()
  player.grounded = !jumped && controller.computedGrounded()

  // Blocked vertically: a ceiling stops the rise, the floor stops the fall.
  if (player.velocity.y > 0 && moved.y < desired.y * 0.5) player.velocity.y = 0
  if (player.grounded && player.velocity.y < 0) player.velocity.y = Math.max(player.velocity.y, -2)

  const t = body.translation()
  const next = { x: t.x + moved.x, y: t.y + moved.y, z: t.z + moved.z }
  body.setNextKinematicTranslation(next)
  player.position.x = next.x
  player.position.y = next.y - HALF
  player.position.z = next.z

  // Landing + footsteps (the game turns them into sounds, dust and noise Grandpa can hear).
  if (player.grounded && !wasGrounded) {
    if (airVy < -6) for (const fn of landListeners) fn({ ...player.position, speed: -airVy })
    airVy = 0
    stride = 0
  }
  if (player.grounded) {
    stride += Math.hypot(moved.x, moved.z)
    const gap = player.crouching ? 0.9 : player.sprinting ? 1.7 : 1.25
    if (stride > gap) {
      stride = 0
      for (const fn of stepListeners) fn({ x: player.position.x, y: player.position.y, z: player.position.z, sprint: player.sprinting, crouch: player.crouching })
    }
  }

  if (player.position.y < PHYSICS.killY) {
    respawn()
    return
  }

  // The body turns toward its heading; in first person it always faces the view.
  if (isFirstPerson()) player.facing = yaw + Math.PI
  else if (inputState.facingLock) player.facing = rotateTowards(player.facing, yaw + Math.PI, PHYSICS.turnSpeed * dt) // grabbing: face what you hold
  else if (Math.hypot(wishX, wishZ) > 0.05) {
    player.facing = rotateTowards(player.facing, Math.atan2(wishX, wishZ), PHYSICS.turnSpeed * dt)
  }
}

// Called once per frame after the physics ticks: interpolated feet position.
export function interpolate() {
  const p = player.position
  const r = player.renderPosition
  r.x = prev.x + (p.x - prev.x) * alpha
  r.y = prev.y + (p.y - prev.y) * alpha
  r.z = prev.z + (p.z - prev.z) * alpha
}
