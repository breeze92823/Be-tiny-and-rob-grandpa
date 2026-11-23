// Every tunable constant lives here; the rest of src/ holds no theme values.

// --- Identity -------------------------------------------------------------
export const GAME_SLUG = 'be-tiny-and-rob-grandpa' // slug registered on bloxity.io
export const GAME_TITLE = "Tiny Thieves: Grandpa's House"

// Forces the Bloxity SDK and avatar CDN to be treated as unavailable (see .env.example).
export const DEV_MODE = import.meta.env.VITE_DEV_MODE === 'true'

// --- World (metres: +X east, +Z south, +Y up) -------------------------------
// Grandpa's house is centred on the origin (front faces +Z); the lobby hideout is far away at LOBBY.center.
export const GROUND_Y = 0
export const SPAWN = { x: 0, y: 0.05, z: 1503.6 } // the lobby hideout (LOBBY.center + a little south)
export const SPAWN_FACING = Math.PI // yaw the character faces on spawn (PI = toward -Z)

// --- Player modes (modes.js) -------------------------------------------------
// 'character' = third-person chase cam with the avatar on screen.
// 'player' = first-person, the camera is the player's eyes and the avatar is hidden.
export const MODES = ['character', 'player']
export const START_MODE = 'character'

// --- Physics (physics.js, player.js) ------------------------------------------
export const PHYSICS = {
  gravity: -22, // m/s^2 for dynamic bodies and the player
  fixedStep: 1 / 60, // s per physics tick; rendering interpolates between ticks
  maxSubSteps: 5, // a long frame never runs more ticks than this
  walkSpeed: 7.5, // m/s
  sprintSpeed: 13, // m/s with Shift held (costs stamina)
  crouchSpeed: 4, // m/s crouched (silent, harder to see, fits under furniture)
  accel: 70, // m/s^2 toward the target velocity on the ground
  airAccel: 24, // m/s^2 steering while airborne
  decel: 60, // m/s^2 when no key is held
  turnSpeed: 12, // rad/s the body turns toward its heading
  jumpSpeed: 9.2, // m/s (~1.9 m jump)
  coyoteTime: 0.1, // s after leaving a ledge a jump still counts
  jumpBuffer: 0.12, // s a jump pressed before landing is remembered
  stepHeight: 0.5, // m autostep
  maxSlope: 50, // degrees the player can walk up
  snapToGround: 0.4, // m the controller stays glued to downward steps and slopes
  pushMass: 25, // kg the character weighs when shoving loot
  killY: -25, // fell this far: respawn
}
export const PLAYER_DIMS = { radius: 0.5, height: 1.8, crouchHeight: 1.05 } // capsule the character controller moves

// Stamina (player.js): sprinting and jumping cost it; it refills after a short rest.
export const STAMINA = { max: 100, sprintDrain: 17, jumpCost: 5, regen: 26, regenDelay: 0.7, minToSprint: 12 }

// --- Look ------------------------------------------------------------------
export const RENDER = { exposure: 1.0 }
export const FOG = { near: 220, far: 900 }
// The two lighting moods lighting.js blends between (key N toggles).
export const TIME_OF_DAY = {
  transition: 2.5, // s to blend day <-> night
  day: {
    zenith: '#1576f0',
    horizon: '#a9e2ff',
    sunColor: '#fff4de',
    // Sun + hemi + env together keep the pale sand (#eed39c) near its own tan;
    // much more and ACES washes it (and the props) out to grey-white.
    sunIntensity: 2.4,
    sunElevation: 55, // degrees above the horizon
    sunAzimuth: 35, // degrees, 0 = from +Z
    hemiSky: '#e4f2ff',
    hemiGround: '#d8c39a',
    hemiIntensity: 0.8,
    envIntensity: 0.45,
    lampIntensity: 0,
    stars: 0,
    exposure: 0.95,
  },
  night: {
    zenith: '#050b22',
    horizon: '#24345e',
    sunColor: '#9fb4ff', // the moon
    sunIntensity: 0.55,
    sunElevation: 38,
    sunAzimuth: -60,
    hemiSky: '#3a4c80',
    hemiGround: '#1a1a22',
    hemiIntensity: 0.35,
    envIntensity: 0.25,
    lampIntensity: 30,
    stars: 1,
    exposure: 1.15,
  },
}
export const LIGHT = {
  shadowRange: 60, // half-width of the sun's shadow box around the player
  lampColor: '#ffb35c',
  lampDistance: 22,
}

// Default (fallback) character look, used only when player.glb cannot load.
export const CHARACTER_COLORS = { skin: '#f2c79a', suit: '#2f6fd0', hair: '#4a2f1c' }

export const MATERIAL_PBR = {
  PLAYER: { roughness: 0.7, metalness: 0 },
  GROUND: { roughness: 0.95, metalness: 0 },
}

