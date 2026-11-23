// Procedural gadget models: the held / HUD look of each gadget plus the pieces the
// gadgets spawn in the world (marbles, banana peel, foam rocket).
import {
  THREE, PI, TAU, G, mat, plastic, cloth, rubber, metal, chrome, gold, glass, glow, add, grp, around, finish, tube,
  extrude, polyShape, canvasTex, rr, txt, speckle, weave, wrapDraw, rng, cached, roundPolyline, remapLatheV,
} from './modelKit.js'
import { buildAlarmClock } from './loot.js'

export const GADGET_IDS = ['marbles', 'glue', 'banana', 'alarm', 'smoke', 'sleep', 'xray', 'energy', 'bazooka', 'extinguisher']
export const GADGET_SIZES = {
  marbles: [0.9, 0.8, 0.9], glue: [0.6, 1.2, 0.6], banana: [1.4, 0.5, 0.6], alarm: [0.8, 0.8, 0.5], smoke: [0.7, 0.8, 0.7],
  sleep: [0.6, 0.9, 0.6], xray: [1.1, 0.4, 0.5], energy: [0.45, 0.9, 0.45], bazooka: [0.6, 0.6, 2.4],
  extinguisher: [0.6, 1.25, 0.6],
}
export const MARBLE_COLORS = ['#ff4a5a', '#3b8cff', '#36d67a', '#ffd23a', '#a66bff', '#ff8c2a']
const yAxisToZ = [PI / 2, 0, 0]

const templates = new Map()
function cachedModel(key, make) {
  let t = templates.get(key)
  if (!t) templates.set(key, (t = make()))
  return t.clone()
}

export function makeGadget(id) {
  return cachedModel('gadget:' + id, () => {
    const root = new THREE.Group()
    const build = BUILDERS[id]
    if (build) build(root)
    else add(root, G.rbox(0.6, 0.6, 0.6, 0.1, 2), plastic('#8a8f99'))
    return finish(root, GADGET_SIZES[id] || [0.6, 0.6, 0.6], { name: 'gadget:' + id, userData: { kind: 'gadget', id } })
  })
}

// --- Marble ------------------------------------------------------------------------------
// Twisted "cat's eye" vane inside a unit-ish sphere (radius R).
function vaneGeo(R, twist) {
  return cached('marble-vane' + R + twist, () => {
    const g = new THREE.PlaneGeometry(2, 2, 3, 16)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const t = p.getX(i) / 2 + 0
      const s = p.getY(i) / 2
      const ss = s * 2
      const a = ss * twist
      const k = Math.sqrt(Math.max(0, 1 - ss * ss)) * R * 0.8
      p.setXYZ(i, t * 2 * k * Math.cos(a), ss * R, t * 2 * k * Math.sin(a))
    }
    g.computeVertexNormals()
    return g
  })
}
function buildMarble(g, i, lod = 0) {
  const c = MARBLE_COLORS[((i % 6) + 6) % 6]
  const tint = '#' + new THREE.Color(c).lerp(new THREE.Color('#ffffff'), 0.4).getHexString()
  add(g, vaneGeo(0.14, 2.4), mat(c, { roughness: 0.3, emissive: c, ei: 0.25, double: true }))
  if (!lod) add(g, vaneGeo(0.12, -2.0), mat('#ffffff', { roughness: 0.3, double: true }), [0, 0, 0], [0, PI / 2, 0])
  add(g, lod ? G.sph(0.175, 12, 8) : G.sph(0.175, 18, 12), glass(tint, 0.32, { noShadow: false }))
  if (!lod) add(g, G.sph(0.178, 6, 4, 0.4, 0.7, 0.35, 0.45), mat('#ffffff', { emissive: '#ffffff', ei: 0.7, opacity: 0.55, order: 4, noShadow: true }))
}
// One 0.35 m glass marble (colorIndex 0..5), centred.
export function makeMarble(colorIndex = 0) {
  const i = ((colorIndex | 0) % 6 + 6) % 6
  return cachedModel('marble:' + i, () => {
    const root = new THREE.Group()
    buildMarble(root, i)
    return finish(root, [0.35, 0.35, 0.35], { name: 'marble', userData: { kind: 'marble', colorIndex: i } })
  })
}

