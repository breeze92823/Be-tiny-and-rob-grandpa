// The furniture of Grandpa's house, room by room (level design, x6 scale), with its colliders, plus
// everything the heist hangs on it: loot spots, hiding spots (low furniture you crawl under), the
// switches (thermostat, toilet handle, the red book, the toaster lever, the fan cord), the toaster
// launcher, the ceiling fan you can ride, the breakable TV, the fireplace, the bird cage
// caught thieves are locked in, the safe, the fridge, the secret bookshelf door, ceiling lamps and
// Grandpa's activity spots. Static meshes go into `g` (baked); moving / animated ones into `live`.
import { AdditiveBlending, CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, PointLight, Quaternion, Euler, SRGBColorSpace, Vector3 } from 'three'
import { HOUSE } from '../config.js'
import { MOVER_GROUPS, RAPIER, world, addDynamicShape, hinge, onTick, setOwner } from '../physics.js'
import { clampSpin } from './house.js'
import { box, boxMM, canvasSign, cyl, emissive, glass, metal, solid, solidMM, sphere, surface, unlit, roundRect } from './kit.js'
import { paintFabric, paintRug, paintWoodGrain, paintTiles } from './paint.js'
import { mulberry32 } from '../textures.js'
import { compact } from '../bake.js'

const H = HOUSE.wallHeight
const qYaw = (yaw) => new Quaternion().setFromEuler(new Euler(0, yaw, 0))

const mats = () => ({
  wood: surface('fw-wood', paintWoodGrain('#c08a5a'), { tile: 4, rough: 0.6, bump: 0 }),
  woodMid: surface('fw-mid', paintWoodGrain('#8b5a35'), { tile: 4, rough: 0.6, bump: 0 }),
  woodDark: surface('fw-dark', paintWoodGrain('#5b3a22'), { tile: 4, rough: 0.55, bump: 0 }),
  sofa: surface('fab-sofa', paintFabric('weave', '#5f7fa8', '#d9b26b'), { tile: 3, rough: 0.95, bump: 0.4 }),
  armchair: surface('fab-arm', paintFabric('velvet', '#a0473f'), { tile: 3, rough: 0.9, bump: 0.3 }),
  bedspread: surface('fab-bed', paintFabric('plaid', '#6a4c8c', '#e0c068'), { tile: 6, rough: 0.95, bump: 0.3 }),
  sheet: solid('#f7f3ea', 0.9),
  counter: solid('#ece6da', 0.35),
  cabinet: solid('#9ec6b8', 0.55),
  cabinetDark: solid('#7fae9f', 0.55),
  porcelain: solid('#fbfbf8', 0.12),
  chrome: metal('#d6dbe0', 0.18),
  brass: metal('#d8b15a', 0.28),
  black: solid('#25262b', 0.6),
  stove: solid('#3a3c44', 0.4, 0.3),
  fridge: solid('#f2efe8', 0.25),
  car: solid('#d9a43a', 0.3, 0.35),
  tire: solid('#1f2024', 0.85),
  brick: solid('#9b4f3a', 0.9),
  stone: solid('#b0aaa0', 0.85),
  white: solid('#ffffff', 0.5),
  plantPot: solid('#c4673f', 0.8),
  leaf: solid('#4f9a3a', 0.85),
  cage: metal('#c9a447', 0.3),
  safe: solid('#4a5560', 0.35, 0.6),
  glass: glass('#d7eeff', 0.25),
  shade: solid('#f4e4c1', 0.8, 0, { emissive: '#ffcf86', emissiveIntensity: 0.25 }),
})

// --- Climb steps ---------------------------------------------------------------------------------------
// A jump lifts the feet ~1.9 m, so every table, counter, desk, bed and cabinet top a thief should stand
// on is reached in rises of at most ~1.8 m: stacks of books, cardboard boxes, stools, poufs and sponges
// set beside it. One fixed collider per step (its whole footprint, floor to top); the visuals stay inside it.
const BOOK_COLOURS = ['#c0392b', '#2f6fa8', '#e0a63a', '#3f8f5a', '#7a4f9a', '#d8673f', '#2f4a6a', '#9c2f4f']
function climbStep(g, x0, z0, x1, z1, top, style = 'books', seed = 1) {
  const w = x1 - x0
  const d = z1 - z0
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  if (style === 'pouf' || style === 'footstool') {
    // round: a velvet pouf, or a wooden footstool with a cushion
    const r = Math.min(w, d) / 2
    world.createCollider(RAPIER.ColliderDesc.cylinder(top / 2, r).setTranslation(cx, top / 2, cz).setFriction(0.8))
    if (style === 'pouf') {
      cyl(g, r * 0.97, r * 0.92, top - 0.25, solid('#b5654a', 0.95), cx, (top - 0.25) / 2, cz, { seg: 20 })
      cyl(g, r * 0.9, r, 0.25, solid('#d07a5c', 0.95), cx, top - 0.125, cz, { seg: 20 })
    } else {
      cyl(g, r * 0.8, r * 0.7, top - 0.45, mats().woodDark, cx, (top - 0.45) / 2, cz, { seg: 16 })
      cyl(g, r, r, 0.45, mats().armchair, cx, top - 0.225, cz, { seg: 20 })
    }
    return
  }
  solidMM(x0, 0, z0, x1, top, z1)
  if (style === 'books') {
    // big hardbacks, each a little smaller or offset from the one under it (never past the collider)
    const n = Math.max(2, Math.round(top / 0.45))
    const h = top / n
    const cream = solid('#f1ead8', 0.9)
    for (let i = 0; i < n; i++) {
      const k = (seed * 3 + i * 5) % BOOK_COLOURS.length
      const bw = w * (0.9 - ((i + seed) % 3) * 0.035)
      const bd = d * (0.86 - ((i * 2 + seed) % 3) * 0.04)
      const ox = ((i % 2 ? 1 : -1) * (w - bw)) / 3
      const oz = ((i % 3) - 1) * ((d - bd) / 3)
      const y = i * h + h / 2
      box(g, bw, h - 0.03, bd, solid(BOOK_COLOURS[k], 0.7), cx + ox, y, cz + oz)
      box(g, bw - 0.14, h - 0.13, bd + 0.06, cream, cx + ox, y, cz + oz) // the pages, showing at both ends
    }
  } else if (style === 'crate') {
    // a cardboard box with a tape strip over the top
    box(g, w, top, d, solid('#c79b62', 0.9), cx, top / 2, cz)
    box(g, w * 0.22, 0.03, d + 0.03, solid('#e8d6a8', 0.6), cx, top + 0.015, cz)
  } else if (style === 'stool') {
    // a wooden step stool (the collider is the whole block: you stand on it, not under it)
    box(g, w, 0.35, d, mats().wood, cx, top - 0.175, cz, { round: 0.08 })
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(g, 0.32, top - 0.35, 0.32, mats().woodMid, cx + sx * (w / 2 - 0.3), (top - 0.35) / 2, cz + sz * (d / 2 - 0.3))
    for (const sz of [-1, 1]) box(g, w - 0.7, 0.22, 0.2, mats().woodMid, cx, top * 0.4, cz + sz * (d / 2 - 0.3))
  } else if (style === 'sponge') {
    // a bath sponge, the green scrubby side up
    // (2 cm off the tub floor: its underside shared the water's bottom plane)
    box(g, w, top - 0.82 - 0.3, d, solid('#f5d04a', 0.95), cx, 0.82 + (top - 1.12) / 2, cz, { round: 0.12 })
    box(g, w - 0.06, 0.3, d - 0.06, solid('#4fae5a', 0.95), cx, top - 0.15, cz, { round: 0.08 })
  }
}

// --- Generic hinged panel (fridge door, safe door, cage door) -----------------------------------------
// The panel's local +X runs along the closed panel from the hinge; yaw0 orients that in the world.
function hingedPanel(live, { id, kind, name, hinge: hp, w, h, th, yaw0, limits, mass, mat, matName = 'metal', start = 0, decorate }) {
  const mesh = new Group()
  box(mesh, w, h, th, mat, 0, 0, 0)
  decorate?.(mesh)
  live.add(mesh)
  const place = (a) => {
    const q = qYaw(yaw0 + a)
    const off = new Vector3(w / 2, 0, 0).applyQuaternion(q)
    mesh.position.set(hp.x + off.x, hp.y, hp.z + off.z)
    mesh.quaternion.copy(q)
  }
  place(start)
  const { body, collider } = addDynamicShape(mesh, RAPIER.ColliderDesc.cuboid(w / 2, h / 2, th / 2), { mass, friction: 0.4, angularDamping: 2.5, linearDamping: 0.6 })
  body.setGravityScale(0, true)
  body.setEnabledTranslations(true, false, true, true)
  body.setEnabledRotations(false, true, false, true) // it only turns about its (vertical) hinge pin
  collider.setCollisionGroups(MOVER_GROUPS)
  const frame = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(hp.x, hp.y, hp.z).setRotation(qYaw(yaw0)))
  const joint = hinge(frame, body, { x: 0, y: 0, z: 0 }, { x: -w / 2, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, limits)
  const mover = {
    kind, id, name, body, collider, mesh, joint, grabbable: true, mat: matName, angle: start, limits,
    amount: () => Math.abs(mover.angle) / Math.max(Math.abs(limits[0]), Math.abs(limits[1])),
    setLimits(a, b) {
      joint.setLimits(a, b)
      mover.limits = [a, b]
      body.wakeUp()
    },
    close(instant = false) {
      if (instant) {
        place(0)
        body.setTranslation(mesh.position, true)
        body.setRotation(mesh.quaternion, true)
      }
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    },
    reset() {
      place(start)
      body.setTranslation(mesh.position, true)
      body.setRotation(mesh.quaternion, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    },
    update(dt, ctx) {
      clampSpin(body, 5)
      const r = body.rotation()
      mover.angle = 2 * Math.atan2(r.y, r.w) - yaw0
      mover.angle = Math.atan2(Math.sin(mover.angle), Math.cos(mover.angle))
      ctx.creak(mover, Math.abs(body.angvel().y), 'doorCreak', mesh.position)
    },
  }
  setOwner(collider, mover)
  return mover
}

// A switch: a static thing you "grab" to use (thermostat dial, toilet handle, the red book).
function makeSwitch(live, { id, name, x, y, z, hx, hy, hz, mesh, onUse }) {
  live.add(mesh)
  const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z))
  const sw = { kind: 'switch', id, name, mesh, collider, grabbable: true, used: 0, onUse, pos: new Vector3(x, y, z) }
  setOwner(collider, sw)
  return sw
}

