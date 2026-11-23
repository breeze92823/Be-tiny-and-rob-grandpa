// Grandpa's house and yard (level design). x6 scale: the player is 1.8 m, a door is 13 m tall.
// Built once at boot and reused for every heist (loot is re-spawned per heist by props.js).
//
//   z=-42 +-------------+-----------+--------------------+   back
//         |  KITCHEN    | BATHROOM  |      BEDROOM       |
//   z=-10 +---D(-30)----+--D(-6)----+-------D(24)--------+
//         |               HALLWAY                        | front door + mail slot at x=54
//   z=4   +----D(-36)---+-------ARCH(0)---------+--------+
//         |  GARAGE     |   LIVING ROOM         | STUDY  |  study: secret, behind the bookshelf
//   z=42  +==GARAGE DOOR+=====FRONT WINDOW======+--------+   front (+Z): lawn, driveway, van
//
// Static geometry is baked to a few meshes per material (bake.js); colliders are separate Rapier
// fixed cuboids. Moving parts (doors, windows, flaps, the garage door) are dynamic bodies on joints.
import { Box3, Group, Mesh, MeshStandardMaterial, PlaneGeometry, Quaternion, Shape, ExtrudeGeometry, Vector3, Euler, DoubleSide } from 'three'
import { HOUSE, ROOMS, VAN } from '../config.js'
import { MOVER_GROUPS, RAPIER, world, addDynamicShape, hinge, slider, setOwner } from '../physics.js'
import { bakeBy, compact } from '../bake.js'
import { classifyBox } from './roomCull.js'
import { box, boxMM, cyl, glass, metal, solid, solidCuboid, solidMM, surface, sphere, emissive } from './kit.js'
import { paintBrick, paintCarpet, paintConcrete, paintLawn, paintShingles, paintSiding, paintTiles, paintWallpaper, paintWoodFloor } from './paint.js'
import { buildFurniture } from './furniture.js'

const T = HOUSE.wallThick
const H = HOUSE.wallHeight
const HT = T / 2

// --- Materials --------------------------------------------------------------------------------------
const M = {}
function materials() {
  if (M.ready) return M
  M.ready = true
  M.siding = surface('siding', paintSiding('#c9d6e3'), { tile: 6, rough: 0.85, bump: 0.8 })
  M.trim = solid('#fbf8f1', 0.55)
  M.plinth = surface('plinth', paintBrick('#8d8a84', '#bdb7aa'), { tile: 5, rough: 0.9, bump: 1 })
  M.roof = surface('roof', paintShingles('#4b4f5c'), { tile: 7, rough: 0.8, bump: 1.2 })
  M.ceiling = solid('#f6f2ea', 0.95)
  M.base = solid('#fffaf0', 0.5) // baseboards
  M.lawn = surface('lawn', paintLawn(), { tile: 22, rough: 0.95, bump: 0.6 })
  M.concrete = surface('conc', paintConcrete('#c2bdb3'), { tile: 9, rough: 0.92, bump: 0.6 })
  M.sidewalk = surface('walk', paintConcrete('#d2cec6'), { tile: 6, rough: 0.9, bump: 0.6 })
  M.asphalt = surface('asph', paintConcrete('#4a4c55', false), { tile: 10, rough: 0.95, bump: 0.4 })
  M.wall = {
    kitchen: surface('wp-kit', paintWallpaper('dots', '#e4f1e3', '#c3dcc4'), { tile: 6, rough: 0.9, bump: 0.2 }),
    bathroom: surface('wp-bath', paintTiles('#eef6fb', '#d8e9f4', 4, '#a9bccb'), { tile: 6, rough: 0.35, bump: 0.6 }),
    bedroom: surface('wp-bed', paintWallpaper('floral', '#ece0f1', '#cdb4dc'), { tile: 7, rough: 0.9, bump: 0.2 }),
    hallway: surface('wp-hall', paintWallpaper('stripes', '#f1e4c6', '#e3cfa3'), { tile: 6, rough: 0.9, bump: 0.2 }),
    garage: surface('wp-gar', paintBrick('#cfc9be', '#e6e1d6'), { tile: 6, rough: 0.95, bump: 0.8 }),
    living: surface('wp-liv', paintWallpaper('diamond', '#dbe5cb', '#b8c9a1'), { tile: 7, rough: 0.9, bump: 0.2 }),
    study: surface('wp-std', paintWallpaper('stripes', '#2f4a3a', '#3b5c48'), { tile: 6, rough: 0.85, bump: 0.2 }),
  }
  M.floor = {
    kitchen: surface('fl-kit', paintTiles('#f3efe6', '#9fb3c2', 2, '#8d8d86'), { tile: 9, rough: 0.4, bump: 0.6 }),
    bathroom: surface('fl-bath', paintTiles('#ffffff', '#e9eef2', 4, '#b3bcc4'), { tile: 6, rough: 0.35, bump: 0.6 }),
    bedroom: surface('fl-bed', paintCarpet('#9d86b3'), { tile: 5, rough: 1, bump: 0.5 }),
    hallway: surface('fl-hall', paintWoodFloor('#b98552', 6, 3), { tile: 12, rough: 0.55, bump: 0.7 }),
    garage: surface('fl-gar', paintConcrete('#a9a49b'), { tile: 10, rough: 0.9, bump: 0.6 }),
    living: surface('fl-liv', paintWoodFloor('#a8703f', 6, 8), { tile: 12, rough: 0.55, bump: 0.7 }),
    study: surface('fl-std', paintCarpet('#7a2f36'), { tile: 5, rough: 1, bump: 0.5 }),
  }
  M.door = solid('#f2ead8', 0.55)
  M.doorPanel = solid('#e6dcc4', 0.6)
  M.knob = metal('#d8b15a', 0.25)
  M.frontDoor = solid('#e0a63a', 0.45)
  M.garageDoor = surface('gdoor', paintSiding('#eef1f4'), { tile: 3.2, rough: 0.6, bump: 1.2 })
  M.glass = glass('#cfe9ff', 0.22)
  M.frame = solid('#ffffff', 0.5)
  M.shutter = solid('#e0a63a', 0.55)
  M.wood = solid('#8b5a35', 0.7)
  M.darkWood = solid('#5b3a22', 0.7)
  M.fence = solid('#f7f3ea', 0.7)
  M.leaf = [solid('#4f9a3a', 0.85), solid('#5fae44', 0.85), solid('#3f8a34', 0.85)]
  M.trunk = solid('#7a5233', 0.9)
  M.bulb = emissive('#ffe2a8', 2.4, '#fff4dc')
  return M
}

// --- Rooms ------------------------------------------------------------------------------------------
export function roomAt(x, z) {
  if (x < HOUSE.minX || x > HOUSE.maxX || z < HOUSE.minZ || z > HOUSE.maxZ) return null
  for (const r of ROOMS) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.id
  return null
}
export const insideFootprint = (x, z, margin = 0) => x > HOUSE.minX - margin && x < HOUSE.maxX + margin && z > HOUSE.minZ - margin && z < HOUSE.maxZ + margin

// --- Walls with openings ------------------------------------------------------------------------------
// A wall along X on the line z, from x0 to x1, split around openings [{ a, b, y0, y1 }] (x range,
// bottom, top). Two half-thickness skins (one material per face side) + one collider per solid piece.
function wallX(g, z, x0, x1, openings, matN, matS) {
  const pieces = []
  let x = x0
  for (const o of [...openings].sort((p, q) => p.a - q.a)) {
    if (o.a > x) pieces.push([x, o.a, 0, H])
    if (o.y0 > 0) pieces.push([o.a, o.b, 0, o.y0])
    if (o.y1 < H) pieces.push([o.a, o.b, o.y1, H])
    x = o.b
  }
  if (x < x1) pieces.push([x, x1, 0, H])
  for (const [a, b, y0, y1] of pieces) {
    if (b - a < 0.01 || y1 - y0 < 0.01) continue
    boxMM(g, a, y0, z - HT, b, y1, z, matN)
    boxMM(g, a, y0, z, b, y1, z + HT, matS)
    solidMM(a, y0, z - HT, b, y1, z + HT)
  }
}
// A wall along Z on the line x (matW faces -X, matE faces +X).
function wallZ(g, x, z0, z1, openings, matW, matE) {
  const pieces = []
  let z = z0
  for (const o of [...openings].sort((p, q) => p.a - q.a)) {
    if (o.a > z) pieces.push([z, o.a, 0, H])
    if (o.y0 > 0) pieces.push([o.a, o.b, 0, o.y0])
    if (o.y1 < H) pieces.push([o.a, o.b, o.y1, H])
    z = o.b
  }
  if (z < z1) pieces.push([z, z1, 0, H])
  for (const [a, b, y0, y1] of pieces) {
    if (b - a < 0.01 || y1 - y0 < 0.01) continue
    boxMM(g, x - HT, y0, a, x, y1, b, matW)
    boxMM(g, x, y0, a, x + HT, y1, b, matE)
    solidMM(x - HT, y0, a, x + HT, y1, b)
  }
}
// White frame around an opening in an X wall (both faces) / a Z wall. Its inner edges sit LIP inside the
// opening, so they cover the wall's cut edges (jambs, lintel underside, sill top) instead of sharing
// their plane (that shared plane Z-fought on every doorway and window).
const LIP = 0.04
function frameX(g, z, a, b, y0, y1, depth = T + 0.5, w = 0.55) {
  const m = materials().frame
  boxMM(g, a - w, y1 - LIP, z - depth / 2, b + w, y1 + w, z + depth / 2, m)
  boxMM(g, a - w, y0, z - depth / 2, a + LIP, y1 - LIP, z + depth / 2, m)
  boxMM(g, b - LIP, y0, z - depth / 2, b + w, y1 - LIP, z + depth / 2, m)
  if (y0 > 0.1) boxMM(g, a - w * 1.4, y0 - 0.35, z - depth / 2 - 0.5, b + w * 1.4, y0 + LIP, z + depth / 2 + 0.5, m)
}
function frameZ(g, x, a, b, y0, y1, depth = T + 0.5, w = 0.55) {
  const m = materials().frame
  boxMM(g, x - depth / 2, y1 - LIP, a - w, x + depth / 2, y1 + w, b + w, m)
  boxMM(g, x - depth / 2, y0, a - w, x + depth / 2, y1 - LIP, a + LIP, m)
  boxMM(g, x - depth / 2, y0, b - LIP, x + depth / 2, y1 - LIP, b + w, m)
  if (y0 > 0.1) boxMM(g, x - depth / 2 - 0.5, y0 - 0.35, a - w * 1.4, x + depth / 2 + 0.5, y0 + LIP, b + w * 1.4, m)
}