// --- Graphics presets, picked by the Bloxity graphics_quality setting ----------
export const GRAPHICS_PRESETS = {
  Low: { shadows: false, shadowMap: 512, antialias: false, dpr: 1, bloom: false, particles: 0.35 },
  Medium: { shadows: true, shadowMap: 1024, antialias: false, dpr: 1.25, bloom: false, particles: 0.6 },
  High: { shadows: true, shadowMap: 2048, antialias: true, dpr: 2, bloom: true, particles: 1 },
  Ultra: { shadows: true, shadowMap: 4096, antialias: true, dpr: 2, bloom: true, particles: 1 },
}

// Bloom (postfx.js): only HDR-bright pixels (above threshold, linear, before
// tone mapping) glow: neon rails, waterfall, VIP gate, particles. Sunlit sand
// stays under the threshold.
// scale: the resolution the bloom pass works at, relative to the screen (postfx.js; 0.5 = cheaper).
export const BLOOM = { strength: 0.6, radius: 0.35, threshold: 2.0, scale: 0.5 }
// Neon materials (propkit.js): k = HDR colour multiplier with bloom on; with
// bloom off they are capped at plainMax so they stay coloured, not white.
export const NEON = { k: 3.5, plainMax: 1.2 }

// Phones and tablets default to a lighter preset when the portal sends no value,
// and any preset is capped there (a phone at DPR 3 renders 9x the pixels; bloom
// is a full-screen multi-pass blur, so it stays off on phones).
export const COARSE_POINTER = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
export const DEFAULT_GRAPHICS = COARSE_POINTER ? 'Medium' : 'High'
export const MOBILE_GRAPHICS_CAP = { dpr: 1.5, shadowMap: 1024, particles: 0.6 }

// The preset to render with on this device.
export function graphicsPreset(name) {
  const p = GRAPHICS_PRESETS[name] ?? GRAPHICS_PRESETS[DEFAULT_GRAPHICS]
  if (!COARSE_POINTER) return p
  const cap = MOBILE_GRAPHICS_CAP
  return { ...p, dpr: Math.min(p.dpr, cap.dpr), shadowMap: Math.min(p.shadowMap, cap.shadowMap), bloom: false, particles: Math.min(p.particles, cap.particles) }
}

// --- Touch controls (touch.js) --------------------------------------------------
export const TOUCH = {
  deadZone: 0.12, // fraction of the joystick radius that does nothing
  lookScale: 1.5, // touch drag pixels -> look, relative to a mouse pixel
  pinchPixelsPerNotch: 30, // finger spread change that equals one wheel notch
}

// --- Camera (camera.js) -------------------------------------------------------
export const CAMERA = {
  fov: 70,
  near: 0.1,
  far: 1200,
  startPitch: 0.14, // radians above the horizon (low chase cam)
  minPitch: -0.75,
  maxPitch: 1.25,
  firstPersonPitch: 1.45, // |pitch| limit looking up/down in player mode
  eyeHeight: 0.92, // eye height as a fraction of player height (player mode)
  distance: 8.5, // resting boom length, m
  minDistance: 2.5, // wheel in past this enters player mode
  maxDistance: 22,
  followLerp: 14, // 1/s: the one smoothing stage, on the point the camera follows
  targetHeight: 1.2, // look-at point as a fraction of player height
  lookSensitivity: 0.0026, // rad per pixel of mouse movement
  zoomStep: 0.9, // m per wheel notch
  zoomEase: 12, // 1/s the zoom glides to its target
  speedFov: 6, // degrees the FOV widens at sprint speed
  speedEase: 3, // 1/s the speed framing eases in and out
  clearEase: 6, // 1/s the boom eases back out once a wall stops blocking it
}

// --- Bloxity (bloxity.js, avatar/) -------------------------------------------------
// SDK setting keys this game listens for; registering a listener makes the control
// appear in the portal's settings menu.
export const SETTINGS = {
  master_volume: { def: '80', type: 'number', min: 0, max: 100 }, // all sound: effects (game/sfx.js) and music (game/music.js)
  music_volume: { def: '80', type: 'number', min: 0, max: 100 }, // the music only (on top of master_volume)
  graphics_quality: { def: DEFAULT_GRAPHICS, type: 'enum', values: ['Low', 'Medium', 'High', 'Ultra'] },
  camera_sensitivity: { def: '1', type: 'number', min: 0.1, max: 5 },
  show_fps: { def: 'false', type: 'bool' },
  fullscreen: { def: 'false', type: 'bool' },
}

// Hosted leaderboards, declared with leaderboard.define() right after init (ids are permanent: lowercase
// a-z 0-9 _ -, max 32). The game SERVER reports the scores from its own copy of the progress (backend
// constants.ts declares the same boards); the client never submits.
export const LEADERBOARDS = [
  { id: 'escapes', label: 'Escapes', order: 'desc', mode: 'best', format: 'number', reset: 'none' },
  { id: 'earned', label: 'Coins earned', order: 'desc', mode: 'best', format: 'compact', reset: 'none' },
  { id: 'besthaul', label: 'Best haul', order: 'desc', mode: 'best', format: 'compact', reset: 'none' },
  { id: 'stolen', label: 'Loot stolen', order: 'desc', mode: 'best', format: 'compact', reset: 'none' },
]
// Screens for Boxity's screen ads: the world itself (gameplay banners stay off), the HUD windows and
// the results card. The lobby / gameplay views keep the 3D world unobstructed.
export const AD_SCREENS = { gameplay: {}, panel: {}, results: {} }
// Rewarded ad in the Store: watch one for coins (granted only after the server verified the reward
// token with Bloxity). Coins only: nothing here is premium currency.
export const REWARDED_AD = { placement: 'extra-coins', coins: 250, cooldown: 90 }