export function buildFurniture(g, live, hm, movers) {
  const m = mats()
  const lootSpots = [] // { room, x, y, z, tag? }
  const hideSpots = [] // { x0, x1, z0, z1, y1 }
  const lamps = [] // ceiling lamp positions for the light pool
  const switches = []
  const animated = [] // fn(dt, t)
  const spot = (room, x, y, z, tag) => lootSpots.push({ room, x, y, z, tag })

  // ===================================== KITCHEN (x -54..-18, z -42..-10) =====================================
  // Fridge (hollow, shelves, hinged door) in the back-west corner.
  {
    const x0 = -52.8
    const x1 = -46
    const z0 = -40.8
    const z1 = -34
    const top = 13
    // pieces fit between each other (no two share an outer face: that Z-fought along every edge)
    boxMM(g, x0, 0, z0 + 0.6, x0 + 0.6, top - 0.6, z1 - 0.6, m.fridge, { collide: true }) // back
    boxMM(g, x0, 0, z0, x1, top, z0 + 0.6, m.fridge, { collide: true }) // side
    boxMM(g, x0, 0, z1 - 0.6, x1, top, z1, m.fridge, { collide: true }) // side
    boxMM(g, x0, top - 0.6, z0 + 0.6, x1, top, z1 - 0.6, m.fridge, { collide: true }) // top
    boxMM(g, x0 + 0.6, 0, z0 + 0.6, x1, 0.8, z1 - 0.6, m.fridge, { collide: true }) // bottom
    boxMM(g, x0 + 0.6, 0.8, z0 + 0.6, x0 + 0.7, top - 0.6, z1 - 0.6, emissive('#e8f6ff', 0.6, '#ffffff'))
    for (const y of [4.4, 8.4]) boxMM(g, x0 + 0.6, y - 0.15, z0 + 0.6, x1 - 0.3, y, z1 - 0.6, m.glass, { collide: true })
    spot('kitchen', -49, 0.8, -37.4, 'fridge')
    spot('kitchen', -49, 4.4, -37.4, 'fridge')
    spot('kitchen', -49, 8.4, -37.4, 'fridge')
    const door = hingedPanel(live, {
      id: 'fridge', kind: 'fridge', name: 'Fridge Door', hinge: { x: x1 + 0.35, y: top / 2, z: z0 + 0.1 }, w: z1 - z0 - 0.2, h: top - 0.3, th: 0.6, yaw0: -Math.PI / 2,
      limits: [0, 1.9], mass: 25, mat: m.fridge, matName: 'metal',
      decorate: (d) => {
        box(d, 0.4, 3.2, 0.5, m.chrome, (z1 - z0) / 2 - 1.2, 0.5, 0.55)
        box(d, 2.2, 2.2, 0.1, solid('#ff7a59', 0.5), -1, 3, 0.34) // a drawing pinned on the door
        sphere(d, 0.25, solid('#3fb7ff', 0.4), -1, 4.2, 0.4)
      },
    })
    movers.push(door)
  }
  // West counter (z -34..-14) with stove + sink, back counter (x -30..-19.4).
  {
    const top = 5.4
    boxMM(g, -52.8, 0, -34, -49, top - 0.4, -14, m.cabinet, { collide: true })
    boxMM(g, -53, top - 0.4, -34.2, -48.6, top, -13.8, m.counter, { collide: true })
    // cabinet doors + handles
    for (let z = -33; z < -14; z += 3.3) {
      boxMM(g, -49.05, 0.6, z + 0.15, -48.95, top - 1, z + 3.05, m.cabinetDark)
      box(g, 0.25, 0.25, 1.2, m.brass, -48.8, top - 1.8, z + 1.6)
    }
    // stove top (z -27..-21): burners, knobs, oven door
    boxMM(g, -52.6, top, -27, -49.2, top + 0.15, -21, m.stove, { collide: true })
    for (const [bz, bx] of [[-25.5, -51.4], [-22.5, -51.4], [-25.5, -50.2], [-22.5, -50.2]]) cyl(g, 0.6, 0.6, 0.1, m.black, bx, top + 0.22, bz, { seg: 14 })
    boxMM(g, -49.1, 0.8, -26.6, -48.9, top - 1, -21.4, m.stove)
    box(g, 0.2, 0.3, 4.4, m.chrome, -48.7, top - 1.4, -24)
    // the kettle steam spot (Grandpa's tea)
    spot('kitchen', -51, top + 0.15, -24, 'stove')
    // sink (z -19..-15)
    boxMM(g, -52.4, top - 0.6, -19, -49.6, top + 0.05, -15, metal('#c4ccd4', 0.25))
    cyl(g, 0.18, 0.18, 2, m.chrome, -52, top + 1, -17, { seg: 8 })
    box(g, 1.4, 0.2, 0.2, m.chrome, -51.4, top + 2, -17)
    // back counter
    boxMM(g, -30, 0, -40.8, -19.4, top - 0.4, -37, m.cabinet, { collide: true })
    boxMM(g, -30.2, top - 0.4, -40.8, -19.2, top, -36.8, m.counter, { collide: true })
    for (let x = -29.5; x < -19.6; x += 3.4) boxMM(g, x, 0.6, -37.05, x + 3.1, top - 1, -36.95, m.cabinetDark)
    // upper cabinets (z -22..-14) with plates
    boxMM(g, -52.8, 9.5, -22, -50, 14.5, -14, m.cabinet, { collide: true })
    spot('kitchen', -46.5, 0.0, -30, null)
    spot('kitchen', -50.8, top, -31.5)
    spot('kitchen', -50.8, top, -28.5)
    spot('kitchen', -50.8, top, -19.5)
    spot('kitchen', -50.8, top, -14.8)
    spot('kitchen', -20.4, top, -38.9)
    // climb onto the west counter at its hallway end: box 1.8 -> step stool 3.6 -> counter 5.4
    climbStep(g, -49.2, -13.4, -46.8, -11, 1.8, 'crate')
    climbStep(g, -52.2, -13.6, -49.4, -11, 3.6, 'stool')
    // backsplash tiles
    boxMM(g, -52.8, top, -34, -52.6, top + 3, -14, surface('splash', paintTiles('#ffffff', '#cfe6e0', 4, '#a8b5b0'), { tile: 2, rough: 0.3, bump: 0.4 }))
  }
  // The toaster launcher on the back counter + the high shelf it pops you up to.
  const toaster = buildToaster(g, live, m, switches, spot)
  // Kitchen table (top 4.5) + 4 chairs + fruit bowl (with the free banana).
  {
    const tx0 = -38
    const tx1 = -28
    const tz0 = -28
    const tz1 = -20
    boxMM(g, tx0, 4.1, tz0, tx1, 4.5, tz1, m.wood, { collide: true })
    for (const [x, z] of [[tx0 + 0.5, tz0 + 0.5], [tx1 - 0.5, tz0 + 0.5], [tx0 + 0.5, tz1 - 0.5], [tx1 - 0.5, tz1 - 0.5]]) {
      box(g, 0.6, 4.1, 0.6, m.woodMid, x, 2.05, z, { collide: true })
    }
    boxMM(g, tx0 + 1, 4.5, tz0 + 1.5, tx1 - 1, 4.52, tz1 - 1.5, solid('#e7f0f6', 0.9), { cast: false }) // tablecloth runner
    // the chairs face the table (their backs used to stand between the seat and the table top)
    for (const [cx, cz, yaw] of [[-33, -30.5, Math.PI], [-33, -17.5, 0], [-40.5, -24, -Math.PI / 2], [-25.5, -24, Math.PI / 2]]) chair(g, m, cx, cz, yaw)
    // climb: cookbooks 1.4 -> the north chair's seat 2.8 -> the table 4.5
    climbStep(g, -37, -18.4, -34.7, -16.6, 1.4, 'books', 2)
    // fruit bowl
    cyl(g, 1.3, 0.9, 0.7, solid('#e5d2b8', 0.6), -33, 4.85, -24, { seg: 18 })
    sphere(g, 0.5, solid('#d8342f', 0.45), -33.4, 5.3, -24.3, { seg: 10 })
    sphere(g, 0.5, solid('#7ac143', 0.45), -32.6, 5.3, -23.8, { seg: 10 })
    spot('kitchen', -35.5, 4.5, -22, null)
    spot('kitchen', -30.5, 4.5, -26, null)
  }
  // Trash can by the back door + a kitchen mat.
  cyl(g, 1.1, 0.95, 3.4, solid('#b9c2c9', 0.3, 0.6), -44, 1.7, -39.5, { collide: true, seg: 16 })
  boxMM(g, -42, 0.03, -40.6, -34, 0.1, -36.5, solid('#a85b4a', 1), { cast: false, collide: true })
  lamps.push({ x: -36, y: 13.4, z: -26, room: 'kitchen' })

  // ===================================== BATHROOM (x -18..6, z -42..-10) =====================================
  // Bathtub along the west wall (hollow, rim 3.6).
  {
    const x0 = -16.8
    const x1 = -10.6
    const z0 = -40.8
    const z1 = -27
    const top = 3.6
    // floor between the four walls, the end walls between the long ones (no shared outer faces)
    boxMM(g, x0 + 0.6, 0, z0 + 0.6, x1 - 0.6, 0.8, z1 - 0.6, m.porcelain, { collide: true })
    boxMM(g, x0, 0, z0, x0 + 0.6, top, z1, m.porcelain, { collide: true })
    boxMM(g, x1 - 0.6, 0, z0, x1, top, z1, m.porcelain, { collide: true })
    boxMM(g, x0 + 0.6, 0, z0, x1 - 0.6, top, z0 + 0.6, m.porcelain, { collide: true })
    boxMM(g, x0 + 0.6, 0, z1 - 0.6, x1 - 0.6, top, z1, m.porcelain, { collide: true })
    boxMM(g, x0 + 0.6, 0.8, z0 + 0.6, x1 - 0.6, 1.6, z1 - 0.6, solid('#9fd4ef', 0.05, 0, { transparent: true, opacity: 0.7 }), { cast: false })
    // tap
    cyl(g, 0.2, 0.2, 2, m.chrome, -13.7, top + 1, z0 + 0.6, { seg: 8 })
    box(g, 0.3, 0.3, 1.4, m.chrome, -13.7, top + 2, z0 + 1.2)
    // in the tub (its floor 0.8; the water is visual): the 0.6 rim was too thin, the duck always fell off
    spot('bathroom', -13.7, 0.8, -31.5, 'tubrim')
    spot('bathroom', -13.7, 0.8, -36.5, null)
    // in and out of the tub: step stool 1.8 outside -> rim 3.6; inside, a big sponge 2.2 -> rim
    climbStep(g, -10.4, -30.2, -8.4, -28.2, 1.8, 'stool')
    climbStep(g, -16.1, -29.4, -13.9, -27.7, 2.2, 'sponge')
    // curtain rail + curtain
    boxMM(g, x0, 13, z1 - 0.15, x1, 13.2, z1 + 0.05, m.chrome)
    boxMM(g, x0 + 0.2, 5, z1 - 0.1, x0 + 3, 12.9, z1 - 0.02, solid('#9fd8d0', 0.9, 0, { side: 2 }), { cast: false })
  }
  // Toilet (with its flush handle switch) against the back wall, east.
  {
    const tx = 2
    const tz = -38.2
    box(g, 2.8, 2.6, 3.6, m.porcelain, tx, 1.3, tz + 0.6, { collide: true, round: 0.6 })
    cyl(g, 1.7, 1.6, 0.4, m.porcelain, tx, 2.8, tz + 1.4, { seg: 20 })
    box(g, 3.4, 4, 1.6, m.porcelain, tx, 4.2, -40, { collide: true, round: 0.3 }) // tank
    const handle = new Group()
    box(handle, 0.8, 0.25, 0.25, m.chrome, 0, 0, 0)
    handle.position.set(tx - 1.6, 5.4, -39.1)
    const sw = makeSwitch(live, {
      id: 'flush', name: 'Flush Handle', x: tx - 1.6, y: 5.4, z: -39.1, hx: 0.6, hy: 0.35, hz: 0.35, mesh: handle,
      onUse: (ctx) => {
        handle.rotation.z = -0.5
        setTimeout(() => (handle.rotation.z = 0), 700)
        ctx.event('flush', sw.pos, 1)
      },
    })
    switches.push(sw)
  }
  // Vanity + mirror on the west wall (z -24..-17) — the dentures glass lives here.
  {
    boxMM(g, -16.8, 0, -24, -13.6, 4.6, -17, solid('#d9c9b0', 0.6), { collide: true })
    boxMM(g, -17, 4.6, -24.2, -13.4, 5, -16.8, m.counter, { collide: true })
    cyl(g, 1.1, 0.8, 0.5, m.porcelain, -15.2, 5.1, -20.5, { seg: 18 })
    boxMM(g, -16.8, 7, -23.5, -16.6, 12.5, -17.5, metal('#e8f2f8', 0.05))
    boxMM(g, -16.9, 6.8, -23.7, -16.7, 12.7, -17.3, m.brass)
    spot('bathroom', -14.4, 5, -23, 'sink')
    spot('bathroom', -14.4, 5, -17.8)
    // climb at the hallway end: magazines 1.7 -> laundry box 3.4 -> vanity 5.0
    climbStep(g, -16.6, -14.4, -14.2, -12.4, 1.7, 'books', 5)
    climbStep(g, -16.6, -16.6, -14.2, -14.6, 3.4, 'crate')
  }
  // The window climb inside (sill 8): hamper 1.8 -> cabinet 3.6 -> shelf 5.4 -> towel stack 7.2.
  {
    box(g, 2.4, 1.8, 2.2, solid('#d7c39b', 0.9), 4, 0.9, -32, { collide: true })
    boxMM(g, -2.5, 0, -40.8, 1, 3.6, -37.6, solid('#e4dccc', 0.6), { collide: true })
    boxMM(g, -5.6, 0, -40.8, -2.5, 5.4, -38, solid('#e4dccc', 0.6), { collide: true })
    boxMM(g, -9, 0, -40.8, -5.6, 7.2, -38.6, solid('#e4dccc', 0.6), { collide: true })
    for (const [x, y, c] of [[-7.3, 7.6, '#ff9aa2'], [-7.3, 8.1, '#9fd8d0']]) box(g, 2.8, 0.5, 1.6, solid(c, 0.95), x, y - 0.2, -39.7)
    spot('bathroom', -0.8, 3.6, -39.2)
    spot('bathroom', -4, 5.4, -39.4)
    spot('bathroom', 4, 1.8, -32)
  }
  // Bath mat, towel rack, shelf.
  boxMM(g, -10, 0.03, -33, -6, 0.12, -27, solid('#9fd8d0', 1), { cast: false, collide: true })
  boxMM(g, 5.2, 6, -24, 5.4, 6.3, -16, m.chrome)
  boxMM(g, 5.0, 3, -23.5, 5.3, 6, -17, solid('#f5c26b', 0.95))
  boxMM(g, 2.4, 7.8, -16, 5.4, 8.1, -12, m.white, { collide: true }) // deep enough that loot doesn't topple off
  spot('bathroom', 3.9, 8.1, -14)
  spot('bathroom', -2, 0, -20)
  lamps.push({ x: -6, y: 13.4, z: -26, room: 'bathroom' })

  // ===================================== BEDROOM (x 6..54, z -42..-10) =====================================
  // Bed (mattress top 3.9, crawlspace under it = hiding spot).
  {
    const x0 = 25
    const x1 = 36
    const z0 = -40.8
    const z1 = -27.8
    for (const [x, z] of [[x0 + 0.5, z0 + 0.5], [x1 - 0.5, z0 + 0.5], [x0 + 0.5, z1 - 0.5], [x1 - 0.5, z1 - 0.5]]) box(g, 0.8, 1.4, 0.8, m.woodDark, x, 0.7, z, { collide: true })
    boxMM(g, x0, 1.4, z0 + 0.7, x1, 2.5, z1, m.woodDark, { collide: true }) // frame starts at the headboard
    boxMM(g, x0 + 0.2, 2.5, z0 + 0.4, x1 - 0.2, 3.9, z1 - 0.2, m.sheet, { collide: true, round: 0.3 })
    boxMM(g, x0 - 0.3, 3.2, z0 + 4.5, x1 + 0.3, 4.1, z1 + 0.3, m.bedspread, { collide: true }) // blanket (solid: loot lies on it)
    boxMM(g, x0 - 0.35, 1.6, z0 + 4.5, x0 - 0.25, 3.6, z1 + 0.3, m.bedspread)
    boxMM(g, x1 + 0.25, 1.6, z0 + 4.5, x1 + 0.35, 3.6, z1 + 0.3, m.bedspread)
    boxMM(g, x0, 0, z0, x1, 7.5, z0 + 0.7, m.woodDark, { collide: true }) // headboard
    box(g, 3.2, 1, 2.2, m.sheet, 28, 4.3, -39, { round: 0.4 }) // decorative pillow (real pillow loot too)
    hideSpots.push({ x0: x0 + 0.2, x1: x1 - 0.2, z0: z0 + 0.7, z1: z1 - 0.2, y1: 1.4, name: 'under the bed' })
    spot('bedroom', 33.5, 3.9, -39, null)
    spot('bedroom', 30.5, 0, -34, 'underbed')
    spot('bedroom', 31, 4.1, -30.5)
    // climb at the foot: a toy chest 1.4 + a stack of books on the floor beside it 2.75 -> blanket 4.1
    climbStep(g, 26.6, -26.9, 29.2, -25.1, 1.4, 'crate')
    climbStep(g, 29.4, -26.9, 31.6, -25.1, 2.75, 'books', 3)
  }
  // Nightstands + lamps.
  for (const nx of [22.8, 38.2]) {
    boxMM(g, nx - 1.7, 0, -40.8, nx + 1.7, 4, -37.6, m.wood, { collide: true })
    box(g, 2.8, 0.2, 0.2, m.brass, nx, 3.1, -37.5)
    cyl(g, 0.5, 0.7, 1.6, m.porcelain, nx + 0.6, 4.8, -39.6, { seg: 12 })
    cyl(g, 0.9, 1.4, 1.4, m.shade, nx + 0.6, 6.2, -39.6, { seg: 16 })
    spot('bedroom', nx - 0.6, 4, -38.8)
  }
  // Wardrobe (tall), dresser with mirror, small armchair, rug.
  boxMM(g, 47.6, 0, -40.8, 52.8, 14, -35.5, m.woodMid, { collide: true })
  boxMM(g, 47.5, 1, -40.4, 47.6, 13.5, -38.2, m.wood)
  boxMM(g, 47.5, 1, -38.1, 47.6, 13.5, -35.9, m.wood)
  box(g, 0.3, 1.6, 0.3, m.brass, 47.3, 7, -38.6)
  box(g, 0.3, 1.6, 0.3, m.brass, 47.3, 7, -37.6)
  boxMM(g, 7.2, 0, -31, 10.5, 5.5, -19, m.wood, { collide: true })
  for (let y = 1; y < 5; y += 1.5) boxMM(g, 10.5, y, -30.5, 10.6, y + 1.2, -19.5, m.woodMid)
  boxMM(g, 7.2, 6, -28, 7.4, 13, -22, metal('#eaf3f8', 0.05))
  boxMM(g, 7.1, 5.8, -28.3, 7.3, 13.2, -21.7, m.woodDark)
  spot('bedroom', 8.8, 5.5, -29.5)
  spot('bedroom', 8.8, 5.5, -26)
  spot('bedroom', 8.8, 5.5, -22.5)
  spot('bedroom', 8.8, 5.5, -19.8)
  // climb onto the dresser from its door end: books 1.4 -> box 2.8 -> stool 4.2 -> dresser 5.5
  climbStep(g, 7.4, -14.4, 9.8, -12.4, 1.4, 'books', 7)
  climbStep(g, 7.4, -16.6, 9.8, -14.6, 2.8, 'crate')
  climbStep(g, 7.4, -18.8, 9.8, -16.8, 4.2, 'stool')
  armchair(g, m.armchair, m.woodDark, 15, -36, 0.5, 0.75)
  climbStep(g, 12, -40.5, 14.2, -38.3, 1.2, 'pouf') // in front of it: pouf 1.2 -> seat 2.25 -> cushion 2.8
  boxMM(g, 18, 0.03, -30, 42, 0.1, -16, surface('rug-bed', paintRug('#3f6a8f', '#f0d58a', '#2a2f4a'), { tile: 24, rough: 1, bump: 0 }), { cast: false, collide: true })
  // Chest under the side window (inside climb: stool 1.7 -> chest 3.4 -> sill 5).
  boxMM(g, 50.4, 0, -33, 52.8, 3.4, -23, m.woodMid, { collide: true })
  box(g, 2, 1.7, 2.2, m.wood, 48.6, 0.85, -26, { collide: true })
  spot('bedroom', 51.6, 3.4, -31)
  spot('bedroom', 48.6, 1.7, -26)
  spot('bedroom', 15, 2.81, -35.5) // the armchair's seat cushion
  // The ceiling fan (with its light bowl) instead of a pendant: pull the cord, hang on to a blade, let go.
  lamps.push({ x: 30, y: 13.4, z: -26, room: 'bedroom', fan: true })
  const fan = buildCeilingFan(g, live, m, switches, 30, -26)

  // ===================================== HALLWAY (x -54..54, z -10..4) =====================================
  // Runner rug.
  boxMM(g, -48, 0.03, -5.5, 46, 0.1, -0.5, surface('rug-hall', paintRug('#8f3b3b', '#e9c46a', '#3a2a2a'), { tile: 94, rough: 1, bump: 0 }), { cast: false, collide: true })
  // Grandfather clock (x -14, against z = 4 wall).
  {
    boxMM(g, -16, 0, 1.4, -12, 14.5, 3.4, m.woodDark, { collide: true })
    cyl(g, 1.4, 1.4, 0.2, solid('#f7f0dc', 0.6), -14, 11.8, 1.3, { seg: 24 }).rotation.x = Math.PI / 2
    const pend = new Group()
    box(pend, 0.12, 4, 0.12, m.brass, 0, -2, 0)
    cyl(pend, 0.7, 0.7, 0.15, m.brass, 0, -4.2, 0, { seg: 16 }).rotation.x = Math.PI / 2
    pend.position.set(-14, 9.6, 1.3)
    live.add(pend)
    boxMM(g, -15.2, 3, 1.25, -12.8, 9.8, 1.3, glass('#e6d7b5', 0.25))
    const hands = new Group()
    box(hands, 0.12, 1.1, 0.06, m.black, 0, 0.5, 0)
    hands.position.set(-14, 11.8, 1.15)
    live.add(hands)
    animated.push((dt, t) => {
      pend.rotation.z = Math.sin(t * Math.PI) * 0.22
      hands.rotation.z = -t * 0.05
    })
  }
  // Coat rack + umbrella stand near the front door, shoe rack + bench on its latch side (clear of the
  // leaf's swing: the front door opens inward; from the hallway a jump at the open door climbs to the porch).
  {
    cyl(g, 0.3, 0.3, 13, m.woodDark, 49, 6.5, 2.4, { seg: 8, collide: true })
    for (let i = 0; i < 4; i++) {
      const peg = box(g, 0.2, 0.2, 1.6, m.brass, 49 + Math.sin(i * 1.57) * 0.7, 12.4, 2.4 + Math.cos(i * 1.57) * 0.7)
      peg.rotation.y = i * 1.57
    }
    box(g, 2.4, 3.6, 2.4, solid('#2f4a3a', 0.6), 46, 1.8, -8.4, { collide: true, round: 0.3 }) // umbrella stand
    box(g, 2.2, 1.7, 2.3, m.wood, 49.5, 0.85, -8.15, { collide: true }) // shoe rack
    boxMM(g, 50.6, 0, -9.3, 52.8, 3.4, -7, m.woodMid, { collide: true }) // bench
    spot('hallway', 49.5, 1.7, -8.2)
    spot('hallway', 51.8, 3.4, -8.2)
    spot('hallway', 41.5, 0, -5.6, 'stand')
  }
  // Side tables with keys/wallet/vase, potted plant, pictures.
  boxMM(g, 32, 0, -9.4, 40, 4.8, -7.2, m.wood, { collide: true })
  spot('hallway', 33.3, 4.8, -8.2)
  spot('hallway', 35.8, 4.8, -8.2)
  // Grandpa's telephone (dial it: it rings, he hurries over and chats for ages)
  const phone = buildPhone(live, m, switches, 38.4, 4.8, -8.3)
  // climb onto the east side table from its west end: books 1.6 -> box 3.2 -> table 4.8
  climbStep(g, 29.6, -7.1, 31.8, -5.5, 1.6, 'books', 4)
  climbStep(g, 29.6, -9.3, 31.8, -7.3, 3.2, 'crate')
  boxMM(g, -52.6, 0, 1.2, -44.6, 4.8, 3.4, m.wood, { collide: true })
  // ...and the west one from the front: books 1.6 -> box 3.2 -> table 4.8
  climbStep(g, -52.4, -3.2, -50, -1.2, 1.6, 'books', 6)
  climbStep(g, -52.4, -1, -50, 1, 3.2, 'crate')
  spot('hallway', -50.6, 4.8, 2.3)
  spot('hallway', -46.6, 4.8, 2.3)
  spot('hallway', -22, 0, -7)
  spot('hallway', 18, 0, 1.6)
  pottedPlant(g, m, -50, -7.5, 1.2)
  pottedPlant(g, m, 26, 1.8, 1)
  for (const [x, z, face] of [[-44, -9.35, 1], [-20, -9.35, 1], [8, 3.35, -1], [40, 3.35, -1]]) picture(g, x, 8, z, face, (x * 13) | 0)
  // Thermostat (switch) on the z = -10 wall at x 10.
  {
    const t = new Group()
    box(t, 1.8, 2.4, 0.4, solid('#f7f3ea', 0.4), 0, 0, 0, { round: 0.2 })
    const dial = cyl(t, 0.6, 0.6, 0.3, solid('#e0a63a', 0.4), 0, 0.1, 0.3, { seg: 18 })
    dial.rotation.x = Math.PI / 2
    const sign = canvasSign(1.4, 0.5, 128, 48, (c, w, h) => {
      c.fillStyle = '#1e3b2e'
      c.fillRect(0, 0, w, h)
      c.fillStyle = '#7dffb0'
      c.font = '700 34px Fredoka, sans-serif'
      c.textAlign = 'center'
      c.textBaseline = 'middle'
      c.fillText(t.userData.hot ? '88°' : '68°', w / 2, h / 2)
    })
    sign.mesh.position.set(0, -0.8, 0.22)
    t.add(sign.mesh)
    t.position.set(10, 8, -9.2)
    const sw = makeSwitch(live, {
      id: 'thermostat', name: 'Thermostat', x: 10, y: 8, z: -9.1, hx: 1, hy: 1.3, hz: 0.4, mesh: t,
      onUse: (ctx) => {
        t.userData.hot = !t.userData.hot
        dial.rotation.z += t.userData.hot ? -2.2 : 2.2
        sign.redraw()
        ctx.event('thermostat', sw.pos, 1, { hot: t.userData.hot })
      },
    })
    sw.isHot = () => !!t.userData.hot
    sw.reset = () => {
      if (t.userData.hot) dial.rotation.z += 2.2
      t.userData.hot = false
      sign.redraw()
    }
    switches.push(sw)
  }
  lamps.push({ x: -30, y: 13.4, z: -3, room: 'hallway' }, { x: 2, y: 13.4, z: -3, room: 'hallway' }, { x: 34, y: 13.4, z: -3, room: 'hallway' })

  // ===================================== GARAGE (x -54..-18, z 4..42) =====================================
  car(g, m, -36, 25, hideSpots)
  // Workbench along the west wall + pegboard + shelves.
  {
    boxMM(g, -52.8, 4.8, 14, -48.4, 5.4, 34, m.woodMid, { collide: true })
    for (const z of [14.6, 33.4]) for (const x of [-52.2, -49]) box(g, 0.6, 4.8, 0.6, m.woodDark, x, 2.4, z, { collide: true })
    boxMM(g, -52.6, 1.5, 14.4, -48.8, 1.8, 33.6, m.woodMid, { collide: true }) // lower shelf
    boxMM(g, -52.8, 7, 15, -52.6, 13, 33, solid('#c9a36f', 0.8)) // pegboard
    for (let z = 17; z < 32; z += 3) box(g, 0.3, 1.6, 0.3, m.black, -52.4, 10, z)
    spot('garage', -50.6, 5.4, 16.5)
    spot('garage', -50.6, 5.4, 20)
    spot('garage', -50.6, 5.4, 24)
    spot('garage', -50.6, 5.4, 28)
    spot('garage', -50.6, 5.4, 32)
    spot('garage', -50.6, 1.8, 24)
    // tall shelf unit by the hall door
    // an open unit: back panel + two sides, the boards between them (it used to be a solid block with the
    // boards buried in it, and an invisible wall across the front that stopped grabbing the loot on it)
    boxMM(g, -52.8, 0, 4.6, -42.5, 11, 4.9, m.woodDark, { collide: true }) // back (against the wall)
    for (const sx of [-52.8, -42.8]) boxMM(g, sx, 0, 4.9, sx + 0.3, 11, 7.6, m.woodDark, { collide: true }) // sides
    for (const y of [0.2, 3.6, 7.2, 10.6]) boxMM(g, -52.5, y, 4.9, -42.8, y + 0.4, 7.5, m.wood, { collide: true })
    spot('garage', -48, 4.0, 6.1) // on the boards (tops 4.0 / 7.6; the spots were inside them)
    spot('garage', -45, 7.6, 6.1)
    for (const [x, y, c] of [[-51.5, 4, '#3a6fd0'], [-50, 4, '#e83b3b'], [-44, 0.6, '#f0c030']]) cyl(g, 0.6, 0.6, 1.2, solid(c, 0.4, 0.4), x, y + 0.6, 6.1, { seg: 12 })
    // climb onto the workbench from its north end (books 1.35 -> box 2.7 -> stool 4.05 -> bench 5.4),
    // with a box 2.7 in front of the shelf unit up to its first board (4.0)
    climbStep(g, -51.8, 7.9, -49.4, 9.7, 1.35, 'books', 1)
    climbStep(g, -51.8, 9.9, -49.4, 11.7, 2.7, 'crate')
    climbStep(g, -51.8, 11.9, -49.4, 13.8, 4.05, 'stool')
    climbStep(g, -49.2, 7.8, -47, 9.8, 2.7, 'crate')
  }
  // Boxes by the garage door (a little climb), lawn mower, bike.
  box(g, 3, 3, 3, solid('#c79b62', 0.9), -21, 1.5, 37.5, { collide: true })
  box(g, 2.4, 2.4, 2.4, solid('#b88a55', 0.9), -21.2, 4.2, 37.8, { collide: true })
  spot('garage', -21.2, 5.4, 37.8) // on top of the box stack (the old spot was past the box's edge)
  climbStep(g, -21, 33.4, -18.8, 35.6, 1.5, 'crate') // a small box: the first step up the stack
  // climb onto the car's boot from its east side (books 1.3 -> box 2.6 -> stool 3.9 -> boot 5.2),
  // clear of the garage door's swing and of Grandpa's path down the garage
  climbStep(g, -30.1, 17.6, -28, 19.6, 1.3, 'books', 3)
  climbStep(g, -30.1, 15.4, -28, 17.4, 2.6, 'crate')
  climbStep(g, -30.1, 13.2, -28, 15.2, 3.9, 'stool')
  {
    boxMM(g, -22, 0.8, 20, -19.4, 2.4, 24.5, solid('#d83a3a', 0.5, 0.2), { collide: true })
    for (const z of [20.4, 24.1]) for (const x of [-21.7, -19.7]) cyl(g, 0.5, 0.5, 0.3, m.tire, x, 0.5, z, { seg: 12 }).rotation.z = Math.PI / 2
    box(g, 0.2, 4.5, 0.2, m.black, -20.7, 4, 25.2)
    box(g, 2.4, 0.2, 0.2, m.black, -20.7, 6.2, 25.2)
  }
  boxMM(g, -52.8, 0.03, 9, -46, 0.08, 13, solid('#6b4a33', 0.9), { cast: false, collide: true }) // oil stain mat
  lamps.push({ x: -36, y: 13.4, z: 23, room: 'garage' })

  // ===================================== LIVING ROOM (x -18..30, z 4..42) =====================================
  boxMM(g, -12, 0.03, 12, 10, 0.1, 32, surface('rug-liv', paintRug('#9c2f2f', '#e9c46a', '#2f3e6b'), { tile: 22, rough: 1, bump: 0 }), { cast: false, collide: true })
  // Sofa facing the TV (-X), crawlspace under it.
  {
    const x0 = 0
    const x1 = 6
    const z0 = 14
    const z1 = 30
    for (const [x, z] of [[x0 + 0.4, z0 + 0.4], [x1 - 0.4, z0 + 0.4], [x0 + 0.4, z1 - 0.4], [x1 - 0.4, z1 - 0.4]]) box(g, 0.5, 1.3, 0.5, m.woodDark, x, 0.65, z, { collide: true })
    boxMM(g, x0, 1.3, z0, x1, 2.8, z1, m.sofa, { collide: true, round: 0.4 })
    boxMM(g, x1 - 1.3, 2.8, z0, x1, 6.2, z1, m.sofa, { collide: true, round: 0.5 })
    // arms stop at the backrest (they used to run through it and share its end faces)
    boxMM(g, x0, 2.8, z0, x1 - 1.3, 4.4, z0 + 1.4, m.sofa, { collide: true, round: 0.5 })
    boxMM(g, x0, 2.8, z1 - 1.4, x1 - 1.3, 4.4, z1, m.sofa, { collide: true, round: 0.5 })
    for (const z of [17.8, 22, 26.2]) box(g, 4.4, 1, 4, m.sofa, (x0 + x1) / 2 - 0.5, 3.2, z, { round: 0.45 }) // seat cushions
    solidMM(x0, 2.8, z0 + 1.4, x1 - 1.3, 3.7, z1 - 1.4) // ...solid, so loot rests on them, not in them
    hideSpots.push({ x0: x0 + 0.3, x1: x1 - 0.3, z0: z0 + 0.3, z1: z1 - 0.3, y1: 1.3, name: 'under the sofa' })
    spot('living', 2.5, 3.7, 16.5)
    spot('living', 2.5, 3.7, 27.5)
    spot('living', 3, 0, 22, 'undersofa')
  }
  // Coffee table + TV stand + TV (breakable).
  boxMM(g, -9, 2.2, 18, -4, 2.6, 26, m.wood, { collide: true })
  for (const [x, z] of [[-8.6, 18.4], [-4.4, 18.4], [-8.6, 25.6], [-4.4, 25.6]]) box(g, 0.4, 2.2, 0.4, m.woodDark, x, 1.1, z, { collide: true })
  spot('living', -7.5, 2.6, 20)
  spot('living', -5.5, 2.6, 24)
  // climb: magazines 1.3 -> coffee table 2.6 -> pouf 2.45 -> sofa seat 3.7 -> arm 4.4 -> back 6.2
  climbStep(g, -7.6, 26.2, -5.4, 28, 1.3, 'books', 4)
  climbStep(g, -3, 20.9, -0.8, 23.1, 2.45, 'pouf')
  boxMM(g, -17.4, 0, 16, -14, 3.6, 28, m.woodDark, { collide: true })
  // (the TV fills the stand top: its old two spots were inside the TV) -> the hearth corners
  spot('living', 14.2, 0.3, 9.6)
  spot('living', 23.8, 0.3, 9.6)
  const tv = buildTv(live, m, -15.6, 3.6, 22)
  // Grandpa's armchair facing the fireplace.
  armchair(g, m.armchair, m.woodDark, 20, 30, Math.PI, 1)
  climbStep(g, 18.8, 33.5, 21.2, 35.9, 1.6, 'footstool') // his footrest: 1.6 -> seat 3.0
  // Fireplace on the z = 4 wall (x 14..24): brick, mantel, firebox with a living fire.
  const fire = buildFireplace(g, live, m)
  spot('living', 15.5, 9.6, 6.2) // on the mantel (top 9.6; the spots were inside it)
  spot('living', 22.5, 9.6, 6.2)
  // Window seat + footstool under the front window (inside climb: 1.7 -> 3.4 -> sill 5).
  boxMM(g, -2, 0, 38.6, 12, 3.4, 40.8, m.woodMid, { collide: true })
  boxMM(g, -1.8, 3.4, 38.8, 11.8, 3.9, 40.6, m.sofa, { round: 0.2, collide: true })
  box(g, 2.4, 1.7, 2.4, m.armchair, 5, 0.85, 36.5, { collide: true, round: 0.4 })
  spot('living', 1, 3.9, 39.6)
  spot('living', 10, 3.9, 39.6)
  // Side table + floor lamp + plant, record player cabinet.
  boxMM(g, 24.5, 0, 37, 28.5, 4, 40.8, m.wood, { collide: true })
  spot('living', 26.5, 4, 38.8)
  climbStep(g, 22.2, 36.4, 24.3, 38.4, 1.35, 'books', 2) // books 1.35 -> box 2.7 -> side table 4.0
  climbStep(g, 22.2, 38.6, 24.3, 40.6, 2.7, 'crate')
  floorLamp(g, m, -15, 9)
  pottedPlant(g, m, 26, 9, 1.3)
  boxMM(g, -17.4, 0, 31, -14, 4.2, 38, m.woodMid, { collide: true })
  cyl(g, 1.2, 1.2, 0.3, m.black, -15.7, 4.35, 34.5, { seg: 20 }) // turntable (clear of both spots)
  spot('living', -15.7, 4.2, 32.2)
  spot('living', -15.7, 4.2, 36.9)
  climbStep(g, -11.4, 33.6, -9.2, 35.8, 1.4, 'books', 6) // books 1.4 -> box 2.8 -> record cabinet 4.2
  climbStep(g, -13.8, 33.6, -11.6, 35.8, 2.8, 'crate')
  spot('living', 8, 0, 9, null)
  // Bookshelves on the x = 30 wall + the secret bookshelf door + the red book.
  const secret = buildSecretShelf(g, live, m, switches)
  // Bird cage (caught thieves go in here).
  const cage = buildCage(g, live, m, movers)
  lamps.push({ x: 6, y: 13.4, z: 23, room: 'living' })

  // ===================================== STUDY (x 30..54, z 4..42) — the secret room =====================================
  boxMM(g, 34, 0.03, 10, 50, 0.1, 30, surface('rug-std', paintRug('#2f4a3a', '#d8b15a', '#1e2a22'), { tile: 20, rough: 1, bump: 0 }), { cast: false, collide: true })
  // Desk + chair.
  boxMM(g, 40, 4.4, 6, 50, 4.9, 11, m.woodDark, { collide: true })
  boxMM(g, 40, 0, 6, 42.5, 4.4, 11, m.woodDark, { collide: true })
  boxMM(g, 47.5, 0, 6, 50, 4.4, 11, m.woodDark, { collide: true })
  box(g, 2.2, 1.4, 1.2, metal('#c9a447', 0.3), 45, 5.6, 6.8) // desk lamp base-ish
  spot('study', 43, 4.9, 9)
  spot('study', 48, 4.9, 9)
  chair(g, { woodMid: m.woodDark, sofa: m.armchair }, 45, 14, 0) // facing the desk
  climbStep(g, 37.6, 8.6, 39.8, 10.8, 1.65, 'books', 1) // books 1.65 -> box 3.3 -> desk 4.9
  climbStep(g, 37.6, 6.2, 39.8, 8.4, 3.3, 'crate')
  // Display pedestals with the gold bar / diamond / coin jar.
  for (const [x, z] of [[36, 36], [42, 38], [34, 28]]) {
    box(g, 3, 4, 3, m.stone, x, 2, z, { collide: true, round: 0.2 })
    spot('study', x, 4, z, 'pedestal')
  }
  // Trophy cabinet (glass) and the safe in the corner.
  // back, two sides and a top, the shelves fitted inside (they used to run through the back panel)
  boxMM(g, 52, 0, 14, 52.8, 12, 26, m.woodDark, { collide: true })
  for (const sz of [14, 25.7]) boxMM(g, 49.6, 0, sz, 52, 12.3, sz + 0.3, m.woodDark, { collide: true })
  boxMM(g, 49.6, 12, 14.3, 52, 12.3, 25.7, m.woodDark, { collide: true })
  for (const y of [3, 6, 9]) boxMM(g, 49.62, y, 14.3, 52, y + 0.3, 25.7, m.woodMid, { collide: true })
  boxMM(g, 49.5, 0, 14, 49.6, 12, 26, glass('#e6f2ff', 0.2))
  spot('study', 51.2, 3.3, 20)
  spot('study', 51.2, 6.3, 17)
  const safe = buildSafe(g, live, m, movers)
  spot('study', 50, 0.8, 33.5, 'safe')
  lamps.push({ x: 42, y: 13.4, z: 23, room: 'study' })

  // Light switches, one per room beside its door (latch side, clear of the door's swing).
  const lightSwitches = buildLightSwitches(live, switches)
  // Lived-in details: clocks, curtains, pictures, rugs, jars, tyres... (mostly visual; big ones solid).
  buildDetails(g, m)

  // ===================================== Lamps (pendants) =====================================
  for (const l of lamps) {
    if (l.fan) continue
    cyl(g, 0.08, 0.08, 2.6, m.black, l.x, H - 1.3, l.z, { seg: 6, cast: false })
    cyl(g, 0.6, 2.2, 1.6, m.shade, l.x, H - 3.2, l.z, { seg: 18 })
    sphere(g, 0.55, hm.bulb, l.x, H - 3.9, l.z, { seg: 10 })
  }

  // ===================================== Grandpa's activities =====================================
  // approach = nav-reachable point, stand = where he stops, yaw = facing (sin, cos), pose = animation.
  const activities = [
    { id: 'tea', room: 'kitchen', approach: [-40, -22], stand: [-45.6, -24], yaw: -Math.PI / 2, pose: 'tea', dur: [10, 15], sight: 0.75 },
    { id: 'fridge', room: 'kitchen', approach: [-40, -33], stand: [-42.6, -37.2], yaw: -Math.PI / 2, pose: 'look', dur: [5, 8], sight: 0.8, opens: 'fridge' },
    { id: 'sink', room: 'bathroom', approach: [-10, -24], stand: [-11.4, -20.5], yaw: -Math.PI / 2, pose: 'wash', dur: [5, 8], sight: 0.7 },
    { id: 'toilet', room: 'bathroom', approach: [0, -28], stand: [2, -36.6], yaw: 0, pose: 'sit', sitY: 2.6, dur: [8, 12], sight: 0.6 },
    { id: 'dresser', room: 'bedroom', approach: [16, -24], stand: [13.2, -25], yaw: -Math.PI / 2, pose: 'look', dur: [5, 7], sight: 0.8 },
    { id: 'nap', room: 'bedroom', approach: [20, -32], stand: [30.5, -29.4], yaw: 0, pose: 'sleepBed', sitY: 3.9, dur: [20, 30], sight: 0 },
    { id: 'workbench', room: 'garage', approach: [-46, 26], stand: [-46.2, 26], yaw: -Math.PI / 2, pose: 'tinker', dur: [9, 14], sight: 0.7 },
    { id: 'thermostat', room: 'hallway', approach: [12, -3], stand: [10, -6.2], yaw: Math.PI, pose: 'adjust', dur: [3, 5], sight: 0.9 },
    { id: 'clock', room: 'hallway', approach: [-14, -3], stand: [-14, -1.4], yaw: 0, pose: 'look', dur: [3, 5], sight: 0.9 },
    { id: 'newspaper', room: 'living', approach: [12, 25], stand: [20, 30.4], yaw: Math.PI, pose: 'read', sitY: 3, dur: [18, 26], sight: 0.35 },
    { id: 'tv', room: 'living', approach: [-2, 15], stand: [3.2, 22], yaw: -Math.PI / 2, pose: 'sit', sitY: 2.8, dur: [14, 20], sight: 0.6 },
    { id: 'fireplace', room: 'living', approach: [12, 14], stand: [19, 10.6], yaw: Math.PI, pose: 'poke', dur: [5, 8], sight: 0.8 },
    { id: 'plants', room: 'hallway', approach: [-46, -3], stand: [-47.5, -6], yaw: Math.PI, pose: 'water', dur: [4, 6], sight: 0.85 },
  ]

  const update = (dt, ctx) => {
    const t = ctx.time
    for (const fn of animated) fn(dt, t)
    fire.update(dt, t, ctx)
    tv.update(dt, t, ctx)
    secret.update(dt, ctx)
    toaster.update(dt, ctx)
    fan.update(dt, ctx)
    phone.update(dt, ctx)
  }

  return {
    toaster,
    fan,
    phone,
    lightSwitches,
    lootSpots,
    hideSpots,
    lamps,
    switches,
    activities,
    tv,
    fire,
    secret,
    cage,
    safe,
    fridge: movers.find((mv) => mv.id === 'fridge'),
    thermostat: switches.find((s) => s.id === 'thermostat'),
    update,
    reset() {
      tv.reset()
      secret.reset()
      cage.reset()
      toaster.reset()
      fan.reset()
      phone.reset()
      for (const ls of lightSwitches) ls.setOn(true)
      for (const s of switches) s.reset?.()
    },
  }
}