// --- Banana peel (dropped trap) -------------------------------------------------------------
// Sheet over (u 0..1 along, v -1..1 across) -> geometry; offset/flip build the underside.
function sheetGeo(key, fn, us, vs, offset, flip) {
  return cached('sheet-' + key, () => {
    const g = new THREE.PlaneGeometry(1, 1, us, vs)
    const p = g.attributes.position
    const out = new THREE.Vector3()
    for (let i = 0; i < p.count; i++) {
      fn(p.getX(i) + 0.5, p.getY(i) * 2, out)
      p.setXYZ(i, out.x, out.y + offset, out.z)
    }
    if (flip) {
      const idx = g.index.array
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t + 1]
        idx[t + 1] = idx[t + 2]
        idx[t + 2] = a
      }
    }
    g.computeVertexNormals()
    return g
  })
}
const petal = (u, v, out) => {
  const w = 0.17 * Math.pow(Math.sin(PI * (0.1 + 0.9 * u)), 0.6) * (1 - 0.35 * u)
  const y = 0.17 * Math.pow(1 - u, 2.2) + 0.012 + 0.05 * Math.pow(Math.max(0, u - 0.75) / 0.25, 2) + 0.025 * (1 - v * v) * (1 - 0.5 * u)
  out.set(v * w, y, 0.06 + u * 0.5)
}
function bananaSkinTex() {
  return canvasTex('banana-skin', 128, 32, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, w, 0)
    gr.addColorStop(0, '#6b4a1f')
    gr.addColorStop(0.07, '#e8c22a')
    gr.addColorStop(0.2, '#ffd93a')
    gr.addColorStop(0.8, '#ffe04a')
    gr.addColorStop(0.95, '#b8c43a')
    gr.addColorStop(1, '#7a8a2a')
    c.fillStyle = gr
    c.fillRect(0, 0, w, h)
    speckle(c, w, h, 22, ['#7a5220', '#8a6228'], { min: 0.8, max: 2, seed: 4 })
    c.fillStyle = 'rgba(160,120,20,0.25)'
    for (let j = 0; j < 5; j++) c.fillRect(0, (j / 5) * h, w, 1.5)
  })
}
export function makeBananaPeel() {
  return cachedModel('bananapeel', () => {
    const g = new THREE.Group()
    const top = sheetGeo('peel-top', petal, 14, 6, 0, false)
    const bot = sheetGeo('peel-bot', petal, 14, 6, -0.014, true)
    const yellow = mat('#ffd93a', { roughness: 0.45 })
    const inside = mat('#f6ecc4', { roughness: 0.8 })
    const angles = [0.3, 1.85, 3.45, 4.85]
    const lens = [1.04, 0.92, 1.08, 0.88]
    angles.forEach((a, i) => {
      const pg = grp(g, [0, 0, 0], [0, a, 0], [1, 1, lens[i]])
      add(pg, top, yellow)
      add(pg, bot, inside)
      add(pg, G.sph(0.03, 6, 4), mat('#6b4a1f', { roughness: 0.7 }), [0, 0.08, 0.57])
    })
    add(g, G.sph(0.13, 14, 10), mat('#ffffff', { roughness: 0.45, map: bananaSkinTex() }), [0, 0.1, 0], null, [1, 0.9, 1])
    add(g, G.cyl(0.035, 0.045, 0.08, 8), mat('#7a6a2a', { roughness: 0.7 }), [0.01, 0.23, 0], [0, 0, 0.2])
    return finish(g, [1.2, 0.25, 1.2], { name: 'bananapeel', bottom: true, userData: { kind: 'bananapeel' } })
  })
}