// --- Openings (shared with the furniture/doors code) ---------------------------------------------------
// Interior doorways: 7 wide, 13 tall.
export const DOORWAYS = [
  { id: 'kitchen', axis: 'x', line: -10, at: -30, w: 7, h: 13, ajar: 1.15, hingeSide: -1, swing: 1 },
  { id: 'bathroom', axis: 'x', line: -10, at: -6, w: 7, h: 13, ajar: 0.35, hingeSide: 1, swing: 1 },
  { id: 'bedroom', axis: 'x', line: -10, at: 24, w: 7, h: 13, ajar: 0.8, hingeSide: -1, swing: 1 },
  { id: 'garage', axis: 'x', line: 4, at: -36, w: 7, h: 13, ajar: 0.6, hingeSide: 1, swing: -1 },
]
export const ARCH = { a: -8, b: 8, h: 14 } // hallway <-> living room, no door
export const SECRET = { x: 30, a: 16, b: 24, h: 12 } // the bookshelf door into the study
export const GARAGE_DOOR = { a: -50, b: -22, h: 13 }
// Every window is a sash window: grab the lower sash and slide it up, then climb through (a jump at an
// open window pulls you up onto the sill: game.js `tryVault`). The study's is latched until the secret
// bookshelf door is found (the treasure room stays a secret).
export const WINDOWS = {
  living: { wall: 'front', a: -2, b: 12, y0: 5, y1: 13, sash: 4 }, // front wall z = 42
  bedroom: { wall: 'east', a: -34, b: -22, y0: 5, y1: 13, sash: 4 }, // east wall x = 54
  bathroom: { wall: 'back', a: -10, b: -2, y0: 8, y1: 12.5, sash: 3 }, // back wall z = -42
  bedroomBack: { wall: 'back', a: 12, b: 20, y0: 5, y1: 12, sash: 3.4 },
  kitchenBack: { wall: 'back', a: -30, b: -22, y0: 6, y1: 12, sash: 3.2 }, // over the back counter
  garage: { wall: 'west', a: 18, b: 28, y0: 5, y1: 12, sash: 3.4 }, // west wall x = -54
  kitchenWest: { wall: 'west', a: -32, b: -24, y0: 6.5, y1: 12, sash: 3 },
  study: { wall: 'front', a: 38, b: 46, y0: 5, y1: 12, sash: 3.4, latched: true },
}
// (No fixed panes any more: every window opens. Kept for the room culling's portal list.)
export const FIXED_WINDOWS = []
// The outer doors open too (grab and pull; they swing inward only: the porch steps are outside the front
// door). The pet flap and the mail slot ride along in their leaves.
export const BACK_DOOR = { a: -42, b: -34, h: 13, flap: { a: -39.5, b: -36.5, h: 3.2 } }
export const FRONT_DOOR = { a: -7, b: 1, h: 13, slot: { a: -4.6, b: -1.4, y0: 4.5, y1: 5.7 } }
export const FRONT_PORCH_Y = 4.5 // the porch floor outside the front door (a ledge from the hallway)

// --- Build ------------------------------------------------------------------------------------------
export function buildHouse(scene) {
  const m = materials()
  const statics = new Group() // baked later
  const live = new Group() // stays as is (moving parts, glass, emissives)
  scene.add(live)
  const mins = { x: HOUSE.minX + HT, z: HOUSE.minZ + HT } // outer wall centre lines
  const maxs = { x: HOUSE.maxX - HT, z: HOUSE.maxZ - HT }

  // Floors per room (slightly overlapping the walls) + one big collider.
  for (const r of ROOMS) {
    const f = new Mesh(new PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0), m.floor[r.id])
    f.rotation.x = -Math.PI / 2
    f.position.set((r.x0 + r.x1) / 2, 0.02, (r.z0 + r.z1) / 2)
    // metre UVs
    const uv = f.geometry.attributes.uv
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (r.x1 - r.x0), uv.getY(i) * (r.z1 - r.z0))
    f.receiveShadow = true
    statics.add(f)
  }
  // The floor's collider, flush with the floor planes (0.02): the lawn's collider sits at -0.02, so
  // feet used to sink into the floorboards indoors. Doors and flaps clear it (their bottoms are 0.05+).
  solidMM(HOUSE.minX, -1, HOUSE.minZ, HOUSE.maxX, 0.02, HOUSE.maxZ, { friction: 0.9 })
  // Ceiling (and its collider: nothing flies into the attic).
  boxMM(statics, HOUSE.minX, H, HOUSE.minZ, HOUSE.maxX, H + 0.8, HOUSE.maxZ, m.ceiling, { cast: true })
  solidMM(HOUSE.minX, H, HOUSE.minZ, HOUSE.maxX, H + 0.8, HOUSE.maxZ)

  // --- Outer walls (exterior siding / interior wallpaper of the room behind) ---
  const W = WINDOWS
  const windowsOn = (wall) => [...Object.values(W), ...FIXED_WINDOWS].filter((f) => f.wall === wall).map((f) => ({ a: f.a, b: f.b, y0: f.y0, y1: f.y1 }))
  // Front wall z = 42: garage (x -54..-18) | living (-18..30) | study (30..54)
  const frontOpen = [
    { a: GARAGE_DOOR.a, b: GARAGE_DOOR.b, y0: 0, y1: GARAGE_DOOR.h },
    ...windowsOn('front'),
  ]
  for (const [x0, x1, room] of [[HOUSE.minX, -18, 'garage'], [-18, 30, 'living'], [30, HOUSE.maxX, 'study']]) {
    wallX(statics, maxs.z, x0, x1, frontOpen.filter((o) => o.a >= x0 && o.b <= x1), m.wall[room], m.siding)
  }
  // Back wall z = -42: kitchen | bathroom | bedroom
  const backOpen = [
    { a: BACK_DOOR.a, b: BACK_DOOR.b, y0: 0, y1: BACK_DOOR.h },
    ...windowsOn('back'),
  ]
  for (const [x0, x1, room] of [[HOUSE.minX, -18, 'kitchen'], [-18, 6, 'bathroom'], [6, HOUSE.maxX, 'bedroom']]) {
    wallX(statics, mins.z, x0, x1, backOpen.filter((o) => o.a >= x0 && o.b <= x1), m.siding, m.wall[room])
  }
  // West wall x = -54: kitchen | hallway | garage
  const westOpen = windowsOn('west')
  // side walls run between the front/back walls' inner faces (both used to reach the corner: their end
  // faces Z-fought with the other wall's outer face)
  for (const [z0, z1, room] of [[HOUSE.minZ + T, -10, 'kitchen'], [-10, 4, 'hallway'], [4, HOUSE.maxZ - T, 'garage']]) {
    wallZ(statics, mins.x, z0, z1, westOpen.filter((o) => o.a >= z0 && o.b <= z1), m.siding, m.wall[room])
  }
  // East wall x = 54: bedroom (window) | hallway (front door) | study
  const eastOpen = [
    ...windowsOn('east'),
    { a: FRONT_DOOR.a, b: FRONT_DOOR.b, y0: 0, y1: FRONT_DOOR.h },
  ]
  for (const [z0, z1, room] of [[HOUSE.minZ + T, -10, 'bedroom'], [-10, 4, 'hallway'], [4, HOUSE.maxZ - T, 'study']]) {
    wallZ(statics, maxs.x, z0, z1, eastOpen.filter((o) => o.a >= z0 && o.b <= z1), m.wall[room], m.siding)
  }

  // --- Interior partitions ---
  // z = -10 (back rooms | hallway)
  const backRow = DOORWAYS.filter((d) => d.line === -10).map((d) => ({ a: d.at - d.w / 2, b: d.at + d.w / 2, y0: 0, y1: d.h }))
  for (const [x0, x1, room] of [[mins.x + HT, -18, 'kitchen'], [-18, 6, 'bathroom'], [6, maxs.x - HT, 'bedroom']]) {
    wallX(statics, -10, x0, x1, backRow.filter((o) => o.a >= x0 && o.b <= x1), m.wall[room], m.wall.hallway)
  }
  // z = 4 (hallway | front rooms)
  const frontRow = [
    ...DOORWAYS.filter((d) => d.line === 4).map((d) => ({ a: d.at - d.w / 2, b: d.at + d.w / 2, y0: 0, y1: d.h })),
    { a: ARCH.a, b: ARCH.b, y0: 0, y1: ARCH.h },
  ]
  for (const [x0, x1, room] of [[mins.x + HT, -18, 'garage'], [-18, 30, 'living'], [30, maxs.x - HT, 'study']]) {
    wallX(statics, 4, x0, x1, frontRow.filter((o) => o.a >= x0 && o.b <= x1), m.wall.hallway, m.wall[room])
  }
  // x = -18 (kitchen | bathroom) and (garage | living)
  wallZ(statics, -18, mins.z + HT, -10 - HT, [], m.wall.kitchen, m.wall.bathroom)
  wallZ(statics, -18, 4 + HT, maxs.z - HT, [], m.wall.garage, m.wall.living)
  // x = 6 (bathroom | bedroom)
  wallZ(statics, 6, mins.z + HT, -10 - HT, [], m.wall.bathroom, m.wall.bedroom)
  // x = 30 (living | study) with the secret bookshelf opening
  wallZ(statics, 30, 4 + HT, maxs.z - HT, [{ a: SECRET.a, b: SECRET.b, y0: 0, y1: SECRET.h }], m.wall.living, m.wall.study)

  // Frames on the interior doorways, the arch and the windows.
  for (const d of DOORWAYS) frameX(statics, d.line, d.at - d.w / 2, d.at + d.w / 2, 0, d.h)
  frameX(statics, 4, ARCH.a, ARCH.b, 0, ARCH.h, T + 0.6, 0.8)
  for (const f of Object.values(W)) {
    if (f.wall === 'front' || f.wall === 'back') frameX(statics, f.wall === 'front' ? maxs.z : mins.z, f.a, f.b, f.y0, f.y1, T + 0.9)
    else frameZ(statics, f.wall === 'east' ? maxs.x : mins.x, f.a, f.b, f.y0, f.y1, T + 0.9)
  }
  frameX(statics, maxs.z, GARAGE_DOOR.a, GARAGE_DOOR.b, 0, GARAGE_DOOR.h, T + 0.6, 0.7)
  for (const f of FIXED_WINDOWS) {
    if (f.wall === 'front' || f.wall === 'back') {
      const z = f.wall === 'front' ? maxs.z : mins.z
      frameX(statics, z, f.a, f.b, f.y0, f.y1, T + 0.9)
      fixedPane(live, statics, 'x', z, f.a, f.b, f.y0, f.y1)
    } else {
      const x = f.wall === 'west' ? mins.x : maxs.x
      frameZ(statics, x, f.a, f.b, f.y0, f.y1, T + 0.9)
      fixedPane(live, statics, 'z', x, f.a, f.b, f.y0, f.y1)
    }
  }

  // Baseboards along every room's walls (a thin strip; purely visual).
  for (const r of ROOMS) {
    const x0 = r.x0 + (r.x0 === HOUSE.minX ? T : HT)
    const x1 = r.x1 - (r.x1 === HOUSE.maxX ? T : HT)
    const z0 = r.z0 + (r.z0 === HOUSE.minZ ? T : HT)
    const z1 = r.z1 - (r.z1 === HOUSE.maxZ ? T : HT)
    boxMM(statics, x0, 0, z0, x1, 0.9, z0 + 0.18, m.base, { cast: false })
    boxMM(statics, x0, 0, z1 - 0.18, x1, 0.9, z1, m.base, { cast: false })
    boxMM(statics, x0, 0, z0, x0 + 0.18, 0.9, z1, m.base, { cast: false })
    boxMM(statics, x1 - 0.18, 0, z0, x1, 0.9, z1, m.base, { cast: false })
    // crown moulding
    boxMM(statics, x0, H - 0.6, z0, x1, H, z0 + 0.3, m.base, { cast: false })
    boxMM(statics, x0, H - 0.6, z1 - 0.3, x1, H, z1, m.base, { cast: false })
  }

  // Exterior plinth + roof + chimney.
  plinth(statics)
  roof(statics)

  // Back door (with the pet flap) and front door (with the mail slot): frames, steps, mats here; the
  // leaves are movers below.
  backDoor(statics)
  frontDoor(statics)

  // Moving parts. (The order is the network index: every client builds the same list.)
  const movers = []
  for (const d of DOORWAYS) movers.push(interiorDoor(live, d))
  movers.push(garageDoor(live))
  const windows = {}
  for (const id of Object.keys(W)) movers.push((windows[id] = sashWindow(live, id)))
  const back = exteriorDoor(live, 'back')
  const front = exteriorDoor(live, 'front')
  movers.push(flap(live, 'pet', back), flap(live, 'mail', front))
  movers.push(back, front)

  // Yard, driveway, street, fence, trees, climbing helpers.
  yard(statics, live)

  // Furniture + interactables + hiding spots + loot spots + Grandpa's activity spots.
  const furniture = buildFurniture(statics, live, m, movers)

  // Bake the static meshes into a handful of draw calls per room (roomCull.js hides rooms behind walls).
  const bb = new Box3()
  const regions = new Map() // room id | 'outside' -> [Object3D] (room culling units)
  const addRegion = (key, obj) => {
    if (!key) return
    if (!regions.has(key)) regions.set(key, [])
    regions.get(key).push(obj)
  }
  const baked = bakeBy(
    statics,
    (o) => {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
      return classifyBox(bb.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld)) ?? 'shared'
    },
    true,
  )
  for (const [key, group] of baked) {
    group.traverse((o) => {
      if (o.isMesh) o.receiveShadow = true
    })
    scene.add(group)
    if (key !== 'shared') addRegion(key, group)
  }
  // Furniture and fittings in `live` that stay in one room (movers swing across doorways: shared).
  const moving = new Set(movers.map((mv) => mv.mesh))
  live.updateMatrixWorld(true)
  for (const child of live.children) {
    if (moving.has(child) || child.isLight) continue
    addRegion(classifyBox(bb.setFromObject(child)), child)
  }

  return {
    movers,
    windows,
    outerDoors: { back, front },
    regions,
    ...furniture,
    nav: buildNav(),
    roomAt,
    insideFootprint,
    // Re-closes doors/windows to their start positions (a new heist).
    reset() {
      for (const mv of movers) mv.reset?.()
      furniture.reset?.()
    },
    update(dt, ctx) {
      for (const mv of movers) mv.update?.(dt, ctx)
      furniture.update?.(dt, ctx)
    },
  }
}