// --- Furniture pieces ------------------------------------------------------------------------------
function chair(g, m, x, z, yaw) {
  const grp = new Group()
  box(grp, 3, 0.4, 3, m.woodMid, 0, 2.6, 0, {})
  for (const [cx, cz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) box(grp, 0.35, 2.6, 0.35, m.woodMid, cx, 1.3, cz)
  box(grp, 3, 3, 0.35, m.woodMid, 0, 4.3, 1.35)
  box(grp, 2.4, 0.4, 2.4, m.sofa, 0, 2.95, 0, { round: 0.15 })
  grp.position.set(x, 0, z)
  grp.rotation.y = yaw
  g.add(grp)
  const q = qYaw(yaw)
  const back = new Vector3(0, 0, 1.35).applyQuaternion(q)
  solidMM(x - 1.5, 2.4, z - 1.5, x + 1.5, 2.8, z + 1.5)
  world.createCollider(RAPIER.ColliderDesc.cuboid(1.5, 1.5, 0.2).setTranslation(x + back.x, 4.3, z + back.z).setRotation(q))
  for (const [cx, cz] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) {
    const p = new Vector3(cx, 0, cz).applyQuaternion(q)
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.2, 1.2, 0.2).setTranslation(x + p.x, 1.2, z + p.z))
  }
}
function armchair(g, fabric, wood, x, z, yaw, s = 1) {
  const grp = new Group()
  box(grp, 7 * s, 1.8 * s, 6.4 * s, fabric, 0, 2.1 * s, 0, { round: 0.6 * s })
  box(grp, 7 * s, 6 * s, 1.6 * s, fabric, 0, 4.6 * s, 2.6 * s, { round: 0.7 * s })
  box(grp, 1.4 * s, 3 * s, 6.4 * s, fabric, -3.1 * s, 3.4 * s, 0, { round: 0.6 * s })
  box(grp, 1.4 * s, 3 * s, 6.4 * s, fabric, 3.1 * s, 3.4 * s, 0, { round: 0.6 * s })
  box(grp, 4.6 * s, 0.9 * s, 4.6 * s, fabric, 0, 3.3 * s, -0.5 * s, { round: 0.4 * s })
  for (const [cx, cz] of [[-3, -2.8], [3, -2.8], [-3, 2.8], [3, 2.8]]) box(grp, 0.5 * s, 1.2 * s, 0.5 * s, wood, cx * s, 0.6 * s, cz * s)
  grp.position.set(x, 0, z)
  grp.rotation.y = yaw
  g.add(grp)
  const q = qYaw(yaw)
  world.createCollider(RAPIER.ColliderDesc.cuboid(3.5 * s, 1.5 * s, 3.2 * s).setTranslation(x, 1.5 * s, z).setRotation(q))
  // the seat cushion (the small bedroom chair; Grandpa's own armchair keeps his sitting room)
  if (s < 1) {
    const cush = new Vector3(0, 0, -0.5 * s).applyQuaternion(q)
    world.createCollider(RAPIER.ColliderDesc.cuboid(2.3 * s, 0.375 * s, 2.3 * s).setTranslation(x + cush.x, 3.375 * s, z + cush.z).setRotation(q))
  }
  const back = new Vector3(0, 0, 2.6 * s).applyQuaternion(q)
  world.createCollider(RAPIER.ColliderDesc.cuboid(3.5 * s, 3 * s, 0.8 * s).setTranslation(x + back.x, 4.6 * s, z + back.z).setRotation(q))
}
function pottedPlant(g, m, x, z, s) {
  cyl(g, 1.3 * s, 1 * s, 2.6 * s, m.plantPot, x, 1.3 * s, z, { collide: true, seg: 14 })
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2
    sphere(g, 1.1 * s, m.leaf, x + Math.cos(a) * 0.9 * s, (3.4 + (i % 3) * 0.7) * s, z + Math.sin(a) * 0.9 * s, { sy: 1.4, seg: 8 })
  }
  sphere(g, 1.2 * s, m.leaf, x, 5 * s, z, { sy: 1.3, seg: 8 })
}
function floorLamp(g, m, x, z) {
  cyl(g, 1.2, 1.2, 0.3, m.brass, x, 0.15, z, { seg: 16 })
  cyl(g, 0.15, 0.15, 10, m.brass, x, 5, z, { seg: 8, collide: true })
  cyl(g, 1.2, 2.2, 2.4, m.shade, x, 10.6, z, { seg: 18 })
}
function picture(g, x, y, z, face, seed) {
  const rand = mulberry32(seed)
  const sign = canvasSign(4, 3, 160, 120, (c, w, h) => {
    const sky = ['#9fd3ff', '#ffd1a1', '#c7b7ff'][Math.floor(rand() * 3)]
    c.fillStyle = sky
    c.fillRect(0, 0, w, h)
    c.fillStyle = '#6fbf5a'
    c.beginPath()
    c.moveTo(0, h * 0.7)
    for (let i = 0; i <= 8; i++) c.lineTo((i / 8) * w, h * (0.55 + rand() * 0.2))
    c.lineTo(w, h)
    c.lineTo(0, h)
    c.fill()
    c.fillStyle = '#fff2b0'
    c.beginPath()
    c.arc(w * (0.2 + rand() * 0.6), h * 0.25, 10, 0, Math.PI * 2)
    c.fill()
  }, { emissiveBoost: 0.08 })
  sign.mesh.position.set(x, y, z + face * 0.15)
  if (face < 0) sign.mesh.rotation.y = Math.PI
  g.add(sign.mesh)
  box(g, 4.6, 3.6, 0.2, solid('#b8893f', 0.4, 0.4), x, y, z, {})
}