// --- Foam rocket (bazooka projectile) --------------------------------------------------------
function rocketTex() {
  return canvasTex('rocket-foam', 64, 64, (c, w, h) => {
    c.fillStyle = '#ff9a2a'
    c.fillRect(0, 0, w, h)
    c.fillStyle = '#ffd23a'
    c.fillRect(0, h * 0.35, w, h * 0.12)
    c.fillRect(0, h * 0.65, w, h * 0.12)
    speckle(c, w, h, 120, ['rgba(255,255,255,0.25)', 'rgba(150,60,0,0.15)'], { min: 0.5, max: 1.4, seed: 3 })
  })
}
function buildRocket(g, len = 1.1) {
  const foam = mat('#ffffff', { roughness: 0.85, map: rocketTex() })
  const r = 0.11
  const body = len * 0.62
  add(g, G.cyl(r, r, body, 18), foam, [0, 0, -0.05], yAxisToZ)
  add(g, G.sph(0.15, 18, 12), mat('#ff3b3b', { roughness: 0.8 }), [0, 0, body / 2 + 0.06], null, [1, 1, 1.35])
  add(g, G.tor(0.115, 0.03, 6, 18), mat('#ffd23a', { roughness: 0.7 }), [0, 0, body / 2 - 0.06])
  add(g, G.cyl(0.07, 0.09, 0.08, 14), mat('#2a2d36', { roughness: 0.6 }), [0, 0, -body / 2 - 0.08], yAxisToZ)
  const fin = extrude('rocket-fin', () => polyShape([[0, 0], [0.2, -0.05], [0.2, -0.22], [0, -0.3]]), 0.02, { bevel: 0.015, bevelSeg: 1 })
  const fm = mat('#3b7be0', { roughness: 0.7 })
  for (let i = 0; i < 4; i++) {
    const fg = grp(g, [0, 0, -body / 2 + 0.22], [0, 0, (i / 4) * TAU + PI / 4])
    add(fg, fin, fm, [r - 0.02, 0, 0], [PI / 2, 0, 0])
  }
}
export function makeFoamRocket() {
  return cachedModel('foamrocket', () => {
    const g = new THREE.Group()
    buildRocket(g)
    const b = new THREE.Box3().setFromObject(g, true)
    const s = b.getSize(new THREE.Vector3())
    const k = 1.1 / s.z
    return finish(g, [s.x * k, s.y * k, 1.1], { name: 'foamrocket', userData: { kind: 'foamrocket' } })
  })
}

// =========================================================================================
//  Gadgets (held / HUD look)
// =========================================================================================
function marbles(g) {
  const pouchTex = canvasTex('pouch', 128, 64, (c, w, h) => {
    weave(c, w, h, '#3d4fb8', { step: 2, alpha: 0.18, seed: 7 })
    c.fillStyle = '#f2c94c'
    for (let i = 0; i < 9; i++) {
      const x = (i + 0.5) * (w / 9)
      const y = h * (i % 2 ? 0.45 : 0.62)
      c.beginPath()
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * TAU - PI / 2
        const r = k % 2 ? 2 : 5
        c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
      }
      c.fill()
    }
  })
  const pouch = cached('marble-pouch', () => {
    const prof = roundPolyline([[0, 0], [0.3, 0.02], [0.4, 0.14], [0.42, 0.32], [0.33, 0.5], [0.17, 0.6], [0.15, 0.64], [0.23, 0.72], [0.28, 0.79], [0.22, 0.78], [0.13, 0.68], [0, 0.66]], 0.03, 1)
    const geo = new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x, y)), 26, PI)
    const p = geo.attributes.position
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i)
      if (y > 0.64) {
        const a = Math.atan2(p.getX(i), p.getZ(i))
        p.setY(i, y + 0.035 * Math.sin(a * 8) * ((y - 0.64) / 0.15))
      }
      const a = Math.atan2(p.getX(i), p.getZ(i))
      const f = 1 + 0.04 * Math.sin(a * 6 + y * 8)
      p.setX(i, p.getX(i) * f)
      p.setZ(i, p.getZ(i) * f)
    }
    remapLatheV(geo, 'y')
    geo.computeVertexNormals()
    return geo
  })
  const pg = grp(g, [0, 0, -0.08], [0.45, 0, 0])
  add(pg, pouch, cloth('#ffffff', pouchTex))
  add(pg, G.tor(0.16, 0.022, 6, 24), gold(0.3), [0, 0.63, 0], [PI / 2, 0, 0])
  add(pg, tube([[0.15, 0.63, 0.05], [0.22, 0.6, 0.12], [0.24, 0.5, 0.18], [0.27, 0.42, 0.17]], 0.011, { seg: 12, radial: 4 }), gold(0.3))
  add(pg, G.sph(0.035, 8, 6), gold(0.3), [0.27, 0.41, 0.17])
  const place = (i, p, s = 0.5) => {
    const m = grp(g, p, null, s)
    buildMarble(m, i, 1)
  }
  place(0, [-0.06, 0.53, 0.3])
  place(1, [0.1, 0.5, 0.36])
  place(3, [0.02, 0.1, 0.46], 0.6)
  place(2, [0.3, 0.1, 0.34], 0.6)
  place(4, [-0.27, 0.1, 0.38], 0.6)
}