// A fixed glass pane + its collider in a wall opening.
function fixedPane(live, statics, axis, line, a, b, y0, y1) {
  const m = materials()
  const w = b - a
  const h = y1 - y0
  const pane = new Mesh(new PlaneGeometry(axis === 'x' ? w : w, h), m.glass)
  if (axis === 'x') pane.position.set((a + b) / 2, (y0 + y1) / 2, line)
  else {
    pane.position.set(line, (y0 + y1) / 2, (a + b) / 2)
    pane.rotation.y = Math.PI / 2
  }
  pane.renderOrder = 3
  live.add(pane)
  // muntins
  const mid = (a + b) / 2
  if (axis === 'x') {
    boxMM(statics, mid - 0.2, y0, line - 0.2, mid + 0.2, y1, line + 0.2, m.frame)
    boxMM(statics, a, (y0 + y1) / 2 - 0.2, line - 0.2, b, (y0 + y1) / 2 + 0.2, line + 0.2, m.frame)
    solidMM(a, y0, line - 0.3, b, y1, line + 0.3)
  } else {
    boxMM(statics, line - 0.2, y0, mid - 0.2, line + 0.2, y1, mid + 0.2, m.frame)
    boxMM(statics, line - 0.2, (y0 + y1) / 2 - 0.2, a, line + 0.2, (y0 + y1) / 2 + 0.2, b, m.frame)
    solidMM(line - 0.3, y0, a, line + 0.3, y1, b)
  }
}

function plinth(g) {
  const m = materials()
  const o = 0.35
  boxMM(g, HOUSE.minX - o, 0, HOUSE.maxZ - 0.2, HOUSE.maxX + o, 1.4, HOUSE.maxZ + o, m.plinth, { cast: false })
  boxMM(g, HOUSE.minX - o, 0, HOUSE.minZ - o, HOUSE.maxX + o, 1.4, HOUSE.minZ + 0.2, m.plinth, { cast: false })
  boxMM(g, HOUSE.minX - o, 0, HOUSE.minZ + 0.2, HOUSE.minX + 0.2, 1.4, HOUSE.maxZ - 0.2, m.plinth, { cast: false }) // sides between front/back
  boxMM(g, HOUSE.maxX - 0.2, 0, HOUSE.minZ + 0.2, HOUSE.maxX + o, 1.4, HOUSE.maxZ - 0.2, m.plinth, { cast: false })
  // the openings at ground level stay clear of the plinth band visually (doors sit on top of it)
  // corner trims
  for (const x of [HOUSE.minX, HOUSE.maxX])
    for (const z of [HOUSE.minZ, HOUSE.maxZ]) boxMM(g, x - 0.5, 1.4, z - 0.5, x + 0.5, H + 0.8, z + 0.5, m.trim)
  // eave fascia
  boxMM(g, HOUSE.minX - 3.35, H + 0.2, HOUSE.maxZ + 2.6, HOUSE.maxX + 3.35, H + 1.4, HOUSE.maxZ + 3.4, m.trim) // just inside the roof slab's ends
  boxMM(g, HOUSE.minX - 3.35, H + 0.2, HOUSE.minZ - 3.4, HOUSE.maxX + 3.35, H + 1.4, HOUSE.minZ - 2.6, m.trim)
}

// Gable roof, ridge along X at z = 0.
function roof(g) {
  const m = materials()
  const over = 3.4
  const half = (HOUSE.maxZ - HOUSE.minZ) / 2 + over
  const rise = 17
  const len = Math.hypot(half, rise)
  const ang = Math.atan2(rise, half)
  const w = HOUSE.maxX - HOUSE.minX + over * 2
  for (const side of [1, -1]) {
    const slab = box(g, w, 1, len + 0.6, m.roof, 0, H + 1.2 + rise / 2, (side * half) / 2)
    slab.rotation.x = side * ang
  }
  // Gable ends (triangles) in siding.
  const s = new Shape()
  s.moveTo(-half + over, 0)
  s.lineTo(half - over, 0)
  s.lineTo(0, rise - 1)
  s.closePath()
  const geo = new ExtrudeGeometry(s, { depth: 1, bevelEnabled: false })
  const uv = geo.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 6, uv.getY(i) / 6)
  for (const x of [HOUSE.minX + 0.2, HOUSE.maxX - 1.2]) {
    const gm = new Mesh(geo, materials().siding)
    gm.rotation.y = Math.PI / 2
    gm.position.set(x + 1, H + 1, 0)
    gm.castShadow = true
    g.add(gm)
  }
  // Attic vent in each gable.
  for (const x of [HOUSE.minX - 0.1, HOUSE.maxX + 0.1]) box(g, 0.4, 4, 5, m.trim, x, H + 7, 0)
  // Chimney over the fireplace (living room, x 19, z 4).
  box(g, 6, 22, 6, materials().plinth, 19, H + 12, 6)
  box(g, 7, 1, 7, m.trim, 19, H + 23.2, 6)
  box(g, 1.6, 2, 1.6, solid('#55555f', 0.6), 17.5, H + 24.4, 6)
  box(g, 1.6, 2.6, 1.6, solid('#55555f', 0.6), 20.5, H + 24.6, 6)
}

