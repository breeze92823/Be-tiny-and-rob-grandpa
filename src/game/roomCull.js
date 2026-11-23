// Hiding rooms behind walls (portal culling). The house is one storey with full-height walls, so seen
// from above every line of sight from one room into another has to pass through an opening: a
// doorway, the arch, the secret door, a window, the pet flap or the mail slot. From the camera's room
// we walk through the openings, narrowing the horizontal view wedge to each opening as seen from the
// camera; rooms the walk never reaches are hidden. "outside" (yard, street, van) is a region too, joined
// to the rooms by the windows and outer doors.
//
// Conservative on purpose: openings count as open even when their door is shut, an opening's span is
// measured on the wall's centre line (the thick jambs only block more) and lintels are ignored. The
// camera above the roof / below the floor, or nowhere near the house, turns culling off.
//
// What gets hidden: per-room baked scenery and furniture (static units), and loot + Grandpa by where
// they are each frame (dynamic units, with a radius so something in a doorway shows from both sides).
// Hidden room contents leave the shadow pass too (their shadows only fall inside their own room);
// hidden outdoor things keep casting (a tree's shadow through a window), they are only not drawn.
import { Vector3 } from 'three'
import { HOUSE, ROOMS } from '../config.js'
import { ARCH, BACK_DOOR, DOORWAYS, FIXED_WINDOWS, FRONT_DOOR, GARAGE_DOOR, SECRET, WINDOWS, roomAt } from './house.js'

const T = HOUSE.wallThick
const HT = T / 2
const PAD = 0.3 // m added to each side of an opening
const MAX_DEPTH = 8
const WEDGE_MARGIN = (12 * Math.PI) / 180 // extra beyond the camera's horizontal half FOV

// Layer masks: 1 = drawn (layer 0); 2 = shadow only (layer 1, which the sun's shadow camera also sees);
// 0 = neither.
const SHOWN = 1
const SHADOW_ONLY = 2
const HIDDEN = 0

// --- Openings ------------------------------------------------------------------------------------------
// { a: room | 'outside', b: room | 'outside', p1: [x, z], p2: [x, z] } on a wall line.
function buildPortals() {
  const out = []
  const along = (axis, line, s0, s1, a, b) => {
    const lo = s0 - PAD
    const hi = s1 + PAD
    const p1 = axis === 'x' ? [lo, line] : [line, lo]
    const p2 = axis === 'x' ? [hi, line] : [line, hi]
    if (a && b && a !== b) out.push({ a, b, p1, p2, axis, line, s0: lo, s1: hi })
  }
  // interior
  for (const d of DOORWAYS) along('x', d.line, d.at - d.w / 2, d.at + d.w / 2, roomAt(d.at, d.line - 2), roomAt(d.at, d.line + 2))
  along('x', 4, ARCH.a, ARCH.b, roomAt((ARCH.a + ARCH.b) / 2, 2), roomAt((ARCH.a + ARCH.b) / 2, 6))
  along('z', SECRET.x, SECRET.a, SECRET.b, roomAt(SECRET.x - 2, (SECRET.a + SECRET.b) / 2), roomAt(SECRET.x + 2, (SECRET.a + SECRET.b) / 2))
  // exterior (walls' centre lines)
  const line = { front: HOUSE.maxZ - HT, back: HOUSE.minZ + HT, west: HOUSE.minX + HT, east: HOUSE.maxX - HT }
  const outer = (wall, s0, s1) => {
    const mid = (s0 + s1) / 2
    if (wall === 'front') along('x', line.front, s0, s1, roomAt(mid, HOUSE.maxZ - 3), 'outside')
    else if (wall === 'back') along('x', line.back, s0, s1, roomAt(mid, HOUSE.minZ + 3), 'outside')
    else if (wall === 'west') along('z', line.west, s0, s1, roomAt(HOUSE.minX + 3, mid), 'outside')
    else along('z', line.east, s0, s1, roomAt(HOUSE.maxX - 3, mid), 'outside')
  }
  for (const w of Object.values(WINDOWS)) outer(w.wall, w.a, w.b)
  for (const w of FIXED_WINDOWS) outer(w.wall, w.a, w.b)
  outer('front', GARAGE_DOOR.a, GARAGE_DOOR.b)
  outer('back', BACK_DOOR.a, BACK_DOOR.b) // the back door (opens; its pet flap when shut)
  outer('east', FRONT_DOOR.a, FRONT_DOOR.b) // the front door (opens; its mail slot when shut)
  return out
}