function glue(g) {
  const label = canvasTex('glue-label', 256, 128, (c, w, h) => {
    c.fillStyle = '#f4f1ea'
    c.fillRect(0, 0, w, h)
    const Y = (v) => (1 - v) * h
    c.fillStyle = '#2f6fe0'
    c.fillRect(0, Y(0.78), w, Y(0.16) - Y(0.78))
    c.fillStyle = '#ffcf26'
    c.fillRect(0, Y(0.78), w, 4)
    c.fillRect(0, Y(0.16) - 4, w, 4)
    wrapDraw(w, w * 0.56, (x) => {
      txt(c, 'GLUE', x, Y(0.5), 30, '#ffffff', { stroke: '#1a3f8f', lw: 5, maxW: 74 })
      c.fillStyle = '#ffffff'
      c.beginPath()
      c.moveTo(x, Y(0.73))
      c.quadraticCurveTo(x + 8, Y(0.66), x, Y(0.63))
      c.quadraticCurveTo(x - 8, Y(0.66), x, Y(0.73))
      c.fill()
      txt(c, 'extra sticky!', x, Y(0.27), 12, '#ffcf26', { italic: true, maxW: 74 })
    })
  }, { text: true })
  add(g, G.lathe([[0, 0], [0.26, 0], [0.28, 0.03], [0.28, 0.62], [0.24, 0.75], [0.14, 0.82], [0.12, 0.86], [0, 0.86]], 26, 0.04, 1, 'y'), mat('#ffffff', { roughness: 0.3, map: label }))
  const orange = mat('#ff8a1f', { roughness: 0.35 })
  add(g, G.lathe([[0, 0.84], [0.15, 0.84], [0.16, 0.92], [0.11, 1.0], [0.06, 1.1], [0.03, 1.18], [0, 1.2]], 20, 0.02), orange)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU
    add(g, G.box(0.02, 0.07, 0.03), orange, [Math.sin(a) * 0.158, 0.88, Math.cos(a) * 0.158], [0, a, 0])
  }
  const drip = mat('#fbfbf6', { roughness: 0.15 })
  add(g, tube([[0.16, 0.8, 0.05], [0.24, 0.72, 0.1], [0.28, 0.6, 0.12], [0.285, 0.5, 0.12]], 0.03, { seg: 10, radial: 6, taper: (t) => 1 - 0.3 * t }), drip)
  add(g, G.sph(0.05, 10, 8), drip, [0.285, 0.47, 0.12], null, [1, 1.3, 1])
}