// The base rig, measured from player.glb: origin at the feet, 6.4 units tall at bind pose.
export const RIG_HEIGHT = 6.4
// Bind-pose values of the rig nodes the SDK proportions drive.
export const RIG = { armOffsetX: 2, legOffsetX: 0.6, neckOffsetY: 0.6 }
// getProportions() ranges, straight from the SDK spec; clamped before they reach the scene graph.
export const PROPORTIONS = {
  height: { def: 1, min: 0.5, max: 1.6 },
  shoulderWidth: { def: 1, min: 0.5, max: 1.5 },
  armLength: { def: 1, min: 0.05, max: 3 },
  legOffsetX: { def: 1, min: -0.7, max: 5 },
  torsoScaleX: { def: 1, min: 0.3, max: 2 },
  neckHeight: { def: 1, min: 0.94, max: 1.2 },
  headScale: { def: 1, min: 0.3, max: 2.6 },
}

// Procedural animation (avatar/animator.js), ported from Clean Leaves for Loot.
// Rotations are radians in CHARACTER space: +X swings a limb backward, +Y yaws, +Z rolls.
const deg = (d) => (d * Math.PI) / 180
export const ANIM = {
  airborneDelay: 0.07, // s off the ground before the air pose (ignores a step down a ledge)
  // Walk -> run is one cycle at two depths; phase advances with distance travelled.
  locomotion: {
    minFrequency: 0.7,
    maxFrequency: 3.6,
    strideDistance: 3.8, // m per cycle
    idleSpeed: 0.6,
    walkSpeed: 2.5,
    runSpeed: 8,
    sprintSpeed: 13,
    hipSwing: { walk: deg(22), run: deg(42), sprint: deg(56) },
    kneeBend: { walk: deg(30), run: deg(58), sprint: deg(72) },
    armSwing: { walk: deg(18), run: deg(36), sprint: deg(52) },
    elbowBend: { walk: deg(14), run: deg(44), sprint: deg(70) },
    torsoTwist: { walk: deg(4), run: deg(7), sprint: deg(9) },
    torsoLean: { walk: deg(3), run: deg(10), sprint: deg(18) },
    headCounterTwist: { walk: deg(2), run: deg(4), sprint: deg(5) },
    torsoRoll: { walk: deg(2), run: deg(3), sprint: deg(3) },
    bob: { walk: 0.03, run: 0.07, sprint: 0.09 }, // m, on the avatar root
    bankAngle: deg(9),
    bankRate: 8,
  },
  idle: {
    breathFrequency: 0.35,
    breathAmount: deg(1.8),
    breathBob: 0.007,
    basePose: {
      ArmL1: { x: deg(-4), z: deg(8) },
      ArmL2: { x: deg(12) },
      ArmR1: { x: deg(-4), z: deg(-8) },
      ArmR2: { x: deg(12) },
      LegL1: { x: deg(-4) },
      LegR1: { x: deg(4) },
    },
  },
  airborne: {
    rise: {
      LegL1: { x: deg(-38) }, LegR1: { x: deg(8) }, LegL2: { x: deg(62) }, LegR2: { x: deg(40) },
      ArmL1: { x: deg(-40), z: deg(34) }, ArmR1: { x: deg(-30), z: deg(-34) },
      ArmL2: { x: deg(30) }, ArmR2: { x: deg(30) }, Spine1: { x: deg(6) },
    },
    fall: {
      LegL1: { x: deg(-14) }, LegR1: { x: deg(10) }, LegL2: { x: deg(22) }, LegR2: { x: deg(18) },
      ArmL1: { x: deg(-70), z: deg(40) }, ArmR1: { x: deg(-60), z: deg(-40) },
      ArmL2: { x: deg(20) }, ArmR2: { x: deg(20) }, Spine1: { x: deg(-4) },
    },
    velocityReference: 8, // m/s vertical speed that reads as fully rising / falling
  },
  landing: {
    duration: 0.16,
    pose: {
      LegL1: { x: deg(-34) }, LegR1: { x: deg(-34) }, LegL2: { x: deg(58) }, LegR2: { x: deg(58) },
      ArmL1: { x: deg(-18), z: deg(20) }, ArmR1: { x: deg(-18), z: deg(-20) }, Spine1: { x: deg(14) },
    },
    bobY: -0.2,
  },
  transitions: { toLocomotion: 0.14, toAirborne: 0.12, toLanding: 0.06 }, // s to blend a pose change
}

export const FONT_FAMILY = 'Fredoka'

export function clamp(n, min, max) {
  return n < min ? min : n > max ? max : n
}