// The getaway-worthy vintage car; the crawlspace under it is a hiding spot.
function car(g, m, cx, cz, hideSpots) {
  const w = 11
  const l = 24
  boxMM(g, cx - w / 2, 1.4, cz - l / 2, cx + w / 2, 5.2, cz + l / 2, m.car, { collide: true, round: 1 })
  boxMM(g, cx - w / 2 + 0.6, 5.2, cz - l / 2 + 5, cx + w / 2 - 0.6, 9, cz + l / 2 - 7, m.car, { collide: true, round: 1 })
  boxMM(g, cx - w / 2 + 0.55, 5.6, cz - l / 2 + 5.4, cx + w / 2 - 0.55, 8.6, cz + l / 2 - 7.4, glass('#9cc3d8', 0.5))
  boxMM(g, cx - w / 2 - 0.2, 1.6, cz - l / 2 - 0.4, cx + w / 2 + 0.2, 2.4, cz - l / 2 + 0.2, m.chrome)
  boxMM(g, cx - w / 2 - 0.2, 1.6, cz + l / 2 - 0.2, cx + w / 2 + 0.2, 2.4, cz + l / 2 + 0.4, m.chrome)
  for (const sx of [-1, 1]) {
    sphere(g, 0.8, emissive('#fff6d8', 0.5, '#ffffff'), cx + sx * 3.4, 4, cz + l / 2 + 0.1, { seg: 12 })
    sphere(g, 0.6, emissive('#ff4a3a', 0.4, '#a01010'), cx + sx * 3.8, 4, cz - l / 2 - 0.1, { seg: 10 })
  }
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const t = cyl(g, 2, 2, 1.6, m.tire, cx + sx * (w / 2 - 0.5), 2, cz + sz * (l / 2 - 4.5), { seg: 20 })
      t.rotation.z = Math.PI / 2
      const hub = cyl(g, 1, 1, 1.7, m.chrome, cx + sx * (w / 2 - 0.5), 2, cz + sz * (l / 2 - 4.5), { seg: 14 })
      hub.rotation.z = Math.PI / 2
      solidMM(cx + sx * (w / 2 - 0.5) - 0.8, 0, cz + sz * (l / 2 - 4.5) - 2, cx + sx * (w / 2 - 0.5) + 0.8, 4, cz + sz * (l / 2 - 4.5) + 2)
    }
  hideSpots.push({ x0: cx - w / 2 + 1.4, x1: cx + w / 2 - 1.4, z0: cz - l / 2 + 0.5, z1: cz + l / 2 - 0.5, y1: 1.4, name: 'under the car' })
}