function backDoor(g) {
  const z = HOUSE.minZ + HT
  const { a, b, h } = BACK_DOOR
  // the leaf (with the pet flap) is a mover: exteriorDoor()
  frameX(g, z, a, b, 0, h, T + 0.6, 0.6)
  // doormat + step outside
  boxMM(g, a - 1, 0, HOUSE.minZ - 4, b + 1, 0.12, HOUSE.minZ, solid('#7d5a3a', 1), { cast: false })
}

function frontDoor(g) {
  const m = materials()
  const x = HOUSE.maxX - HT
  const { a, b, h } = FRONT_DOOR
  // the leaf (with the mail slot) is a mover: exteriorDoor()
  frameZ(g, x, a, b, 0, h, T + 0.6, 0.6)
  // porch: three steps up to the slot (each 1.5)
  const step = solid('#b9b2a6', 0.85)
  // stacked, not nested: each step starts where the one below ends (nested boxes share side faces)
  for (let i = 0; i < 3; i++) {
    const top = (i + 1) * 1.5
    boxMM(g, HOUSE.maxX + 0.01, i * 1.5, a - 3 + i * 0.02, HOUSE.maxX + 9 - i * 2.6, top, b + 3 - i * 0.02, step, { collide: true })
  }
  // doormat on the porch
  boxMM(g, HOUSE.maxX + 0.5, 4.5, a + 0.5, HOUSE.maxX + 3, 4.62, b - 0.5, solid('#7d5a3a', 1), { cast: false })
  // porch roof posts + light
  for (const z of [a - 2.5, b + 2.5]) box(g, 0.8, 11.5, 0.8, m.trim, HOUSE.maxX + 7.5, 4.5 + 5.75, z)
  boxMM(g, HOUSE.maxX, 16, a - 3.5, HOUSE.maxX + 9, 17, b + 3.5, materials().roof)
  sphere(g, 0.6, m.bulb, HOUSE.maxX + 1.2, 14, b + 1.6)
}

// --- Moving parts -------------------------------------------------------------------------------------
// Safety net for jointed parts: never let one spin or fly off faster than `max` (a solver blow-up).
export function clampSpin(body, max) {
  if (body.bodyType() !== RAPIER.RigidBodyType.Dynamic) return
  const w = body.angvel()
  const ws = Math.hypot(w.x, w.y, w.z)
  if (!Number.isFinite(ws)) {
    body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    return
  }
  if (ws > max) body.setAngvel({ x: (w.x / ws) * max, y: (w.y / ws) * max, z: (w.z / ws) * max }, true)
  const v = body.linvel()
  const vs = Math.hypot(v.x, v.y, v.z)
  if (vs > max * 4) body.setLinvel({ x: 0, y: 0, z: 0 }, true)
}
// Each mover: { kind, id, body, update(dt, ctx), reset(), amount() } and reports noise through ctx.noise.
// Optional aimPull(anchorLocal, target): remaps a grab's hold point (in place) onto the part's own path.
const qYaw = (yaw) => new Quaternion().setFromEuler(new Euler(0, yaw, 0))
// The hinge angle from a quaternion's axis component `s` and `w`, in (-PI, PI]. Rapier may hand back
// -q (the same rotation): read raw, that was a 2*PI jump (false slams, Grandpa shoving the door the
// wrong way into its stop, amount() > 1).
export const hingeAngle = (s, w) => (w < 0 ? 2 * Math.atan2(-s, -w) : 2 * Math.atan2(s, w))

// Interior doors swing this far each way (past ~1.85 the leaf rubs its own frame trim and wedges),
// and hang this high: the hallway runner and the mats have colliders up to 0.14, a door bottom at 0.05
// dragged on them (stuck at ~50 deg open, then popped off its hinge when pulled harder).
const DOOR_SWING = 1.75
const DOOR_FLOOR_GAP = 0.25