function banana(g) {
  const pts = [[-0.62, 0.1, 0.02], [-0.34, 0.0, 0.24], [0, -0.04, 0.32], [0.34, 0.0, 0.24], [0.6, 0.1, 0.0]]
  add(g, tube(pts, 0.2, { seg: 24, radial: 5, taper: (t) => 0.28 + 0.72 * Math.pow(Math.sin(PI * t), 0.55) }), mat('#ffffff', { roughness: 0.45, map: bananaSkinTex() }))
  add(g, G.cyl(0.035, 0.05, 0.16, 8), mat('#7a8a2a', { roughness: 0.6 }), [0.66, 0.14, -0.04], [0, 0, -1.05], 1)
  add(g, G.sph(0.04, 8, 6), mat('#4a3418', { roughness: 0.7 }), [-0.64, 0.1, 0.03])
}

function alarm(g) {
  buildAlarmClock(g, { ringing: true })
}

function smoke(g) {
  const band = canvasTex('smoke-band', 256, 128, (c, w, h) => {
    c.fillStyle = '#2b2d36'
    c.fillRect(0, 0, w, h)
    speckle(c, w, h, 200, ['#353845', '#22242c'], { min: 0.6, max: 1.6, seed: 2 })
    c.fillStyle = '#d8dce6'
    c.fillRect(0, h * 0.4, w, h * 0.2)
    for (const u of [0.25, 0.75]) txt(c, 'SMOKE', u * w, h * 0.5 + 1, 20, '#2b2d36')
  }, { text: true })
  add(g, G.sph(0.32, 28, 20), mat('#ffffff', { roughness: 0.45, metalness: 0.2, map: band }), [0, 0, 0])
  add(g, G.cyl(0.1, 0.13, 0.1, 16), metal('#8a8f99', 0.35), [0, 0.32, 0])
  add(g, G.cyl(0.11, 0.11, 0.03, 16), metal('#6a6f79', 0.35), [0, 0.37, 0])
  add(g, tube([[0, 0.36, 0], [0.02, 0.45, 0.02], [0.08, 0.5, 0.07], [0.15, 0.48, 0.12]], 0.02, { seg: 12, radial: 5 }), mat('#c9a56b', { roughness: 0.8 }))
  const spark = mat('#ffd23a', { emissive: '#ffae00', ei: 2.4 })
  for (const sc of [[0.025, 0.16, 0.025], [0.16, 0.025, 0.025], [0.025, 0.025, 0.16]]) add(g, G.oct(1), spark, [0.16, 0.49, 0.13], [0.4, 0.5, 0.2], sc)
  add(g, G.sph(0.045, 10, 8), mat('#ff7a1a', { emissive: '#ff5a00', ei: 2 }), [0.16, 0.49, 0.13])
  add(g, G.sph(0.06, 8, 6, 0.6, 0.9, 0.5, 0.5), mat('#ffffff', { emissive: '#ffffff', ei: 0.5, opacity: 0.45, order: 4, noShadow: true }), [0, 0, 0], null, [5.4, 5.4, 5.4])
}