// The TV: a screen that shows Grandpa's soap opera; a hard hit cracks it (sparks + static).
function buildTv(live, m, x, y, z) {
  const grp = new Group()
  box(grp, 0.9, 5.6, 9.4, m.black, 0, 2.8, 0, { round: 0.15 })
  box(grp, 0.6, 0.4, 3, m.black, 0, 0.2, 0)
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 160
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  const screen = new Mesh(new PlaneGeometry(8.8, 5), new MeshBasicMaterial({ map: tex, toneMapped: false }))
  screen.position.set(0.47, 2.8, 0)
  screen.rotation.y = Math.PI / 2
  grp.add(screen)
  grp.position.set(x, y, z)
  live.add(grp)
  world.createCollider(RAPIER.ColliderDesc.cuboid(0.45, 2.8, 4.7).setTranslation(x, y + 2.8, z))
  const light = new PointLight('#8fc8ff', 0, 26, 2)
  light.position.set(x + 3, y + 3, z)
  light.userData.farCull = true // off while you are in the hideout (perf.js)
  live.add(light)
  const ctx2 = c.getContext('2d')
  let broken = false
  let on = true
  let acc = 0
  let sparks = 0
  const crack = () => {
    ctx2.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx2.lineWidth = 2
    const cx = 128 + (Math.random() - 0.5) * 40
    const cy = 80 + (Math.random() - 0.5) * 30
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.3
      ctx2.beginPath()
      ctx2.moveTo(cx, cy)
      let px = cx
      let py = cy
      for (let s = 0; s < 4; s++) {
        px += Math.cos(a + (Math.random() - 0.5) * 0.6) * (18 + Math.random() * 22)
        py += Math.sin(a + (Math.random() - 0.5) * 0.6) * (18 + Math.random() * 22)
        ctx2.lineTo(px, py)
      }
      ctx2.stroke()
    }
  }
  const drawShow = (t) => {
    // a tiny cartoon soap opera: a sunset, two blob people chatting
    const g2 = ctx2.createLinearGradient(0, 0, 0, 160)
    g2.addColorStop(0, '#ff9a6b')
    g2.addColorStop(1, '#6a4c9c')
    ctx2.fillStyle = g2
    ctx2.fillRect(0, 0, 256, 160)
    ctx2.fillStyle = '#ffd36b'
    ctx2.beginPath()
    ctx2.arc(128, 120, 34, Math.PI, 0)
    ctx2.fill()
    ctx2.fillStyle = '#2b2140'
    ctx2.fillRect(0, 120, 256, 40)
    const bob = Math.sin(t * 6) * 3
    for (const [px, col, ph] of [[80, '#ff6fa8', 0], [176, '#6fd0ff', 1.6]]) {
      const talk = Math.sin(t * 9 + ph) > 0.3
      ctx2.fillStyle = col
      ctx2.beginPath()
      ctx2.ellipse(px, 104 + (ph ? -bob : bob), 18, 26, 0, 0, Math.PI * 2)
      ctx2.fill()
      ctx2.fillStyle = '#fff'
      ctx2.beginPath()
      ctx2.arc(px - 6, 96, 4, 0, Math.PI * 2)
      ctx2.arc(px + 6, 96, 4, 0, Math.PI * 2)
      ctx2.fill()
      ctx2.fillStyle = '#2b2140'
      ctx2.fillRect(px - 5, 108, 10, talk ? 6 : 2)
    }
    ctx2.fillStyle = 'rgba(255,255,255,0.08)'
    for (let yy = 0; yy < 160; yy += 4) ctx2.fillRect(0, yy, 256, 1)
  }
  const drawStatic = () => {
    const img = ctx2.getImageData(0, 0, 256, 160)
    const d = img.data
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 255
      d[i] = d[i + 1] = d[i + 2] = v
    }
    ctx2.putImageData(img, 0, 0)
    crack()
  }
  const tv = {
    screenPos: new Vector3(x + 0.6, y + 2.8, z),
    get broken() {
      return broken
    },
    // A loot hit near the screen breaks it.
    hit(strength, ctx) {
      if (broken || strength < 0.35) return false
      broken = true
      sparks = 1.2
      ctx.event('tv', tv.screenPos, 1)
      return true
    },
    reset() {
      broken = false
      on = true
    },
    update(dt, t, ctx) {
      acc += dt
      if (acc < 1 / 15) return
      acc = 0
      if (broken) {
        drawStatic()
        light.intensity = 30 + Math.random() * 60
        light.color.set('#cfe6ff')
        if (sparks > 0) {
          sparks -= 1 / 15
          if (Math.random() < 0.5) ctx.sparks?.(tv.screenPos, 6)
        }
      } else if (on) {
        drawShow(t)
        light.intensity = 40 + Math.sin(t * 3) * 10
        light.color.set('#ffb38a')
      }
      tex.needsUpdate = true
    },
  }
  return tv
}

// Brick fireplace with a flickering fire (additive flame sprites) and its own warm light.
function buildFireplace(g, live, m) {
  const x0 = 14
  const x1 = 24
  const z0 = 4.6
  const z1 = 7.6
  const brick = surface('fp-brick', paintTiles('#a8503b', '#9a4634', 6, '#d6c6b0'), { tile: 3, rough: 0.9, bump: 0.6 })
  boxMM(g, x0, 0, z0, x0 + 2.5, 9, z1, brick, { collide: true })
  boxMM(g, x1 - 2.5, 0, z0, x1, 9, z1, brick, { collide: true })
  boxMM(g, x0 + 2.5, 5.2, z0, x1 - 2.5, 9, z1, brick, { collide: true })
  boxMM(g, x0 - 0.6, 9, z0 - 0.2, x1 + 0.6, 9.6, z1 + 0.6, m.woodDark, { collide: true }) // mantel
  boxMM(g, x0 + 2.5, 0, z0, x1 - 2.5, 5.2, z0 + 0.4, solid('#1a1412', 1)) // back of the firebox
  boxMM(g, x0 - 1, 0, z1, x1 + 1, 0.3, z1 + 3, m.stone, { cast: false, collide: true }) // hearth
  solidMM(x0 + 2.5, 0, z0, x1 - 2.5, 5.2, z1 - 1.2) // keep things out of the fire
  for (const [x, rz] of [[17.6, 0.25], [20.4, -0.25]]) {
    const log = cyl(g, 0.5, 0.5, 4, solid('#5b3a22', 0.9), x, 0.6, 6.4, { seg: 10 })
    log.rotation.z = Math.PI / 2 + rz
    log.rotation.y = 1.2
  }
  // grate
  boxMM(g, x0 + 3, 0.2, 6.6, x1 - 3, 0.35, 7, m.black)
  // flames: crossed additive quads with a painted flame texture
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 128
  const ctx = c.getContext('2d')
  const grd = ctx.createRadialGradient(32, 96, 4, 32, 80, 60)
  grd.addColorStop(0, 'rgba(255,250,200,1)')
  grd.addColorStop(0.3, 'rgba(255,190,60,0.9)')
  grd.addColorStop(0.65, 'rgba(255,90,20,0.5)')
  grd.addColorStop(1, 'rgba(255,40,0,0)')
  ctx.fillStyle = grd
  ctx.beginPath()
  ctx.moveTo(32, 2)
  ctx.bezierCurveTo(58, 50, 62, 110, 32, 126)
  ctx.bezierCurveTo(2, 110, 6, 50, 32, 2)
  ctx.fill()
  const tex = new CanvasTexture(c)
  tex.colorSpace = SRGBColorSpace
  const mat = new MeshBasicMaterial({ map: tex, transparent: true, blending: AdditiveBlending, depthWrite: false, side: 2, toneMapped: false, color: new Color(1.6, 1.3, 1) })
  const flames = []
  for (let i = 0; i < 6; i++) {
    const f = new Mesh(new PlaneGeometry(1.6, 3.2), mat)
    f.position.set(16.8 + i * 0.9, 1.9, 6.5 + (i % 2) * 0.3)
    f.rotation.y = (i % 2 ? 0.5 : -0.5)
    live.add(f)
    flames.push(f)
  }
  const glow = new PointLight('#ff9a4a', 60, 40, 2)
  glow.position.set(19, 3, 9)
  glow.userData.farCull = true
  live.add(glow)
  return {
    pos: new Vector3(19, 2, 7),
    light: glow,
    update(dt, t) {
      flames.forEach((f, i) => {
        const k = 0.75 + Math.sin(t * (9 + i) + i * 2.1) * 0.15 + Math.sin(t * 23 + i) * 0.08
        f.scale.set(0.8 + Math.sin(t * 7 + i) * 0.1, k, 1)
        f.position.y = 1.4 + k * 1.6 * 0.5
      })
      glow.intensity = 55 + Math.sin(t * 11) * 8 + Math.sin(t * 27) * 6
    },
  }
}

// The x = 30 bookshelf wall; the section z 16..24 is a secret door (kinematic) opened by the red book.
function buildSecretShelf(g, live, m, switches) {
  const books = ['#b33a3a', '#3a6fd0', '#e0a63a', '#4f9a3a', '#7d4fb3', '#d8d0c0', '#2f4a3a', '#c4673f']
  const shelfUnit = (parent, z0, z1, x0, x1, seed) => {
    const rand = mulberry32(seed)
    // sides, then back and boards fitted between them (no piece shares a face with another)
    boxMM(parent, x0, 0, z0, x1, 14, z0 + 0.3, m.woodDark)
    boxMM(parent, x0, 0, z1 - 0.3, x1, 14, z1, m.woodDark)
    boxMM(parent, x1 - 0.2, 0, z0 + 0.3, x1, 14, z1 - 0.3, m.woodDark)
    for (const y of [0, 3.4, 6.8, 10.2, 13.6]) boxMM(parent, x0 + 0.02, y, z0 + 0.3, x1 - 0.2, y + 0.35, z1 - 0.3, m.woodMid)
    for (const y of [0.35, 3.75, 7.15, 10.55]) {
      let z = z0 + 0.4
      let prevDepth = 0
      while (z < z1 - 0.8) {
        const bw = 0.35 + rand() * 0.35
        const bh = 2 + rand() * 0.9
        const lean = rand() < 0.08
        // each book its own depth (fronts at different x), so neighbours never share a face plane; a
        // leaning book is also a touch thinner so it can't poke through the next one's spine
        let depth = 1.3 + rand() * 0.25 - (lean ? 0.1 : 0)
        if (Math.abs(depth - prevDepth) < 0.03) depth += 0.05 // never (almost) flush with the neighbour
        prevDepth = depth
        const back = x1 - 0.25
        const b = box(parent, depth, bh, lean ? bw * 0.9 : bw, solid(books[Math.floor(rand() * books.length)], 0.7), back - depth / 2, y + bh / 2, z + bw / 2)
        if (lean) b.rotation.x = 0.2
        z += bw + 0.05
      }
    }
  }
  // static units either side of the secret door
  shelfUnit(g, 6, 16, 27.2, 29.4, 5)
  shelfUnit(g, 24, 40.6, 27.2, 29.4, 6)
  solidMM(27.2, 0, 6, 29.4, 14, 16)
  solidMM(27.2, 0, 24, 29.4, 14, 40.6)
  // the secret door: a shelf unit on a kinematic body hinged at (30.6, z 16)
  const door = new Group()
  const inner = new Group()
  shelfUnit(inner, 0, 8, -3.4, -1.2, 7)
  boxMM(inner, -1.2, 0, 0, 0, 12, 8, m.woodMid)
  compact(inner) // ~58 shelves + books -> a few draw calls (the door swings as one piece)
  inner.position.set(0, 0, 0)
  door.add(inner)
  const hingeP = new Vector3(30.6, 0, 16)
  door.position.copy(hingeP)
  live.add(door)
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(hingeP.x, 0, hingeP.z))
  world.createCollider(RAPIER.ColliderDesc.cuboid(1.7, 6, 4).setTranslation(-1.7, 6, 4), body)
  // The red book (a switch) on the static unit beside the door.
  const book = new Group()
  box(book, 1.7, 2.6, 0.55, solid('#e8262b', 0.45), 0, 0, 0)
  box(book, 1.72, 0.25, 0.57, m.brass, 0, 0.8, 0)
  book.position.set(28.1, 7.15 + 1.4, 14.9)
  let angle = 0
  let target = 0
  const sw = makeSwitch(live, {
    id: 'redbook', name: 'Odd Red Book', x: 28.1, y: 8.5, z: 14.9, hx: 0.9, hy: 1.3, hz: 0.4, mesh: book,
    onUse: (ctx) => {
      if (target > 0) return
      book.rotation.z = 0.35
      target = 1.3
      ctx.event('secret', new Vector3(30, 6, 20), 1)
    },
  })
  switches.push(sw)
  const q = new Quaternion()
  const secret = {
    get open() {
      return target > 0
    },
    get amount() {
      return angle / 1.3
    },
    reset() {
      angle = target = 0
      book.rotation.z = 0
      door.rotation.y = 0
      body.setNextKinematicRotation({ x: 0, y: 0, z: 0, w: 1 })
    },
    update(dt) {
      if (Math.abs(angle - target) < 1e-3) return
      angle += Math.sign(target - angle) * Math.min(Math.abs(target - angle), dt * 0.9)
      door.rotation.y = angle
      q.setFromEuler(new Euler(0, angle, 0))
      body.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
    },
    forceOpen() {
      target = 1.3
      book.rotation.z = 0.35
    },
  }
  return secret
}

