// Loot: every item is a dynamic Rapier body (convex hull of its model) spawned on the furniture of its
// room for each heist (the heist seed shuffles which spot each item gets). The authority (solo play, or
// the crew's host) simulates them; everyone else follows the host's snapshots with kinematic bodies,
// except the item they hold themselves.
//
// Per physics tick: impacts from the change in velocity (sound + noise Grandpa can hear, fragile items
// shatter, a hit near the TV breaks it, a hit on Grandpa makes him drop a held thief), and items that
// leave the house footprint are STOLEN: the body goes away and the model flies into the van's trailer.
import { Box3, Group, Matrix4, Vector3 } from 'three'
import { HOUSE, IMPACT, LOOT, VAN } from '../config.js'
import { RAPIER, addDynamicShape, onTick, removeDynamic, setOwner } from '../physics.js'
import { makeLoot } from './models/loot.js'
import { rng } from './kit.js'

// Which room each item belongs to (where it spawns, and the room tracker's counts).
export const ROOM_OF = {}
for (const [room, ids] of Object.entries({
  hallway: ['umbrella', 'boot', 'fedora', 'keys', 'vase', 'wallet', 'pocketwatch', 'snowglobe'],
  living: ['remote', 'lamp', 'cushion', 'book', 'record', 'trophy', 'teacup', 'cookietin', 'piggybank', 'yarn', 'camera', 'radio'],
  kitchen: ['toaster', 'pan', 'teapot', 'cheese', 'cake', 'mug', 'milk', 'blender', 'rollingpin', 'plate'],
  bathroom: ['duck', 'toothbrush', 'perfume', 'shampoo', 'tp', 'hairdryer', 'soap', 'dentures'],
  bedroom: ['alarmclock', 'jewelbox', 'pillow', 'slipper', 'teddy', 'watch', 'photo', 'cash', 'necklace', 'diary'],
  garage: ['toolbox', 'hammer', 'wrench', 'drill', 'paintcan', 'flashlight', 'gascan', 'hubcap'],
  study: ['goldbar', 'crown', 'globe', 'painting', 'diamond', 'coinjar'],
})) for (const id of ids) ROOM_OF[id] = room
// Items that always take a tagged spot.
// Settle assist (per tick, loose loot moving slower than speed m/s and spin rad/s): damping factors.
const SETTLE = { speed: 1.2, spin: 5, damp: 0.86, dampLin: 0.94 }
const UNDER_MAX_H = 1.15 // m: tallest loot that may spawn in a crawlspace (under the bed / sofa)
const TAGGED = { crown: 'safe', cheese: 'fridge', milk: 'fridge', cake: 'fridge', duck: 'tubrim', dentures: 'sink', teapot: 'stove', cash: 'underbed', umbrella: 'stand', goldbar: 'pedestal', diamond: 'pedestal', coinjar: 'pedestal' }

const hullCache = new Map() // id -> { points: Float32Array, half: Vector3 }
function hullFor(id, group) {
  if (hullCache.has(id)) return hullCache.get(id)
  group.updateMatrixWorld(true)
  const inv = new Matrix4().copy(group.matrixWorld).invert()
  const rel = new Matrix4()
  const pts = []
  const v = new Vector3()
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position || o.userData.lodLow) return
    if (o.material?.transparent && o.material.opacity < 0.2) return
    rel.multiplyMatrices(inv, o.matrixWorld)
    const pos = o.geometry.attributes.position
    const step = Math.max(1, Math.floor(pos.count / 160))
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(rel)
      pts.push(v.x, v.y, v.z)
    }
  })
  const box = new Box3().setFromObject(group)
  const half = new Vector3()
  box.getSize(half).multiplyScalar(0.5)
  const out = { points: new Float32Array(pts), half, center: box.getCenter(new Vector3()).sub(group.position) }
  hullCache.set(id, out)
  return out
}