// Coerce one raw SDK string against its SETTINGS entry.
export function coerceSetting(key, raw) {
  const spec = SETTINGS[key]
  if (!spec) return raw
  const value = raw === '' || raw == null ? spec.def : raw
  if (spec.type === 'bool') return value === 'true' || value === true
  if (spec.type === 'enum') return spec.values.includes(value) ? value : spec.def
  const n = Number(value)
  return clamp(Number.isFinite(n) ? n : Number(spec.def), spec.min, spec.max)
}

// =====================================================================================================
// Tiny Thieves: game data. The house layout lives in game/house.js (level design); everything you
// might want to tune lives here.
// =====================================================================================================

// --- Scale + house footprint ----------------------------------------------------------------------
export const HOUSE = {
  minX: -54, maxX: 54, minZ: -42, maxZ: 42, // outer wall faces (metres)
  wallHeight: 16, // ceiling height
  wallThick: 1.2,
  collectMargin: 1.5, // loot this far outside the footprint is stolen
}
// Rooms (axis-aligned interiors, used for the room tracker, ambience and Grandpa's routines).
export const ROOMS = [
  { id: 'kitchen', name: 'KITCHEN', x0: -54, x1: -18, z0: -42, z1: -10, floor: 'tile', icon: 'pan' },
  { id: 'bathroom', name: 'BATHROOM', x0: -18, x1: 6, z0: -42, z1: -10, floor: 'tile', icon: 'tub' },
  { id: 'bedroom', name: 'BEDROOM', x0: 6, x1: 54, z0: -42, z1: -10, floor: 'carpet', icon: 'bed' },
  { id: 'hallway', name: 'HALLWAY', x0: -54, x1: 54, z0: -10, z1: 4, floor: 'wood', icon: 'door' },
  { id: 'garage', name: 'GARAGE', x0: -54, x1: -18, z0: 4, z1: 42, floor: 'stone', icon: 'car' },
  { id: 'living', name: 'LIVING ROOM', x0: -18, x1: 30, z0: 4, z1: 42, floor: 'wood', icon: 'sofa' },
  { id: 'study', name: 'SECRET STUDY', x0: 30, x1: 54, z0: 4, z1: 42, floor: 'carpet', icon: 'gem' },
]
// The getaway van on the driveway and the crew's spawn on the sidewalk.
export const VAN = { x: 16, z: 80, yaw: 0, escapeRadius: 4.5 }
export const HEIST_SPAWN = { x: -6, y: 0.05, z: 92, facing: Math.PI }