// The bird cage (living room corner): a ring of bars, a dome, and a hinged door that Grandpa locks.
function buildCage(g, live, m, movers) {
  const cx = -11
  const cz = 35
  const r = 3.6
  const h = 8
  cyl(g, r + 0.4, r + 0.6, 0.6, m.cage, cx, 0.3, cz, { seg: 28 })
  const bars = 26
  const doorA0 = -0.42 // the door gap (radians, facing +X)
  const doorA1 = 0.42
  for (let i = 0; i < bars; i++) {
    const a = (i / bars) * Math.PI * 2
    if (a < doorA1 || a > Math.PI * 2 + doorA0) continue
    cyl(g, 0.09, 0.09, h, m.cage, cx + Math.cos(a) * r, h / 2 + 0.6, cz + Math.sin(a) * r, { seg: 6 })
  }
  for (const y of [3, 6, h + 0.5]) {
    const ring = cyl(g, r + 0.05, r + 0.05, 0.18, m.cage, cx, y, cz, { seg: 28 })
    ring.material = m.cage
  }
  sphere(g, r, m.cage, cx, h + 0.6, cz, { sy: 0.45, seg: 16 })
  sphere(g, 0.5, m.cage, cx, h + 2.4, cz, { seg: 10 })
  box(g, 0.3, 0.3, r * 1.6, m.woodMid, cx, 4.2, cz) // perch
  // collider ring (segments) leaving the door gap
  const segs = 16
  const halfA = Math.PI / segs
  for (let i = 0; i < segs; i++) {
    const a = ((i + 0.5) / segs) * Math.PI * 2
    const wa = Math.atan2(Math.sin(a), Math.cos(a))
    if (Math.abs(wa) < doorA1 + halfA + 0.08) continue // leave the door gap (and the door) clear
    const q = qYaw(-a)
    world.createCollider(RAPIER.ColliderDesc.cuboid(0.15, h / 2 + 0.5, (Math.PI * r) / segs + 0.05).setTranslation(cx + Math.cos(a) * r, h / 2 + 0.6, cz + Math.sin(a) * r).setRotation(q))
  }
  solidMM(cx - r, h + 0.4, cz - r, cx + r, h + 1.4, cz + r) // roof
  // door: chord across the gap, hinged at the gap's -Z side
  const ax = cx + Math.cos(doorA0) * r
  const az = cz + Math.sin(doorA0) * r
  const bx = cx + Math.cos(doorA1) * r
  const bz = cz + Math.sin(doorA1) * r
  const w = Math.hypot(bx - ax, bz - az)
  const yaw0 = -Math.atan2(bz - az, bx - ax)
  const door = hingedPanel(live, {
    id: 'cage', kind: 'cage', name: 'Cage Door', hinge: { x: ax, y: h / 2 + 0.4, z: az }, w: w - 0.3, h: h - 1, th: 0.25, yaw0, limits: [0, 0.01], mass: 8, mat: m.cage, matName: 'metal',
    decorate: (d) => {
      for (let i = 1; i < 6; i++) box(d, 0.12, h, 0.3, m.cage, -w / 2 + (w / 6) * i, 0, 0)
    },
  })
  door.mesh.children[0].material = glass('#fff0c0', 0.06)
  movers.push(door)
  let locked = true
  const cage = {
    center: new Vector3(cx, 0.6, cz),
    dropSpot: { x: -3.4, z: 34, yaw: -Math.PI / 2 },
    door,
    get locked() {
      return locked
    },
    inside: (p) => Math.hypot(p.x - cx, p.z - cz) < r - 0.4 && p.y < h,
    lock() {
      locked = true
      door.close(true)
      door.setLimits(0, 0.01)
    },
    unlock() {
      locked = false
      door.setLimits(-0.05, 1.9)
    },
    reset() {
      cage.lock()
    },
  }
  return cage
}

// The safe in the study's corner: hollow box + heavy hinged door. The crown waits inside.
function buildSafe(g, live, m, movers) {
  const x0 = 47.4
  const x1 = 52.6
  const z0 = 31
  const z1 = 36.4
  const top = 6
  // sides full size; back, top and floor fitted between them (no shared outer faces)
  boxMM(g, x1 - 0.5, 0, z0 + 0.5, x1, top - 0.5, z1 - 0.5, m.safe, { collide: true })
  boxMM(g, x0, 0, z0, x1, top, z0 + 0.5, m.safe, { collide: true })
  boxMM(g, x0, 0, z1 - 0.5, x1, top, z1, m.safe, { collide: true })
  boxMM(g, x0, top - 0.5, z0 + 0.5, x1, top, z1 - 0.5, m.safe, { collide: true })
  boxMM(g, x0, 0, z0 + 0.5, x1 - 0.5, 0.8, z1 - 0.5, m.safe, { collide: true })
  boxMM(g, x0 + 0.3, 0.8, z0 + 0.5, x1 - 0.5, 0.9, z1 - 0.5, solid('#7a1f2b', 0.9), { cast: false }) // velvet
  const door = hingedPanel(live, {
    id: 'safe', kind: 'safe', name: 'Safe Door', hinge: { x: x0 - 0.3, y: top / 2, z: z0 }, w: z1 - z0, h: top - 0.1, th: 0.6, yaw0: -Math.PI / 2, limits: [-1.9, 0], mass: 40, mat: m.safe, matName: 'metal',
    decorate: (d) => {
      const dial = cyl(d, 0.9, 0.9, 0.3, m.chrome, 0.6, 0.6, -0.4, { seg: 20 })
      dial.rotation.x = Math.PI / 2
      for (let i = 0; i < 3; i++) box(d, 0.15, 1.4, 0.2, m.chrome, 0.6 + Math.cos(i * 2.1) * 0.7, 0.6 + Math.sin(i * 2.1) * 0.7, -0.5)
      box(d, 0.3, 2, 0.3, m.brass, -1.8, 0, -0.45)
    },
  })
  movers.push(door)
  return { door }
}

// --- The toaster launcher (kitchen back counter, top 5.4) ----------------------------------------------
// Climb: cookbooks 1.8 -> step stool 3.6 -> counter 5.4 -> butter 6.7 -> toaster top 8.0, then drop
// into a slot (rack 6.4). Push the lever (from inside the slot, or a crewmate does it): it ticks for
// `delay` s, then POP: whoever stands in a slot is launched up onto the high shelf (top 11.6) next to it,
// loot in a slot flies too. The ding carries: Grandpa comes to see about his toast.
export const TOASTER = { x0: -27.4, x1: -23.0, z0: -40.7, z1: -36.9, rack: 6.4, top: 8.0, delay: 2.2, cool: 1.2, launch: { vx: 4, vy: 18, carry: 1.6 } }
function buildToaster(g, live, m, switches, spot) {
  const T = 5.4
  const { x0, x1, z0, z1, rack, top } = TOASTER
  const bake = solid('#2b2622', 0.55)
  // climb helpers at the counter's west end: a stack of cookbooks + a step stool
  const books = ['#3f6fb0', '#c9473a', '#e0b84a']
  books.forEach((c, i) => box(g, 2.4 - i * 0.15, 0.6, 2.2 - i * 0.1, solid(c, 0.75), -31.6 + (i % 2) * 0.1, 0.3 + i * 0.6, -35.1))
  solidMM(-32.8, 0, -36.2, -30.4, 1.8, -34.0) // one collider for the stack
  boxMM(g, -32.9, 3.2, -38.9, -30.3, 3.6, -36.3, solid('#e9e1d2', 0.6), { collide: true }) // stool seat
  for (const [lx, lz] of [[-32.6, -38.6], [-30.6, -38.6], [-32.6, -36.6], [-30.6, -36.6]]) box(g, 0.3, 3.2, 0.3, solid('#d0c6b4', 0.6), lx, 1.6, lz)
  solidMM(-32.9, 0, -38.9, -30.3, 3.2, -36.3)
  // butter dish at the back of the counter (the step up onto the toaster; the front stays free to land on)
  boxMM(g, -29.8, T, -40.6, -27.6, T + 0.4, -38.4, m.porcelain, { collide: true })
  boxMM(g, -29.4, T + 0.4, -40.2, -28.0, T + 1.3, -38.8, solid('#ffe08a', 0.5), { collide: true })
  boxMM(g, -29.9, T + 0.35, -40.7, -27.5, T + 0.42, -38.3, m.porcelain, { cast: false })
  // the toaster shell (retro red enamel + chrome trim, baked, solid)
  const ch = m.chrome
  const shell = solid('#d9473b', 0.3, 0.05)
  boxMM(g, x0, T, z0, x1, rack, z1, shell, { collide: true }) // base under the racks
  boxMM(g, x0, rack, z0, x0 + 0.4, top, z1, shell, { collide: true }) // end walls
  boxMM(g, x1 - 0.4, rack, z0, x1, top, z1, shell, { collide: true })
  boxMM(g, x0 + 0.4, rack, z0, x1 - 0.4, top, z0 + 0.25, shell, { collide: true }) // long walls
  boxMM(g, x0 + 0.4, rack, z1 - 0.25, x1 - 0.4, top, z1, shell, { collide: true })
  boxMM(g, x0 + 0.4, rack, -38.95, x1 - 0.4, top, -38.65, shell, { collide: true }) // between the slots
  // chrome rims round the slot openings + a chrome stripe along the sides
  for (const [a, b] of [[z0 + 0.25, -38.95], [-38.65, z1 - 0.25]]) {
    boxMM(g, x0 + 0.3, top, a - 0.1, x1 - 0.3, top + 0.06, a, ch, { cast: false })
    boxMM(g, x0 + 0.3, top, b, x1 - 0.3, top + 0.06, b + 0.1, ch, { cast: false })
  }
  for (const zz of [z0 - 0.02, z1 + 0.02]) boxMM(g, x0, 7.0, Math.min(zz, zz + 0.01), x1, 7.25, Math.max(zz, zz + 0.01), ch, { cast: false })
  for (const [fx, fz] of [[x0 + 0.4, z0 + 0.4], [x1 - 0.4, z0 + 0.4], [x0 + 0.4, z1 - 0.4], [x1 - 0.4, z1 - 0.4]]) box(g, 0.5, 0.2, 0.5, bake, fx, T + 0.1, fz)
  boxMM(g, x0 - 0.02, rack - 0.5, z0 - 0.02, x1 + 0.02, rack - 0.3, z1 + 0.02, bake) // bakelite band
  // browning dial + lever slot on the east end face
  const dial = cyl(g, 0.35, 0.35, 0.2, bake, x1 + 0.1, rack - 0.1, -37.8, { seg: 14 })
  dial.rotation.z = Math.PI / 2
  boxMM(g, x1, 6.1, -39.0, x1 + 0.05, top - 0.1, -38.6, bake)
  // high shelf over the counter's east end (the launch lands you here)
  boxMM(g, -22.4, 11.2, -40.8, -18.6, 11.6, -37.4, m.wood, { collide: true })
  for (const bx of [-21.8, -19.2]) boxMM(g, bx - 0.15, 9.6, -40.8, bx + 0.15, 11.2, -40.2, m.brass)
  spot('kitchen', -21.4, 11.6, -39.4)
  spot('kitchen', -19.6, 11.6, -38.2)

  // live: heating coils (glow when armed), racks (jump on the pop), the lever
  const slots = [[z0 + 0.25, -38.95], [-38.65, z1 - 0.25]]
  const coilMat = new MeshStandardMaterial({ color: '#3a2a22', emissive: '#ff5a1f', emissiveIntensity: 0.12, roughness: 0.6 })
  const racks = new Group()
  for (const [a, b] of slots) {
    for (const zc of [a + 0.03, b - 0.03]) boxMM(live, x0 + 0.5, rack + 0.2, zc - 0.02, x1 - 0.5, top - 0.3, zc + 0.02, coilMat, { cast: false })
    for (let x = x0 + 0.7; x < x1 - 0.5; x += 0.6) box(racks, 0.12, 0.1, b - a - 0.1, ch, x, rack + 0.05, (a + b) / 2, { cast: false })
  }
  compact(racks)
  live.add(racks)
  const lever = new Group()
  box(lever, 0.6, 0.12, 0.5, ch, -0.3, 0, 0) // stem through the slot
  box(lever, 0.7, 0.5, 1.6, bake, 0.3, 0, 0, { round: 0.15 }) // the big knob
  live.add(lever)
  const leverX = x1 + 0.1
  const leverZ = -38.8
  const upY = top + 0.1
  const downY = 6.5
  lever.position.set(leverX, upY, leverZ)

  const pos = new Vector3((x0 + x1) / 2, top, (z0 + z1) / 2)
  const t = {
    pos,
    armed: false,
    popAt: 0,
    auth: false,
    coolUntil: 0,
    rackT: 0,
    leverY: upY,
    // feet inside a slot (standing on a rack, or dropping into one)
    contains(p) {
      if (p.x < x0 + 0.2 || p.x > x1 - 0.2 || p.y < rack - 0.4 || p.y > top + 0.3) return false
      return slots.some(([a, b]) => p.z > a - 0.25 && p.z < b + 0.25)
    },
    arm(time, auth) {
      t.armed = true
      t.auth = auth
      t.popAt = time + TOASTER.delay
    },
    pop(time) {
      t.armed = false
      t.popAt = 0
      t.rackT = 0.5
      t.coolUntil = time + TOASTER.cool
    },
    update(dt, ctx) {
      const target = t.armed ? downY : upY
      t.leverY += (target - t.leverY) * Math.min(1, dt * (t.armed ? 14 : 22))
      lever.position.y = t.leverY
      sw.collider.setTranslation({ x: leverX + 0.3, y: t.leverY, z: leverZ })
      coilMat.emissiveIntensity = t.armed ? 1.6 + Math.sin(ctx.time * 9) * 0.35 : Math.max(0.12, coilMat.emissiveIntensity - dt * 1.2)
      if (t.rackT > 0) {
        t.rackT = Math.max(0, t.rackT - dt)
        const k = t.rackT / 0.5
        racks.position.y = Math.sin(k * Math.PI) * 1.4
      } else racks.position.y = 0
      // the host pops it; the crew pops on the host's event (or on its own if that never comes)
      if (t.armed && t.popAt && ctx.time >= t.popAt + (t.auth ? 0 : 1.5)) {
        t.popAt = 0
        ctx.event('toasterPop', pos, 1)
      }
    },
    reset() {
      t.armed = false
      t.popAt = 0
      t.coolUntil = 0
      t.rackT = 0
      t.leverY = upY
      lever.position.y = upY
      racks.position.y = 0
      coilMat.emissiveIntensity = 0.12
    },
  }
  const sw = makeSwitch(live, {
    id: 'toaster', name: 'Toaster Lever', x: leverX + 0.3, y: upY, z: leverZ, hx: 0.45, hy: 0.35, hz: 0.85, mesh: new Group(),
    onUse: (ctx) => {
      if (t.armed || ctx.time < t.coolUntil) return
      ctx.event('toasterArm', sw.pos, 1)
    },
  })
  sw.action = 'Push down'
  t.switch = sw
  switches.push(sw)
  return t
}