function sleep(g) {
  add(g, G.lathe([[0, 0], [0.15, 0.005], [0.27, 0.08], [0.3, 0.25], [0.27, 0.42], [0.14, 0.52], [0.095, 0.56], [0.095, 0.72], [0.115, 0.74], [0.1, 0.75]], 24, 0.02), glass('#f0e6ff', 0.32))
  const liquid = mat('#7d2cff', { roughness: 0.15, emissive: '#6a1cff', ei: 1.0, opacity: 0.94, order: 2 })
  add(g, G.lathe([[0, 0.02], [0.14, 0.025], [0.25, 0.09], [0.28, 0.25], [0.268, 0.34], [0, 0.34]], 20, 0.02), liquid)
  const bub = mat('#e2c8ff', { emissive: '#c79bff', ei: 1, roughness: 0.2 })
  for (const [x, y, z, r] of [[0.08, 0.2, 0.12, 0.03], [-0.1, 0.14, 0.05, 0.022], [0.02, 0.28, -0.1, 0.025], [-0.05, 0.3, 0.14, 0.018]]) add(g, G.sph(r, 8, 6), bub, [x, y, z])
  const cork = canvasTex('cork', 64, 64, (c, w, h) => {
    c.fillStyle = '#c99a62'
    c.fillRect(0, 0, w, h)
    speckle(c, w, h, 160, ['#a87a42', '#e0b880', '#8a5e2e'], { min: 0.6, max: 1.6, seed: 8 })
  })
  add(g, G.cyl(0.11, 0.088, 0.17, 16), mat('#ffffff', { roughness: 0.9, map: cork }), [0, 0.79, 0])
  add(g, G.tor(0.1, 0.012, 5, 20), cloth('#f2c94c'), [0, 0.6, 0], [PI / 2, 0, 0])
  const label = canvasTex('zz-label', 128, 64, (c, w, h) => {
    c.fillStyle = '#f6ecd0'
    rr(c, 2, 2, w - 4, h - 4, 10)
    c.fill()
    c.strokeStyle = '#7a2cff'
    c.lineWidth = 3
    rr(c, 6, 6, w - 12, h - 12, 8)
    c.stroke()
    txt(c, 'Zz', w / 2 + 10, h / 2 + 2, 34, '#5a1fbf')
    c.fillStyle = '#f2c94c'
    c.beginPath()
    c.arc(30, h / 2, 13, 0, TAU)
    c.fill()
    c.fillStyle = '#f6ecd0'
    c.beginPath()
    c.arc(36, h / 2 - 5, 11, 0, TAU)
    c.fill()
  }, { text: true })
  add(g, G.arcCyl(0.305, 0.15, -0.55, 1.1, 10), mat('#ffffff', { roughness: 0.8, map: label, alphaTest: 0.5 }), [0, 0.25, 0])
}

function xray(g) {
  const spiral = canvasTex('xray-spiral', 128, 128, (c, w, h) => {
    const m = w / 2
    c.fillStyle = '#7dff8a'
    c.fillRect(0, 0, w, h)
    const gr = c.createRadialGradient(m, m, 4, m, m, 64)
    gr.addColorStop(0, '#e6ffe8')
    gr.addColorStop(1, '#2fd94a')
    c.fillStyle = gr
    c.fillRect(0, 0, w, h)
    c.strokeStyle = '#0d5a1c'
    c.lineWidth = 5
    c.beginPath()
    for (let t = 0; t < 6 * PI; t += 0.1) {
      const r = t * 3.1
      const x = m + Math.cos(t) * r
      const y = m + Math.sin(t) * r
      t === 0 ? c.moveTo(x, y) : c.lineTo(x, y)
    }
    c.stroke()
  })
  const lens = mat('#ffffff', { roughness: 0.2, map: spiral, emissive: '#ffffff', emap: spiral, ei: 0.9 })
  const frame = plastic('#1e1e24', 0.35)
  for (const s of [-1, 1]) {
    add(g, G.tor(0.16, 0.045, 10, 28), frame, [s * 0.33, 0, 0.18])
    add(g, G.circle(0.165, 28), lens, [s * 0.33, 0, 0.18])
    add(g, G.circle(0.165, 28), lens, [s * 0.33, 0, 0.17], [0, PI, 0])
    add(g, G.rbox(0.08, 0.08, 0.1, 0.02, 1), frame, [s * 0.5, 0.07, 0.14])
    const arm = grp(g, [s * 0.52, 0.07, 0.1])
    add(arm, G.rbox(0.045, 0.06, 0.42, 0.02, 1), frame, [0, 0, -0.21])
    add(arm, G.rbox(0.045, 0.06, 0.14, 0.02, 1), frame, [0, -0.05, -0.43], [-0.8, 0, 0])
  }
  add(g, G.tor(0.09, 0.035, 8, 14, PI), frame, [0, 0.02, 0.18])
  add(g, G.rbox(1.02, 0.06, 0.08, 0.03, 1), plastic('#e23b3b', 0.35), [0, 0.17, 0.2])
}