// A hinged interior door. Closed = spanning its doorway; hinge at one jamb.
function interiorDoor(live, d) {
  const m = materials()
  const w = d.w - 1.2 // the hinge sits clear of the wall end so the door never rubs it
  const h = d.h - DOOR_FLOOR_GAP - 0.2
  const cy = DOOR_FLOOR_GAP + h / 2 // centre height (the hinge pin's too)
  const th = 0.5
  const mesh = new Group()
  const slab = box(mesh, w, h, th, m.door, 0, 0, 0)
  for (const side of [-1, 1]) {
    box(mesh, w - 1.6, h * 0.36, 0.12, m.doorPanel, 0, h * 0.2, side * (th / 2 + 0.04))
    box(mesh, w - 1.6, h * 0.36, 0.12, m.doorPanel, 0, -h * 0.24, side * (th / 2 + 0.04))
    sphere(mesh, 0.38, m.knob, (-d.hingeSide * (w / 2 - 0.9)), -0.6, side * 0.55)
  }
  slab.castShadow = true
  compact(mesh) // one draw call per look for the whole door
  live.add(mesh)
  // Hinge at x = at + hingeSide * w/2 on the wall line; door local -x/+x edge at the hinge.
  const hingeX = d.at + d.hingeSide * (d.w / 2 - 0.6)
  const hingeZ = d.line
  const yawFor = (a) => a // rotation about Y
  const local = -d.hingeSide * (w / 2) // door centre offset from the hinge along local x
  const place = (angle) => {
    const q = qYaw(yawFor(angle))
    const off = new Vector3(local, 0, 0).applyQuaternion(q)
    mesh.position.set(hingeX + off.x, cy, hingeZ + off.z)
    mesh.quaternion.copy(q)
  }
  const start = d.ajar * d.swing * -d.hingeSide
  place(start)
  // 35 kg: light enough that the grabber arms swing it at a usable speed (at 70 it crawled at ~0.8 rad/s)
  const { body, collider } = addDynamicShape(mesh, RAPIER.ColliderDesc.cuboid(w / 2, h / 2, th / 2), { mass: 35, friction: 0.4, restitution: 0.05, angularDamping: 2.2, linearDamping: 0.5, sleep: true })
  body.setGravityScale(0, true)
  // It only ever turns about its pin: with x / z rotation free, a vertical pull or a snag tilted the
  // leaf and the joint alone had to hold it (it stretched, wedged and blew up).
  body.setEnabledTranslations(true, false, true, true)
  body.setEnabledRotations(false, true, false, true)
  const frame = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(hingeX, cy, hingeZ))
  const joint = hinge(frame, body, { x: 0, y: 0, z: 0 }, { x: -local, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, [-DOOR_SWING, DOOR_SWING])
  collider.setCollisionGroups(MOVER_GROUPS)
  const center = new Vector3(d.at, 0, d.line)
  // Swing at `wy` rad/s about the pin (the centre's velocity matches, so the joint has nothing to fix).
  const swing = (wy) => {
    const t = body.translation()
    body.setAngvel({ x: 0, y: wy, z: 0 }, true)
    body.setLinvel({ x: wy * (t.z - hingeZ), y: 0, z: -wy * (t.x - hingeX) }, true)
  }
  const mover = {
    kind: 'door', id: d.id, body, collider, mesh, grabbable: true, mat: 'wood', name: 'Door', center, swingDir: -d.hingeSide,
    angle: start, lastAngle: start, swingSpeed: 0, slamCooldown: 0,
    amount: () => Math.min(1, Math.abs(mover.angle) / DOOR_SWING),
    reset() {
      place(start)
      body.setTranslation(mesh.position, true)
      body.setRotation(mesh.quaternion, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    },
    update(dt, ctx) {
      const r = body.rotation()
      mover.angle = hingeAngle(r.y, r.w)
      clampSpin(body, 6)
      // Grandpa walks through doorways: the door swings open away from him (he never shoves it physically)
      const gp = ctx.grandpa
      if (gp && body.bodyType() === RAPIER.RigidBodyType.Dynamic && Math.hypot(gp.x - center.x, gp.z - center.z) < 9) {
        // which side of the wall line is he on? open toward the other side
        const side = Math.sign(gp.z - center.z) || 1
        const target = -side * d.hingeSide * 1.55 // the door's z side is hingeSide * sign(angle)
        const want = Math.abs(mover.angle) > 1.2 && Math.sign(mover.angle) === Math.sign(target) ? 0 : (target - mover.angle) * 3
        if (want !== 0) swing(Math.max(-3, Math.min(3, want)))
      }
      const av = body.angvel().y
      mover.swingSpeed = Math.abs(av)
      mover.slamCooldown -= dt
      // A fast swing that comes to a stop near closed or at the stop = slam.
      // slam = swung shut fast, or banged into its stop fast (never while Grandpa is the one swinging it)
      const closing = Math.abs(mover.angle) < 0.08 && Math.abs(mover.lastAngle) >= 0.08
      const banged = Math.abs(mover.angle) > DOOR_SWING - 0.1 && mover.lastSpeed > 2.6 && Math.abs(av) < 0.6
      const gpNear = gp && Math.hypot(gp.x - center.x, gp.z - center.z) < 14
      if (!gpNear && ((closing && Math.abs(av) > 1.4) || banged)) {
        if (mover.slamCooldown <= 0) {
          ctx.event('doorSlam', mesh.position, 1)
          mover.slamCooldown = 0.6
        }
      }
      mover.lastSpeed = Math.abs(av)
      mover.lastAngle = mover.angle
      ctx.creak(mover, mover.swingSpeed, 'doorCreak', mesh.position)
    },
  }
  setOwner(collider, mover)
  void joint
  return mover
}

// The front / back door: a hinged leaf like the interior doors, but swinging INWARD only, with a hole for
// its pet flap / mail slot (several cuboid colliders around the hole). Its flap mover rides along while
// the door is open (flap(..., door)).
const OUTER_DOORS = {
  // back wall z = -41.4, hinge at the west jamb (knob east), leaf toward +x
  back: { axis: 'x', line: () => HOUSE.minZ + HT, a: BACK_DOOR.a, b: BACK_DOOR.b, h: BACK_DOOR.h, hinge: 'a', hole: { a: BACK_DOOR.flap.a, b: BACK_DOOR.flap.b, y0: 0, y1: BACK_DOOR.flap.h }, trim: 'frame' },
  // east wall x = 53.4, hinge at the north jamb (knob south), leaf toward -z
  front: { axis: 'z', line: () => HOUSE.maxX - HT, a: FRONT_DOOR.a, b: FRONT_DOOR.b, h: FRONT_DOOR.h, hinge: 'b', hole: FRONT_DOOR.slot, trim: 'brass' },
}
function exteriorDoor(live, id) {
  const m = materials()
  const D = OUTER_DOORS[id]
  const line = D.line()
  const w = D.b - D.a - 1.0
  const top = D.h - 0.2
  const h = top - DOOR_FLOOR_GAP
  const cy = DOOR_FLOOR_GAP + h / 2
  const th = 0.7
  const dir = D.hinge === 'a' ? 1 : -1 // the leaf runs from its hinge this way along the wall
  const hingeAlong = D.hinge === 'a' ? D.a + 0.5 : D.b - 0.5
  const alongV = D.axis === 'x' ? new Vector3(dir, 0, 0) : new Vector3(0, 0, dir)
  const baseYaw = Math.atan2(-alongV.z, alongV.x) // local +x (hinge -> latch) along the wall
  const qBase = qYaw(baseYaw)
  const hingePos = D.axis === 'x' ? new Vector3(hingeAlong, cy, line) : new Vector3(line, cy, hingeAlong)
  const inward = D.axis === 'x' ? new Vector3(0, 0, -Math.sign(line)) : new Vector3(-Math.sign(line), 0, 0)
  const localZ = new Vector3(0, 0, 1).applyQuaternion(qBase)
  const inZ = Math.sign(localZ.dot(inward)) // which local z faces the inside
  const openSign = -inZ // +angle moves the leaf toward local -z
  const toLocalX = (along) => (along - hingeAlong) * dir - w / 2
  const hx0 = Math.min(toLocalX(D.hole.a), toLocalX(D.hole.b))
  const hx1 = Math.max(toLocalX(D.hole.a), toLocalX(D.hole.b))
  const hy0 = Math.max(-h / 2, D.hole.y0 - cy)
  const hy1 = D.hole.y1 - cy
  // leaf pieces around the hole: [x0, x1, y0, y1] in local space
  const pieces = [[-w / 2, hx0, -h / 2, h / 2], [hx1, w / 2, -h / 2, h / 2], [hx0, hx1, hy1, h / 2]]
  if (hy0 > -h / 2 + 0.05) pieces.push([hx0, hx1, -h / 2, hy0])
  const mesh = new Group()
  for (const [x0, x1, y0, y1] of pieces) {
    const s = box(mesh, x1 - x0, y1 - y0, th, m.frontDoor, (x0 + x1) / 2, (y0 + y1) / 2, 0)
    s.castShadow = true
  }
  // trim round the hole (both faces), panels outside, a knob each side near the latch edge
  const trim = D.trim === 'brass' ? metal('#d8b15a', 0.3) : m.frame
  for (const side of [-1, 1]) {
    const z = side * (th / 2 + 0.06)
    box(mesh, hx1 - hx0 + 0.5, 0.25, 0.12, trim, (hx0 + hx1) / 2, hy1 + 0.125, z)
    if (hy0 > -h / 2 + 0.05) box(mesh, hx1 - hx0 + 0.5, 0.25, 0.12, trim, (hx0 + hx1) / 2, hy0 - 0.125, z)
    box(mesh, 0.25, hy1 - hy0, 0.12, trim, hx0 - 0.125, (hy0 + hy1) / 2, z)
    box(mesh, 0.25, hy1 - hy0, 0.12, trim, hx1 + 0.125, (hy0 + hy1) / 2, z)
    sphere(mesh, 0.42, m.knob, w / 2 - 1, 6.3 - cy, side * (th / 2 + 0.4))
  }
  const outZ = -inZ * (th / 2 + 0.05)
  box(mesh, w - 2, 4.6, 0.1, m.doorPanel, 0, 9.4 - cy, outZ)
  if (D.hole.y1 < 3.8) box(mesh, w - 2, 1.8, 0.1, m.doorPanel, 0, 5 - cy, outZ)
  compact(mesh)
  live.add(mesh)
  const place = (angle) => {
    const q = qYaw(baseYaw + angle)
    const off = new Vector3(w / 2, 0, 0).applyQuaternion(q)
    mesh.position.set(hingePos.x + off.x, cy, hingePos.z + off.z)
    mesh.quaternion.copy(q)
  }
  place(0)
  const [p0, ...rest] = pieces.map(([x0, x1, y0, y1]) => ({ hx: (x1 - x0) / 2, hy: (y1 - y0) / 2, x: (x0 + x1) / 2, y: (y0 + y1) / 2 }))
  const mass = 40 / pieces.length
  const { body, collider } = addDynamicShape(mesh, RAPIER.ColliderDesc.cuboid(p0.hx, p0.hy, th / 2).setTranslation(p0.x, p0.y, 0), { mass, friction: 0.4, restitution: 0.05, angularDamping: 2.2, linearDamping: 0.5, sleep: true })
  const colliders = [collider]
  for (const p of rest) colliders.push(world.createCollider(RAPIER.ColliderDesc.cuboid(p.hx, p.hy, th / 2).setTranslation(p.x, p.y, 0).setMass(mass).setFriction(0.4).setRestitution(0.05), body))
  body.setGravityScale(0, true)
  body.setEnabledTranslations(true, false, true, true)
  body.setEnabledRotations(false, true, false, true)
  // The pin's frame stays unrotated (a revolute joint on a rotated fixed frame locked the leaf solid), so
  // the limits are in absolute yaw, kept inside (-PI, PI]: the front door (base yaw PI/2) swings ~89 deg.
  const swingMax = Math.min(DOOR_SWING, Math.PI - Math.abs(baseYaw) - 0.02)
  const frame = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(hingePos.x, cy, hingePos.z))
  hinge(frame, body, { x: 0, y: 0, z: 0 }, { x: -w / 2, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, openSign > 0 ? [baseYaw, baseYaw + swingMax] : [baseYaw - swingMax, baseYaw])
  for (const c of colliders) c.setCollisionGroups(MOVER_GROUPS)
  const center = new Vector3(D.axis === 'x' ? (D.a + D.b) / 2 : line, 0, D.axis === 'x' ? line : (D.a + D.b) / 2)
  const qInv = qBase.clone().invert()
  const qRel = new Quaternion()
  const swing = (wy) => {
    const t = body.translation()
    body.setAngvel({ x: 0, y: wy, z: 0 }, true)
    body.setLinvel({ x: wy * (t.z - hingePos.z), y: 0, z: -wy * (t.x - hingePos.x) }, true)
  }
  const mover = {
    kind: 'door', id, body, collider, mesh, grabbable: true, mat: 'wood', name: id === 'front' ? 'Front Door' : 'Back Door', center, outer: true,
    angle: 0, lastAngle: 0, swingSpeed: 0, slamCooldown: 0, lastSpeed: 0, inward, openSign,
    amount: () => Math.min(1, Math.abs(mover.angle) / swingMax),
    reset() {
      place(0)
      body.setTranslation(mesh.position, true)
      body.setRotation(mesh.quaternion, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    },
    update(dt, ctx) {
      const r = body.rotation()
      qRel.set(r.x, r.y, r.z, r.w).premultiply(qInv)
      mover.angle = hingeAngle(qRel.y, qRel.w)
      clampSpin(body, 6)
      // Grandpa going in / out (the back door is his way to the yard): it swings wide open for him
      const gp = ctx.grandpa
      if (gp && body.bodyType() === RAPIER.RigidBodyType.Dynamic && Math.hypot(gp.x - center.x, gp.z - center.z) < 10) {
        const target = openSign * (swingMax - 0.08)
        if (Math.abs(mover.angle) < swingMax - 0.15) swing(Math.max(-3, Math.min(3, (target - mover.angle) * 3)))
      }
      const av = body.angvel().y
      mover.swingSpeed = Math.abs(av)
      mover.slamCooldown -= dt
      const closing = Math.abs(mover.angle) < 0.08 && Math.abs(mover.lastAngle) >= 0.08
      const banged = Math.abs(mover.angle) > swingMax - 0.1 && mover.lastSpeed > 2.6 && Math.abs(av) < 0.6
      const gpNear = gp && Math.hypot(gp.x - center.x, gp.z - center.z) < 14
      if (!gpNear && ((closing && Math.abs(av) > 1.4) || banged) && mover.slamCooldown <= 0) {
        ctx.event('doorSlam', mesh.position, 1)
        mover.slamCooldown = 0.6
      }
      mover.lastSpeed = Math.abs(av)
      mover.lastAngle = mover.angle
      ctx.creak(mover, mover.swingSpeed, 'doorCreak', mesh.position)
    },
  }
  for (const c of colliders) setOwner(c, mover)
  return mover
}

// The up-and-over garage door: hinged along its top edge, swings out and up. Grab the bottom and lift.
function garageDoor(live) {
  const m = materials()
  const { a, b, h } = GARAGE_DOOR
  const w = b - a - 0.4
  const th = 0.6
  const mesh = new Group()
  box(mesh, w, h - 0.2, th, m.garageDoor, 0, 0, 0)
  // handle bar along the bottom + window strip
  box(mesh, w * 0.5, 0.5, 0.6, metal('#9aa1ab', 0.35), 0, -h / 2 + 1.3, th / 2 + 0.25)
  for (let i = 0; i < 5; i++) box(mesh, w / 6.5, 1.5, 0.1, m.glass, -w / 2 + (w / 5) * (i + 0.5), h / 2 - 2.6, th / 2 + 0.05)
  compact(mesh)
  live.add(mesh)
  const hingeY = h - 0.1
  const z = HOUSE.maxZ + 0.1
  mesh.position.set((a + b) / 2, hingeY - (h - 0.2) / 2, z)
  const { body, collider } = addDynamicShape(mesh, RAPIER.ColliderDesc.cuboid(w / 2, (h - 0.2) / 2, th / 2), { mass: 32, friction: 0.5, angularDamping: 1.4, linearDamping: 0.6 })
  body.setGravityScale(0, true)
  // only the swing about its top edge (no sideways slide, no twist off the pin)
  body.setEnabledTranslations(false, true, true, true)
  body.setEnabledRotations(true, false, false, true)
  collider.setCollisionGroups(MOVER_GROUPS)
  const frame = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation((a + b) / 2, hingeY, z))
  const OPEN = 1.45
  const halfH = (h - 0.2) / 2 // the pin sits this far above the leaf's centre
  hinge(frame, body, { x: 0, y: 0, z: 0 }, { x: 0, y: halfH, z: 0 }, { x: 1, y: 0, z: 0 }, [-OPEN, 0])
  const start = { p: mesh.position.clone(), q: mesh.quaternion.clone() }
  const mover = {
    kind: 'garage', id: 'garage', body, collider, mesh, grabbable: true, mat: 'metal', name: 'Garage Door',
    angle: 0, clunk: 0,
    // its bottom edge sweeps 12 m out toward the thief lifting it: it passes through its holder
    // instead of jamming against them a fifth of the way up
    ghostWhileHeld: true,
    amount: () => Math.min(1, -mover.angle / OPEN),
    // Grabbed low, the leaf can only move out-and-up along an arc. A pull straight up on the closed door
    // points at the pin (no leverage), so "grab the bottom and drag up" did nothing. The hold point is
    // put on the arc instead: lift it to a height (or pull it out to a distance) and the door opens
    // until the grabbed point gets there.
    aimPull(anchorLocal, target) {
      const ly = anchorLocal.y - halfH // the grabbed point relative to the pin (door frame, closed)
      const lz = anchorLocal.z
      if (ly > -1) return // grabbed right by the pin: no arc worth mapping
      const R = -ly
      const byHeight = -Math.acos(Math.min(1, Math.max(-1, (hingeY - target.y) / R)))
      const byReach = -Math.asin(Math.min(1, Math.max(0, (target.z - z) / R)))
      const ang = Math.max(-OPEN, Math.min(0, Math.min(byHeight, byReach)))
      const c = Math.cos(ang)
      const s = Math.sin(ang)
      target.y = hingeY + ly * c - lz * s
      target.z = z + ly * s + lz * c
    },
    reset() {
      mesh.position.copy(start.p)
      mesh.quaternion.copy(start.q)
      body.setTranslation(start.p, true)
      body.setRotation(start.q, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    },
    update(dt, ctx) {
      clampSpin(body, 4)
      const r = body.rotation()
      const prev = mover.angle
      mover.angle = hingeAngle(r.x, r.w)
      const speed = Math.abs(body.angvel().x)
      ctx.creak(mover, speed * 1.4, 'garageRattle', mesh.position)
      mover.clunk -= dt
      const atStop = mover.angle > -0.02 || mover.angle < -1.43
      const wasMoving = Math.abs(mover.angle - prev) / Math.max(dt, 1e-3) > 0.6
      if (atStop && wasMoving && mover.clunk <= 0) {
        ctx.event('garageClunk', mesh.position, 1)
        mover.clunk = 0.8
      }
    },
  }
  setOwner(collider, mover)
  return mover
}

// A sash window: the lower sash slides up on a prismatic joint. Grab it and drag up.
function sashWindow(live, id) {
  const m = materials()
  const W = WINDOWS[id]
  const w = W.b - W.a - 0.3
  const sashH = W.sash
  const th = 0.35
  const mesh = new Group()
  // sash frame + glass
  box(mesh, w, 0.5, th, m.frame, 0, -sashH / 2 + 0.25, 0)
  box(mesh, w, 0.4, th, m.frame, 0, sashH / 2 - 0.2, 0)
  box(mesh, 0.4, sashH, th, m.frame, -w / 2 + 0.2, 0, 0)
  box(mesh, 0.4, sashH, th, m.frame, w / 2 - 0.2, 0, 0)
  box(mesh, 0.3, sashH, th, m.frame, 0, 0, 0)
  const pane = new Mesh(new PlaneGeometry(w - 0.8, sashH - 0.9), m.glass)
  pane.renderOrder = 3
  mesh.add(pane)
  // the lift handle (the "bottom glass" grip)
  box(mesh, 1.6, 0.3, 0.5, metal('#d8b15a', 0.3), 0, -sashH / 2 + 0.55, th / 2 + 0.2)
  box(mesh, 1.6, 0.3, 0.5, metal('#d8b15a', 0.3), 0, -sashH / 2 + 0.55, -th / 2 - 0.2)
  compact(mesh)
  live.add(mesh)
  // Upper fixed sash (glass + frame) and its collider, slightly outside.
  const upper = new Group()
  box(upper, w, 0.4, th, m.frame, 0, -sashH / 2 + 0.2, 0)
  box(upper, 0.3, W.y1 - W.y0 - sashH, th, m.frame, 0, 0, 0)
  const up = new Mesh(new PlaneGeometry(w - 0.8, W.y1 - W.y0 - sashH - 0.6), m.glass)
  up.renderOrder = 3
  upper.add(up)
  compact(upper)
  live.add(upper)
  let base
  let upperPos
  let yaw = 0
  if (W.wall === 'front') {
    base = new Vector3((W.a + W.b) / 2, W.y0 + sashH / 2, HOUSE.maxZ - HT - 0.15)
    upperPos = new Vector3((W.a + W.b) / 2, W.y0 + sashH + (W.y1 - W.y0 - sashH) / 2, HOUSE.maxZ - HT + 0.3)
  } else if (W.wall === 'back') {
    base = new Vector3((W.a + W.b) / 2, W.y0 + sashH / 2, HOUSE.minZ + HT + 0.15)
    upperPos = new Vector3((W.a + W.b) / 2, W.y0 + sashH + (W.y1 - W.y0 - sashH) / 2, HOUSE.minZ + HT - 0.3)
  } else if (W.wall === 'east') {
    yaw = Math.PI / 2
    base = new Vector3(HOUSE.maxX - HT - 0.15, W.y0 + sashH / 2, (W.a + W.b) / 2)
    upperPos = new Vector3(HOUSE.maxX - HT + 0.3, W.y0 + sashH + (W.y1 - W.y0 - sashH) / 2, (W.a + W.b) / 2)
  } else {
    yaw = Math.PI / 2
    base = new Vector3(HOUSE.minX + HT + 0.15, W.y0 + sashH / 2, (W.a + W.b) / 2)
    upperPos = new Vector3(HOUSE.minX + HT - 0.3, W.y0 + sashH + (W.y1 - W.y0 - sashH) / 2, (W.a + W.b) / 2)
  }
  upper.position.copy(upperPos)
  upper.rotation.y = yaw
  const uh = (W.y1 - W.y0 - sashH) / 2
  const q = qYaw(yaw)
  world.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, uh, th / 2).setTranslation(upperPos.x, upperPos.y, upperPos.z).setRotation(q))
  mesh.position.copy(base)
  mesh.quaternion.copy(q)
  const { body, collider } = addDynamicShape(mesh, RAPIER.ColliderDesc.cuboid(w / 2, sashH / 2, th / 2), { mass: 10, friction: 0.3, linearDamping: 5, angularDamping: 10 })
  body.setGravityScale(0, true)
  body.setEnabledRotations(false, false, false, true)
  collider.setCollisionGroups(MOVER_GROUPS)
  const frame = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(base.x, base.y, base.z).setRotation(q))
  const travel = W.y1 - W.y0 - sashH - 0.2
  const track = slider(frame, body, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, [0, travel])
  // the wall line (centre of the wall) and which way is inside, for the climb-through vault
  const wallLine = W.wall === 'front' ? HOUSE.maxZ - HT : W.wall === 'back' ? HOUSE.minZ + HT : W.wall === 'east' ? HOUSE.maxX - HT : HOUSE.minX + HT
  const mover = {
    kind: 'window', id, body, collider, mesh, grabbable: true, mat: 'glass', name: 'Window', travel, wall: W.wall,
    open: 0, thud: 0, latched: false, def: W, wallLine,
    amount: () => mover.open / travel,
    // latched shut (the study's, until the secret door is found)
    setLatched(on) {
      mover.latched = !!on
      mover.name = on ? 'Window (latched)' : 'Window'
      track.setLimits(0, on ? 0.001 : travel)
      if (on) mover.reset()
    },
    reset() {
      mesh.position.copy(base)
      body.setTranslation(base, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      if (W.latched && !mover.latched) mover.setLatched(true)
    },
    update(dt, ctx) {
      clampSpin(body, 4)
      const prev = mover.open
      mover.open = body.translation().y - base.y
      const speed = Math.abs(body.linvel().y)
      ctx.creak(mover, speed * 0.5, 'windowSlide', mesh.position)
      mover.thud -= dt
      const stop = mover.open < 0.03 || mover.open > travel - 0.03
      if (stop && Math.abs(mover.open - prev) / Math.max(dt, 1e-3) > 2.5 && mover.thud <= 0) {
        ctx.event('windowThud', mesh.position, 1)
        mover.thud = 0.5
      }
    },
  }
  setOwner(collider, mover)
  if (W.latched) mover.setLatched(true)
  return mover
}