// --- Loot (models: game/models/loot.js). value $, mass kg, mat = sound/impact material ---------------
// fragile: shatters on a hard hit (loud, value lost); coins: bursts into coins when it shatters.
const L = (id, name, value, mass, mat, extra = {}) => ({ id, name, value, mass, mat, ...extra })
export const LOOT = [
  L('umbrella', 'Umbrella', 30, 6, 'plastic'), L('boot', 'Rain Boot', 15, 4, 'rubber'), L('fedora', 'Fedora Hat', 25, 2, 'soft'),
  L('keys', 'Car Keys', 45, 1, 'metal'), L('vase', 'Flower Vase', 60, 5, 'ceramic', { fragile: true }), L('wallet', 'Fat Wallet', 90, 1, 'soft'),
  L('pocketwatch', 'Pocket Watch', 120, 1, 'metal'), L('snowglobe', 'Snow Globe', 40, 3, 'glass', { fragile: true }),
  L('remote', 'TV Remote', 20, 1, 'plastic'), L('lamp', 'Table Lamp', 45, 6, 'ceramic'), L('cushion', 'Fluffy Cushion', 15, 2, 'soft'),
  L('book', 'Old Book', 25, 2, 'paper'), L('record', 'Vinyl Record', 55, 1, 'plastic'), L('trophy', 'Golf Trophy', 150, 6, 'metal'),
  L('teacup', 'Fancy Teacup', 35, 1, 'ceramic', { fragile: true }), L('cookietin', 'Cookie Tin', 40, 3, 'metal'),
  L('piggybank', 'Piggy Bank', 100, 4, 'ceramic', { fragile: true, coins: true }), L('yarn', 'Yarn Ball', 10, 1, 'soft'),
  L('camera', 'Vintage Camera', 130, 4, 'metal'), L('radio', 'Retro Radio', 85, 8, 'wood'),
  L('toaster', 'Toaster', 50, 12, 'metal'), L('pan', 'Frying Pan', 30, 6, 'metal'), L('teapot', 'Teapot', 70, 5, 'ceramic', { fragile: true }),
  L('cheese', 'Fancy Cheese', 40, 3, 'soft'), L('cake', 'Birthday Cake', 55, 4, 'soft'), L('mug', 'Coffee Mug', 10, 1, 'ceramic'),
  L('milk', 'Milk Carton', 8, 2, 'paper'), L('blender', 'Blender', 75, 7, 'plastic'), L('rollingpin', 'Rolling Pin', 15, 3, 'wood'),
  L('plate', 'Fine China Plate', 45, 2, 'ceramic', { fragile: true }),
  L('duck', 'Rubber Duck', 50, 1, 'rubber', { squeak: true }), L('toothbrush', 'Electric Toothbrush', 25, 1, 'plastic'),
  L('perfume', 'Fancy Perfume', 110, 2, 'glass', { fragile: true }), L('shampoo', 'Shampoo Bottle', 12, 2, 'plastic'), L('tp', 'Toilet Paper', 5, 1, 'paper'),
  L('hairdryer', 'Hair Dryer', 45, 3, 'plastic'), L('soap', 'Soap Bar', 5, 1, 'soft'), L('dentures', 'Golden Dentures', 200, 1, 'ceramic'),
  L('alarmclock', 'Alarm Clock', 35, 2, 'metal'), L('jewelbox', 'Jewelry Box', 180, 4, 'wood'), L('pillow', 'Pillow', 10, 2, 'soft'),
  L('slipper', 'Fuzzy Slipper', 15, 1, 'soft'), L('teddy', 'Teddy Bear', 40, 2, 'soft'), L('watch', 'Gold Watch', 160, 1, 'metal'),
  L('photo', 'Photo Frame', 30, 2, 'wood'), L('cash', 'Cash Stack', 140, 1, 'paper'), L('necklace', 'Pearl Necklace', 220, 1, 'metal'), L('diary', 'Secret Diary', 25, 1, 'paper'),
  L('toolbox', 'Toolbox', 60, 30, 'metal'), L('hammer', 'Hammer', 20, 4, 'metal'), L('wrench', 'Wrench', 25, 3, 'metal'), L('drill', 'Power Drill', 90, 6, 'plastic'),
  L('paintcan', 'Paint Can', 15, 8, 'metal'), L('flashlight', 'Flashlight', 20, 2, 'metal'), L('gascan', 'Gas Can', 25, 6, 'plastic'), L('hubcap', 'Shiny Hubcap', 45, 4, 'metal'),
  L('goldbar', 'Gold Bar', 250, 35, 'metal'), L('crown', 'Jeweled Crown', 400, 8, 'metal', { treasure: true }), L('globe', 'Antique Globe', 120, 20, 'wood'),
  L('painting', 'Small Painting', 200, 6, 'wood'), L('diamond', 'Giant Diamond', 350, 3, 'glass'), L('coinjar', 'Coin Jar', 150, 6, 'glass', { fragile: true, coins: true }),
]
export const LOOT_BY_ID = Object.fromEntries(LOOT.map((l) => [l.id, l]))
// Impacts: loudness (noise radius per unit strength) and the speed change that counts as a hit.
export const IMPACT = {
  minDeltaV: 3.2, // m/s velocity change in one tick that counts as an impact
  fullDeltaV: 16, // ... and the one that counts as a full-strength (1.0) impact
  breakDeltaV: 13, // fragile loot shatters above this
  noise: { wood: 34, metal: 44, glass: 46, plastic: 26, soft: 7, ceramic: 40, paper: 6, rubber: 16 },
  shatterNoise: 62,
  squeakNoise: 30,
}

// --- Grab (game/grab.js): stretchy grabber arms ---------------------------------------------------
export const GRAB = {
  range: 11, // m from the player's chest (Stretchy Arms upgrade adds per level)
  rangePerLevel: 2,
  minHold: 2.4, // m: closest a held thing floats
  wheelStep: 0.9, // m per wheel notch (Distance)
  stiffness: 11, // 1/s: how hard the held point chases its target
  maxSpeed: 26, // m/s the held point may move toward the target
  liftMass: 12, // kg held without sagging (Strong Grip upgrade adds per level)
  liftPerLevel: 6,
  maxImpulsePerKg: 0.9, // per tick, scaled by lift capacity: heavy loot lags behind
  holdAngularDamping: 5, // doors / windows while pulled
  // Carrying loot (held by its centre of mass, no pendulum swing, keeps up while you run):
  carryAccel: 130, // m/s^2 the held loot may change speed (x lift capacity / mass for heavier loot)
  carrySag: 1.4, // m heavy loot hangs below the crosshair (at 0 % strength; none within capacity)
  rotStiffness: 9, // 1/s: the held loot turns with your view (keeps the angle you picked it up at)
  maxSpin: 10, // rad/s
  wallGap: 0.25, // m kept between the held loot and walls / floors (plus its own size)
  dropMaxSpeed: 15, // m/s: letting go keeps the carry momentum, capped (a camera whip never flings it)
  noCollideAfter: 0.35, // s after letting go before the loot can bump into you again
  throwSpeed: 22, // m/s at full strength (lighter than the lift capacity = full speed)
  throwArc: 0.12, // extra upward share of the throw speed
  throwInherit: 0.85, // share of your running speed added to a throw
  throwSpin: 5, // rad/s forward tumble on a throw
  breakDistance: 9, // m between the held point and its target: the grip slips
  armColor: '#2b3a67', gloveColor: '#ffb21e',
}

// --- Noise (game/noise.js): radius in metres Grandpa can hear something from ----------------------
export const NOISE = {
  wallMuffle: 0.55, // radius x this when there is no line of sight
  stepWalk: 2.5, stepSprint: 10, stepCrouch: 0, land: 7,
  doorSlam: 46, doorCreak: 22, garage: 44, window: 26, flap: 10,
  alarm: 95, flush: 75, tv: 85, bazooka: 110, marbles: 18, thermostat: 20, secret: 30, cage: 24,
  toasterLever: 8, toaster: 48, fanCord: 12, phone: 80, lightSwitch: 6,
  ignite: 14, extinguisher: 30, gasBoom: 120, smokeAlarm: 140,
}