export function createProps(scene, house, hooks) {
  const root = new Group()
  scene.add(root)
  const pile = new Group() // stolen loot, shrunk, in the van's trailer
  scene.add(pile)
  const props = []
  const flying = [] // { mesh, t, from, to, ... }
  let authority = true
  let spawnSeed = 0

  // The van trailer's bed (local pile grid).
  const trailer = { x: VAN.x, z: VAN.z - 17, w: 8, l: 10, y: 3 }
  let pileCount = 0

  function clear() {
    for (const p of props) {
      if (p.body) removeDynamic(p.body, p.mesh)
      root.remove(p.mesh)
    }
    props.length = 0
    for (const f of flying) scene.remove(f.mesh)
    flying.length = 0
    pile.clear()
    pileCount = 0
  }

  function spawn(seed) {
    clear()
    spawnSeed = seed
    const rand = rng(seed ^ 0x5eed)
    const spots = house.lootSpots.map((s, i) => ({ ...s, i, used: false }))
    let netId = 0
    for (const def of LOOT) {
      const room = ROOM_OF[def.id]
      const tag = TAGGED[def.id]
      const mesh = makeLoot(def.id)
      const hull = hullFor(def.id, mesh)
      // the crawlspaces under the bed / sofa are 1.3-1.4 high: taller loot spawned inside the furniture
      const fitsUnder = hull.half.y * 2 < UNDER_MAX_H || tag === 'underbed'
      const ok = (s) => !s.tag || s.tag === 'stand' || ((s.tag === 'underbed' || s.tag === 'undersofa') && fitsUnder)
      let pool = spots.filter((s) => !s.used && s.room === room && (tag ? s.tag === tag : ok(s)))
      if (tag && !pool.length) pool = spots.filter((s) => !s.used && s.room === room && !s.tag)
      if (!pool.length) pool = spots.filter((s) => s.room === room && !s.tag)
      const s = pool[Math.floor(rand() * pool.length)] ?? { x: 0, y: 0, z: 0 }
      s.used = true
      mesh.position.set(s.x + (rand() - 0.5) * 0.4, s.y + hull.half.y + 0.06 - hull.center.y, s.z + (rand() - 0.5) * 0.4)
      // long things keep their length along X (they would poke into walls otherwise)
      mesh.rotation.y = Math.max(hull.half.x, hull.half.z) > 1.3 ? (rand() < 0.5 ? 0 : Math.PI) : rand() * Math.PI * 2
      root.add(mesh)
      const shape = RAPIER.ColliderDesc.convexHull(hull.points) ?? RAPIER.ColliderDesc.cuboid(hull.half.x, hull.half.y, hull.half.z)
      const { body, collider } = addDynamicShape(mesh, shape, { mass: def.mass, friction: 0.75, restitution: def.mat === 'rubber' ? 0.55 : 0.12, linearDamping: 0.12, angularDamping: 0.35 })
      const prop = {
        kind: 'loot', netId: netId++, id: def.id, def, name: def.name, value: def.value, mat: def.mat, room,
        mesh, body, collider, grabbable: true, state: 'home', heldBy: null, half: hull.half,
        lastV: new Vector3(), hitCool: 0, spawn: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z }, settle: 1.2,
      }
      setOwner(collider, prop)
      props.push(prop)
    }
    setAuthority(authority)
  }

  // Authority (solo / host) simulates loot; a crew member follows snapshots (kinematic bodies).
  function setAuthority(on) {
    authority = on
    for (const p of props) if (p.body && p.heldBy !== 'me') setLocalMode(p, on ? 'dynamic' : 'kinematic')
  }
  function setLocalMode(p, mode) {
    if (!p.body) return
    const type = mode === 'dynamic' ? RAPIER.RigidBodyType.Dynamic : RAPIER.RigidBodyType.KinematicPositionBased
    if (p.body.bodyType() !== type) p.body.setBodyType(type, true)
    p.mode = mode
  }

  // --- Per physics tick: impacts + theft ------------------------------------------------------------
  const tmp = new Vector3()
  onTick((dt) => {
    if (!props.length) return
    for (const p of props) {
      if (p.state !== 'home' || !p.body) continue
      if (p.settle > 0) p.settle -= dt
      const t = p.body.translation()
      // Stolen: outside the footprint (only the authority decides).
      if (authority && !house.insideFootprint(t.x, t.z, HOUSE.collectMargin)) {
        steal(p)
        continue
      }
      if (t.y < -15 && authority) {
        p.body.setTranslation(p.spawn, true)
        p.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
        continue
      }
      if (p.mode !== 'dynamic' || p.body.isSleeping()) {
        p.lastV.set(0, 0, 0)
        continue
      }
      const v = p.body.linvel()
      tmp.set(v.x, v.y, v.z)
      // safety net: a solver blow-up never flings loot across the map
      const sp = tmp.length()
      if (!Number.isFinite(sp) || sp > 70) {
        if (!Number.isFinite(sp)) {
          p.body.setTranslation(p.spawn, true)
          tmp.set(0, 0, 0)
        } else tmp.multiplyScalar(70 / sp)
        p.body.setLinvel({ x: tmp.x, y: tmp.y, z: tmp.z }, true)
        p.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      }
      // settle assist: round-bottomed loot (vases, jars, plates) otherwise rocks on its hull forever and
      // never sleeps; slow wobbles get extra damping (throws / falls / hits are far faster: untouched)
      if (!p.heldBy && sp < SETTLE.speed) {
        const w = p.body.angvel()
        if (Math.hypot(w.x, w.y, w.z) < SETTLE.spin) {
          // wakeUp false: this must never keep a body awake (it only runs on awake ones anyway)
          p.body.setAngvel({ x: w.x * SETTLE.damp, y: w.y * SETTLE.damp, z: w.z * SETTLE.damp }, false)
          p.body.setLinvel({ x: tmp.x * SETTLE.dampLin, y: tmp.y, z: tmp.z * SETTLE.dampLin }, false)
        }
      }
      const dv = tmp.distanceTo(p.lastV)
      p.lastV.copy(tmp)
      p.hitCool -= dt
      if (p.settle > 0 || p.heldBy) continue
      if (dv > IMPACT.minDeltaV && p.hitCool <= 0) {
        p.hitCool = 0.09
        const strength = Math.min(1, (dv - IMPACT.minDeltaV) / (IMPACT.fullDeltaV - IMPACT.minDeltaV))
        const pos = new Vector3(t.x, t.y, t.z)
        hooks.impact?.(p, pos, strength, dv)
        if (p.def.fragile && dv > IMPACT.breakDeltaV && authority) {
          shatter(p)
          continue
        }
      }
    }
  })

  function steal(p, by = null) {
    if (p.state !== 'home') return
    p.state = 'stolen'
    const from = p.mesh.position.clone()
    removeDynamic(p.body, p.mesh)
    p.body = null
    // fly to the trailer: an arc, shrinking, spinning
    const slot = pileCount++
    const col = slot % 4
    const row = Math.floor(slot / 4) % 4
    const layer = Math.floor(slot / 16)
    const to = new Vector3(trailer.x - trailer.w / 2 + 1 + col * ((trailer.w - 2) / 3), trailer.y + 0.8 + layer * 1.1, trailer.z - trailer.l / 2 + 1.2 + row * ((trailer.l - 2.4) / 3))
    flying.push({ p, mesh: p.mesh, t: 0, dur: 1.1, from, to, s0: p.mesh.scale.x, s1: Math.min(1, 1.5 / Math.max(p.half.x, p.half.y, p.half.z) / 2) })
    hooks.stolen?.(p, from, by)
  }
  function shatter(p) {
    if (p.state !== 'home') return
    p.state = 'broken'
    const pos = p.mesh.position.clone()
    removeDynamic(p.body, p.mesh)
    p.body = null
    root.remove(p.mesh)
    hooks.broken?.(p, pos)
  }
  // Burned to ash (fire.js): gone, its value lost.
  function burn(p) {
    if (p.state !== 'home') return
    p.state = 'burnt'
    p.fire = null
    const pos = p.mesh.position.clone()
    removeDynamic(p.body, p.mesh)
    p.body = null
    root.remove(p.mesh)
    hooks.burnt?.(p, pos)
  }

  return {
    burn,
    root,
    props,
    spawn,
    clear,
    setAuthority,
    setLocalMode,
    steal,
    shatter,
    get authority() {
      return authority
    },
    get seed() {
      return spawnSeed
    },
    byNet: (id) => props[id] ?? null,
    // Per frame: the stolen-loot flights into the trailer.
    update(dt) {
      for (let i = flying.length - 1; i >= 0; i--) {
        const f = flying[i]
        f.t += dt / f.dur
        const k = Math.min(1, f.t)
        const e = 1 - Math.pow(1 - k, 2)
        f.mesh.position.lerpVectors(f.from, f.to, e)
        f.mesh.position.y += Math.sin(k * Math.PI) * (8 + f.from.distanceTo(f.to) * 0.12)
        const s = f.s0 + (f.s1 - f.s0) * e
        f.mesh.scale.setScalar(s)
        f.mesh.rotation.y += dt * 9 * (1 - k)
        if (k >= 1) {
          root.remove(f.mesh)
          pile.add(f.mesh)
          flying.splice(i, 1)
          hooks.landed?.(f.p, f.to)
        }
      }
    },
    // What the room tracker shows: per room { total, stolen } and the % of the house's loot value.
    roomStats() {
      const out = {}
      let total = 0
      let gone = 0
      for (const p of props) {
        const r = (out[p.room] ??= { total: 0, stolen: 0 })
        r.total++
        total += p.value
        if (p.state === 'stolen') {
          r.stolen++
          gone += p.value
        }
      }
      return { rooms: out, percent: total ? gone / total : 0 }
    },
    // --- Network snapshots (host) ---
    snapshot(all = false) {
      const out = []
      for (const p of props) {
        if (p.state !== 'home' || !p.body) continue
        if (!all && p.body.isSleeping() && !p.dirty) continue
        p.dirty = false
        const t = p.body.translation()
        const r = p.body.rotation()
        const R = (n) => Math.round(n * 100) / 100
        out.push([p.netId, R(t.x), R(t.y), R(t.z), R(r.x), R(r.y), R(r.z), R(r.w)])
      }
      return out
    },
    // A crew member applies the host's snapshot (kinematic targets), skipping what it holds itself.
    applySnapshot(list) {
      for (const [id, x, y, z, qx, qy, qz, qw] of list) {
        const p = props[id]
        if (!p || !p.body || p.heldBy === 'me') continue
        if (p.mode !== 'kinematic') setLocalMode(p, 'kinematic')
        p.body.setNextKinematicTranslation({ x, y, z })
        p.body.setNextKinematicRotation({ x: qx, y: qy, z: qz, w: qw })
      }
    },
  }
}