// Pet flap (kitchen back door) and mail slot flap (front door): light flaps hinged at the top that
// swing both ways under gravity; the player pushes through. While its door is open the flap rides along
// in the leaf (kinematic, on the authority; crew clients follow the host's pose anyway).
const _fp = new Vector3()
const _fq = new Quaternion()
function flap(live, kind, door = null) {
  const m = materials()
  let w
  let h
  let pos
  let axis
  let yaw = 0
  if (kind === 'pet') {
    const f = BACK_DOOR.flap
    w = f.b - f.a - 0.2
    h = f.h - 0.2
    pos = new Vector3((f.a + f.b) / 2, f.h - 0.1, HOUSE.minZ + HT)
    axis = { x: 1, y: 0, z: 0 }
  } else {
    const s = FRONT_DOOR.slot
    w = s.b - s.a - 0.15
    h = s.y1 - s.y0 - 0.1
    pos = new Vector3(HOUSE.maxX - HT + 0.4, s.y1 - 0.05, (s.a + s.b) / 2)
    axis = { x: 0, y: 0, z: 1 }
    yaw = Math.PI / 2
  }
  const mesh = new Group()
  box(mesh, w, h, 0.15, kind === 'pet' ? solid('#6d7a88', 0.4, 0, { transparent: true, opacity: 0.85 }) : metal('#d8b15a', 0.3), 0, 0, 0)
  live.add(mesh)
  const q = qYaw(yaw)
  mesh.quaternion.copy(q)
  mesh.position.set(pos.x, pos.y - h / 2, pos.z)
  const { body, collider } = addDynamicShape(mesh, RAPIER.ColliderDesc.cuboid(w / 2, h / 2, 0.08), { mass: 1.2, friction: 0.2, angularDamping: 1.2, linearDamping: 0.5 })
  collider.setCollisionGroups(MOVER_GROUPS)
  const frame = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(pos.x, pos.y, pos.z).setRotation(q))
  hinge(frame, body, { x: 0, y: 0, z: 0 }, { x: 0, y: h / 2, z: 0 }, { x: 1, y: 0, z: 0 }, [-1.35, 1.35])
  // it only swings about its top edge (a thief shoving through used to twist it off the pin)
  body.setEnabledRotations(axis.x !== 0, axis.y !== 0, axis.z !== 0, true)
  const start = { p: mesh.position.clone(), q: mesh.quaternion.clone() }
  // its closed pose relative to the (closed) door leaf
  let rel = null
  if (door) {
    const dq = door.mesh.quaternion.clone().invert()
    rel = { p: start.p.clone().sub(door.mesh.position).applyQuaternion(dq), q: dq.multiply(start.q) }
  }
  let riding = false
  const mover = {
    kind: 'flap', id: kind, body, collider, mesh, grabbable: false, mat: 'plastic', name: 'Flap', tick: 0,
    reset() {
      if (riding) {
        riding = false
        body.setBodyType(RAPIER.RigidBodyType.Dynamic, true)
      }
      body.setTranslation(start.p, true)
      body.setRotation(start.q, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    },
    update(dt, ctx) {
      if (door && ctx.authority !== false) {
        const open = Math.abs(door.angle) > 0.03 || door.swingSpeed > 0.05
        if (open) {
          if (!riding) {
            riding = true
            body.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true)
          }
          const t = door.body.translation()
          const r = door.body.rotation()
          _fq.set(r.x, r.y, r.z, r.w)
          _fp.copy(rel.p).applyQuaternion(_fq).add(t)
          body.setNextKinematicTranslation(_fp)
          body.setNextKinematicRotation(_fq.multiply(rel.q))
          return
        }
        if (riding) mover.reset()
      }
      clampSpin(body, 10)
      const av = body.angvel()
      const s = Math.hypot(av.x, av.z)
      mover.tick -= dt
      if (s > 3.5 && mover.tick <= 0) {
        ctx.event('flap', mesh.position, Math.min(1, s / 8))
        mover.tick = 0.35
      }
    },
  }
  setOwner(collider, mover)
  return mover
}