// --- Fire (game/fire.js) ----------------------------------------------------------------------------
// Hold / drop flammable loot in the fireplace and it catches fire. A burning item that rests somewhere
// in the house lights the floor there; the fire grows, spreads cell to cell (slower through walls),
// burns flammable loot in it and eventually burns out. Thieves put it out with the extinguisher;
// Grandpa fetches buckets of water from the nearest sink (far from water, high up, behind the secret
// door or too big = he can't win and runs out of the back door).
export const FIRE = {
  cell: 6, // m: fire grid cell size over the house footprint
  hearth: { x0: 15.6, x1: 22.4, y1: 6.2, z0: 5.6, z1: 9.8 }, // in front of / in the firebox: things catch fire
  igniteTime: 0.7, // s flammable loot spends in the hearth before it catches
  // per loot material: life = s a burning item lasts before it is ash; catch = s in flames before it catches
  flammable: { paper: { life: 14, catch: 0.8 }, soft: { life: 16, catch: 1.4 }, wood: { life: 26, catch: 3 }, plastic: { life: 18, catch: 2.2 } },
  seedAfter: 0.9, // s a burning item rests in the house before the floor under it catches
  seedHeat: 0.18, // heat a resting burning item gives its cell (per second)
  grow: 0.07, // heat per second a burning cell gains (x the room's burnability)
  spread: 0.075, // ignition per second a full-heat neighbour adds (1 = catches)
  diagonal: 0.5, // diagonal neighbours spread this much
  throughWall: 0.5, // spread between cells of different rooms (walls + doorways)
  burnability: { kitchen: 0.85, bathroom: 0.35, bedroom: 1.1, hallway: 0.9, garage: 1, living: 1.1, study: 1.15 },
  fuel: { kitchen: 46, bathroom: 22, bedroom: 70, hallway: 60, garage: 62, living: 70, study: 70 }, // s at full heat
  wetTime: 22, // s a doused cell will not catch again
  lootHeat: 0.3, // cell heat that sets flammable loot in it alight
  hurtHeat: 0.4, // cell heat that burns a thief (below hurtTop m)
  hurtTop: 7,
  hurtTime: 1, // s in the flames before the thief is thrown clear
  alarmCells: 3, // burning cells that set off the hallway smoke alarm (Grandpa hears it anywhere)
  highY: 11, // m: a fire lit higher than this is out of Grandpa's bucket reach (until it spreads down)
  wholeHouse: 0.35, // share of cells burning at once = THE WHOLE HOUSE IS ON FIRE
  extinguisher: { range: 15, cone: 0.42, power: 1.4, radius: 3.2 }, // cone = cos of the half angle
  bucket: { radius: 7.5, power: 1.25, fill: 1.4, throwAt: 0.55, throwDur: 1.2, reach: 5.5 },
  giveUp: 18, // burning cells: Grandpa runs outside instead
  gasFuse: 2.4, // s a burning gas can takes to go BOOM
  gasRadius: 11,
  // where Grandpa fills his bucket (stand + face) and where he waits outside
  water: [
    { id: 'kitchen', x: -45.6, z: -17, fx: -52, fz: -17 },
    { id: 'bathroom', x: -11.4, z: -20.5, fx: -16, fz: -20.5 },
  ],
  safeSpot: { x: -38, z: -66 }, // back yard, through the back door
}

// --- Grandpa (game/grandpa.js + grandpaBrain.js) -----------------------------------------------------
export const GRANDPA = {
  height: 10.5, radius: 1.7, eyeHeight: 9.6,
  walkSpeed: 4.2, hurrySpeed: 6.2, chaseSpeed: 11.2, carrySpeed: 5.5, // m/s (difficulty scales them)
  turnRate: 3.2, // rad/s
  fov: 54, // degrees, half-angle of the sharp vision cone
  peripheral: 85, // degrees, half-angle of the side vision (slower to notice)
  sightRange: 46, // m (difficulty scales it)
  detectRate: 1.7, // meter per second at point blank, fully visible
  forgetRate: 0.3, // meter drained per second out of sight
  suspicious: 0.32, // meter level of "?" (he stops and turns to look)
  hearRange: 1, // multiplier on noise radii
  reach: 3.7, // m he can grab within
  reachHeight: 12.5, // m: anything higher is out of reach
  grabTime: 0.5, // s from lunge to closed fist
  loseSightAfter: 4.5, // s without seeing his target before searching
  searchTime: 7, // s looking around the last known spot
  hideGiveUp: 7, // s staring at a hiding spot before grumbling off
  stun: { marbles: 5, glue: 7, banana: 4, sleep: 18, bazooka: 4, hit: 1.2 },
  hitImpulse: 9, // m/s of loot hitting him that counts as a hit (rescues a held player)
  struggleToEscape: 14, // presses (space / taps) to wriggle free of his hand
  cageTime: 45, // s in the bird cage before you are out
  activityWeights: { tea: 3, newspaper: 3, tv: 2, nap: 1, workbench: 2, toilet: 1, thermostat: 1, wander: 3, plants: 2 },
}