// --- Wedges (absolute angle c, half width h; null = unrestricted) ----------------------------------------
const TAU = Math.PI * 2
const wrap = (a) => {
  a %= TAU
  if (a > Math.PI) a -= TAU
  else if (a <= -Math.PI) a += TAU
  return a
}
function intersect(w, c2, h2) {
  if (!w) return { c: c2, h: h2 }
  const d = wrap(c2 - w.c)
  for (const off of [0, TAU, -TAU]) {
    const lo = Math.max(-w.h, d + off - h2)
    const hi = Math.min(w.h, d + off + h2)
    if (hi > lo + 1e-4) return { c: w.c + (lo + hi) / 2, h: (hi - lo) / 2 }
  }
  return null
}

// Classifies a world-space box: a room id, 'outside', or null (spans several: never hidden).
// A room owns a piece whose centre is inside the room's interior (+ one wall skin) and whose box stays
// inside the room's full rectangle, so each wall skin goes to the room it faces, while frames, door
// leaves and the outer siding (seen from outside) stay shared.
const interiors = ROOMS.map((r) => ({
  id: r.id,
  x0: r.x0 + (r.x0 === HOUSE.minX ? T : HT) - 0.65,
  x1: r.x1 - (r.x1 === HOUSE.maxX ? T : HT) + 0.65,
  z0: r.z0 + (r.z0 === HOUSE.minZ ? T : HT) - 0.65,
  z1: r.z1 - (r.z1 === HOUSE.maxZ ? T : HT) + 0.65,
  r,
}))
export function classifyBox(box) {
  if (box.isEmpty()) return null
  const E = 0.05
  if (box.max.x < HOUSE.minX - E || box.min.x > HOUSE.maxX + E || box.max.z < HOUSE.minZ - E || box.min.z > HOUSE.maxZ + E) return 'outside'
  if (box.max.y > HOUSE.wallHeight + 0.05) return null // reaches the ceiling / roof
  const cx = (box.min.x + box.max.x) / 2
  const cz = (box.min.z + box.max.z) / 2
  for (const i of interiors) {
    const r = i.r
    if (cx < i.x0 || cx > i.x1 || cz < i.z0 || cz > i.z1) continue
    if (box.min.x >= r.x0 - E && box.max.x <= r.x1 + E && box.min.z >= r.z0 - E && box.max.z <= r.z1 + E) return i.id
  }
  return null
}