// --- The bedroom ceiling fan -------------------------------------------------------------------------
// Pull the cord (a switch) to turn it on: the blades spin up. Grab a spinning blade to hang on and ride it
// round (the game drives the thief along the blade), let go to be flung off at the blade's speed.
export const FAN = { y: 12.6, radius: 5.8, inner: 1.0, maxSpin: 2.5, spinUp: 0.9, spinDown: 0.5, minRide: 0.6, hang: 2.5, cordY: 7.4, fling: { speed: 1.35, up: 6.5, carry: 2 }, catchUp: 5, maxCatch: 2, snapErr: 1.2, netLead: 0.05 }
function buildCeilingFan(g, live, m, switches, cx, cz) {
  const Y = FAN.y
  cyl(g, 0.9, 0.9, 0.2, m.brass, cx, H - 0.1, cz, { seg: 18, cast: false }) // canopy
  cyl(g, 0.14, 0.14, H - Y - 1, m.brass, cx, (H + Y + 1) / 2, cz, { seg: 8, cast: false }) // downrod
  cyl(g, 1.05, 1.25, 0.8, m.brass, cx, Y + 0.6, cz, { seg: 20 }) // motor housing
  sphere(g, 0.95, m.shade, cx, Y - 0.35, cz, { sy: 0.6, seg: 16 }) // the light bowl
  // rotor: brass irons + wooden blades (live, turned every tick)
  const rotor = new Group()
  rotor.position.set(cx, Y, cz)
  const bladeLen = FAN.radius - FAN.inner
  const rMid = FAN.inner + bladeLen / 2
  for (let k = 0; k < 4; k++) {
    const arm = new Group()
    arm.rotation.y = (k * Math.PI) / 2
    box(arm, 1.4, 0.12, 0.3, m.brass, 0.9, 0.05, 0)
    const blade = box(arm, bladeLen, 0.12, 1.5, m.wood, rMid, 0, 0, { round: 0.05 })
    blade.rotation.x = 0.14
    rotor.add(arm)
  }
  cyl(rotor, 1.1, 1.1, 0.3, m.brass, 0, 0.05, 0, { seg: 20 })
  live.add(rotor)
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(cx, Y, cz))
  const ride = { kind: 'ride', id: 'fan', name: 'Fan Blade', action: 'Hang on', grabbable: true, mesh: rotor }
  for (let k = 0; k < 4; k++) {
    const q = qYaw((k * Math.PI) / 2)
    const off = new Vector3(rMid, 0, 0).applyQuaternion(q)
    const c = world.createCollider(RAPIER.ColliderDesc.cuboid(bladeLen / 2, 0.18, 0.75).setTranslation(off.x, 0, off.z).setRotation(q), body)
    c.setCollisionGroups(MOVER_GROUPS)
    setOwner(c, ride)
  }
  // the pull cord (hangs from the light bowl, out of the blades' way)
  const cord = new Group()
  cyl(cord, 0.05, 0.05, Y - 0.9 - FAN.cordY, m.black, 0, (Y - 0.9 - FAN.cordY) / 2, 0, { seg: 5, cast: false })
  sphere(cord, 0.32, m.brass, 0, -0.2, 0, { sy: 1.3, seg: 10 })
  cord.position.set(cx + 0.5, FAN.cordY, cz)

  const f = {
    on: false,
    spin: 0,
    angle: 0,
    pullT: 0,
    corr: 0, // (crew) angle still to catch up toward the host's blades, eased in on the tick
    center: new Vector3(cx, Y, cz),
    ride,
    rideLocal: null, // { lx, lz } the grab point in the rotor's frame
    spinning: () => f.spin >= FAN.minRide,
    setOn(on) {
      f.on = !!on
      f.pullT = 0.35
    },
    // Grab point -> rider anchor on that blade (slid out toward the tip: a faster ride, a bigger fling).
    attach(p) {
      const dx = p.x - cx
      const dz = p.z - cz
      const c = Math.cos(f.angle)
      const s = Math.sin(f.angle)
      let lx = dx * c - dz * s
      let lz = dx * s + dz * c
      const r = Math.hypot(lx, lz) || 1
      const want = Math.min(FAN.radius - 0.5, Math.max(4.2, r))
      lx *= want / r
      lz *= want / r
      f.rideLocal = { lx, lz }
    },
    detach() {
      f.rideLocal = null
    },
    // (crew) the host's blades: on / spin taken as is, the angle eased in; a big miss (joining late, a
    // long hitch) snaps, except under a local rider (a snap would teleport them metres).
    sync(angle, spin, on) {
      f.on = !!on
      f.spin = spin
      const err = Math.atan2(Math.sin(angle - f.angle), Math.cos(angle - f.angle))
      if (Math.abs(err) > FAN.snapErr && !f.rideLocal) {
        f.angle = angle
        f.corr = 0
        body.setNextKinematicRotation(qYaw(f.angle))
      } else f.corr = err
    },
    // world point under the blade where the hands are
    anchor(out) {
      const { lx, lz } = f.rideLocal ?? { lx: FAN.radius - 1, lz: 0 }
      const c = Math.cos(f.angle)
      const s = Math.sin(f.angle)
      return out.set(cx + lx * c + lz * s, Y - 0.15, cz - lx * s + lz * c)
    },
    // the anchor's velocity (m/s)
    velocity(out) {
      f.anchor(out)
      const dx = out.x - cx
      const dz = out.z - cz
      return out.set(f.spin * dz, 0, -f.spin * dx)
    },
    update(dt) {
      rotor.rotation.y = f.angle
      if (f.pullT > 0) f.pullT = Math.max(0, f.pullT - dt)
      cord.position.y = FAN.cordY - Math.sin((f.pullT / 0.35) * Math.PI) * 0.6
    },
    reset() {
      f.on = false
      f.spin = 0
      f.angle = 0
      f.corr = 0
      f.rideLocal = null
      rotor.rotation.y = 0
      body.setNextKinematicRotation(qYaw(0))
    },
  }
  // spin on the physics tick, so a rider (driven on the same tick) moves with the blade
  onTick((dt) => {
    const target = f.on ? FAN.maxSpin : 0
    f.spin = f.spin < target ? Math.min(target, f.spin + FAN.spinUp * dt) : Math.max(target, f.spin - FAN.spinDown * dt)
    let step = f.spin * dt
    if (f.corr) {
      // eased, and never faster than maxCatch rad/s on top of the spin (a rider swings, never jumps)
      const c = Math.max(-FAN.maxCatch * dt, Math.min(FAN.maxCatch * dt, f.corr * Math.min(1, dt * FAN.catchUp)))
      f.corr = Math.abs(f.corr - c) < 1e-4 ? 0 : f.corr - c
      step += c
    }
    if (!step) return
    f.angle = (f.angle + step) % (Math.PI * 2)
    body.setNextKinematicRotation(qYaw(f.angle))
  })
  const sw = makeSwitch(live, {
    id: 'fanCord', name: 'Fan Pull Cord', x: cx + 0.5, y: FAN.cordY - 0.2, z: cz, hx: 0.45, hy: 0.6, hz: 0.45, mesh: cord,
    onUse: (ctx) => ctx.event('fan', sw.pos, 1, { on: !f.on }),
  })
  sw.action = 'Pull'
  f.switch = sw
  switches.push(sw)
  return f
}

// --- Grandpa's telephone (hallway side table) ----------------------------------------------------------
// Dial it (a switch): `dial` s later it rings (loud). Grandpa hurries over, answers and chats for ages
// facing the wall (he barely watches the room), then hangs up. It rings `ring` s, or `ringComing` s once
// he's on his way; nobody answers by then: it stops.
// States run on the host's timers; every client mirrors them through the 'phone' house event.
export const PHONE = { dial: 2.5, ring: 12, ringComing: 35, answerMax: 22, cool: 25, stand: { x: 38.4, z: -4.6 } }
function buildPhone(live, m, switches, x, y, z) {
  const red = solid('#b8322c', 0.35)
  const black = m.black
  const ph = new Group()
  box(ph, 2.4, 0.8, 1.8, red, 0, 0.4, 0, { round: 0.25 }) // base
  box(ph, 1.9, 0.45, 1.1, red, 0, 1.0, -0.2, { round: 0.2 }) // upper body
  const dial = new Group()
  cyl(dial, 0.36, 0.36, 0.08, solid('#f4efe4', 0.4), 0, 0, 0, { seg: 18 })
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 1.6 + 0.6
    cyl(dial, 0.05, 0.05, 0.1, black, Math.cos(a) * 0.24, 0.02, Math.sin(a) * 0.24, { seg: 6 })
  }
  compact(dial)
  dial.rotation.x = Math.PI / 2
  dial.position.set(0, 0.42, 0.95)
  ph.add(dial)
  for (const cx of [-0.75, 0.75]) box(ph, 0.25, 0.35, 0.3, black, cx, 1.35, -0.2) // cradle prongs
  const handset = new Group()
  box(handset, 2.4, 0.28, 0.42, black, 0, 0.18, 0, { round: 0.12 })
  for (const hx of [-1.05, 1.05]) box(handset, 0.6, 0.36, 0.62, black, hx, 0, 0, { round: 0.15 })
  compact(handset)
  handset.position.set(0, 1.62, -0.2)
  ph.add(handset)
  compact(ph) // the body pieces (the dial and handset groups move on their own and stay separate)
  ph.position.set(x, y, z)

  const pos = new Vector3(x, y + 1, z)
  const p = {
    pos,
    state: 'idle', // idle | dialing | ringing | answered
    coolUntil: 0,
    pending: null, // (host) { at, s } the next state
    t: 0,
    // s: dial | ring | answer | hangup | stop. `auth` = this client runs the timers.
    set(s, time, auth) {
      p.t = 0
      if (s === 'dial') {
        p.state = 'dialing'
        p.pending = auth ? { at: time + PHONE.dial, s: 'ring' } : null
      } else if (s === 'ring') {
        p.state = 'ringing'
        p.pending = auth ? { at: time + PHONE.ring, s: 'stop' } : null
      } else if (s === 'answer') {
        p.state = 'answered'
        handset.visible = false
        p.pending = auth ? { at: time + PHONE.answerMax, s: 'hangup' } : null // he got called away: hang up anyway
      } else {
        p.state = 'idle'
        handset.visible = true
        p.coolUntil = time + PHONE.cool
        p.pending = null
      }
    },
    update(dt, ctx) {
      p.t += dt
      dial.rotation.y = p.state === 'dialing' ? Math.sin(p.t * 5) * 1.2 : 0
      // ringing: the handset rattles on its cradle in bursts
      const burst = p.state === 'ringing' && p.t % 2.4 < 1.4
      handset.position.y = 1.62 + (burst ? Math.abs(Math.sin(p.t * 55)) * 0.12 : 0)
      handset.rotation.z = burst ? Math.sin(p.t * 47) * 0.05 : 0
      if (p.pending && ctx.time >= p.pending.at) {
        const s = p.pending.s
        p.pending = null
        ctx.event('phone', pos, 1, { s })
      }
    },
    reset() {
      p.state = 'idle'
      p.pending = null
      p.coolUntil = 0
      handset.visible = true
      handset.position.y = 1.62
      handset.rotation.z = 0
      dial.rotation.y = 0
    },
  }
  const sw = makeSwitch(live, {
    id: 'phone', name: 'Telephone', x, y: y + 0.85, z: z - 0.1, hx: 1.25, hy: 0.85, hz: 1.0, mesh: ph,
    onUse: (ctx) => {
      if (p.state !== 'idle' || ctx.time < p.coolUntil) return
      ctx.event('phone', pos, 1, { s: 'dial' })
    },
  })
  Object.defineProperty(sw, 'action', { get: () => (p.state === 'idle' ? 'Dial' : p.state === 'answered' ? 'Busy' : 'Ringing...') })
  p.switch = sw
  switches.push(sw)
  return p
}