function energy(g) {
  const can = canvasTex('energy-can', 256, 128, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, 0, h)
    gr.addColorStop(0, '#1d2350')
    gr.addColorStop(1, '#0d1030')
    c.fillStyle = gr
    c.fillRect(0, 0, w, h)
    wrapDraw(w, w / 2, (x) => {
      c.fillStyle = '#7dff3a'
      c.beginPath()
      c.moveTo(x + 8, 10)
      c.lineTo(x - 22, 64)
      c.lineTo(x - 2, 64)
      c.lineTo(x - 12, 118)
      c.lineTo(x + 24, 52)
      c.lineTo(x + 4, 52)
      c.lineTo(x + 16, 10)
      c.closePath()
      c.fill()
      txt(c, 'ZAP!', x, 40, 30, '#ffe23a', { stroke: '#0d1030', lw: 6 })
      txt(c, 'ENERGY', x, 100, 18, '#ffffff', { stroke: '#0d1030', lw: 4 })
    })
    wrapDraw(w, 0, (x) => {
      c.fillStyle = 'rgba(125,255,58,0.35)'
      for (let i = 0; i < 5; i++) c.fillRect(x - 30 + i * 12, 20 + i * 18, 40, 4)
    })
  }, { text: true })
  add(g, G.lathe([[0.21, 0.07], [0.21, 0.79]], 26, 0, 1, 'y'), mat('#ffffff', { roughness: 0.3, metalness: 0.4, map: can }))
  const alu = metal('#d8dde3', 0.25)
  add(g, G.lathe([[0, 0], [0.15, 0], [0.19, 0.03], [0.21, 0.07]], 26, 0.01), alu)
  add(g, G.lathe([[0.21, 0.79], [0.17, 0.85], [0.165, 0.88], [0.172, 0.895], [0.155, 0.885], [0, 0.875]], 26, 0.008), alu)
  add(g, G.rbox(0.1, 0.012, 0.16, 0.006, 1), alu, [0, 0.887, 0.05])
  add(g, G.tor(0.03, 0.01, 4, 10), alu, [0, 0.889, -0.02], [PI / 2, 0, 0])
}

function bazooka(g) {
  const stripes = canvasTex('bazooka-tube', 256, 128, (c, w, h) => {
    c.fillStyle = '#6fd13a'
    c.fillRect(0, 0, w, h)
    c.fillStyle = '#ffd23a'
    for (const y of [0.12, 0.85]) c.fillRect(0, y * h, w, 8)
    const star = (x, y, r, col) => {
      c.fillStyle = col
      c.beginPath()
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * TAU - PI / 2
        const rr2 = k % 2 ? r * 0.45 : r
        c.lineTo(x + Math.cos(a) * rr2, y + Math.sin(a) * rr2)
      }
      c.fill()
    }
    star(w * 0.1, h * 0.5, 12, '#ffffff')
    star(w * 0.42, h * 0.32, 10, '#ff5ab0')
    star(w * 0.42, h * 0.7, 8, '#ffffff')
    c.save()
    c.translate(w * 0.75, h * 0.5)
    c.rotate(PI / 2)
    txt(c, 'BOOM!', 0, 2, 30, '#ff5a2a', { stroke: '#ffffff', lw: 6 })
    c.restore()
  }, { text: true })
  const purple = plastic('#7a4dd8', 0.35)
  const orange = plastic('#ff6a2a', 0.4)
  add(g, G.cyl(0.17, 0.17, 1.6, 24), mat('#ffffff', { roughness: 0.35, map: stripes }), [0, 0, -0.1], yAxisToZ)
  add(g, G.tor(0.18, 0.045, 8, 24), orange, [0, 0, 0.7])
  add(g, G.circle(0.16, 20), mat('#1d1d22', { roughness: 0.8 }), [0, 0, 0.69])
  const rocket = grp(g, [0, 0, 0.78], null, 0.85)
  add(rocket, G.sph(0.15, 18, 12), mat('#ff3b3b', { roughness: 0.8 }), [0, 0, 0.02], null, [1, 1, 1.35])
  add(rocket, G.tor(0.115, 0.03, 6, 18), mat('#ffd23a', { roughness: 0.7 }), [0, 0, -0.08])
  const flare = grp(g, [0, 0, -0.9], [-PI / 2, 0, 0])
  add(flare, G.lathe([[0.16, 0], [0.25, 0.28], [0.27, 0.32], [0.23, 0.32], [0.14, 0.04]], 20, 0.02), purple)
  add(g, G.circle(0.15, 18), mat('#1d1d22', { roughness: 0.8 }), [0, 0, -0.92], [0, PI, 0])
  const grip = grp(g, [0, -0.16, 0.08], [0.3, 0, 0])
  add(grip, G.rbox(0.12, 0.26, 0.14, 0.05, 2), purple, [0, -0.1, 0])
  add(g, G.tor(0.07, 0.015, 6, 14, PI), orange, [0, -0.17, 0.2], [0, PI / 2, PI])
  add(g, G.rbox(0.04, 0.08, 0.04, 0.015, 1), orange, [0, -0.2, 0.19])
  add(g, G.rbox(0.1, 0.18, 0.11, 0.04, 2), purple, [0, -0.2, 0.48])
  add(g, G.rbox(0.05, 0.08, 0.04, 0.015, 1), plastic('#ffd23a', 0.4), [0, 0.2, 0.32])
  add(g, G.tor(0.055, 0.014, 6, 14), plastic('#ffd23a', 0.4), [0, 0.27, 0.32])
  add(g, G.rbox(0.22, 0.09, 0.42, 0.04, 2), rubber('#2a2d36'), [0, 0.16, -0.5])
}