export function createRoomCull(sunShadowCamera) {
  sunShadowCamera?.layers.enable(1) // shadow-only things (hidden outdoor scenery) still cast
  const portals = buildPortals()
  const byRegion = new Map() // region -> portals touching it
  for (const p of portals) {
    for (const r of [p.a, p.b]) {
      if (!byRegion.has(r)) byRegion.set(r, [])
      byRegion.get(r).push(p)
    }
  }
  const units = new Map() // region -> [{ meshes, mask }]
  const meshesOf = (root) => {
    const list = []
    root.traverse((o) => {
      if (o.isMesh || o.isLine || o.isPoints || o.isSprite || o.isLOD) list.push(o)
    })
    return list
  }
  function addStatic(region, root) {
    if (!region) return
    if (!units.has(region)) units.set(region, [])
    units.get(region).push({ meshes: meshesOf(root), mask: SHOWN })
  }
  const setMask = (u, mask) => {
    if (u.mask === mask) return
    u.mask = mask
    for (const o of u.meshes) o.layers.mask = mask
  }

  const visible = new Set()
  let culling = false
  const cam = { x: 0, z: 0 }
  const angleTo = (x, z) => Math.atan2(z - cam.z, x - cam.x)

  function walk(region, wedge, from, depth) {
    for (const p of byRegion.get(region) ?? []) {
      if (p === from) continue
      const other = p.a === region ? p.b : p.a
      // standing in the opening itself: the room beyond is in view with the whole wedge
      const across = p.axis === 'x' ? cam.z - p.line : cam.x - p.line
      const alongPos = p.axis === 'x' ? cam.x : cam.z
      let next
      if (Math.abs(across) < T && alongPos > p.s0 - 0.5 && alongPos < p.s1 + 0.5) next = wedge ?? { c: 0, h: Math.PI }
      else {
        const a1 = angleTo(p.p1[0], p.p1[1])
        const a2 = angleTo(p.p2[0], p.p2[1])
        const half = wrap(a2 - a1) / 2
        next = intersect(wedge, a1 + half, Math.abs(half))
      }
      if (!next) continue
      visible.add(other)
      if (depth < MAX_DEPTH) walk(other, next, p, depth + 1)
    }
  }

  // Dynamic things: inside a visible room's rectangle (grown by r), or outside while outside shows.
  function regionVisible(x, z, r) {
    if (!culling) return true
    if (visible.has('outside') && (x < HOUSE.minX + r || x > HOUSE.maxX - r || z < HOUSE.minZ + r || z > HOUSE.maxZ - r)) return true
    for (const room of ROOMS) {
      if (!visible.has(room.id)) continue
      if (x >= room.x0 - r && x <= room.x1 + r && z >= room.z0 - r && z <= room.z1 + r) return true
    }
    return false
  }
  const dynMask = new WeakMap() // object -> { meshes, mask }
  function setDynamic(obj, show, outdoors) {
    let u = dynMask.get(obj)
    if (!u) dynMask.set(obj, (u = { meshes: meshesOf(obj), mask: SHOWN }))
    setMask(u, show ? SHOWN : outdoors ? SHADOW_ONLY : HIDDEN)
  }

  return {
    portals,
    addStatic,
    get visible() {
      return culling ? visible : null
    },
    // Per frame, before rendering. enabled = false (the lobby, x-ray on, ...) shows everything.
    update(camera, enabled = true) {
      visible.clear()
      culling = false
      if (enabled) {
        const p = camera.getWorldPosition(_v)
        cam.x = p.x
        cam.z = p.z
        const inFootprint = p.x > HOUSE.minX && p.x < HOUSE.maxX && p.z > HOUSE.minZ && p.z < HOUSE.maxZ
        const start = inFootprint ? (p.y > 0 && p.y < HOUSE.wallHeight ? roomAt(p.x, p.z) : null) : 'outside'
        if (start) {
          culling = true
          visible.add(start)
          // the camera's horizontal view wedge (unrestricted when it looks steeply up or down)
          camera.getWorldDirection(_d)
          const flat = Math.hypot(_d.x, _d.z)
          const halfH = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect) + WEDGE_MARGIN
          const wedge = flat > 0.85 && halfH < Math.PI / 2 - 0.05 ? { c: Math.atan2(_d.z, _d.x), h: halfH } : null
          walk(start, wedge, null, 0)
        }
      }
      for (const [region, list] of units) {
        const show = !culling || visible.has(region)
        const mask = show ? SHOWN : region === 'outside' ? SHADOW_ONLY : HIDDEN
        for (const u of list) setMask(u, mask)
      }
    },
    // obj: a root to show / hide by its position; r: how far it reaches (m).
    dynamic(obj, x, z, r) {
      const outdoors = x < HOUSE.minX || x > HOUSE.maxX || z < HOUSE.minZ || z > HOUSE.maxZ
      setDynamic(obj, regionVisible(x, z, r), outdoors)
    },
  }
}
const _v = new Vector3()
const _d = new Vector3()