// --- Yard -----------------------------------------------------------------------------------------
function yard(g, live) {
  const m = materials()
  // Lawn (huge, so the horizon is grass) + its collider.
  const lawn = new Mesh(new PlaneGeometry(1400, 1400), m.lawn)
  lawn.rotation.x = -Math.PI / 2
  lawn.position.y = -0.02
  const uv = lawn.geometry.attributes.uv
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1400, uv.getY(i) * 1400)
  lawn.receiveShadow = true
  g.add(lawn)
  world.createCollider(RAPIER.ColliderDesc.cuboid(700, 1, 700).setTranslation(0, -1.02, 0).setFriction(0.9))
  // Driveway from the garage to the street, front path to the porch, sidewalk, street + curbs.
  boxMM(g, -52, -0.01, HOUSE.maxZ, -20, 0.06, 112, m.concrete, { cast: false, collide: true })
  boxMM(g, 56, -0.01, -10, 66, 0.06, 112, m.sidewalk, { cast: false, collide: true }) // path to the porch
  boxMM(g, -300, -0.01, 104, 300, 0.12, 112, m.sidewalk, { cast: false, collide: true })
  boxMM(g, -300, -0.03, 112, 300, 0.04, 150, m.asphalt, { cast: false, collide: true })
  boxMM(g, -300, 0, 111.4, 300, 0.45, 112.2, solid('#d8d4cc', 0.8), { cast: false, collide: true })
  // dashed centre line
  for (let x = -290; x < 300; x += 16) boxMM(g, x, 0.05, 130.6, x + 8, 0.07, 131.4, solid('#f3d36b', 0.7), { cast: false })

  // Fence around the yard (picket), with a gap for the driveway and the path.
  const fz = 102
  const fx = 110
  const fb = -110
  picketRun(g, -fx, fz, -54, fz)
  picketRun(g, -18, fz, 54, fz)
  picketRun(g, 68, fz, fx, fz)
  picketRun(g, -fx, fb, fx, fb)
  picketRun(g, -fx, fb, -fx, fz)
  picketRun(g, fx, fb, fx, fz)
  // invisible walls beyond the fence so nobody wanders off
  solidMM(-fx - 1, 0, fb - 1, -fx, 10, fz)
  solidMM(fx, 0, fb - 1, fx + 1, 10, fz)
  solidMM(-fx, 0, fb - 1, fx, 10, fb)
  solidMM(-300, 0, 150, 300, 10, 151)

  // Trees and hedges.
  const trees = [[-85, 60, 1.1], [80, 70, 1.3], [-90, -60, 1.2], [85, -55, 1], [0, -85, 1.4], [-60, -90, 0.9], [95, 20, 0.9], [-95, 15, 1]]
  for (const [x, z, s] of trees) tree(g, x, z, s)
  for (let x = -100; x <= 100; x += 9) if (Math.abs(x) > 60) bush(g, x, 96, 1 + ((x * 7) % 3) * 0.15)
  // Flower beds along the front wall (left of the garage, right of the window).
  flowerBed(g, -16, HOUSE.maxZ + 1, -4, HOUSE.maxZ + 4.5)
  flowerBed(g, 15, HOUSE.maxZ + 1, 52, HOUSE.maxZ + 4.5)
  // Mailbox by the sidewalk.
  box(g, 0.6, 6, 0.6, m.wood, 62, 3, 100)
  box(g, 2.2, 1.8, 3.4, solid('#3a6fd0', 0.4, 0.3), 62, 6.6, 100, { round: 0.6 })
  box(g, 0.2, 1.2, 0.5, solid('#e83b3b', 0.5), 63.2, 7.2, 100.8)
  solidMM(61.6, 0, 98.2, 62.4, 7.5, 101.8)

  // Climbing helpers (static): front window, bedroom window, bathroom window.
  const crate = solid('#b88a55', 0.85)
  const W = WINDOWS
  // Front window (sill 5): planter 1.6 -> crate 3.2 -> crate 4.8 -> sill.
  boxMM(g, W.living.a - 1, 0, HOUSE.maxZ + 0.4, W.living.b + 1, 1.6, HOUSE.maxZ + 3.6, solid('#9a6b45', 0.8), { collide: true })
  for (let x = W.living.a; x < W.living.b; x += 1.8) sphere(g, 0.9, M.leaf[(x | 0) % 3], x + 0.6, 2.1, HOUSE.maxZ + 2, { sy: 0.7 })
  crateBox(g, crate, 9.5, 1.6, HOUSE.maxZ + 2.4, 2.6)
  crateBox(g, crate, 11.5, 3.2, HOUSE.maxZ + 2.0, 2.2, 1.6)
  // Bedroom window (east wall, sill 5): crate 1.6 -> AC unit 3.2 -> crate 4.8.
  crateBox(g, crate, HOUSE.maxX + 3, 0, W.bedroom.b + 3, 2.8)
  acUnit(g, HOUSE.maxX + 3, (W.bedroom.a + W.bedroom.b) / 2 + 2.5, 3.2)
  crateBox(g, crate, HOUSE.maxX + 2.6, 3.2, (W.bedroom.a + W.bedroom.b) / 2 - 1, 2.2, 1.6)
  // Bathroom window (back wall, sill 8): crate 1.6 -> bin 3.2 -> AC 4.8 -> crate 6.4.
  crateBox(g, crate, -16, 0, HOUSE.minZ - 3, 2.8)
  trashBin(g, -12.5, HOUSE.minZ - 3.2, 3.2)
  acUnit(g, -8.5, HOUSE.minZ - 2.6, 4.8, true)
  crateBox(g, crate, -5, 4.8, HOUSE.minZ - 2.4, 2.4, 1.6)
  // A drainpipe for looks.
  cyl(g, 0.35, 0.35, H + 1, solid('#d9dde2', 0.4, 0.5), -1, (H + 1) / 2, HOUSE.minZ - 0.6)

  // Garden shed in the back + a clothesline.
  boxMM(g, 60, 0, -95, 90, 14, -75, surface('shed', paintSiding('#b55d4c'), { tile: 5 }), { collide: true })
  const roofM = materials().roof
  const sr = box(g, 34, 0.8, 13, roofM, 75, 15.5, -90)
  sr.rotation.x = 0.35
  const sr2 = box(g, 34, 0.8, 13, roofM, 75, 15.5, -80)
  sr2.rotation.x = -0.35
  box(g, 6, 10, 0.3, solid('#6e3b2e', 0.7), 75, 5, -74.8)
  for (const x of [-40, 0]) box(g, 0.5, 14, 0.5, m.trim, x, 7, -78)
  boxMM(g, -40, 13.4, -78.05, 0, 13.5, -77.95, solid('#ffffff', 0.9), { cast: false })

  // Neighbours across the street (simple, for the skyline).
  const nb = [[-140, '#e7c9a2', '#7b3f3f'], [-40, '#bcd7c4', '#4d4f60'], [60, '#f0d9df', '#5c6b8a'], [170, '#d9dbe8', '#6b4b3b']]
  for (const [x, wall, rf] of nb) neighbour(g, x, 205, wall, rf)
  void live
}