// --- Difficulty (lobby pads) ------------------------------------------------------------------------
export const DIFFICULTY = {
  normal: { label: 'NORMAL', target: 1000, coinMult: 1, speed: 1, sight: 1, color: '#44d35b' },
  hard: { label: 'HARD', target: 2000, coinMult: 1.5, speed: 1.12, sight: 1.2, color: '#ff9b2f' },
  nightmare: { label: 'NIGHTMARE', target: 3000, coinMult: 2.2, speed: 1.24, sight: 1.35, color: '#ff3b5c' },
}

// --- Gadgets (bought with coins; hotbar 1-9, 0) -----------------------------------------------------
// Prices are in Coins (never premium currency).
export const GADGETS = [
  { id: 'marbles', name: 'Marbles', price: 150, desc: 'Scatter marbles. Grandpa slips and falls.', color: '#3fb7ff' },
  { id: 'glue', name: 'Super Glue', price: 200, desc: 'A sticky puddle. Grandpa gets stuck.', color: '#f4f0e0' },
  { id: 'banana', name: 'Banana', price: 100, desc: 'Drop the peel. Whoops!', color: '#ffd93b' },
  { id: 'alarm', name: 'Alarm Clock', price: 250, desc: 'Rings after 3 s. Grandpa goes to smash it.', color: '#ff6b5a' },
  { id: 'smoke', name: 'Smoke Bomb', price: 300, desc: 'Blocks his sight. Breaks a chase.', color: '#b9b9d6' },
  { id: 'sleep', name: 'Sleep Potion', price: 450, desc: 'Throw it at Grandpa: instant nap.', color: '#b06cff' },
  { id: 'xray', name: 'X-Ray Specs', price: 350, desc: 'See Grandpa and his eyesight through walls.', color: '#4dff8a' },
  { id: 'energy', name: 'Energy Drink', price: 200, desc: 'Endless stamina and +20 % speed.', color: '#a8ff3e' },
  { id: 'bazooka', name: 'Toy Bazooka', price: 600, desc: 'Foam rocket: knocks Grandpa down. LOUD.', color: '#ff4fa3' },
  { id: 'extinguisher', name: 'Fire Extinguisher', price: 275, desc: 'Foam blast: puts out fires and burning loot.', color: '#ff3b3b' },
]
export const GADGET_BY_ID = Object.fromEntries(GADGETS.map((g) => [g.id, g]))
export const GADGET_FX = {
  marbleCount: 12, marbleRadius: 0.36, trapRadius: 2.8,
  glueRadius: 3.2, glueLife: 90, bananaRadius: 1.8,
  alarmDelay: 3, alarmRing: 10,
  smokeRadius: 9, smokeTime: 9,
  sleepRadius: 7.5, throwSpeed: 19,
  xrayTime: 30, energyTime: 15, energySpeed: 1.2,
  rocketSpeed: 42, rocketBlast: 6,
}
export const STARTER_GADGETS = { marbles: 1, banana: 1, smoke: 1 } // a new thief's first kit

// --- Upgrades (permanent, levels 0..5; price = base * growth^level, in Coins) ------------------------
export const UPGRADES = [
  { id: 'arms', name: 'Stretchy Arms', desc: '+2 m grab reach', base: 300, growth: 1.85, icon: 'arm' },
  { id: 'grip', name: 'Strong Grip', desc: 'Carry heavier loot', base: 350, growth: 1.85, icon: 'fist' },
  { id: 'lungs', name: 'Big Lungs', desc: '+20 % stamina', base: 250, growth: 1.8, icon: 'lungs' },
  { id: 'feet', name: 'Quick Feet', desc: '+4 % speed', base: 300, growth: 1.9, icon: 'shoe' },
  { id: 'soft', name: 'Soft Socks', desc: '-12 % noise', base: 250, growth: 1.8, icon: 'sock' },
  { id: 'ninja', name: 'Ninja Moves', desc: '-8 % visibility', base: 400, growth: 1.9, icon: 'mask' },
]
export const UPGRADE_MAX = 5
export const upgradePrice = (u, level) => Math.round((u.base * Math.pow(u.growth, level)) / 10) * 10

// --- Coins: what escaping pays, and the paid helpers (Coins only) --------------------------------------
export const REWARDS = { caughtShare: 0.15, jobCoins: 60 }
export const PRICES = { breakFree: 350, revive: 500 }