// --- Details: the lived-in layer -----------------------------------------------------------------------
// Every piece sits in checked free space; a piece on a surface or a wall only touches it back-to-face
// (never two same-facing faces in one plane: no Z-fighting). Small things are visual only; the big ones
// (tyres, the oil drum, baskets, the chess table, the coat stand) are solid.
function buildDetails(g, m) {
  const cream = solid('#f4efe4', 0.5)
  const ink = solid('#2a2420', 0.5)
  // a round wall clock facing `face` (+-1 along z) on the wall plane `wallZ`
  const wallClock = (x, y, wallZ, face, r = 1.3, rim = m.woodDark) => {
    const c = new Group()
    cyl(c, r, r, 0.25, rim, 0, 0, 0, { seg: 24 })
    cyl(c, r - 0.2, r - 0.2, 0.05, cream, 0, 0.15, 0, { seg: 24 })
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2
      box(c, 0.08, 0.04, 0.22, ink, Math.sin(a) * (r - 0.4), 0.19, Math.cos(a) * (r - 0.4))
    }
    box(c, 0.1, 0.05, r * 0.5, ink, 0, 0.22, -r * 0.2) // hour hand
    const mh = box(c, 0.07, 0.05, r * 0.75, ink, r * 0.2, 0.24, 0) // minute hand
    mh.rotation.y = 1.9
    c.rotation.x = (face * Math.PI) / 2 // disc axis along z, face outward
    c.position.set(x, y, wallZ + face * 0.125)
    g.add(c)
  }
  // a framed picture flat on a z wall (canvas painted landscape / portrait)
  const framed = (x, y, wallZ, face, w, h, seed) => {
    boxMM(g, x - w / 2, y - h / 2, Math.min(wallZ, wallZ + face * 0.16), x + w / 2, y + h / 2, Math.max(wallZ, wallZ + face * 0.16), m.woodDark)
    const art = canvasSign(w - 0.5, h - 0.5, 160, Math.round((160 * h) / w), (c, cw, ch) => {
      const rr = mulberry32(seed)
      const sky = c.createLinearGradient(0, 0, 0, ch)
      sky.addColorStop(0, ['#8fc8ff', '#ffcf8a', '#c9b6ff'][seed % 3])
      sky.addColorStop(1, '#fff6e0')
      c.fillStyle = sky
      c.fillRect(0, 0, cw, ch)
      for (let i = 0; i < 3; i++) {
        c.fillStyle = ['#4f9a3a', '#3f7f6a', '#6aa84f'][i]
        c.beginPath()
        c.moveTo(0, ch)
        for (let xx = 0; xx <= cw; xx += 8) c.lineTo(xx, ch * (0.55 + i * 0.12) + Math.sin(xx * 0.03 + rr() * 6 + i) * ch * 0.08)
        c.lineTo(cw, ch)
        c.fill()
      }
      c.fillStyle = '#fff3b0'
      c.beginPath()
      c.arc(cw * (0.2 + rr() * 0.6), ch * 0.25, ch * 0.08, 0, Math.PI * 2)
      c.fill()
    })
    art.mesh.position.set(x, y, wallZ + face * 0.19) // 3 cm proud of the frame's face
    if (face < 0) art.mesh.rotation.y = Math.PI
    g.add(art.mesh)
  }
  // curtains either side of a window on a z wall + a valance (all 5+ cm off the frame)
  const curtains = (a, b, y0, y1, wallFace, face, colour, { left = true, right = true } = {}) => {
    const z0 = wallFace + face * 0.5
    const z1 = wallFace + face * 0.65
    const lo = Math.min(z0, z1)
    const hi = Math.max(z0, z1)
    const cloth = solid(colour, 0.95)
    if (left) boxMM(g, a - 1.75, y0, lo, a - 0.7, y1, hi, cloth, { cast: false })
    if (right) boxMM(g, b + 0.7, y0, lo, b + 1.75, y1, hi, cloth, { cast: false })
    boxMM(g, a - 1.9, y1, lo - 0.05, b + 1.9, y1 + 0.6, hi + 0.05, cloth, { cast: false })
  }
  // flat rug (1 cm above the floor plane at 0.02)
  const rug = (x0, z0, x1, z1, colour) => boxMM(g, x0, 0.03, z0, x1, 0.08, z1, solid(colour, 1), { cast: false, collide: true })

  // --- Kitchen ---
  wallClock(-42, 11, -10.6, -1, 1.3, m.brass)
  // spice rack over the sink corner, under the upper cabinets (clear of the tap)
  boxMM(g, -52.6, 8.45, -21.5, -51.9, 8.65, -15.5, m.wood)
  ;['#c0392b', '#e0a63a', '#4f9a3a', '#8b5a35', '#f2efe8'].forEach((c, i) => {
    cyl(g, 0.24, 0.24, 0.6, glass('#e9f6ff', 0.35), -52.25, 8.95, -20.8 + i * 1.3, { seg: 10 })
    cyl(g, 0.2, 0.2, 0.42, solid(c, 0.8), -52.25, 8.88, -20.8 + i * 1.3, { seg: 10 })
    cyl(g, 0.26, 0.26, 0.12, m.black, -52.25, 9.31, -20.8 + i * 1.3, { seg: 10 })
  })
  curtains(-30, -22, 6, 12.6, -40.8, 1, '#ffd9a0', { right: false }) // right side: the toaster shelf
  rug(-48.2, -20.5, -44.4, -13.8, '#c7d9e8') // at the sink
  // calendar on the x = -18 wall
  boxMM(g, -18.72, 6.8, -17.2, -18.6, 9.6, -15.2, cream) // kitchen side of the wall: x < -18.6
  boxMM(g, -18.76, 8.2, -16.9, -18.72, 9.3, -15.5, solid('#c0392b', 0.7))
  // cereal box + biscuit jar on top of the fridge
  box(g, 1.3, 2, 0.6, solid('#f0b93a', 0.6), -50.5, 14, -36.2)
  box(g, 1.2, 0.5, 0.56, solid('#c0392b', 0.6), -50.5, 14.4, -35.88)
  cyl(g, 0.6, 0.6, 1.3, glass('#e9f6ff', 0.35), -48.3, 13.65, -37.2, { seg: 14 })

  // --- Bathroom ---
  framed(2.5, 9.5, -10.6, -1, 4, 3, 11) // clear of the doorway (x -9.5..-2.5)
  box(g, 1.6, 0.22, 1.6, solid('#e9edf2', 0.4), -3.5, 0.14, -34, { round: 0.1 }) // bathroom scale
  box(g, 0.9, 0.04, 0.5, ink, -3.5, 0.27, -33.6) // its little display
  cyl(g, 0.3, 0.26, 0.8, solid('#9fd8d0', 0.3), -16.3, 5.4, -18.4, { seg: 10 }) // toothbrush cup
  box(g, 0.08, 1, 0.08, solid('#ff9aa2', 0.4), -16.25, 6, -18.45)
  box(g, 0.08, 0.9, 0.08, solid('#7fb3d5', 0.4), -16.38, 5.95, -18.32)
  boxMM(g, 5.25, 3.3, -35.6, 5.4, 3.55, -34.4, m.chrome) // toilet-roll holder (x = 6 wall)
  cyl(g, 0.55, 0.55, 1.1, m.white, 4.75, 3.15, -35, { seg: 14 }).rotation.x = Math.PI / 2

  // --- Bedroom ---
  framed(28, 10.3, -40.8, 1, 3.2, 2.6, 3)
  framed(33, 10.3, -40.8, 1, 3.2, 2.6, 8)
  curtains(12, 20, 4.6, 13, -40.8, 1, '#9d8ac9')
  wallClock(15, 11.5, -10.6, -1)
  // coat stand in the corner by the door (solid pole), a hat and a scarf on it
  cyl(g, 1.1, 1.3, 0.4, m.woodDark, 50.5, 0.2, -13.6, { seg: 16, collide: true })
  cyl(g, 0.22, 0.22, 11, m.woodDark, 50.5, 5.7, -13.6, { seg: 10, collide: true })
  for (let i = 0; i < 4; i++) {
    const a = i * (Math.PI / 2) + 0.4
    const hook = box(g, 0.16, 0.16, 1.2, m.brass, 50.5 + Math.sin(a) * 0.55, 10.6, -13.6 + Math.cos(a) * 0.55)
    hook.rotation.y = a
  }
  cyl(g, 0.75, 0.9, 0.7, solid('#3a3f4a', 0.8), 50.5, 11.6, -13.6, { seg: 16 }) // hat
  cyl(g, 1.4, 1.4, 0.1, solid('#3a3f4a', 0.8), 50.5, 11.2, -13.6, { seg: 18 }) // its brim
  box(g, 0.5, 3.2, 1.6, solid('#c0392b', 0.95), 51.1, 8.6, -13.6) // scarf
  // laundry basket by the wardrobe
  cyl(g, 1.2, 1.0, 2, solid('#d7c39b', 0.95), 45.2, 1, -38.8, { seg: 14, collide: true })
  box(g, 1.6, 0.5, 1.4, solid('#9fd8d0', 0.95), 45.2, 2.1, -38.8, { round: 0.2 }) // a towel poking out

  // --- Hallway ---
  // shoes by the front door
  for (const [x, z, c] of [[51.2, 1.9, '#5b3a22'], [52.1, 2.1, '#5b3a22'], [49.8, 2.2, '#2f4a6a'], [50.6, 2.4, '#2f4a6a']]) {
    box(g, 0.7, 0.45, 1.5, solid(c, 0.6), x, 0.25, z, { round: 0.18 })
    box(g, 0.66, 0.4, 0.6, solid(c, 0.6), x, 0.62, z - 0.4, { round: 0.15 })
  }
  // a mirror and a key board
  boxMM(g, 28.4, 6, 3.24, 31.6, 11, 3.4, m.woodDark)
  boxMM(g, 28.8, 6.4, 3.18, 31.2, 10.6, 3.24, metal('#eaf3f8', 0.05))
  boxMM(g, 46.4, 6.5, -9.4, 49.2, 7.7, -9.26, m.wood)
  for (const [x, c] of [[46.9, '#d8b15a'], [47.8, '#c0c6cc'], [48.7, '#d8b15a']]) {
    box(g, 0.1, 0.1, 0.35, m.brass, x, 7.1, -9.1)
    box(g, 0.3, 0.6, 0.06, metal(c, 0.3), x, 6.65, -8.98)
  }

  // --- Living room ---
  curtains(-2, 12, 4.2, 14, 40.8, -1, '#c0392b')
  framed(19, 12.4, 4.6, 1, 6, 3.4, 5) // over the mantel
  // throw pillows on the sofa (sitting on the seat cushions against the backrest)
  for (const [z, c] of [[16.2, '#e0a63a'], [27.8, '#7d4fb3']]) {
    const p = box(g, 0.5, 1.5, 1.6, solid(c, 0.95), 4.35, 4.45, z, { round: 0.22 })
    p.rotation.z = 0.18
  }
  // knitting basket by the armchair + yarn balls and needles
  cyl(g, 1.0, 0.85, 1.2, solid('#b88a55', 0.95), 25.2, 0.6, 31, { seg: 14, collide: true })
  for (const [dx, dz, c] of [[-0.3, -0.2, '#d8342f'], [0.35, 0.1, '#5f7fa8'], [-0.05, 0.4, '#f0d58a']]) sphere(g, 0.42, solid(c, 0.95), 25.2 + dx, 1.35, 31 + dz, { seg: 10 })
  for (const s of [-1, 1]) {
    const n = cyl(g, 0.04, 0.04, 1.6, m.brass, 25.2 + s * 0.15, 1.9, 30.8, { seg: 5 })
    n.rotation.z = s * 0.35
  }
  // newspapers stacked by the armchair
  for (let i = 0; i < 4; i++) {
    const p = box(g, 1.6, 0.14, 2.2, solid(i % 2 ? '#e9e4d8' : '#dcd6c6', 0.9), 15, 0.1 + i * 0.15, 33.5)
    p.rotation.y = (i - 1.5) * 0.12
  }

  // --- Garage ---
  // a stack of tyres
  for (let i = 0; i < 3; i++) cyl(g, 1.4, 1.4, 0.9, m.tire, -27.5, 0.45 + i * 0.92, 7.6, { seg: 18 })
  solidMM(-28.9, 0, 6.2, -26.1, 2.75, 9)
  for (let i = 0; i < 3; i++) cyl(g, 0.7, 0.7, 0.94, metal('#9aa1ab', 0.35), -27.5, 0.45 + i * 0.92, 7.6, { seg: 12 }) // hub
  // a hose reel and a dartboard on the x = -18 wall
  const reel = cyl(g, 1.2, 1.2, 0.7, solid('#2f8f4a', 0.5), -18.95, 4, 12, { seg: 18 })
  reel.rotation.z = Math.PI / 2
  const hose = cyl(g, 1.0, 1.0, 0.78, solid('#4fbf6a', 0.6), -18.95, 4, 12, { seg: 18 })
  hose.rotation.z = Math.PI / 2
  const board = cyl(g, 1.2, 1.2, 0.2, solid('#1f1f23', 0.7), -18.7, 8, 30, { seg: 24 })
  board.rotation.z = Math.PI / 2
  for (const [r, c] of [[0.9, '#d8342f'], [0.6, '#f4efe4'], [0.3, '#2f8f4a'], [0.1, '#d8342f']]) {
    const ring = cyl(g, r, r, 0.04, solid(c, 0.7), -18.79 - (1.2 - r) * 0.05, 8, 30, { seg: 24 }) // each ring 1.5 cm proud of the last
    ring.rotation.z = Math.PI / 2
  }
  // an oil drum in the corner
  cyl(g, 1.1, 1.1, 3.2, solid('#2f5f9a', 0.45, 0.4), -51.5, 1.6, 38.5, { seg: 18, collide: true })
  cyl(g, 1.12, 1.12, 0.15, solid('#24497a', 0.45, 0.4), -51.5, 1.0, 38.5, { seg: 18 })
  cyl(g, 1.12, 1.12, 0.15, solid('#24497a', 0.45, 0.4), -51.5, 2.2, 38.5, { seg: 18 })
  rug(-37, 8.2, -33, 12.2, '#5a5f66') // an old mat inside the hall door

  // --- Study ---
  framed(42, 10.5, 4.6, 1, 7, 4.5, 17) // a big landscape over the desk
  // chess table (solid) with a checkerboard
  cyl(g, 0.3, 0.45, 3, m.woodDark, 37, 1.5, 18, { seg: 10, collide: true })
  boxMM(g, 35.6, 3, 16.6, 38.4, 3.3, 19.4, m.woodDark, { collide: true })
  climbStep(g, 35.9, 14.2, 38.1, 16.4, 1.65, 'pouf') // a pouf 1.65 -> the chess table 3.3
  const chess = canvasSign(2.4, 2.4, 128, 128, (c, w, h) => {
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      c.fillStyle = (i + j) % 2 ? '#2a2420' : '#efe6cf'
      c.fillRect((i * w) / 8, (j * h) / 8, w / 8 + 1, h / 8 + 1)
    }
  })
  chess.mesh.rotation.x = -Math.PI / 2
  chess.mesh.position.set(37, 3.33, 18) // 3 cm above the table top
  g.add(chess.mesh)
  for (const [dx, dz, c, hgt] of [[-0.75, -0.75, '#efe6cf', 0.6], [0.45, -0.45, '#efe6cf', 0.8], [-0.15, 0.75, '#2a2420', 0.6], [0.75, 0.45, '#2a2420', 0.9]]) {
    cyl(g, 0.12, 0.16, hgt, solid(c, 0.4), 37 + dx, 3.33 + hgt / 2, 18 + dz, { seg: 8 })
    sphere(g, 0.14, solid(c, 0.4), 37 + dx, 3.4 + hgt, 18 + dz, { seg: 8 })
  }
  wallClock(34, 11, 40.8, -1, 1.5, m.brass)
}

// --- Light switches ------------------------------------------------------------------------------------
// One per room on the wall beside its door (latch side), plate sunk 0.05 into the wall (no shared face).
// `face` = which way the plate faces (+-z), `stand` = where Grandpa stops to flick it back on.
export const LIGHT_SWITCHES = [
  { room: 'kitchen', x: -25, wall: -10.6, face: -1, stand: { x: -25, z: -13.6 } },
  { room: 'bathroom', x: -11, wall: -10.6, face: -1, stand: { x: -11, z: -13.6 } },
  { room: 'bedroom', x: 29, wall: -10.6, face: -1, stand: { x: 29, z: -13.6 } },
  { room: 'hallway', x: 43, wall: -9.4, face: 1, stand: { x: 43, z: -6.2 } },
  { room: 'garage', x: -40.5, wall: 4.6, face: 1, stand: { x: -40.5, z: 8 } },
  { room: 'living', x: 8.5, wall: 4.6, face: 1, stand: { x: 8.5, z: 7.8 } },
]
const SWITCH_Y = 6.5
function buildLightSwitches(live, switches) {
  const plateMat = solid('#f3efe6', 0.45)
  const nubMat = solid('#e2dccf', 0.4)
  return LIGHT_SWITCHES.map((d) => {
    const z = d.wall + d.face * 0.04 // plate centre: its back 0.05 inside the wall
    const g = new Group()
    box(g, 1.1, 1.7, 0.18, plateMat, 0, 0, 0, { round: 0.06, cast: false })
    const nub = new Group()
    box(nub, 0.34, 0.6, 0.22, nubMat, 0, 0, 0.1, { round: 0.06, cast: false })
    nub.position.z = 0.09
    g.add(nub)
    g.position.set(d.x, SWITCH_Y, z)
    if (d.face < 0) g.rotation.y = Math.PI
    const ls = {
      room: d.room,
      stand: d.stand,
      on: true,
      setOn(on) {
        ls.on = !!on
        nub.rotation.x = ls.on ? -0.35 : 0.35 // up = on
      },
    }
    const sw = makeSwitch(live, {
      id: `lights-${d.room}`, name: 'Light Switch', x: d.x, y: SWITCH_Y, z: d.wall + d.face * 0.3, hx: 0.65, hy: 0.95, hz: 0.3, mesh: g,
      onUse: (ctx) => ctx.event('lights', sw.pos, 1, { room: d.room, on: !ls.on }),
    })
    Object.defineProperty(sw, 'action', { get: () => (ls.on ? 'Lights off' : 'Lights on') })
    ls.switch = sw
    ls.setOn(true)
    switches.push(sw)
    return ls
  })
}

export { unlit, roundRect }