function picketRun(g, x0, z0, x1, z1) {
  const m = materials()
  const len = Math.hypot(x1 - x0, z1 - z0)
  const dx = (x1 - x0) / len
  const dz = (z1 - z0) / len
  const yaw = Math.atan2(dx, dz)
  for (let s = 0; s <= len; s += 2.2) {
    const x = x0 + dx * s
    const z = z0 + dz * s
    const p = box(g, 1.2, 6, 0.4, m.fence, x, 3, z)
    p.rotation.y = yaw + Math.PI / 2
  }
  for (const y of [1.8, 4.6]) {
    const rail = box(g, len, 0.6, 0.3, m.fence, (x0 + x1) / 2, y, (z0 + z1) / 2)
    rail.rotation.y = yaw + Math.PI / 2
  }
}
function tree(g, x, z, s) {
  const m = materials()
  cyl(g, 1.6 * s, 2.4 * s, 22 * s, m.trunk, x, 11 * s, z, { collide: true })
  const blobs = [[0, 26, 0, 11], [-6, 22, 3, 8], [6, 23, -2, 8.5], [2, 30, 4, 7.5], [-3, 29, -5, 7]]
  blobs.forEach(([bx, by, bz, r], i) => sphere(g, r * s, m.leaf[i % 3], x + bx * s, by * s, z + bz * s, { seg: 12 }))
}
function bush(g, x, z, s) {
  const m = materials()
  sphere(g, 3.2 * s, m.leaf[0], x, 2.2 * s, z, { sy: 0.8, seg: 10 })
  sphere(g, 2.6 * s, m.leaf[1], x + 2.4 * s, 2 * s, z + 0.6, { sy: 0.8, seg: 10 })
}
function flowerBed(g, x0, z0, x1, z1) {
  boxMM(g, x0, 0, z0, x1, 0.8, z1, solid('#6b4a33', 1), { cast: false })
  const cols = ['#ff6b8a', '#ffd35c', '#ffffff', '#b38cff', '#ff8c42']
  let i = 0
  for (let x = x0 + 1; x < x1 - 0.5; x += 1.6) {
    for (let z = z0 + 0.8; z < z1 - 0.5; z += 1.5) {
      cyl(g, 0.08, 0.08, 1.6, solid('#3f8a34', 0.8), x, 1.6, z, { seg: 5, cast: false })
      sphere(g, 0.45, solid(cols[i++ % cols.length], 0.6), x, 2.5, z, { seg: 8 })
    }
  }
}
function crateBox(g, mat, x, y0, z, size, h = size) {
  const m = materials()
  box(g, size, h, size, mat, x, y0 + h / 2, z, { collide: true })
  // slats
  for (const dy of [-h / 2 + 0.25, h / 2 - 0.25]) box(g, size + 0.06, 0.25, size + 0.06, m.darkWood, x, y0 + h / 2 + dy, z)
}
function acUnit(g, x, z, h, alongX = false) {
  const body = solid('#d9dde2', 0.45, 0.2)
  if (alongX) box(g, 3.6, h, 2.6, body, x, h / 2, z, { collide: true })
  else box(g, 2.6, h, 3.6, body, x, h / 2, z, { collide: true })
  cyl(g, 1, 1, 0.2, solid('#55606b', 0.5), x, h + 0.1, z, { seg: 18 })
}
function trashBin(g, x, z, h) {
  cyl(g, 1.3, 1.15, h, solid('#4f7f4f', 0.6), x, h / 2, z, { collide: true })
  cyl(g, 1.4, 1.4, 0.25, solid('#3f6a3f', 0.6), x, h + 0.12, z)
}
function neighbour(g, x, z, wall, rf) {
  boxMM(g, x - 40, 0, z - 25, x + 40, 18, z + 25, surface(`nb${wall}`, paintSiding(wall), { tile: 6 }))
  const r1 = box(g, 86, 1, 30, surface(`nbr${rf}`, paintShingles(rf), { tile: 7 }), x, 24, z - 12)
  r1.rotation.x = 0.55
  const r2 = box(g, 86, 1, 30, surface(`nbr${rf}`, paintShingles(rf), { tile: 7 }), x, 24, z + 12)
  r2.rotation.x = -0.55
  for (let i = -2; i <= 2; i++) box(g, 7, 7, 0.3, emissive('#ffe6a6', 0.25, '#7a8ea8'), x + i * 14, 9, z - 25.2)
}

// --- Grandpa's navigation graph ---------------------------------------------------------------------
// Nodes on the floor plan (x, z), edges where he can walk straight between them. Door nodes sit in
// the doorway itself so paths go straight through. The study joins only once the secret door is open.
export function buildNav() {
  const N = {
    // hallway
    h1: [-46, -3], h2: [-30, -3], h3: [-14, -3], h4: [0, -3], h5: [12, -3], h6: [24, -3], h7: [38, -3], h8: [48, -3],
    // doors
    dK: [-30, -10], dB: [-6, -10], dR: [24, -10], dG: [-36, 4], dL: [0, 4],
    // kitchen
    k1: [-30, -17], k2: [-40, -22], k3: [-40, -33], k4: [-25, -30],
    // bathroom
    b1: [-6, -17], b2: [-10, -24], b3: [0, -28],
    // bedroom
    r1: [24, -17], r2: [16, -24], r3: [40, -18], r4: [44, -28], r5: [20, -32],
    // garage
    g1: [-36, 9], g2: [-46, 12], g3: [-46, 26], g4: [-24, 12], g5: [-24, 34],
    // living
    l1: [0, 10], l2: [-8, 13], l3: [10, 14], l4: [12, 25], l5: [-4, 32], l6: [24, 20], l7: [8, 36],
    // secret door + study
    dS: [30, 20], s1: [38, 20], s2: [44, 30],
    // the back door + the back yard (only while he runs from a fire: flag 'outside')
    dX: [-38, -42], y1: [-38, -52], y2: [-38, -66],
  }
  const E = [
    ['h1', 'h2'], ['h2', 'h3'], ['h3', 'h4'], ['h4', 'h5'], ['h5', 'h6'], ['h6', 'h7'], ['h7', 'h8'],
    ['h2', 'dK'], ['dK', 'k1'], ['k1', 'k2'], ['k2', 'k3'], ['k3', 'k4'], ['k1', 'k4'],
    ['h3', 'dB'], ['h4', 'dB'], ['dB', 'b1'], ['b1', 'b2'], ['b1', 'b3'], ['b2', 'b3'],
    ['h6', 'dR'], ['dR', 'r1'], ['r1', 'r2'], ['r1', 'r3'], ['r3', 'r4'], ['r2', 'r5'], ['r4', 'r5'],
    ['h2', 'dG'], ['h1', 'dG'], ['dG', 'g1'], ['g1', 'g2'], ['g2', 'g3'], ['g1', 'g4'], ['g4', 'g5'],
    ['h4', 'dL'], ['h3', 'dL'], ['h5', 'dL'], ['dL', 'l1'], ['l1', 'l2'], ['l1', 'l3'], ['l3', 'l4'], ['l2', 'l5'], ['l4', 'l7'], ['l5', 'l7'], ['l3', 'l6'], ['l4', 'l6'],
    ['l6', 'dS', 'secret'], ['dS', 's1', 'secret'], ['s1', 's2', 'secret'],
    ['k3', 'dX', 'outside'], ['k2', 'dX', 'outside'], ['dX', 'y1', 'outside'], ['y1', 'y2', 'outside'],
  ]
  const OUT = new Set(['dX', 'y1', 'y2'])
  const nodes = Object.entries(N).map(([id, [x, z]]) => ({ id, x, z, links: [], out: OUT.has(id) }))
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]))
  for (const [a, b, flag] of E) {
    byId[a].links.push({ to: byId[b], flag })
    byId[b].links.push({ to: byId[a], flag })
  }
  const flags = { secret: false, outside: false }
  const nearest = (x, z, filter = null) => {
    let best = null
    let bd = Infinity
    for (const n of nodes) {
      if (!flags.secret && (n.id === 'dS' || n.id[0] === 's')) continue
      if (!flags.outside && n.out) continue
      if (filter && !filter(n)) continue
      const d = (n.x - x) ** 2 + (n.z - z) ** 2
      if (d < bd) {
        bd = d
        best = n
      }
    }
    return best
  }
  // A* over the graph.
  const path = (from, to) => {
    if (!from || !to) return []
    const open = new Map([[from.id, { n: from, g: 0, f: 0, prev: null }]])
    const closed = new Map()
    while (open.size) {
      let cur = null
      for (const e of open.values()) if (!cur || e.f < cur.f) cur = e
      open.delete(cur.n.id)
      closed.set(cur.n.id, cur)
      if (cur.n === to) {
        const out = []
        for (let e = cur; e; e = e.prev) out.unshift(e.n)
        return out
      }
      for (const { to: nb, flag } of cur.n.links) {
        if (flag && !flags[flag]) continue
        if (closed.has(nb.id)) continue
        const g = cur.g + Math.hypot(nb.x - cur.n.x, nb.z - cur.n.z)
        const ex = open.get(nb.id)
        if (!ex || g < ex.g) open.set(nb.id, { n: nb, g, f: g + Math.hypot(to.x - nb.x, to.z - nb.z), prev: cur })
      }
    }
    return []
  }
  return { nodes, byId, nearest, path, flags }
}

export { materials as houseMaterials }
export const VAN_SPOT = VAN
export { DoubleSide }