// Fire extinguisher: a red cylinder with a FOAM label, a squeeze handle + safety pin, a gauge, and a
// black hose down to the nozzle.
function extinguisher(g) {
  const label = canvasTex('ext-label', 128, 128, (c, w, h) => {
    c.fillStyle = '#e8262a'
    c.fillRect(0, 0, w, h)
    c.fillStyle = '#ffffff'
    c.fillRect(w * 0.18, h * 0.3, w * 0.64, h * 0.42)
    txt(c, 'FIRE', w * 0.5, h * 0.44, 22, '#e8262a')
    txt(c, 'FOAM', w * 0.5, h * 0.62, 18, '#1d1d22')
  }, { text: true })
  const red = mat('#e8262a', { roughness: 0.35, metalness: 0.1 })
  const black = rubber('#1d1d22')
  add(g, G.cyl(0.2, 0.2, 0.9, 24), mat('#ffffff', { roughness: 0.35, metalness: 0.1, map: label }), [0, 0.45, 0])
  add(g, G.sph(0.2, 24, 12, 0, TAU, 0, PI / 2), red, [0, 0.9, 0])
  add(g, G.cyl(0.21, 0.2, 0.05, 24), red, [0, 0.025, 0])
  add(g, G.cyl(0.06, 0.07, 0.12, 14), metal('#b8bec6', 0.3), [0, 1.13, 0])
  add(g, G.rbox(0.07, 0.04, 0.3, 0.015, 1), metal('#2c2f35', 0.4), [0, 1.22, 0.08], [0.25, 0, 0])
  add(g, G.rbox(0.06, 0.03, 0.26, 0.012, 1), metal('#2c2f35', 0.4), [0, 1.15, 0.1], [0.05, 0, 0])
  add(g, G.tor(0.025, 0.008, 6, 12), metal('#ffd23a', 0.3), [0.06, 1.17, -0.02], [0, PI / 2, 0])
  add(g, G.cyl(0.05, 0.05, 0.03, 16), metal('#d8dde3', 0.3), [0.075, 1.04, 0.05], [0, 0, PI / 2])
  add(g, tube([[0, 1.12, -0.06], [0, 1.0, -0.22], [0.02, 0.6, -0.27], [0.04, 0.32, -0.25]], 0.03, { seg: 14, radial: 6 }), black)
  add(g, G.cyl(0.035, 0.06, 0.16, 12), black, [0.04, 0.24, -0.25])
}

const BUILDERS = { marbles, glue, banana, alarm, smoke, sleep, xray, energy, bazooka, extinguisher }