// --- Jobs (game/jobs.js): 6 per heist, shared by the crew --------------------------------------------
// bonus = $ added to the crew bank when done. kind is what jobs.js listens for.
export const JOBS = [
  { id: 'steal12', kind: 'stealCount', n: 12, time: 240, text: 'Steal 12 items', bonus: 120 },
  { id: 'steal20', kind: 'stealCount', n: 20, time: 420, text: 'Steal 20 items', bonus: 200 },
  { id: 'room', kind: 'stealRoom', n: 3, text: 'Steal 3 from the {ROOM}', bonus: 80 },
  { id: 'big', kind: 'stealValue', n: 100, text: 'Steal a $100+ item', bonus: 80 },
  { id: 'treasure', kind: 'stealTreasure', text: 'Steal the hidden treasure', bonus: 200 },
  { id: 'marbles', kind: 'trap', trap: 'marbles', text: 'Trip Grandpa on marbles', bonus: 100 },
  { id: 'glue', kind: 'trap', trap: 'glue', text: 'Glue Grandpa', bonus: 100 },
  { id: 'banana', kind: 'trap', trap: 'banana', text: 'Slip Grandpa on a banana', bonus: 80 },
  { id: 'clock', kind: 'trap', trap: 'alarm', text: 'Fool Grandpa with a clock', bonus: 90 },
  { id: 'smoke', kind: 'trap', trap: 'smokeChase', text: 'Smoke bomb in a chase', bonus: 120 },
  { id: 'sleep', kind: 'trap', trap: 'sleep', text: 'Put Grandpa to sleep', bonus: 120 },
  { id: 'heat', kind: 'event', event: 'thermostat', text: 'Turn up the heat', bonus: 70 },
  { id: 'flush', kind: 'event', event: 'flush', text: 'Flush the toilet', bonus: 60 },
  { id: 'tv', kind: 'event', event: 'tv', text: "Break Grandpa's TV", bonus: 110 },
  { id: 'secret', kind: 'event', event: 'secret', text: 'Open a secret door', bonus: 100 },
  { id: 'toaster', kind: 'event', event: 'toaster', text: 'Get launched by the toaster', bonus: 80 },
  { id: 'fanRide', kind: 'event', event: 'fanRide', text: 'Ride the ceiling fan', bonus: 80 },
  { id: 'phone', kind: 'event', event: 'phone', text: 'Prank call Grandpa', bonus: 80 },
  { id: 'lights', kind: 'event', event: 'lights', text: 'Turn off the lights in a room', bonus: 60 },
  { id: 'fire', kind: 'event', event: 'fire', text: 'Start a fire with something from the fireplace', bonus: 90 },
  { id: 'firefight', kind: 'event', event: 'firefight', text: 'Make Grandpa fight a fire', bonus: 100 },
  { id: 'rescue', kind: 'event', event: 'rescue', text: 'Free a caught friend', bonus: 120, crewOnly: true },
]
export const JOBS_PER_HEIST = 6

// --- Lobby (game/lobby.js): the hideout and its crew pads -------------------------------------------
export const LOBBY = {
  center: { x: 0, z: 1500 },
  // The hideout is player-sized (only the house is giant): lobby.js lays it out in design units x this.
  scale: 0.3,
  halfX: 13.8, halfZ: 10.2, height: 7.8, // m
  pads: [
    // Three crews, all the same kind of game (NORMAL). Keep the count in step with the server's PAD_COUNT.
    { x: -5.4, z: 1495.2, difficulty: 'normal' },
    { x: 0, z: 1494, difficulty: 'normal' },
    { x: 5.4, z: 1495.2, difficulty: 'normal' },
  ],
  padRadius: 1.8, // m
  padExit: 1.2, // m south of a cap's rim where leaving a pad puts you
  padSize: 4, // thieves per crew
  countdown: 20, // s from the first thief on a pad
  fullCountdown: 5, // s once the pad is full
}

// --- Multiplayer (net.js) ---------------------------------------------------------------------------
// Colyseus game server (../Be-tiny-and-rob-grandpa-backend), one URL per Bloxity Legion channel:
// `npm run build` (production) reads _MAIN, `npm run dev` and `npm run build:dev` read _DEV (`npm run dev`
// defaults to the local server). Empty = net.js asks the Bloxity SDK for the channel's endpoint; with no
// SDK either the game runs offline (solo heists, nothing saved).
const SERVER_URL_DEV = import.meta.env.VITE_SERVER_URL_DEV || (import.meta.env.DEV ? 'ws://localhost:2567' : '')
const SERVER_URL_MAIN = import.meta.env.VITE_SERVER_URL_MAIN || ''
export const SERVER_URL = import.meta.env.MODE === 'production' ? SERVER_URL_MAIN : SERVER_URL_DEV
export const NET = {
  roomSize: 12, // players per room: the server's ROOM_MAX_CLIENTS (3 pads x 4). A full room is not "joinable" to the portal
  poseHz: 12, // pose messages per second (only when the pose changed)
  snapshotHz: 12, // host snapshots per second (Grandpa, moving loot, doors)
  holdHz: 15, // a crew member's held-loot updates per second
  remoteLerp: 12, // 1/s: how fast another player's character eases toward their last reported pose
  remoteSnap: 25, // m: a bigger jump (teleport) snaps instead of sliding
  remoteRange: 140, // m: only players this close are drawn
  remoteRangeSlack: 10,
  remoteNameHeight: 0.55,
  saveEvery: 8, // s: at most one save to the server per this
  rejoinSeconds: 15,
  retryMax: 15,
  giveUpAfter: 60,
  retryPause: 30,
}
