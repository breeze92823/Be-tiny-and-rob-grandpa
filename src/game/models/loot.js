// Procedural loot models (everything Grandpa owns that the crew can steal).
// makeLoot(id) -> THREE.Group centred on its bounding box, sized to LOOT_SIZES[id],
// +Y up, front facing +Z. Each model is built once from primitives, baked to one
// mesh per material (modelKit.finish) and cloned per call (shared geometry/materials).
import {
  THREE, PI, TAU, G, mat, paint, plastic, matte, cloth, ceramic, rubber, metal, chrome, gold, brass, copper, iron, glass,
  glow, gem, pearl, add, grp, around, finish, tube, extrude, shapeGeo, roundRectShape, roundRectPath, polyShape, pillowGeo,
  pillowY, gemGeo, frustumGeo, canvasTex, rr, txt, speckle, woodGrain, stitches, weave, wrapDraw, rng, cached, remapLatheV,
  roundPolyline, withDetail,
} from './modelKit.js'

const V2 = THREE.Vector2
const V3 = THREE.Vector3

export const LOOT_SIZES = {
  // hallway
  umbrella: [6, 1.2, 1.2], boot: [1.6, 2.6, 2.4], fedora: [2.4, 1.2, 2.4], keys: [1.2, 0.3, 1.6], vase: [1.6, 3, 1.6],
  wallet: [1.6, 0.4, 1.2], pocketwatch: [0.9, 0.25, 1.1], snowglobe: [1.2, 1.4, 1.2],
  // living room
  remote: [0.8, 0.35, 2.2], lamp: [2, 3.6, 2], cushion: [3, 1, 3], book: [1.4, 0.5, 2], record: [2, 0.15, 2],
  trophy: [1.2, 2.6, 1.2], teacup: [1, 0.7, 1], cookietin: [1.8, 0.8, 1.8], piggybank: [1.6, 1.4, 2.2], yarn: [1.2, 1.2, 1.2],
  camera: [1.6, 1.1, 1], radio: [2.4, 1.6, 1],
  // kitchen
  toaster: [2, 1.4, 1.2], pan: [1.8, 0.4, 3.4], teapot: [2, 1.6, 1.4], cheese: [1.6, 0.9, 1.2], cake: [2, 1.4, 2],
  mug: [0.9, 1, 1.1], milk: [0.9, 1.8, 0.9], blender: [1.2, 2.4, 1.2], rollingpin: [3, 0.5, 0.5], plate: [1.8, 0.15, 1.8],
  // bathroom
  duck: [1.4, 1.4, 1.6], toothbrush: [0.4, 1.8, 0.4], perfume: [0.8, 1.2, 0.8], shampoo: [0.8, 1.6, 0.6], tp: [1, 1, 1],
  hairdryer: [1.8, 1.6, 0.8], soap: [0.9, 0.4, 0.6], dentures: [0.9, 0.6, 0.9],
  // bedroom
  alarmclock: [1.2, 1.2, 0.7], jewelbox: [1.6, 1, 1.2], pillow: [3, 0.8, 2], slipper: [1.2, 0.8, 2.4], teddy: [1.8, 2.4, 1.4],
  watch: [0.8, 0.3, 1.1], photo: [1.4, 1.8, 0.3], cash: [1.2, 0.5, 0.6], necklace: [1.2, 0.2, 1.2], diary: [1.2, 0.4, 1.6],
  // garage
  toolbox: [2.4, 1.4, 1.2], hammer: [0.5, 0.4, 2.2], wrench: [0.4, 0.2, 2], drill: [1.6, 1.6, 0.6], paintcan: [1, 1.1, 1],
  flashlight: [0.5, 0.5, 1.8], gascan: [1.4, 1.6, 0.8], hubcap: [2, 0.3, 2],
  // study (secret room)
  goldbar: [1.4, 0.5, 0.7], crown: [1.6, 1.2, 1.6], globe: [1.8, 2.4, 1.8], painting: [2.2, 1.8, 0.3], diamond: [0.9, 0.9, 0.9],
  coinjar: [1.2, 1.6, 1.2],
}
export const LOOT_IDS = Object.keys(LOOT_SIZES)

// Level of detail: past LOD_NEAR + LOD_PER_M x the model's longest side (a 1 m mug: 18 m, the 6 m
// umbrella: 58 m; it is then ~30 px tall or less) the model swaps to a low-detail build: half the curve
// segments, tiny pieces (< LOD_MIN_PIECE of the longest side) left out, and no shadow of its own.
const LOD_NEAR = 10
const LOD_PER_M = 8
const LOD_MIN_PIECE = 0.06
const templates = new Map()
function buildModel(id, low) {
  const build = BUILDERS[id]
  const size = LOOT_SIZES[id] || [1, 1, 1]
  const root = new THREE.Group()
  if (build) build(root)
  else add(root, G.rbox(1, 1, 1, 0.12, 2), paint('#c9a27a'))
  return finish(root, size, { name: 'loot:' + id, userData: { kind: 'loot', id }, minPiece: low ? LOD_MIN_PIECE * Math.max(...size) : 0 })
}
export function makeLoot(id) {
  let t = templates.get(id)
  if (!t) {
    const high = buildModel(id, false)
    const low = withDetail(0.5, () => buildModel(id, true))
    low.traverse((o) => {
      if (!o.isMesh) return
      o.castShadow = false
      o.userData.lodLow = true // physics hulls skip it (props.js)
    })
    const size = LOOT_SIZES[id] || [1, 1, 1]
    t = new THREE.LOD()
    t.name = high.name
    t.userData = high.userData
    t.addLevel(high, 0)
    t.addLevel(low, LOD_NEAR + LOD_PER_M * Math.max(...size), 0.1)
    templates.set(id, t)
  }
  return t.clone()
}

// --- Shared bits -------------------------------------------------------------------------
const white = () => ceramic('#fbf8f1')
const dark = () => plastic('#26272c', 0.5)
const yAxisToX = [0, 0, -PI / 2] // rotates a +Y built part to point along +X
const yAxisToZ = [PI / 2, 0, 0] // rotates a +Y built part to point along +Z

function feltTex(base, key) {
  return canvasTex('felt-' + key, 64, 64, (c, w, h) => {
    weave(c, w, h, base, { step: 2, alpha: 0.07, seed: 11 })
  }, { wrap: true })
}
function woodTex(key, base, darkC, lightC, along = 'x', seed = 3) {
  return canvasTex('wood-' + key, 128, 128, (c, w, h) => woodGrain(c, w, h, { base, dark: darkC, light: lightC, along, seed }), { wrap: true })
}
function noteTex() {
  return canvasTex('banknote', 256, 128, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, w, h)
    gr.addColorStop(0, '#d6efc6')
    gr.addColorStop(1, '#a8d898')
    c.fillStyle = gr
    c.fillRect(0, 0, w, h)
    c.strokeStyle = '#2f7a44'
    c.lineWidth = 7
    c.strokeRect(5, 5, w - 10, h - 10)
    c.lineWidth = 1.5
    c.strokeRect(15, 15, w - 30, h - 30)
    c.globalAlpha = 0.3
    for (let i = 0; i < 7; i++) {
      c.beginPath()
      for (let x = 15; x <= w - 15; x += 3) {
        const y = 30 + i * 11 + Math.sin(x * 0.09 + i) * 5
        x === 15 ? c.moveTo(x, y) : c.lineTo(x, y)
      }
      c.stroke()
    }
    c.globalAlpha = 1
    c.fillStyle = '#e9f6e0'
    c.beginPath()
    c.ellipse(w / 2, h / 2, 32, 40, 0, 0, TAU)
    c.fill()
    c.strokeStyle = '#2f7a44'
    c.lineWidth = 3
    c.stroke()
    // a tiny grandpa portrait
    c.fillStyle = '#3f8a52'
    c.beginPath()
    c.ellipse(w / 2, h / 2 + 30, 24, 14, 0, PI, TAU)
    c.fill()
    c.beginPath()
    c.arc(w / 2, h / 2 - 4, 14, 0, TAU)
    c.fill()
    c.fillStyle = '#e9f6e0'
    c.beginPath()
    c.ellipse(w / 2, h / 2 + 2, 8, 3, 0, 0, TAU)
    c.fill()
    txt(c, '100', 36, 32, 26, '#1f5a33')
    txt(c, '100', w - 36, h - 30, 26, '#1f5a33')
    txt(c, 'GRANDPA BANK', w / 2, h - 22, 12, '#1f5a33', { weight: 700 })
  }, { text: true })
}
const noteMat = () => mat('#ffffff', { roughness: 0.8, map: noteTex() })

// Drip skirt: open cylinder hanging from y = 0 with rounded drips.
// drips: [[angle (0 = +Z), halfWidth (rad), length]]
function dripGeo(key, R, band, drips, seg = 96, rows = 5) {
  return cached('drip-' + key, () => {
    const g = new THREE.CylinderGeometry(R, R, 1, seg, rows, true, PI)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      const z = p.getZ(i)
      const t = 0.5 - p.getY(i)
      const a = Math.atan2(x, z)
      let L = band
      for (const [da, hw, len] of drips) {
        const d = Math.abs(Math.atan2(Math.sin(a - da), Math.cos(a - da))) / hw
        if (d < 1) L = Math.max(L, band + len * Math.sqrt(1 - d * d))
      }
      const k = 1 + 0.025 * Math.sin(t * PI)
      p.setXYZ(i, x * k, -t * L, z * k)
    }
    g.computeVertexNormals()
    return g
  })
}

// Foot outline (heel at -y, toe at +y), used by the boot and slipper soles.
function footShape(L, wh, wb) {
  const s = new THREE.Shape()
  const h = L / 2
  s.moveTo(0, -h)
  s.bezierCurveTo(wh * 1.1, -h, wh, -h * 0.45, wh * 0.95, -h * 0.2)
  s.bezierCurveTo(wh * 0.9, h * 0.1, wb * 1.05, h * 0.25, wb, h * 0.6)
  s.bezierCurveTo(wb * 0.95, h * 1.08, -wb * 0.95, h * 1.08, -wb, h * 0.6)
  s.bezierCurveTo(-wb * 1.05, h * 0.25, -wh * 0.9, h * 0.1, -wh * 0.95, -h * 0.2)
  s.bezierCurveTo(-wh, -h * 0.45, -wh * 1.1, -h, 0, -h)
  return s
}

// Clock dial (used by the alarm clock + gadget).
function clockFaceTex() {
  return canvasTex('clockface', 256, 256, (c, w, h) => {
    const cx = w / 2
    const cy = h / 2
    c.fillStyle = '#fff8e6'
    c.fillRect(0, 0, w, h)
    const g2 = c.createRadialGradient(cx, cy, 20, cx, cy, 128)
    g2.addColorStop(0, 'rgba(255,255,255,0)')
    g2.addColorStop(1, 'rgba(200,170,120,0.35)')
    c.fillStyle = g2
    c.fillRect(0, 0, w, h)
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * TAU
      const big = i % 5 === 0
      c.strokeStyle = '#2a2320'
      c.lineWidth = big ? 5 : 2
      c.beginPath()
      c.moveTo(cx + Math.sin(a) * (big ? 98 : 106), cy - Math.cos(a) * (big ? 98 : 106))
      c.lineTo(cx + Math.sin(a) * 114, cy - Math.cos(a) * 114)
      c.stroke()
    }
    const nums = ['12', '3', '6', '9']
    nums.forEach((n, i) => {
      const a = (i / 4) * TAU
      txt(c, n, cx + Math.sin(a) * 76, cy - Math.cos(a) * 76 + 2, 34, '#2a2320')
    })
    txt(c, 'WAKE UP!', cx, cy + 40, 15, '#c43a32')
    const hand = (a, len, wid, col) => {
      c.save()
      c.translate(cx, cy)
      c.rotate(a)
      c.fillStyle = col
      c.beginPath()
      c.moveTo(-wid, 12)
      c.lineTo(-wid * 0.5, -len)
      c.lineTo(0, -len - wid * 1.4)
      c.lineTo(wid * 0.5, -len)
      c.lineTo(wid, 12)
      c.closePath()
      c.fill()
      c.restore()
    }
    hand(-0.95, 62, 6, '#2a2320')
    hand(0.95 * 1.0 + 0.15, 92, 4.5, '#2a2320')
    hand(2.6, 80, 2.5, '#e0413a')
    c.fillStyle = '#e0413a'
    c.beginPath()
    c.arc(cx, cy, 9, 0, TAU)
    c.fill()
  }, { text: true })
}

// Twin-bell alarm clock, ~1.2 x 1.2 x 0.7 around the origin. ringing adds motion arcs.
export function buildAlarmClock(g, { ringing = false } = {}) {
  const red = mat('#e23e3a', { roughness: 0.28, metalness: 0.25 })
  const ch = chrome()
  const body = grp(g, [0, 0, 0], [PI / 2, 0, 0])
  add(body, G.lathe([[0, -0.24], [0.4, -0.24], [0.45, -0.2], [0.46, 0.14], [0.44, 0.22], [0.41, 0.24], [0, 0.24]], 26, 0.03), red)
  add(g, G.circle(0.38, 28), mat('#ffffff', { roughness: 0.5, map: clockFaceTex() }), [0, 0, 0.245])
  add(g, G.tor(0.4, 0.04, 6, 32), ch, [0, 0, 0.245])
  // glass crystal (a shallow dome)
  add(g, G.sph(0.7, 24, 6, 0, TAU, 0, 0.58), glass('#ffffff', 0.25), [0, 0, 0.245 - 0.7 * Math.cos(0.58) + 0.005], [PI / 2, 0, 0])
  // bells + posts
  for (const s of [-1, 1]) {
    const b = grp(g, [s * 0.3, 0.44, -0.02], [0, 0, -s * 0.55])
    add(b, G.sph(0.21, 16, 6, 0, TAU, 0, PI / 2), ch)
    add(b, G.circle(0.21, 18), dark(), [0, 0.001, 0], [PI / 2, 0, 0])
    add(b, G.sph(0.04, 8, 6), ch, [0, 0.22, 0])
    add(g, G.cyl(0.025, 0.025, 0.22, 8), ch, [s * 0.22, 0.38, -0.02], [0, 0, -s * 0.55])
    // legs with ball feet
    add(g, G.cyl(0.045, 0.06, 0.3, 10), ch, [s * 0.3, -0.44, -0.02], [0, 0, s * 0.45])
    add(g, G.sph(0.075, 10, 8), ch, [s * 0.365, -0.58, -0.02])
  }
  // hammer between the bells
  add(g, G.cyl(0.02, 0.02, 0.22, 6), ch, [0, 0.5, -0.02])
  add(g, G.sph(0.055, 10, 8), ch, [0, 0.6, -0.02])
  // winding key on the back
  add(g, G.cyl(0.03, 0.03, 0.12, 8), ch, [0, 0, -0.3], [PI / 2, 0, 0])
  add(g, G.rbox(0.26, 0.12, 0.03, 0.04, 2), ch, [0, 0, -0.37])
  if (ringing) {
    const y = mat('#ffd23a', { emissive: '#ffb800', ei: 1.2 })
    for (const s of [-1, 1]) {
      for (let i = 0; i < 2; i++) {
        add(g, G.tor(0.3 + i * 0.13, 0.025, 4, 10, 0.9), y, [s * 0.32, 0.5, 0.05], [0, 0, s > 0 ? -0.3 : PI - 0.6])
      }
    }
  }
}

// =========================================================================================
//  HALLWAY
// =========================================================================================
function umbrella(g) {
  const dots = canvasTex('umb-dots', 128, 128, (c, w, h) => {
    c.fillStyle = '#2f5fae'
    c.fillRect(0, 0, w, h)
    c.fillStyle = '#f6efd9'
    for (const [x, y] of [[32, 32], [96, 96]]) {
      c.beginPath()
      c.arc(x, y, 13, 0, TAU)
      c.fill()
    }
  }, { repeat: [8, 9] })
  const canopy = cached('umbrella-canopy', () => {
    const prof = [[0, -1.62], [0.09, -1.6], [0.22, -1.5], [0.4, -1.32], [0.52, -1.08], [0.56, -0.8], [0.52, -0.4], [0.44, 0.2], [0.35, 0.8], [0.25, 1.4], [0.16, 2.0], [0.09, 2.4], [0.05, 2.56], [0, 2.58]]
    const geo = new THREE.LatheGeometry(prof.map(([x, y]) => new V2(x, y)), 48, PI)
    const p = geo.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      const z = p.getZ(i)
      const f = 0.9 + 0.13 * Math.abs(Math.sin(4 * Math.atan2(x, z)))
      p.setX(i, x * f)
      p.setZ(i, z * f)
    }
    remapLatheV(geo, 'y')
    geo.computeVertexNormals()
    return geo
  })
  add(g, canopy, mat('#ffffff', { roughness: 0.7, map: dots }), [0, 0, 0], yAxisToX)
  const strap = plastic('#24467f', 0.6)
  add(g, G.tor(0.385, 0.032, 6, 40), strap, [0.6, 0, 0], [0, PI / 2, 0], [1, 1, 2.6])
  add(g, G.rbox(0.34, 0.035, 0.16, 0.015, 1), strap, [0.8, 0.355, 0], [0, 0, -0.16])
  add(g, G.cyl(0.055, 0.06, 0.04, 12), chrome(), [0.66, 0.4, 0], [0, 0, -0.08])
  // shaft, collar, ferrule
  const ch = chrome()
  add(g, G.cyl(0.045, 0.045, 0.5, 10), ch, [-1.8, 0, 0], yAxisToX)
  add(g, G.cyl(0.07, 0.1, 0.1, 14), ch, [-1.6, 0, 0], yAxisToX)
  add(g, G.cyl(0.03, 0.06, 0.34, 12), ch, [2.72, 0, 0], yAxisToX)
  add(g, G.sph(0.05, 10, 8), ch, [2.9, 0, 0])
  // J-handle
  const wood = paint('#7a3b1c', 0.3)
  const hx = -2.62
  add(g, G.cyl(0.1, 0.1, 0.58, 14), wood, [hx + 0.29, 0, 0], yAxisToX)
  add(g, G.tor(0.28, 0.1, 10, 24, 3.66), wood, [hx, -0.28, 0], [0, 0, PI / 2])
  add(g, G.sph(0.1, 12, 8), wood, [hx + 0.28 * Math.cos(PI / 2 + 3.66), -0.28 + 0.28 * Math.sin(PI / 2 + 3.66), 0])
  add(g, G.cyl(0.11, 0.11, 0.06, 14), brass(), [-2.05, 0, 0], yAxisToX)
}

function boot(g) {
  const yellow = mat('#ffc928', { roughness: 0.3 })
  const sole = rubber('#4a3224')
  add(g, extrude('bootsole', () => footShape(2.3, 0.5, 0.64), 0.14, { bevel: 0.045, bevelSeg: 1, curveSeg: 9 }), sole, [0, 0.115, 0], [PI / 2, 0, 0])
  const sx = grp(g, [0, 0, -0.42], null, [1, 1, 1.04])
  add(sx, G.lathe([[0.66, 0.18], [0.69, 0.6], [0.72, 1.6], [0.74, 2.4], [0.79, 2.6], [0.76, 2.63]], 28, 0.03), yellow)
  const tartan = canvasTex('tartan', 64, 64, (c, w, h) => {
    c.fillStyle = '#c63b2f'
    c.fillRect(0, 0, w, h)
    c.globalAlpha = 0.55
    c.fillStyle = '#1f3d6b'
    c.fillRect(0, 20, w, 14)
    c.fillRect(20, 0, 14, h)
    c.fillStyle = '#f2d25a'
    c.fillRect(0, 50, w, 3)
    c.fillRect(50, 0, 3, h)
    c.globalAlpha = 1
  }, { repeat: [6, 2] })
  add(sx, G.lathe([[0.75, 2.61], [0.71, 2.5], [0.67, 1.9], [0, 1.85]], 28, 0.02), cloth('#ffffff', tartan))
  add(sx, G.tor(0.745, 0.035, 6, 32), mat('#f0a91c', { roughness: 0.35 }), [0, 2.32, 0], [PI / 2, 0, 0])
  add(sx, G.rbox(0.3, 0.42, 0.08, 0.035, 2), plastic('#d9483b'), [0, 2.52, -0.78])
  add(sx, G.cyl(0.15, 0.15, 0.04, 20), plastic('#d9483b'), [0.74, 2.0, 0], [0, 0, -PI / 2])
  add(sx, G.cyl(0.09, 0.09, 0.04, 16), plastic('#fff6dc'), [0.765, 2.0, 0], [0, 0, -PI / 2])
  // the foot (vamp)
  add(g, G.cap(0.55, 0.95, 4, 18), yellow, [0, 0.6, 0.1], [PI / 2 + 0.12, 0, 0], [1.12, 1, 0.84])
}

function fedora(g) {
  const felt = cloth('#ffffff', feltTex('#7d5f45', 'fedora'))
  const brim = cached('fedora-brim', () => {
    const prof = roundPolyline([[0.58, 0], [1.0, -0.01], [1.15, 0.03], [1.22, 0.12], [1.2, 0.17], [1.13, 0.11], [0.98, 0.05], [0.58, 0.06]], 0.025, 1)
    const geo = new THREE.LatheGeometry(prof.map(([x, y]) => new V2(x, y)), 40, PI)
    const p = geo.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      const z = p.getZ(i)
      const r = Math.hypot(x, z) || 1
      const t = Math.max(0, (r - 0.58) / 0.64)
      let dy = 0.09 * t * t * ((x * x - z * z) / (r * r))
      if (z > 0) dy -= 0.07 * t * t * (z / r) ** 2
      p.setY(i, p.getY(i) + dy)
    }
    geo.computeVertexNormals()
    return geo
  })
  add(g, brim, felt)
  const crown = cached('fedora-crown', () => {
    const prof = roundPolyline([[0.6, 0.02], [0.63, 0.35], [0.61, 0.8], [0.55, 1.04], [0.43, 1.13], [0.25, 1.06], [0, 1.0]], 0.06, 2)
    const geo = new THREE.LatheGeometry(prof.map(([x, y]) => new V2(x, y)), 32, PI)
    const p = geo.attributes.position
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i)
      const y = p.getY(i)
      const z = p.getZ(i)
      const r = Math.hypot(x, z) || 1
      // centre crease (teardrop, deeper at the front) + front pinch
      const t = Math.min(1, Math.max(0, (y - 0.62) / 0.5))
      const crease = 0.17 * t * Math.exp(-(x * x) / 0.03) * (1 - 0.35 * Math.max(0, -z / r))
      const nx = y > 0.45 && z > 0 ? x * (1 - 0.3 * Math.min(1, (y - 0.45) / 0.6) * (z / r)) : x
      p.setXYZ(i, nx, y - crease, z)
    }
    geo.computeVertexNormals()
    return geo
  })
  add(g, crown, felt)
  const ribbon = cloth('#3a2418')
  add(g, G.cyl(0.632, 0.645, 0.2, 40, true), ribbon, [0, 0.13, 0])
  add(g, G.rbox(0.07, 0.16, 0.12, 0.03, 1), ribbon, [0.65, 0.14, 0.05])
  add(g, G.sph(0.12, 10, 8), ribbon, [0.655, 0.14, 0.2], null, [0.28, 0.55, 1])
  add(g, G.sph(0.12, 10, 8), ribbon, [0.655, 0.14, -0.1], null, [0.28, 0.55, 1])
  // feather
  const fg = grp(g, [0.67, 0.3, -0.12], [-0.6, 0, -0.18])
  add(fg, G.sph(0.32, 12, 10), cloth('#d8452f'), [0, 0.22, 0], null, [0.12, 1, 0.32])
  add(fg, G.sph(0.12, 10, 8), cloth('#f2c13a'), [0, 0.5, 0], null, [0.14, 1, 0.4])
}

function keys(g) {
  const blade = extrude('keyblade', () => polyShape([[-0.05, 0], [-0.05, 0.6], [0, 0.67], [0.06, 0.6], [0.06, 0.55], [0.1, 0.52], [0.1, 0.47], [0.06, 0.44], [0.06, 0.38], [0.11, 0.34], [0.11, 0.29], [0.06, 0.26], [0.06, 0.2], [0.09, 0.17], [0.06, 0.13], [0.06, 0]]), 0.03, { bevel: 0.012, bevelSeg: 1 })
  const head = extrude('keyhead', () => {
    const s = new THREE.Shape()
    s.absarc(0, 0, 0.17, 0, TAU, false)
    const hole = new THREE.Path()
    hole.absarc(0, -0.08, 0.045, 0, TAU, true)
    s.holes.push(hole)
    return s
  }, 0.045, { bevel: 0.018, bevelSeg: 1, curveSeg: 8 })
  const ring = [0.02, 0.04, -0.52]
  const R = 0.3
  add(g, G.tor(R, 0.035, 6, 28), chrome(), ring, [PI / 2, 0, 0])
  const kinds = [
    { a: 0.0, head: brass(), blade: brass(), y: 0.04, tilt: 0.04 },
    { a: 0.27, head: plastic('#e04646'), blade: metal('#c9ced6', 0.25), y: 0.08, tilt: -0.05 },
    { a: 0.52, head: plastic('#3b7be0'), blade: metal('#c9ced6', 0.25), y: 0.05, tilt: 0.06 },
  ]
  for (const k of kinds) {
    const dir = [Math.sin(k.a), Math.cos(k.a)]
    const kg = grp(g, [ring[0] + dir[0] * (R + 0.25), k.y, ring[2] + dir[1] * (R + 0.25)], [k.tilt, k.a, 0, 'YXZ'])
    const flat = grp(kg, [0, 0, 0], [PI / 2, 0, 0])
    add(flat, head, k.head, [0, 0.0, 0])
    add(flat, blade, k.blade, [0, 0.15, 0])
  }
  // car fob
  const fa = -0.42
  const fob = grp(g, [ring[0] + Math.sin(fa) * (R + 0.05), 0.12, ring[2] + Math.cos(fa) * (R + 0.05)], [0, fa, 0])
  add(fob, G.tor(0.07, 0.02, 6, 14), chrome(), [0, 0, 0.02], [0, PI / 2, 0])
  add(fob, G.rbox(0.44, 0.22, 0.68, 0.1, 1), plastic('#24252b', 0.35), [0, 0, 0.44])
  add(fob, G.cyl(0.07, 0.07, 0.03, 14), plastic('#8a8f99'), [0, 0.115, 0.32])
  add(fob, G.cyl(0.07, 0.07, 0.03, 14), plastic('#8a8f99'), [0, 0.115, 0.5])
  add(fob, G.cyl(0.06, 0.06, 0.03, 14), plastic('#e23b3b'), [0, 0.115, 0.67])
  add(fob, G.tor(0.06, 0.012, 6, 18), chrome(), [0, 0.112, 0.16], [PI / 2, 0, 0])
}

function vase(g) {
  const blue = '#2a55a8'
  const delft = canvasTex('delft', 256, 128, (c, w, h) => {
    c.fillStyle = '#f8f6ef'
    c.fillRect(0, 0, w, h)
    const Y = (v) => (1 - v) * h
    c.fillStyle = blue
    c.fillRect(0, Y(0.045), w, Y(0) - Y(0.045))
    c.fillRect(0, Y(0.135), w, 2)
    c.fillRect(0, Y(0.63), w, 2)
    c.fillRect(0, Y(0.86), w, 2)
    c.fillRect(0, Y(1), w, Y(0.975) - Y(1))
    // scallops
    for (let i = 0; i < 24; i++) {
      c.beginPath()
      c.arc((i + 0.5) * (w / 24), Y(0.15), 5, 0, PI)
      c.fill()
    }
    // dots on the shoulder
    for (let i = 0; i < 32; i++) {
      c.beginPath()
      c.arc((i + 0.5) * (w / 32), Y(0.69), 2, 0, TAU)
      c.fill()
    }
    // three flowers around the belly (one centred on the front)
    const flower = (x) => {
      const y = Y(0.42)
      c.strokeStyle = blue
      c.lineWidth = 2.5
      c.beginPath()
      c.moveTo(x, y + 6)
      c.bezierCurveTo(x - 4, y + 18, x + 6, y + 26, x, y + 36)
      c.stroke()
      for (const s of [-1, 1]) {
        c.beginPath()
        c.ellipse(x + s * 10, y + 22, 9, 4, s * 0.6, 0, TAU)
        c.fill()
      }
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU
        c.beginPath()
        c.ellipse(x + Math.cos(a) * 9, y + Math.sin(a) * 9, 7, 4, a, 0, TAU)
        c.fill()
      }
      c.fillStyle = '#f8f6ef'
      c.beginPath()
      c.arc(x, y, 4, 0, TAU)
      c.fill()
      c.fillStyle = blue
    }
    for (const u of [1 / 6, 0.5, 5 / 6]) wrapDraw(w, u * w, flower)
    // little birds between the flowers
    c.lineWidth = 2
    for (const u of [0, 1 / 3, 2 / 3]) {
      wrapDraw(w, u * w, (x) => {
        c.beginPath()
        c.moveTo(x - 8, Y(0.5))
        c.quadraticCurveTo(x - 4, Y(0.53), x, Y(0.5))
        c.quadraticCurveTo(x + 4, Y(0.53), x + 8, Y(0.5))
        c.stroke()
      })
    }
  })
  const glaze = ceramic('#ffffff', delft)
  add(g, G.lathe([[0, 0], [0.36, 0], [0.4, 0.06], [0.55, 0.45], [0.57, 0.75], [0.5, 1.1], [0.3, 1.45], [0.24, 1.6], [0.28, 1.76], [0.33, 1.82], [0.29, 1.845], [0.22, 1.72], [0.2, 1.56]], 24, 0.04, 1, 'y'), glaze)
  add(g, G.circle(0.21, 16), mat('#2b3a4a', { roughness: 0.2 }), [0, 1.56, 0], [-PI / 2, 0, 0])
  // flowers
  const stem = plastic('#4f9a3a', 0.6)
  const daisyShape = (petals, R) => () => {
    const pts = []
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * TAU
      const r = R * (0.45 + 0.55 * Math.pow(Math.abs(Math.cos((petals / 2) * a)), 0.7))
      pts.push([Math.cos(a) * r, Math.sin(a) * r])
    }
    return polyShape(pts)
  }
  const flowerHead = (pos, dir, petals, R, petalMat, centreMat) => {
    const f = grp(g, pos)
    f.lookAt(pos[0] + dir[0], pos[1] + dir[1], pos[2] + dir[2])
    add(f, extrude('petals' + petals + R, daisyShape(petals, R), 0.03, { bevel: 0.015, bevelSeg: 1, curveSeg: 4 }), petalMat)
    add(f, G.sph(R * 0.32, 8, 5), centreMat, [0, 0, 0.03], null, [1, 1, 0.55])
  }
  const stemTo = (end, bend) => {
    add(g, tube([[0, 1.55, 0], [end[0] * 0.4 + bend[0], 1.95 + bend[1], end[2] * 0.4 + bend[2]], end], 0.035, { seg: 8, radial: 4 }), stem)
  }
  const daisy = [0.12, 2.78, 0.3]
  stemTo(daisy, [0, 0.2, 0])
  flowerHead(daisy, [0.25, 0.55, 0.8], 12, 0.3, cloth('#ffffff'), plastic('#ffc21f', 0.5))
  const blueF = [-0.3, 2.82, -0.32]
  stemTo(blueF, [0, 0.25, 0])
  flowerHead(blueF, [-0.4, 0.8, -0.3], 8, 0.2, cloth('#5b8ff0'), plastic('#ffe08a', 0.5))
  const blueF2 = [0.42, 2.25, 0.42]
  stemTo(blueF2, [0.1, 0.1, 0.1])
  flowerHead(blueF2, [0.6, 0.4, 0.7], 8, 0.18, cloth('#ff8fb1'), plastic('#ffe08a', 0.5))
  // tulip
  const tulip = [-0.55, 2.5, 0.08]
  stemTo(tulip, [-0.05, 0.1, 0])
  const tg = grp(g, tulip, [0, 0, 0.4])
  add(tg, G.lathe([[0, -0.05], [0.12, -0.02], [0.17, 0.08], [0.17, 0.2], [0.12, 0.27], [0.06, 0.22], [0, 0.2]], 10, 0.03), plastic('#e2353f', 0.45))
  // rose
  const rose = [0.55, 2.55, -0.25]
  stemTo(rose, [0.05, 0.1, 0])
  const rg = grp(g, rose, [0.3, 0, -0.35])
  add(rg, G.lathe([[0, -0.12], [0.12, -0.1], [0.2, 0.0], [0.2, 0.1], [0.16, 0.13], [0.12, 0.06], [0, 0.04]], 12, 0.03), plastic('#f06a92', 0.5))
  add(rg, G.sph(0.12, 10, 8), plastic('#d9456f', 0.5), [0, 0.07, 0], null, [1, 0.8, 1])
  add(rg, G.cone(0.13, 0.1, 8), plastic('#4f9a3a', 0.6), [0, -0.14, 0], [PI, 0, 0])
  // leaves
  const leaf = plastic('#3f8a2f', 0.55)
  for (const [a, tilt] of [[0.6, 0.9], [2.4, 0.8], [4.2, 1.0]]) {
    const lg = grp(g, [Math.sin(a) * 0.15, 1.7, Math.cos(a) * 0.15], [tilt, a, 0, 'YXZ'])
    add(lg, G.sph(0.22, 8, 5), leaf, [0, 0.2, 0], null, [0.38, 1, 0.12])
  }
}

function wallet(g) {
  const leatherTex = canvasTex('wallet-leather', 128, 128, (c, w, h) => {
    c.fillStyle = '#7a4326'
    c.fillRect(0, 0, w, h)
    speckle(c, w, h, 400, ['#6a3820', '#8a5030'], { min: 0.5, max: 1.6, alpha: 0.6 })
    stitches(c, 11, 11, w - 22, h - 22, 10, '#f0d9a8', 2.5, [6, 4])
  })
  const leather = mat('#ffffff', { roughness: 0.6, map: leatherTex })
  add(g, G.rbox(1.42, 0.17, 0.95, 0.07, 2), leather, [0, 0.085, 0])
  const top = grp(g, [0, 0.17, -0.47], [-0.07, 0, 0])
  add(top, G.rbox(1.42, 0.17, 0.95, 0.07, 2), leather, [0, 0.095, 0.47])
  add(top, G.rbox(0.26, 0.03, 0.3, 0.012, 1), leather, [0.45, 0.19, 0.86])
  add(top, G.cyl(0.04, 0.04, 0.03, 12), chrome(), [0.45, 0.2, 0.92])
  add(g, G.cap(0.1, 1.24, 3, 10), leather, [0, 0.18, -0.47], [0, 0, PI / 2])
  // banknotes sticking out of the open edge + a card
  const nm = noteMat()
  add(g, G.box(1.16, 0.012, 0.58), nm, [-0.04, 0.17, 0.3], [0.03, 0.1, 0])
  add(g, G.box(1.16, 0.012, 0.58), nm, [0.06, 0.19, 0.34], [0.06, -0.08, 0])
  add(g, G.box(1.16, 0.012, 0.58), nm, [0.25, 0.2, 0.0], [0.02, -0.5, 0.04])
  const card = canvasTex('card', 128, 80, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, w, h)
    gr.addColorStop(0, '#3a6fd8')
    gr.addColorStop(1, '#1e3f8f')
    c.fillStyle = gr
    c.fillRect(0, 0, w, h)
    rr(c, 14, 26, 24, 18, 4)
    c.fillStyle = '#f2c94c'
    c.fill()
  })
  add(g, G.box(0.56, 0.012, 0.36), mat('#ffffff', { roughness: 0.3, map: card }), [-0.6, 0.27, 0.15], [0, 0.35, 0.05])
}

function pocketwatch(g) {
  const au = gold()
  const cx = 0.225
  add(g, G.lathe([[0, 0], [0.18, 0], [0.215, 0.025], [0.226, 0.1], [0.22, 0.17], [0.2, 0.205], [0.18, 0.21], [0.172, 0.19], [0, 0.19]], 28, 0.015), au, [cx, 0, 0])
  const dial = canvasTex('pocketdial', 128, 128, (c, w, h) => {
    const m = w / 2
    c.fillStyle = '#fbf3df'
    c.fillRect(0, 0, w, h)
    c.strokeStyle = '#b8892f'
    c.lineWidth = 4
    c.beginPath()
    c.arc(m, m, 60, 0, TAU)
    c.stroke()
    const rom = ['XII', 'I', 'II', 'III', 'IIII', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI']
    rom.forEach((r, i) => {
      const a = (i / 12) * TAU
      txt(c, r, m + Math.sin(a) * 45, m - Math.cos(a) * 45, 11, '#2a2320', { font: 'Georgia, serif', weight: 700 })
    })
    c.strokeStyle = '#2a2320'
    c.lineWidth = 1
    c.beginPath()
    c.arc(m, m + 24, 9, 0, TAU)
    c.stroke()
    c.lineCap = 'round'
    c.lineWidth = 4
    c.beginPath()
    c.moveTo(m, m)
    c.lineTo(m - 20, m - 16)
    c.stroke()
    c.lineWidth = 2.5
    c.beginPath()
    c.moveTo(m, m)
    c.lineTo(m + 22, m - 34)
    c.stroke()
  }, { text: true })
  add(g, G.circle(0.175, 28), mat('#ffffff', { roughness: 0.4, map: dial }), [cx, 0.191, 0], [-PI / 2, 0, 0])
  add(g, G.cyl(0.015, 0.015, 0.02, 8), au, [cx, 0.2, 0])
  const th = 0.5
  const Rc = 0.18 / Math.sin(th)
  add(g, G.sph(Rc, 24, 4, 0, TAU, 0, th), glass('#ffffff', 0.22), [cx, 0.195 - Rc * Math.cos(th), 0])
  // crown + bow at +Z
  add(g, G.cyl(0.025, 0.025, 0.07, 8), au, [cx, 0.1, 0.25], yAxisToZ)
  add(g, G.cyl(0.05, 0.05, 0.06, 12), au, [cx, 0.1, 0.3], yAxisToZ)
  add(g, G.tor(0.075, 0.018, 5, 14), au, [cx, 0.1, 0.4], [PI / 2, 0, 0])
  // open lid lying at -X (hinged at 9 o'clock), engraved inside
  add(g, G.cyl(0.025, 0.025, 0.14, 10), au, [0, 0.03, 0], yAxisToZ)
  add(g, G.lathe([[0, 0], [0.18, 0.004], [0.215, 0.02], [0.226, 0.05], [0.21, 0.06], [0, 0.055]], 28, 0.01), au, [-0.225, 0, 0])
  const engr = canvasTex('engrave', 128, 128, (c, w, h) => {
    const m = w / 2
    c.fillStyle = '#e7b748'
    c.fillRect(0, 0, w, h)
    c.strokeStyle = '#8a5d14'
    c.lineWidth = 2
    c.beginPath()
    c.arc(m, m, 54, 0, TAU)
    c.stroke()
    c.beginPath()
    c.arc(m, m, 48, 0, TAU)
    c.stroke()
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * TAU
      c.beginPath()
      c.arc(m + Math.cos(a) * 51, m + Math.sin(a) * 51, 2, 0, TAU)
      c.fillStyle = '#8a5d14'
      c.fill()
    }
    txt(c, 'Love,', m, m - 14, 18, '#7a4f0e', { font: 'Georgia, serif', italic: true })
    txt(c, 'Martha', m, m + 6, 20, '#7a4f0e', { font: 'Georgia, serif', italic: true })
    txt(c, '1958', m, m + 28, 12, '#7a4f0e', { font: 'Georgia, serif' })
  }, { text: true })
  add(g, G.circle(0.195, 28), gold(0.28, engr), [-0.225, 0.058, 0], [-PI / 2, 0, 0])
  // chain
  const curve = new THREE.CatmullRomCurve3([[cx, 0.03, 0.45], [0.4, 0.03, 0.49], [0.5, 0.03, 0.27], [0.47, 0.03, -0.08], [0.33, 0.03, -0.34], [0.12, 0.03, -0.45]].map((p) => new V3(...p)))
  const N = 15
  const P = new V3()
  const T = new V3()
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N
    curve.getPointAt(t, P)
    curve.getTangentAt(t, T)
    const yaw = Math.atan2(T.x, T.z)
    const lg = grp(g, [P.x, P.y, P.z], [0, yaw, 0])
    if (i % 2) add(lg, G.tor(0.036, 0.012, 4, 8), au, null, [0, PI / 2, 0], [1.5, 1, 1])
    else add(lg, G.tor(0.036, 0.012, 4, 8), au, null, [PI / 2, 0, 0], [1, 1.5, 1])
  }
  add(g, G.cyl(0.018, 0.018, 0.18, 8), au, [0.1, 0.03, -0.47], [0, 0, PI / 2])
  add(g, G.sph(0.03, 8, 6), au, [0.01, 0.03, -0.47])
  add(g, G.sph(0.03, 8, 6), au, [0.19, 0.03, -0.47])
}

function snowglobe(g) {
  const woodT = woodTex('globe-base', '#5a2f1a', '#3a1c0e', '#7a4526', 'x', 5)
  add(g, G.lathe([[0, 0], [0.6, 0], [0.62, 0.04], [0.61, 0.1], [0.55, 0.14], [0.52, 0.28], [0.47, 0.36], [0.4, 0.38], [0, 0.38]], 30, 0.02), mat('#ffffff', { roughness: 0.25, map: woodT }))
  add(g, G.arcCyl(0.545, 0.09, -0.4, 0.8, 10), brass(), [0, 0.21, 0])
  const cy = 0.8
  // inside: snowy ground, a cosy house, a pine tree, flakes
  const snow = mat('#fbfdff', { roughness: 0.7 })
  add(g, G.sph(0.47, 20, 5, 0, TAU, 0, PI / 2), snow, [0, 0.5, 0], null, [1, 0.3, 1])
  add(g, G.rbox(0.26, 0.2, 0.22, 0.025, 2), plastic('#d24a3a', 0.6), [0.06, 0.72, -0.02])
  add(g, extrude('gl-roof', () => polyShape([[-0.18, 0], [0.18, 0], [0, 0.14]]), 0.26, { bevel: 0.015, bevelSeg: 1 }), snow, [0.06, 0.815, -0.02])
  add(g, G.box(0.05, 0.09, 0.05), plastic('#7a3b2a'), [0.13, 0.9, -0.08])
  add(g, G.box(0.06, 0.1, 0.01), plastic('#5a3220'), [0.12, 0.67, 0.095])
  add(g, G.box(0.06, 0.05, 0.01), glow('#ffcc55', 1.2), [0.0, 0.73, 0.095])
  const pine = plastic('#2f7a4a', 0.6)
  add(g, G.cyl(0.02, 0.025, 0.08, 6), plastic('#6b4226'), [-0.22, 0.66, 0.0])
  add(g, G.cone(0.12, 0.18, 10), pine, [-0.22, 0.76, 0.0])
  add(g, G.cone(0.09, 0.15, 10), pine, [-0.22, 0.86, 0.0])
  add(g, G.cone(0.05, 0.08, 8), snow, [-0.22, 0.95, 0.0])
  const r = rng(42)
  const flake = glow('#ffffff', 0.4)
  for (let i = 0; i < 14; i++) {
    const a = r() * TAU
    const d = Math.sqrt(r()) * 0.4
    add(g, G.oct(0.022), flake, [Math.sin(a) * d, 0.72 + r() * 0.45, Math.cos(a) * d])
  }
  add(g, G.sph(0.55, 26, 18), glass('#e8f6ff', 0.3), [0, cy, 0])
  add(g, G.sph(0.556, 10, 6, 0.35, 0.6, 0.45, 0.42), mat('#ffffff', { emissive: '#ffffff', ei: 0.6, opacity: 0.45, order: 4, noShadow: true }), [0, cy, 0])
}

// =========================================================================================
//  LIVING ROOM
// =========================================================================================
function remote(g) {
  add(g, G.rbox(0.72, 0.28, 2.1, 0.12, 3), plastic('#2b2d33', 0.4), [0, 0, 0])
  const y = 0.14
  add(g, G.cyl(0.08, 0.08, 0.05, 16), plastic('#e2383a', 0.35), [0.18, y, 0.82])
  add(g, G.rbox(0.22, 0.06, 0.04, 0.02, 1), plastic('#7a1418', 0.15), [0, 0, 1.05])
  const cols = ['#e2383a', '#3fbf5a', '#f2c230', '#3b7be0']
  cols.forEach((c, i) => add(g, G.rbox(0.12, 0.05, 0.09, 0.025, 1), plastic(c, 0.35), [-0.24 + i * 0.16, y, 0.58]))
  add(g, G.tor(0.17, 0.04, 6, 24), plastic('#8a8f99', 0.35), [0, y + 0.005, 0.24], [PI / 2, 0, 0])
  add(g, G.cyl(0.08, 0.08, 0.05, 16), plastic('#c9ccd3', 0.35), [0, y, 0.24])
  add(g, G.rbox(0.12, 0.05, 0.3, 0.05, 1), plastic('#8a8f99', 0.35), [-0.22, y, -0.18])
  add(g, G.rbox(0.12, 0.05, 0.3, 0.05, 1), plastic('#8a8f99', 0.35), [0.22, y, -0.18])
  const btn = plastic('#c9ccd3', 0.35)
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 3; c++) {
      if (r === 3 && c !== 1) continue
      add(g, G.cyl(0.055, 0.055, 0.04, 10), btn, [-0.18 + c * 0.18, y, -0.42 - r * 0.15])
    }
  }
  const logo = canvasTex('remote-logo', 128, 32, (c, w, h) => {
    c.fillStyle = '#2b2d33'
    c.fillRect(0, 0, w, h)
    txt(c, 'GRANDPA TV', w / 2, h / 2 + 1, 18, '#c9ccd3')
  }, { text: true })
  add(g, G.plane(0.5, 0.125), mat('#ffffff', { roughness: 0.4, map: logo }), [0, 0.141, -0.93], [-PI / 2, 0, 0])
}

function lamp(g) {
  const baseTex = canvasTex('lamp-base', 128, 128, (c, w, h) => {
    c.fillStyle = '#3f9a8c'
    c.fillRect(0, 0, w, h)
    c.strokeStyle = '#f3e6c8'
    c.lineWidth = 3
    for (const v of [0.42, 0.58]) {
      c.beginPath()
      for (let x = 0; x <= w; x += 2) {
        const y = (1 - v) * h + Math.sin((x / w) * TAU * 6) * 4
        x === 0 ? c.moveTo(x, y) : c.lineTo(x, y)
      }
      c.stroke()
    }
    c.fillStyle = '#f3e6c8'
    for (let i = 0; i < 12; i++) {
      c.beginPath()
      c.arc((i + 0.5) * (w / 12), 0.5 * h, 3, 0, TAU)
      c.fill()
    }
  })
  add(g, G.lathe([[0, 0], [0.42, 0], [0.46, 0.05], [0.44, 0.12], [0.6, 0.45], [0.7, 0.85], [0.62, 1.25], [0.4, 1.5], [0.3, 1.58], [0.32, 1.64], [0, 1.66]], 28, 0.04, 1, 'y'), ceramic('#ffffff', baseTex))
  const br = brass()
  add(g, G.cyl(0.12, 0.17, 0.14, 16), br, [0, 1.72, 0])
  add(g, G.cyl(0.035, 0.035, 1.75, 8), br, [0, 2.6, 0])
  add(g, G.cyl(0.09, 0.08, 0.22, 14), br, [0, 2.45, 0])
  add(g, G.sph(0.16, 10, 8), glow('#fff2c4', 0.5), [0, 2.7, 0], null, [1, 1.2, 1])
  const shadeTex = canvasTex('lamp-shade', 128, 64, (c, w, h) => {
    c.fillStyle = '#f3e6c8'
    c.fillRect(0, 0, w, h)
    for (let i = 0; i < 32; i++) {
      c.fillStyle = i % 2 ? 'rgba(160,120,70,0.10)' : 'rgba(255,255,255,0.12)'
      c.fillRect(i * (w / 32), 0, w / 32, h)
    }
    c.fillStyle = '#b9472f'
    c.fillRect(0, h - 9, w, 5)
    c.fillRect(0, 4, w, 4)
  })
  add(g, G.lathe([[1.0, 2.2], [0.66, 3.38], [0.64, 3.38], [0.98, 2.2], [1.0, 2.2]], 30, 0.012, 1, 'y'), mat('#ffffff', { roughness: 0.9, map: shadeTex, emissive: '#ffcf80', ei: 0.12 }))
  add(g, G.tor(1.0, 0.035, 5, 40), mat('#c98a2b', { roughness: 0.6 }), [0, 2.2, 0], [PI / 2, 0, 0])
  add(g, G.tor(0.655, 0.028, 5, 32), mat('#c98a2b', { roughness: 0.6 }), [0, 3.38, 0], [PI / 2, 0, 0])
  add(g, G.sph(0.08, 12, 8), br, [0, 3.48, 0])
  add(g, G.cyl(0.04, 0.05, 0.08, 10), br, [0, 3.4, 0])
}

function cushionLike(g, { w, h, d, tufts = [], tuftDepth = 0, tuftSize = 0.2, corner = 3.2, fabricTex, piping, buttonMat, tassel }) {
  const opts = { seg: 18, tufts, tuftDepth, tuftSize, corner }
  add(g, pillowGeo(w, h, d, opts), mat('#ffffff', { roughness: 0.92, map: fabricTex }))
  for (const [x, z] of tufts) {
    const y = pillowY(w, h, d, x, z, opts)
    add(g, G.sph(0.09, 8, 4), buttonMat, [x, y, z], null, [1, 0.5, 1])
    add(g, G.sph(0.09, 8, 4), buttonMat, [x, -y, z], null, [1, 0.5, 1])
  }
  const pts = []
  for (let i = 0; i < 40; i++) {
    const t = (i / 40) * TAU
    const c = Math.cos(t)
    const s = Math.sin(t)
    const ex = Math.sign(c) * Math.pow(Math.abs(c), 0.25)
    const ez = Math.sign(s) * Math.pow(Math.abs(s), 0.25)
    const fx = Math.max(0, 1 - Math.pow(Math.abs(ex), corner))
    const fz = Math.max(0, 1 - Math.pow(Math.abs(ez), corner))
    pts.push([((ex * w) / 2) * (0.97 + 0.03 * fz), 0, ((ez * d) / 2) * (0.97 + 0.03 * fx)])
  }
  add(g, tube(pts, 0.055, { seg: 72, radial: 5, closed: true }), piping)
  if (tassel) {
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const p = [sx * (w / 2) * 0.97, 0, sz * (d / 2) * 0.97]
        const tg = grp(g, p, [0, Math.atan2(sx, sz), 0])
        add(tg, G.sph(0.06, 6, 4), tassel, [0, 0, 0.04])
        add(tg, G.cone(0.08, 0.22, 10), tassel, [0, -0.0, 0.17], [-PI / 2 - 0.4, 0, 0])
      }
    }
  }
}
function cushion(g) {
  const velvet = canvasTex('velvet-rose', 128, 128, (c, w, h) => {
    weave(c, w, h, '#c9667a', { step: 2, alpha: 0.14, seed: 3 })
    c.strokeStyle = 'rgba(120,40,60,0.25)'
    c.lineWidth = 2
    for (const v of [0.25, 0.5, 0.75]) {
      c.beginPath()
      c.moveTo(0, v * h)
      c.lineTo(w, v * h)
      c.moveTo(v * w, 0)
      c.lineTo(v * w, h)
      c.stroke()
    }
  })
  const t = 0.72
  cushionLike(g, {
    w: 2.9, h: 0.96, d: 2.9, tufts: [[0, 0], [t, t], [-t, t], [t, -t], [-t, -t]], tuftDepth: 0.32, tuftSize: 0.24,
    fabricTex: velvet, piping: cloth('#f3e3c3'), buttonMat: gold(0.3), tassel: cloth('#e9c46a'),
  })
}

function bookLike(g, { cover, coverTex, pageTex, spineBand, corner, w = 1.4, h = 0.5, d = 2.0 }) {
  const ct = 0.07
  add(g, G.rbox(w - 0.1, ct, d, 0.03, 2), cover, [0.05, h / 2 - ct / 2, 0])
  add(g, G.rbox(w - 0.1, ct, d, 0.03, 2), cover, [0.05, -h / 2 + ct / 2, 0])
  add(g, G.box(w - 0.2, h - 2 * ct + 0.01, d - 0.1), mat('#ffffff', { roughness: 0.85, map: pageTex }), [0.02, 0, 0])
  add(g, G.cyl(h / 2, h / 2, d, 20), cover, [-w / 2 + 0.2, 0, 0], yAxisToZ, [0.5, 1, 1])
  if (spineBand) for (const z of [-0.6, -0.2, 0.2, 0.6].map((v) => (v * d) / 2)) add(g, G.cyl(h / 2 + 0.012, h / 2 + 0.012, 0.06, 20), spineBand, [-w / 2 + 0.2, 0, z], yAxisToZ, [0.5, 1, 1])
  add(g, G.plane(w - 0.22, d - 0.14), mat('#ffffff', { roughness: 0.55, map: coverTex }), [0.06, h / 2 + 0.001, 0], [-PI / 2, 0, 0])
  if (corner) {
    // brass corner caps: right-angle triangles with their legs running along the cover edges
    const tri = extrude('bookcorner', () => polyShape([[0, 0], [0.22, 0], [0, 0.22]]), 0.012, { bevel: 0.008, bevelSeg: 1 })
    const rot = { '1,1': [-PI / 2, PI / 2, 0, 'YXZ'], '1,-1': [-PI / 2, PI, 0, 'YXZ'], '-1,1': [PI / 2, PI, 0, 'YXZ'], '-1,-1': [PI / 2, -PI / 2, 0, 'YXZ'] }
    for (const sy of [1, -1]) {
      for (const sz of [1, -1]) add(g, tri, corner, [w / 2 - 0.01, sy * (h / 2 + 0.004), sz * (d / 2 - 0.01)], rot[sy + ',' + sz])
    }
  }
}
function pagesTex() {
  return canvasTex('pages', 64, 64, (c, w, h) => {
    c.fillStyle = '#f4ead2'
    c.fillRect(0, 0, w, h)
    for (let y = 1; y < h; y += 3) {
      c.fillStyle = `rgba(150,120,80,${0.12 + ((y * 7) % 5) * 0.03})`
      c.fillRect(0, y, w, 1)
    }
  })
}
function book(g) {
  const coverTex = canvasTex('book-cover', 128, 192, (c, w, h) => {
    c.fillStyle = '#7a2e22'
    c.fillRect(0, 0, w, h)
    speckle(c, w, h, 300, ['#6a261b', '#8a3a2c'], { min: 0.5, max: 1.5, alpha: 0.7 })
    c.strokeStyle = '#e3b44c'
    c.lineWidth = 3
    c.strokeRect(10, 10, w - 20, h - 20)
    c.lineWidth = 1.5
    c.strokeRect(16, 16, w - 32, h - 32)
    c.fillStyle = '#e3b44c'
    c.beginPath()
    c.moveTo(w / 2, h / 2 - 34)
    c.lineTo(w / 2 + 24, h / 2 + 6)
    c.lineTo(w / 2, h / 2 + 46)
    c.lineTo(w / 2 - 24, h / 2 + 6)
    c.closePath()
    c.fill()
    c.fillStyle = '#7a2e22'
    c.beginPath()
    c.arc(w / 2, h / 2 + 6, 10, 0, TAU)
    c.fill()
    txt(c, 'OLD', w / 2, 44, 22, '#e3b44c', { font: 'Georgia, serif' })
    txt(c, 'TALES', w / 2, 66, 22, '#e3b44c', { font: 'Georgia, serif' })
  }, { text: true })
  bookLike(g, { cover: mat('#7a2e22', { roughness: 0.6 }), coverTex, pageTex: pagesTex(), spineBand: mat('#5e2018', { roughness: 0.55 }), corner: brass() })
  // ribbon bookmark hanging out at the front
  add(g, G.box(0.1, 0.012, 0.36), cloth('#c8283a'), [0.3, -0.05, 1.08], [1.0, 0, 0])
}

function record(g) {
  const sleeve = canvasTex('sleeve', 256, 256, (c, w, h) => {
    const m = w / 2
    c.fillStyle = '#f7e2a8'
    c.fillRect(0, 0, w, h)
    for (let i = 0; i < 18; i++) {
      c.fillStyle = i % 2 ? '#f29a3a' : '#f7c95a'
      c.beginPath()
      c.moveTo(m, h * 0.62)
      c.arc(m, h * 0.62, 260, PI + (i / 18) * PI, PI + ((i + 1) / 18) * PI)
      c.closePath()
      c.fill()
    }
    c.fillStyle = '#e2503a'
    c.beginPath()
    c.arc(m, h * 0.62, 56, 0, TAU)
    c.fill()
    c.fillStyle = '#2b5d8f'
    c.fillRect(0, h * 0.62, w, h * 0.38)
    c.fillStyle = '#3b7ab5'
    for (let i = 0; i < 5; i++) c.fillRect(0, h * 0.66 + i * 14, w, 5)
    txt(c, 'GOLDEN', m, h * 0.17, 46, '#ffffff', { stroke: '#7a2e1a', lw: 8 })
    txt(c, 'OLDIES', m, h * 0.34, 46, '#ffffff', { stroke: '#7a2e1a', lw: 8 })
    txt(c, 'GRANDPA’S DANCE HITS • VOL. 2', m, h * 0.92, 15, '#f7e2a8')
  }, { text: true })
  const sw = 1.7
  add(g, G.rbox(sw, 0.09, sw, 0.03, 2), matte('#e8d6a0'), [-0.15, 0.045, -0.15])
  add(g, G.plane(sw - 0.07, sw - 0.07), mat('#ffffff', { roughness: 0.6, map: sleeve }), [-0.15, 0.0905, -0.15], [-PI / 2, 0, 0])
  const groove = canvasTex('vinyl', 256, 256, (c, w, h) => {
    const m = w / 2
    c.fillStyle = '#121214'
    c.fillRect(0, 0, w, h)
    for (let r = 44; r < 126; r += 2) {
      c.strokeStyle = (r / 2) % 2 ? '#1d1d22' : '#0c0c0e'
      c.lineWidth = 1
      c.beginPath()
      c.arc(m, m, r, 0, TAU)
      c.stroke()
    }
    for (const r of [70, 92, 110]) {
      c.strokeStyle = '#2a2a30'
      c.lineWidth = 2
      c.beginPath()
      c.arc(m, m, r, 0, TAU)
      c.stroke()
    }
    if (c.createConicGradient) {
      const cg = c.createConicGradient(0.6, m, m)
      cg.addColorStop(0, 'rgba(255,255,255,0)')
      cg.addColorStop(0.08, 'rgba(255,255,255,0.16)')
      cg.addColorStop(0.16, 'rgba(255,255,255,0)')
      cg.addColorStop(0.5, 'rgba(255,255,255,0)')
      cg.addColorStop(0.58, 'rgba(255,255,255,0.16)')
      cg.addColorStop(0.66, 'rgba(255,255,255,0)')
      c.fillStyle = cg
      c.beginPath()
      c.arc(m, m, 126, 0, TAU)
      c.arc(m, m, 42, 0, TAU, true)
      c.fill()
    }
    c.fillStyle = '#d8343b'
    c.beginPath()
    c.arc(m, m, 40, 0, TAU)
    c.fill()
    txt(c, 'GRANDPA', m, m - 16, 12, '#fff3d6')
    txt(c, 'RECORDS', m, m + 16, 12, '#fff3d6')
    c.fillStyle = '#f2f2f2'
    c.beginPath()
    c.arc(m, m, 4, 0, TAU)
    c.fill()
  }, { text: true })
  const rc = [0.2, 0.09, 0.2]
  add(g, G.cyl(0.8, 0.8, 0.05, 48, true), plastic('#121214', 0.3), [rc[0], rc[1] + 0.025, rc[2]])
  add(g, G.circle(0.8, 48), mat('#ffffff', { roughness: 0.28, map: groove }), [rc[0], rc[1] + 0.05, rc[2]], [-PI / 2, 0, 0])
  add(g, G.circle(0.8, 48), plastic('#121214', 0.3), [rc[0], rc[1] + 0.001, rc[2]], [PI / 2, 0, 0])
}

function trophy(g) {
  add(g, G.rbox(1.12, 0.22, 1.12, 0.05, 1), mat('#1f3b33', { roughness: 0.15 }), [0, 0.11, 0])
  const wood = mat('#ffffff', { roughness: 0.3, map: woodTex('trophy', '#6b3b1e', '#45230f', '#8a5230', 'x', 8) })
  add(g, G.rbox(0.92, 0.3, 0.92, 0.04, 1), wood, [0, 0.37, 0])
  add(g, G.rbox(0.64, 0.18, 0.02, 0.008, 1), gold(0.3), [0, 0.37, 0.465])
  const plaque = canvasTex('trophy-plaque', 128, 36, (c, w, h) => {
    c.fillStyle = '#e8bf55'
    c.fillRect(0, 0, w, h)
    c.strokeStyle = '#8a6418'
    c.strokeRect(3, 3, w - 6, h - 6)
    txt(c, 'GOLF CHAMP', w / 2, 13, 12, '#5a3c0a')
    txt(c, '★ 1978 ★', w / 2, 26, 10, '#5a3c0a')
  }, { text: true })
  add(g, G.plane(0.6, 0.16), gold(0.35, plaque), [0, 0.37, 0.477])
  const au = gold(0.18)
  add(g, G.lathe([[0, 0.52], [0.3, 0.52], [0.28, 0.58], [0.12, 0.64], [0.08, 0.82], [0.1, 0.96], [0.17, 1.0], [0.1, 1.06], [0.14, 1.1], [0.36, 1.22], [0.45, 1.46], [0.48, 1.74], [0.5, 1.8], [0.46, 1.84], [0.3, 1.93], [0.13, 1.99], [0.13, 2.04], [0, 2.04]], 20, 0.02), au)
  for (const s of [-1, 1]) add(g, G.tor(0.17, 0.04, 5, 12, PI), au, [s * 0.44, 1.52, 0], [0, 0, s > 0 ? -PI / 2 : PI / 2])
  // golfer on the lid, mid back-swing
  const gf = grp(g, [0, 2.04, 0], [0, 0.5, 0], 1.3)
  for (const s of [-1, 1]) add(gf, G.cap(0.042, 0.16, 2, 8), au, [s * 0.05, 0.12, 0], [0, 0, s * 0.12])
  add(gf, G.cap(0.075, 0.13, 3, 10), au, [0, 0.33, 0], [0.15, 0, 0.1])
  add(gf, G.sph(0.068, 12, 10), au, [0.02, 0.5, 0.02])
  add(gf, G.cyl(0.07, 0.072, 0.03, 12), au, [0.02, 0.55, 0.02])
  add(gf, G.cyl(0.02, 0.02, 0.07, 6), au, [0.02, 0.55, 0.07], [PI / 2 - 0.3, 0, 0])
  add(gf, G.cap(0.03, 0.16, 2, 6), au, [-0.08, 0.4, 0.04], [0.3, 0, 0.9])
  add(gf, G.cap(0.03, 0.16, 2, 6), au, [0.08, 0.42, 0.04], [0.3, 0, -0.5])
  add(gf, G.cyl(0.012, 0.012, 0.5, 6), au, [-0.12, 0.62, -0.05], [-0.4, 0, 0.6])
  add(gf, G.rbox(0.07, 0.03, 0.04, 0.012, 1), au, [-0.28, 0.82, -0.14], [0, 0, 0.6])
  add(g, G.sph(0.04, 10, 8), ceramic('#ffffff'), [0.1, 2.08, 0.08])
}

function teacup(g) {
  const floral = canvasTex('floral', 256, 64, (c, w, h) => {
    c.fillStyle = '#fdfbf6'
    c.fillRect(0, 0, w, h)
    c.fillStyle = '#d9a63a'
    c.fillRect(0, 0, w, 4)
    c.fillRect(0, h - 3, w, 3)
    const rose = (x, y, s) => {
      for (const [dx, dy, col] of [[0, 0, '#f07a9a'], [-0.6, 0.2, '#f59ab3'], [0.6, 0.2, '#f59ab3']]) {
        c.fillStyle = col
        c.beginPath()
        c.arc(x + dx * s, y + dy * s, s * 0.8, 0, TAU)
        c.fill()
      }
      c.strokeStyle = '#c94a6e'
      c.lineWidth = 1.5
      c.beginPath()
      c.arc(x, y, s * 0.4, 0.5, 5)
      c.stroke()
      c.fillStyle = '#5fa04a'
      c.beginPath()
      c.ellipse(x - s * 1.3, y + s * 0.7, s * 0.7, s * 0.3, 0.5, 0, TAU)
      c.ellipse(x + s * 1.3, y + s * 0.7, s * 0.7, s * 0.3, -0.5, 0, TAU)
      c.fill()
    }
    for (let i = 0; i < 5; i++) wrapDraw(w, (i + 0.5) * (w / 5), (x) => rose(x, h * 0.48, 9))
    for (let i = 0; i < 5; i++) {
      wrapDraw(w, i * (w / 5), (x) => {
        c.fillStyle = '#7fb0e8'
        for (let k = 0; k < 3; k++) {
          c.beginPath()
          c.arc(x + (k - 1) * 6, h * 0.62 + (k % 2) * -8, 2.5, 0, TAU)
          c.fill()
        }
      })
    }
  })
  const por = white()
  add(g, G.lathe([[0, 0], [0.25, 0], [0.27, 0.02], [0.3, 0.04], [0.48, 0.07], [0.5, 0.1], [0.48, 0.11], [0.3, 0.075], [0.22, 0.06], [0, 0.06]], 30, 0.012), por)
  add(g, G.tor(0.49, 0.012, 4, 36), gold(0.25), [0, 0.105, 0], [PI / 2, 0, 0])
  add(g, G.lathe([[0.16, 0.06], [0.19, 0.08], [0.21, 0.11], [0.3, 0.22], [0.35, 0.42], [0.37, 0.66], [0.36, 0.68]], 30, 0.015, 1, 'y'), ceramic('#ffffff', floral))
  add(g, G.lathe([[0.35, 0.68], [0.34, 0.45], [0.28, 0.24], [0, 0.18]], 30, 0.02), por)
  add(g, G.tor(0.358, 0.012, 4, 32), gold(0.25), [0, 0.68, 0], [PI / 2, 0, 0])
  add(g, G.circle(0.335, 24), mat('#8a4b20', { roughness: 0.12 }), [0, 0.55, 0], [-PI / 2, 0, 0])
  add(g, G.tor(0.13, 0.035, 6, 16, 4.3), por, [0.4, 0.42, 0], [0, 0, -2.15])
  add(g, G.tor(0.13, 0.008, 3, 16, 4.3), gold(0.25), [0.4, 0.42, 0.034], [0, 0, -2.15])
}

function cookietin(g) {
  // 256 x 32 matches the tin's 5.5 m x 0.6 m side, so the lettering is not stretched
  const side = canvasTex('tin-side', 256, 32, (c, w, h) => {
    c.fillStyle = '#1d3f8f'
    c.fillRect(0, 0, w, h)
    c.fillStyle = '#e8bf55'
    c.fillRect(0, 2, w, 2)
    c.fillRect(0, h - 4, w, 2)
    for (let i = 0; i < 3; i++) wrapDraw(w, (i + 0.5) * (w / 3), (x) => txt(c, 'COOKIES', x, h / 2 + 1, 14, '#ffffff', { stroke: '#e8bf55', lw: 2 }))
    for (let i = 0; i < 3; i++) {
      wrapDraw(w, i * (w / 3), (x) => {
        c.strokeStyle = '#ffffff'
        c.lineWidth = 1.2
        for (let k = 0; k < 3; k++) {
          const a = (k / 3) * PI
          c.beginPath()
          c.moveTo(x - Math.cos(a) * 6, h / 2 - Math.sin(a) * 6)
          c.lineTo(x + Math.cos(a) * 6, h / 2 + Math.sin(a) * 6)
          c.stroke()
        }
      })
    }
  }, { text: true })
  add(g, G.cyl(0.87, 0.87, 0.6, 48), mat('#ffffff', { roughness: 0.3, metalness: 0.4, map: side }), [0, 0.32, 0])
  const lidTex = canvasTex('tin-lid', 256, 256, (c, w, h) => {
    const m = w / 2
    c.fillStyle = '#1d3f8f'
    c.fillRect(0, 0, w, h)
    c.strokeStyle = '#e8bf55'
    c.lineWidth = 5
    c.beginPath()
    c.arc(m, m, 118, 0, TAU)
    c.stroke()
    c.fillStyle = '#f6ead0'
    c.beginPath()
    c.arc(m, m + 6, 62, 0, TAU)
    c.fill()
    const ck = [[0, -18, '#d99a4e'], [-26, 14, '#c98a3e'], [26, 14, '#e3ad5e'], [0, 34, '#b97a33']]
    for (const [dx, dy, col] of ck) {
      c.fillStyle = col
      c.beginPath()
      c.arc(m + dx, m + 6 + dy, 20, 0, TAU)
      c.fill()
      c.fillStyle = '#5a3215'
      for (let k = 0; k < 3; k++) {
        c.beginPath()
        c.arc(m + dx + (k - 1) * 7, m + 6 + dy + ((k * 5) % 7) - 3, 2.5, 0, TAU)
        c.fill()
      }
    }
    txt(c, 'GRANDMA’S', m, 44, 22, '#e8bf55')
    txt(c, 'Butter Cookies', m, 214, 24, '#ffffff', { italic: true })
  }, { text: true })
  add(g, G.cyl(0.9, 0.9, 0.16, 48), mat('#e8bf55', { roughness: 0.3, metalness: 0.7 }), [0, 0.68, 0])
  add(g, G.circle(0.86, 48), mat('#ffffff', { roughness: 0.3, metalness: 0.35, map: lidTex }), [0, 0.761, 0], [-PI / 2, 0, 0])
  const rim = gold(0.25)
  add(g, G.tor(0.9, 0.028, 5, 44), rim, [0, 0.6, 0], [PI / 2, 0, 0])
  add(g, G.tor(0.885, 0.025, 5, 44), rim, [0, 0.76, 0], [PI / 2, 0, 0])
  add(g, G.tor(0.87, 0.022, 5, 44), rim, [0, 0.022, 0], [PI / 2, 0, 0])
}

function piggybank(g) {
  const pinkTex = canvasTex('pig-skin', 256, 128, (c, w, h) => {
    c.fillStyle = '#ffa3c0'
    c.fillRect(0, 0, w, h)
    const daisy = (x, y) => {
      c.fillStyle = '#ffffff'
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU
        c.beginPath()
        c.arc(x + Math.cos(a) * 3.4, y + Math.sin(a) * 3.4, 2.6, 0, TAU)
        c.fill()
      }
      c.fillStyle = '#ffd23a'
      c.beginPath()
      c.arc(x, y, 1.9, 0, TAU)
      c.fill()
    }
    const r = rng(19)
    for (let i = 0; i < 22; i++) daisy(((i + r() * 0.6) / 22) * w, h * (0.32 + r() * 0.36))
  })
  const pink = ceramic('#ffffff', pinkTex)
  const pinkPlain = ceramic('#ffa3c0')
  const deep = ceramic('#ff7fa6')
  add(g, G.sph(0.7, 26, 16), pink, [0, 0.78, -0.02], [0, PI / 2, 0], [1.32, 0.86, 1.0])
  add(g, G.lathe([[0, 0], [0.24, 0], [0.27, 0.05], [0.26, 0.18], [0.22, 0.21], [0, 0.21]], 20, 0.03), pinkPlain, [0, 0.74, 0.86], yAxisToZ)
  for (const s of [-1, 1]) add(g, G.sph(0.055, 8, 6), mat('#a83a5c', { roughness: 0.4 }), [s * 0.085, 0.74, 1.07], null, [0.8, 1.2, 0.5])
  for (const s of [-1, 1]) {
    const e = grp(g, [s * 0.36, 1.22, 0.45], [-0.35, 0, s * -0.45])
    add(e, G.cone(0.2, 0.32, 10), pinkPlain, [0, 0, 0], null, [1, 1, 0.42])
    add(e, G.cone(0.13, 0.22, 10), deep, [0, -0.02, 0.05], null, [1, 1, 0.3])
    add(g, G.sph(0.075, 10, 8), mat('#1a1a1f', { roughness: 0.1 }), [s * 0.27, 1.0, 0.8])
    add(g, G.sph(0.024, 6, 4), glow('#ffffff', 0.6), [s * 0.25, 1.03, 0.86])
    add(g, G.sph(0.11, 8, 6), mat('#ff86a8', { roughness: 0.4 }), [s * 0.44, 0.83, 0.66], [0, s * 0.6, 0], [1, 0.6, 0.25])
    for (const fz of [-1, 1]) {
      add(g, G.lathe([[0, 0], [0.15, 0], [0.17, 0.03], [0.15, 0.32], [0, 0.32]], 10, 0.03), pinkPlain, [s * 0.38, 0, fz * 0.5])
      add(g, G.circle(0.155, 16), deep, [s * 0.38, 0.001, fz * 0.5], [PI / 2, 0, 0])
    }
  }
  add(g, tube([[0, 0.82, -0.88], [0.04, 0.9, -1.0], [-0.03, 0.97, -1.04], [-0.08, 0.9, -1.0], [-0.02, 0.86, -1.02], [0.06, 0.92, -1.08]], 0.03, { seg: 16, radial: 5 }), pinkPlain)
  add(g, G.rbox(0.42, 0.05, 0.08, 0.02, 1), mat('#5a2a3a', { roughness: 0.5 }), [0, 1.38, -0.1])
  add(g, G.cyl(0.16, 0.16, 0.04, 20), gold(0.25), [0, 1.42, -0.1], yAxisToZ)
}

function yarn(g) {
  const yarnTex = canvasTex('yarn', 128, 128, (c, w, h) => {
    c.fillStyle = '#e8505b'
    c.fillRect(0, 0, w, h)
    const r = rng(9)
    for (let band = 0; band < 6; band++) {
      const ang = r() * PI
      const off = r() * h
      for (let k = 0; k < 7; k++) {
        c.strokeStyle = k % 2 ? 'rgba(140,20,35,0.45)' : 'rgba(255,170,170,0.4)'
        c.lineWidth = 2
        c.beginPath()
        for (let s = -20; s <= w + 20; s += 4) {
          const x = s
          const y = off + k * 4 + Math.tan(ang - PI / 2) * 0 + Math.sin(s * 0.05 + band) * 10
          s === -20 ? c.moveTo(x, y % h) : c.lineTo(x, y % h)
        }
        c.stroke()
      }
    }
  }, { repeat: [2, 1] })
  const ymat = cloth('#ffffff', yarnTex)
  add(g, G.sph(0.5, 22, 14), ymat)
  const strand = cloth('#d9434e')
  add(g, G.tor(0.505, 0.026, 5, 40), strand, [0, 0, 0], [0.4, 0.2, 0])
  add(g, G.tor(0.505, 0.026, 5, 40), strand, [0, 0, 0], [1.4, 0.9, 0.2])
  add(g, G.tor(0.505, 0.026, 5, 40), strand, [0, 0, 0], [2.3, -0.6, 0.9])
  add(g, tube([[0.25, -0.38, 0.25], [0.42, -0.48, 0.38], [0.58, -0.5, 0.28], [0.62, -0.5, 0.0], [0.5, -0.5, -0.2]], 0.026, { seg: 24, radial: 5 }), strand)
  const needle = mat('#d8c09a', { roughness: 0.4 })
  const knob = plastic('#7a5cd8', 0.3)
  for (const [rx, rz, x] of [[0.2, 0.55, -0.05], [-0.25, -0.4, 0.1]]) {
    const n = grp(g, [x, 0.12, 0], [rx, 0, rz])
    add(n, G.cyl(0.025, 0.025, 1.25, 8), needle, [0, 0, 0])
    add(n, G.cone(0.025, 0.08, 8), needle, [0, -0.66, 0], [PI, 0, 0])
    add(n, G.sph(0.06, 10, 8), knob, [0, 0.64, 0])
  }
}

function camera(g) {
  const leatherette = canvasTex('leatherette', 64, 64, (c, w, h) => {
    c.fillStyle = '#26262a'
    c.fillRect(0, 0, w, h)
    speckle(c, w, h, 260, ['#1a1a1d', '#36363c'], { min: 0.6, max: 1.8, seed: 4 })
  }, { wrap: true, repeat: [3, 1] })
  add(g, G.rbox(1.5, 0.6, 0.48, 0.07, 2), mat('#ffffff', { roughness: 0.75, map: leatherette }), [0, 0.42, 0])
  const ch = chrome()
  add(g, G.rbox(1.53, 0.16, 0.51, 0.06, 2), ch, [0, 0.78, 0])
  add(g, G.rbox(1.53, 0.1, 0.51, 0.045, 2), ch, [0, 0.08, 0])
  add(g, extrude('prism', () => polyShape([[-0.32, 0], [0.32, 0], [0.18, 0.32], [-0.18, 0.32]]), 0.44, { bevel: 0.03, bevelSeg: 2 }), ch, [0, 0.83, 0])
  const name = canvasTex('camname', 128, 32, (c, w, h) => {
    c.fillStyle = '#1b1b1e'
    c.fillRect(0, 0, w, h)
    txt(c, 'GRAMPAFLEX', w / 2, h / 2 + 1, 17, '#e8e8ea')
  }, { text: true })
  add(g, G.plane(0.38, 0.095), mat('#ffffff', { roughness: 0.4, map: name }), [0, 0.98, 0.253])
  // lens
  const rib = canvasTex('lensrib', 64, 16, (c, w, h) => {
    c.fillStyle = '#1b1b1e'
    c.fillRect(0, 0, w, h)
    for (let x = 0; x < w; x += 4) {
      c.fillStyle = '#3a3a40'
      c.fillRect(x, 0, 2, h)
    }
  }, { repeat: [6, 1] })
  add(g, G.cyl(0.28, 0.28, 0.12, 28), ch, [0, 0.42, 0.3], yAxisToZ)
  add(g, G.cyl(0.27, 0.27, 0.22, 28), mat('#ffffff', { roughness: 0.6, map: rib }), [0, 0.42, 0.46], yAxisToZ)
  add(g, G.cyl(0.29, 0.27, 0.08, 28), ch, [0, 0.42, 0.61], yAxisToZ)
  add(g, G.sph(0.4, 24, 6, 0, TAU, 0, 0.55), mat('#2b2350', { roughness: 0.05, metalness: 0.3, env: 2 }), [0, 0.42, 0.65 - 0.4 * Math.cos(0.55)], [PI / 2, 0, 0])
  add(g, G.sph(0.1, 10, 6, 0.6, 0.8, 0.5, 0.6), mat('#ffffff', { emissive: '#ffffff', ei: 0.5, opacity: 0.5, order: 4, noShadow: true }), [0, 0.42, 0.66])
  // knobs
  add(g, G.cyl(0.12, 0.12, 0.1, 18), ch, [-0.48, 0.91, 0])
  add(g, G.cyl(0.08, 0.08, 0.06, 14), ch, [0.42, 0.89, 0.06])
  add(g, G.cyl(0.04, 0.04, 0.05, 10), plastic('#d8343b', 0.3), [0.42, 0.94, 0.06])
  add(g, G.rbox(0.3, 0.03, 0.07, 0.015, 1), ch, [0.55, 0.88, -0.1], [0, 0.4, 0])
  for (const s of [-1, 1]) add(g, G.tor(0.05, 0.015, 6, 12), ch, [s * 0.77, 0.66, 0], [0, PI / 2, 0])
  add(g, G.cyl(0.05, 0.05, 0.03, 12), ch, [0.5, 0.55, 0.245], yAxisToZ)
}

function radio(g) {
  const woodT = woodTex('radio', '#8a4b22', '#5e2f12', '#a8622e', 'x', 12)
  add(g, extrude('radio-body', () => {
    const w = 2.3
    const h = 1.45
    const s = new THREE.Shape()
    s.moveTo(-w / 2 + 0.1, 0)
    s.lineTo(w / 2 - 0.1, 0)
    s.quadraticCurveTo(w / 2, 0, w / 2, 0.1)
    s.lineTo(w / 2, h - 0.55)
    s.quadraticCurveTo(w / 2, h, w / 2 - 0.55, h)
    s.lineTo(-w / 2 + 0.55, h)
    s.quadraticCurveTo(-w / 2, h, -w / 2, h - 0.55)
    s.lineTo(-w / 2, 0.1)
    s.quadraticCurveTo(-w / 2, 0, -w / 2 + 0.1, 0)
    return s
  }, 0.82, { bevel: 0.06, bevelSeg: 3, curveSeg: 12 }), mat('#ffffff', { roughness: 0.35, map: woodT }), [0, 0.08, 0])
  const grille = canvasTex('grille', 128, 96, (c, w, h) => {
    weave(c, w, h, '#d8c39a', { step: 2, alpha: 0.2, seed: 6 })
    for (let x = 8; x < w; x += 14) {
      c.fillStyle = '#b8892f'
      c.fillRect(x, 0, 5, h)
      c.fillStyle = 'rgba(255,240,190,0.6)'
      c.fillRect(x + 1, 0, 1.5, h)
    }
  })
  const fz = 0.41 + 0.06
  add(g, G.rbox(1.18, 0.92, 0.04, 0.05, 2), gold(0.3), [-0.45, 0.76, fz])
  add(g, extrude('grille', () => roundRectShape(1.08, 0.82, 0.08), 0.02, { bevel: 0.01, bevelSeg: 1 }), cloth('#ffffff', grille), [-0.45, 0.76, fz + 0.03])
  const dial = canvasTex('radiodial', 128, 128, (c, w, h) => {
    const m = w / 2
    c.fillStyle = '#f6e9c6'
    c.fillRect(0, 0, w, h)
    c.strokeStyle = '#4a3220'
    for (let i = 0; i <= 20; i++) {
      const a = -2.3 + (i / 20) * 4.6
      c.lineWidth = i % 5 ? 1 : 2.5
      c.beginPath()
      c.moveTo(m + Math.sin(a) * 44, m - Math.cos(a) * 44)
      c.lineTo(m + Math.sin(a) * (i % 5 ? 52 : 56), m - Math.cos(a) * (i % 5 ? 52 : 56))
      c.stroke()
    }
    ;['55', '70', '100', '130', '160'].forEach((n, i) => {
      const a = -2.3 + (i / 4) * 4.6
      txt(c, n, m + Math.sin(a) * 32, m - Math.cos(a) * 32, 11, '#4a3220')
    })
    txt(c, 'Grandtone', m, m + 30, 13, '#a8342a', { italic: true })
    c.strokeStyle = '#d8343b'
    c.lineWidth = 2.5
    c.beginPath()
    c.moveTo(m, m)
    c.lineTo(m + Math.sin(0.7) * 56, m - Math.cos(0.7) * 56)
    c.stroke()
  }, { text: true })
  add(g, G.circle(0.3, 32), mat('#ffffff', { roughness: 0.3, map: dial, emissive: '#ffcf80', ei: 0.08 }), [0.62, 0.9, fz + 0.012])
  add(g, G.tor(0.31, 0.035, 8, 32), chrome(), [0.62, 0.9, fz + 0.015])
  const knob = mat('#f1e4c4', { roughness: 0.3 })
  for (const x of [0.42, 0.82]) {
    add(g, G.lathe([[0, 0], [0.11, 0], [0.12, 0.02], [0.1, 0.1], [0, 0.11]], 18, 0.015), knob, [x, 0.36, fz], yAxisToZ)
    add(g, G.box(0.02, 0.08, 0.02), plastic('#4a3220'), [x, 0.4, fz + 0.115])
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, G.cyl(0.07, 0.06, 0.08, 10), plastic('#3a2415'), [sx * 0.95, 0.04, sz * 0.32])
}

// =========================================================================================
//  KITCHEN
// =========================================================================================
function toaster(g) {
  const ch = mat('#eef1f5', { roughness: 0.1, metalness: 1, env: 1.3 })
  add(g, G.rbox(1.9, 1.05, 1.1, 0.3, 3), ch, [0, 0.66, 0])
  add(g, G.rbox(2.0, 0.16, 1.2, 0.07, 2), plastic('#2a2a2e', 0.4), [0, 0.1, 0])
  for (const z of [-0.22, 0.22]) add(g, G.rbox(1.3, 0.04, 0.17, 0.03, 1), plastic('#151517', 0.6), [0, 1.18, z])
  const slice = () => {
    const s = new THREE.Shape()
    s.moveTo(-0.48, -0.4)
    s.lineTo(0.48, -0.4)
    s.quadraticCurveTo(0.54, -0.4, 0.53, -0.3)
    s.lineTo(0.5, 0.16)
    s.bezierCurveTo(0.66, 0.22, 0.66, 0.5, 0.42, 0.52)
    s.bezierCurveTo(0.28, 0.6, -0.28, 0.6, -0.42, 0.52)
    s.bezierCurveTo(-0.66, 0.5, -0.66, 0.22, -0.5, 0.16)
    s.lineTo(-0.53, -0.3)
    s.quadraticCurveTo(-0.54, -0.4, -0.48, -0.4)
    return s
  }
  const crumb = canvasTex('toast', 128, 128, (c, w, h) => {
    const gr = c.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, 70)
    gr.addColorStop(0, '#f3cf8c')
    gr.addColorStop(1, '#d99a4c')
    c.fillStyle = gr
    c.fillRect(0, 0, w, h)
    speckle(c, w, h, 160, ['#c9853f', '#f8dca4', '#b8702f'], { min: 0.8, max: 2.4, seed: 21 })
  })
  const crust = mat('#b8702f', { roughness: 0.8 })
  const inner = mat('#ffffff', { roughness: 0.9, map: crumb })
  const crustGeo = extrude('toast', slice, 0.1, { bevel: 0.025, bevelSeg: 2, curveSeg: 8 })
  const faceGeo = shapeGeo('toastface', slice, 8)
  for (const [z, y] of [[-0.22, 0.98], [0.22, 0.9]]) {
    const t = grp(g, [0, y, z])
    add(t, crustGeo, crust)
    add(t, faceGeo, inner, [0, 0.01, 0.077], null, [0.86, 0.86, 1])
    add(t, faceGeo, inner, [0, 0.01, -0.077], [0, PI, 0], [0.86, 0.86, 1])
  }
  add(g, G.rbox(0.03, 0.52, 0.08, 0.012, 1), plastic('#151517'), [0.955, 0.66, 0])
  add(g, G.rbox(0.16, 0.09, 0.18, 0.04, 2), plastic('#2a2a2e', 0.35), [1.02, 0.8, 0])
  add(g, G.cyl(0.11, 0.11, 0.06, 18), plastic('#2a2a2e', 0.35), [0.97, 0.36, 0], [0, 0, PI / 2])
  add(g, G.box(0.02, 0.02, 0.09), plastic('#ffffff'), [1.0, 0.4, 0])
  const badge = canvasTex('toasty', 128, 32, (c, w, h) => {
    c.fillStyle = '#1b1b1e'
    rr(c, 0, 0, w, h, 10)
    c.fill()
    txt(c, 'TOASTY', w / 2, h / 2 + 1, 20, '#ffcf5a')
  }, { text: true })
  add(g, G.plane(0.5, 0.125), mat('#ffffff', { roughness: 0.4, map: badge }), [0, 0.42, 0.553])
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, G.cyl(0.06, 0.05, 0.05, 10), plastic('#151517'), [sx * 0.8, 0.0, sz * 0.45])
}

function pan(g) {
  const ironM = mat('#2e2e33', { roughness: 0.5, metalness: 0.6 })
  add(g, G.lathe([[0, 0], [0.72, 0], [0.78, 0.03], [0.87, 0.28], [0.9, 0.33], [0.87, 0.35], [0.84, 0.32], [0.74, 0.08], [0.68, 0.055], [0, 0.055]], 36, 0.02), ironM)
  const h = grp(g, [0, 0.29, 0.84], [-0.04, 0, 0])
  add(h, G.rbox(0.24, 0.12, 1.62, 0.055, 2), ironM, [0, 0, 0.78])
  add(h, G.tor(0.06, 0.022, 5, 12), ironM, [0, 0.055, 1.42], [PI / 2, 0, 0])
  add(h, G.circle(0.045, 12), mat('#101012', { roughness: 0.8 }), [0, 0.062, 1.42], [-PI / 2, 0, 0])
  add(g, G.rbox(0.42, 0.06, 0.2, 0.03, 1), ironM, [0, 0.3, -0.95])
  // a fried egg, because why not
  const eggShape = () => {
    const pts = []
    for (let i = 0; i < 40; i++) {
      const a = (i / 40) * TAU
      const r = 0.36 + 0.05 * Math.sin(3 * a + 0.4) + 0.035 * Math.cos(5 * a)
      pts.push([Math.cos(a) * r, Math.sin(a) * r])
    }
    return polyShape(pts)
  }
  add(g, extrude('egg', eggShape, 0.02, { bevel: 0.02, bevelSeg: 1 }), mat('#fbf8f0', { roughness: 0.25 }), [0.08, 0.085, -0.1], [-PI / 2, 0, 0])
  add(g, G.sph(0.13, 12, 8), mat('#ffb21a', { roughness: 0.15, emissive: '#7a3a00', ei: 0.2 }), [0.12, 0.11, -0.12], null, [1, 0.55, 1])
}

function teapot(g) {
  const dots = canvasTex('teapot-dots', 256, 64, (c, w, h) => {
    c.fillStyle = '#8fd3c4'
    c.fillRect(0, 0, w, h)
    c.fillStyle = '#ffffff'
    for (let r = 0; r < 4; r++) for (let i = 0; i < 18; i++) {
      c.beginPath()
      c.arc((i + (r % 2) * 0.5) * (w / 18), 8 + r * 16, 3.6, 0, TAU)
      c.fill()
    }
  })
  const body = ceramic('#ffffff', dots)
  const mint = ceramic('#8fd3c4')
  add(g, G.lathe([[0, 0], [0.4, 0], [0.44, 0.04], [0.42, 0.09], [0.6, 0.22], [0.68, 0.5], [0.64, 0.82], [0.48, 1.04], [0.38, 1.1], [0.36, 1.12], [0, 1.12]], 26, 0.03, 1, 'y'), body)
  add(g, G.lathe([[0, 1.1], [0.38, 1.1], [0.4, 1.13], [0.32, 1.24], [0.14, 1.3], [0.11, 1.34], [0, 1.34]], 26, 0.02), mint)
  const au = gold(0.22)
  add(g, G.sph(0.1, 10, 8), au, [0, 1.42, 0])
  add(g, G.tor(0.38, 0.02, 4, 32), au, [0, 1.11, 0], [PI / 2, 0, 0])
  add(g, G.tor(0.43, 0.02, 4, 32), au, [0, 0.06, 0], [PI / 2, 0, 0])
  add(g, tube([[0.5, 0.34, 0], [0.8, 0.46, 0], [0.92, 0.78, 0], [1.04, 1.0, 0]], 0.15, { seg: 14, radial: 10, taper: (t) => 1 - 0.55 * t }), mint)
  add(g, G.tor(0.07, 0.018, 6, 16), au, [1.04, 1.0, 0], [PI / 2 - 0.5, 0, -0.5])
  add(g, G.tor(0.33, 0.065, 8, 20, 3.4), mint, [-0.62, 0.62, 0], [0, 0, 1.45])
}

function cheese(g) {
  const holes = (key, w, h, n, seed) => canvasTex('cheese-' + key, w, h, (c) => {
    c.fillStyle = '#ffd864'
    c.fillRect(0, 0, w, h)
    speckle(c, w, h, 120, ['#ffe28a', '#f5c94a'], { min: 0.6, max: 1.6, seed })
    const r = rng(seed)
    for (let i = 0; i < n; i++) {
      const x = r() * w
      const y = r() * h
      const rad = 5 + r() * 13
      const gr = c.createRadialGradient(x - rad * 0.3, y - rad * 0.3, rad * 0.1, x, y, rad)
      gr.addColorStop(0, '#d9a42e')
      gr.addColorStop(0.75, '#e8b443')
      gr.addColorStop(1, '#fff0b0')
      c.fillStyle = gr
      c.beginPath()
      c.arc(x, y, rad, 0, TAU)
      c.fill()
    }
  })
  const top = mat('#ffffff', { roughness: 0.55, map: holes('top', 256, 192, 9, 5) })
  const side = mat('#ffffff', { roughness: 0.55, map: holes('side', 256, 144, 8, 9) })
  const alpha = Math.atan(0.6 / 1.6)
  const L = 1.6
  const tip = -0.8
  const sector = () => {
    const s = new THREE.Shape()
    s.moveTo(0, 0)
    s.lineTo(L * Math.cos(alpha), -L * Math.sin(alpha))
    s.absarc(0, 0, L, -alpha, alpha, false)
    s.closePath()
    return s
  }
  add(g, shapeGeo('cheese-sector', sector, 16), top, [tip, 0.9, 0], [-PI / 2, 0, 0])
  add(g, shapeGeo('cheese-sector', sector, 16), side, [tip, 0, 0], [PI / 2, 0, 0])
  for (const s of [1, -1]) {
    const mx = tip + (L / 2) * Math.cos(alpha)
    const mz = s * (L / 2) * Math.sin(alpha)
    add(g, G.plane(L, 0.9), side, [mx, 0.45, mz], [0, s > 0 ? -alpha : PI + alpha, 0])
  }
  add(g, G.arcCyl(L, 0.9, PI / 2 - alpha, 2 * alpha, 16), mat('#e8a530', { roughness: 0.45 }), [tip, 0.45, 0])
}

function cake(g) {
  add(g, G.lathe([[0, 0], [0.85, 0], [0.98, 0.05], [1.0, 0.08], [0.96, 0.09], [0.8, 0.05], [0, 0.05]], 36, 0.015), white())
  const cream = mat('#fff0d9', { roughness: 0.6 })
  add(g, G.cyl(0.84, 0.84, 0.72, 40), cream, [0, 0.41, 0])
  const pinkF = mat('#ff8fb8', { roughness: 0.3 })
  add(g, G.tor(0.845, 0.03, 4, 36), mat('#ffffff', { roughness: 0.5 }), [0, 0.1, 0], [PI / 2, 0, 0])
  add(g, G.cyl(0.87, 0.87, 0.08, 40), pinkF, [0, 0.81, 0])
  const r = rng(7)
  const drips = []
  for (let i = 0; i < 16; i++) drips.push([(i / 16) * TAU + r() * 0.15, 0.1 + r() * 0.05, 0.12 + r() * 0.26])
  add(g, dripGeo('cake', 0.872, 0.1, drips, 96, 4), pinkF, [0, 0.85, 0])
  const top = canvasTex('caketop', 256, 256, (c, w, h) => {
    c.fillStyle = '#ff8fb8'
    c.fillRect(0, 0, w, h)
    const rr2 = rng(3)
    const cols = ['#ffffff', '#ffe14d', '#62c3ff', '#7ee07a', '#c78bff', '#ff5a5a']
    for (let i = 0; i < 160; i++) {
      c.save()
      c.translate(rr2() * w, rr2() * h)
      c.rotate(rr2() * PI)
      c.fillStyle = cols[i % cols.length]
      rr(c, -5, -1.6, 10, 3.2, 1.6)
      c.fill()
      c.restore()
    }
    c.fillStyle = 'rgba(255,143,184,0.85)'
    c.beginPath()
    c.ellipse(w / 2, h / 2, 62, 34, 0, 0, TAU)
    c.fill()
    txt(c, 'Happy', w / 2, h / 2 - 12, 26, '#7a3a1a', { italic: true })
    txt(c, '80th!', w / 2, h / 2 + 16, 28, '#7a3a1a', { italic: true })
  }, { text: true })
  add(g, G.circle(0.86, 40), mat('#ffffff', { roughness: 0.35, map: top }), [0, 0.851, 0], [-PI / 2, 0, 0])
  const dollop = mat('#ffffff', { roughness: 0.45 })
  around(11, 0.76, (i, a, x, z) => add(g, G.sph(0.08, 6, 4), dollop, [x, 0.87, z], null, [1, 0.8, 1]))
  const stripes = (key, a, b) => canvasTex('candle-' + key, 32, 64, (c, w, h) => {
    c.fillStyle = a
    c.fillRect(0, 0, w, h)
    c.fillStyle = b
    for (let i = -2; i < 8; i++) {
      c.beginPath()
      c.moveTo(0, i * 12)
      c.lineTo(w, i * 12 + 14)
      c.lineTo(w, i * 12 + 20)
      c.lineTo(0, i * 12 + 6)
      c.fill()
    }
  })
  const candleMats = [
    mat('#ffffff', { roughness: 0.5, map: stripes('a', '#ffffff', '#3b8cff') }),
    mat('#ffffff', { roughness: 0.5, map: stripes('b', '#ffffff', '#ff4d6d') }),
    mat('#ffffff', { roughness: 0.5, map: stripes('c', '#ffffff', '#ffc21f') }),
  ]
  const flame = mat('#ffd34a', { emissive: '#ffb020', ei: 2.2, roughness: 0.4 })
  around(5, 0.45, (i, a, x, z) => {
    add(g, G.cyl(0.045, 0.045, 0.32, 10), candleMats[i % 3], [x, 1.01, z])
    add(g, G.cyl(0.008, 0.008, 0.05, 4), plastic('#2a2a2a'), [x, 1.19, z])
    add(g, G.sph(0.05, 6, 5), flame, [x, 1.27, z], null, [1, 1.7, 1])
  }, 0.3)
}

function mug(g) {
  const print = canvasTex('mug-print', 256, 96, (c, w, h) => {
    c.fillStyle = '#fbfaf6'
    c.fillRect(0, 0, w, h)
    // printed between +Z and +X (u = 0.66) so it faces the 3/4 view; the handle is at +Z
    const m = w * 0.66
    txt(c, 'WORLD’S BEST', m, h * 0.3, 13, '#2b4f8f', { maxW: 70 })
    txt(c, 'GRANDPA', m, h * 0.56, 24, '#d8343b', { maxW: 78 })
    c.fillStyle = '#d8343b'
    const hx = m
    const hy = h * 0.8
    c.beginPath()
    c.moveTo(hx, hy + 7)
    c.bezierCurveTo(hx - 12, hy - 2, hx - 6, hy - 10, hx, hy - 4)
    c.bezierCurveTo(hx + 6, hy - 10, hx + 12, hy - 2, hx, hy + 7)
    c.fill()
  }, { text: true })
  add(g, G.lathe([[0, 0], [0.36, 0], [0.4, 0.03], [0.42, 0.08], [0.42, 0.9], [0.41, 0.92]], 30, 0.02, 1, 'y'), ceramic('#ffffff', print))
  const w = white()
  add(g, G.lathe([[0.39, 0.92], [0.38, 0.85], [0.38, 0.1], [0, 0.08]], 30, 0.02), w)
  add(g, G.tor(0.4, 0.02, 5, 32), w, [0, 0.92, 0], [PI / 2, 0, 0])
  const coffee = canvasTex('coffee', 128, 128, (c, wd, h) => {
    c.fillStyle = '#5a3420'
    c.fillRect(0, 0, wd, h)
    const gr = c.createRadialGradient(64, 64, 10, 64, 64, 64)
    gr.addColorStop(0, 'rgba(210,160,110,0.0)')
    gr.addColorStop(0.8, 'rgba(160,100,60,0.0)')
    gr.addColorStop(1, 'rgba(200,150,100,0.8)')
    c.fillStyle = gr
    c.fillRect(0, 0, wd, h)
    c.fillStyle = '#e8cfa8'
    c.beginPath()
    c.moveTo(64, 92)
    c.bezierCurveTo(30, 66, 40, 34, 64, 50)
    c.bezierCurveTo(88, 34, 98, 66, 64, 92)
    c.fill()
  })
  add(g, G.circle(0.38, 32), mat('#ffffff', { roughness: 0.15, map: coffee }), [0, 0.8, 0], [-PI / 2, 0, 0])
  add(g, G.tor(0.2, 0.065, 8, 18, 3.49), w, [0, 0.48, 0.44], [0, PI / 2, 1.396])
}

function milk(g) {
  const carton = canvasTex('milk', 160, 256, (c, w, h) => {
    c.fillStyle = '#ffffff'
    c.fillRect(0, 0, w, h)
    c.fillStyle = '#2f6fd0'
    c.fillRect(0, 0, w, 40)
    txt(c, 'FARM FRESH', w / 2, 21, 20, '#ffffff')
    // cow spots
    c.fillStyle = '#1d1d22'
    const r = rng(12)
    for (let i = 0; i < 6; i++) {
      c.beginPath()
      c.ellipse(r() * w, 52 + r() * 40, 10 + r() * 12, 7 + r() * 8, r() * PI, 0, TAU)
      c.fill()
    }
    txt(c, 'MILK', w / 2, 128, 58, '#2f6fd0', { stroke: '#ffffff', lw: 6 })
    c.fillStyle = '#6cc04a'
    c.beginPath()
    c.moveTo(0, h)
    c.lineTo(0, 200)
    c.quadraticCurveTo(w * 0.3, 180, w * 0.6, 196)
    c.quadraticCurveTo(w * 0.85, 208, w, 190)
    c.lineTo(w, h)
    c.fill()
    c.fillStyle = '#d8343b'
    c.fillRect(w * 0.62, 176, 30, 22)
    c.beginPath()
    c.moveTo(w * 0.62 - 3, 177)
    c.lineTo(w * 0.62 + 15, 164)
    c.lineTo(w * 0.62 + 33, 177)
    c.fill()
    txt(c, '1 GALLON', w / 2, h - 18, 16, '#ffffff')
  }, { text: true })
  add(g, G.box(0.85, 1.32, 0.85), mat('#ffffff', { roughness: 0.6, map: carton }), [0, 0.66, 0])
  const roofM = mat('#2f6fd0', { roughness: 0.6 })
  const th = Math.atan2(0.425, 0.3)
  const sl = Math.hypot(0.425, 0.3)
  add(g, G.plane(0.86, sl), roofM, [0, 1.32 + 0.15, 0.2125], [-th, 0, 0])
  add(g, G.plane(0.86, sl), roofM, [0, 1.32 + 0.15, -0.2125], [-th, PI, 0, 'YXZ'])
  const tri = shapeGeo('milk-gable', () => polyShape([[-0.425, 0], [0.425, 0], [0, 0.3]]))
  add(g, tri, mat('#ffffff', { roughness: 0.6 }), [0.425, 1.32, 0], [0, PI / 2, 0])
  add(g, tri, mat('#ffffff', { roughness: 0.6 }), [-0.425, 1.32, 0], [0, -PI / 2, 0])
  add(g, G.box(0.86, 0.16, 0.04), mat('#ffffff', { roughness: 0.6 }), [0, 1.69, 0])
}

function blender(g) {
  const red = mat('#d83a3f', { roughness: 0.25, metalness: 0.15 })
  add(g, G.rbox(1.06, 0.72, 1.06, 0.18, 2), red, [0, 0.36, 0])
  add(g, G.rbox(0.98, 0.07, 0.98, 0.03, 1), chrome(), [0, 0.73, 0])
  add(g, G.rbox(0.76, 0.3, 0.04, 0.03, 1), plastic('#2a2a2e', 0.3), [0, 0.36, 0.53])
  const btnCols = ['#ffffff', '#ffffff', '#ffd23a', '#ff6a5a']
  btnCols.forEach((col, i) => add(g, G.box(0.1, 0.12, 0.05), plastic(col, 0.35), [-0.27 + i * 0.13, 0.36, 0.56]))
  add(g, G.cyl(0.07, 0.07, 0.06, 14), chrome(), [0.3, 0.36, 0.56], yAxisToZ)
  add(g, G.lathe([[0.3, 0.75], [0.4, 0.76], [0.42, 0.92], [0.33, 0.93]], 24, 0.02), plastic('#1f1f23', 0.4))
  const jarG = glass('#e8f6ff', 0.32)
  add(g, G.lathe([[0.34, 0.9], [0.4, 0.92], [0.54, 2.06], [0.56, 2.1], [0.52, 2.11], [0.5, 2.07], [0.37, 0.96], [0.3, 0.94]], 26, 0.015), jarG)
  add(g, G.lathe([[0, 0.94], [0.37, 0.94], [0.42, 1.38], [0.36, 1.43], [0, 1.43]], 24, 0.02), mat('#ff7aa2', { roughness: 0.35, emissive: '#ff3a70', ei: 0.12 }))
  add(g, G.lathe([[0.42, 1.38], [0.43, 1.42], [0, 1.45]], 24, 0.02), mat('#ffd0dd', { roughness: 0.6 }))
  for (const a of [0, PI / 2]) add(g, G.box(0.42, 0.02, 0.07), chrome(), [0, 0.99, 0], [0.25, a, 0])
  add(g, G.lathe([[0.5, 2.08], [0.58, 2.1], [0.58, 2.2], [0.5, 2.22], [0.18, 2.22], [0, 2.22]], 26, 0.02), plastic('#1f1f23', 0.4))
  add(g, G.cyl(0.14, 0.15, 0.12, 18), plastic('#1f1f23', 0.4), [0, 2.28, 0])
  const ticks = canvasTex('jar-ticks', 64, 128, (c, w, h) => {
    c.clearRect(0, 0, w, h)
    c.fillStyle = '#ffffff'
    for (let i = 1; i < 8; i++) {
      c.fillRect(w * 0.3, i * 16, i % 2 ? 14 : 26, 3)
    }
  })
  add(g, G.arcCyl(0.505, 0.9, PI * 1.5 - 0.3, 0.6, 6), mat('#ffffff', { map: ticks, opacity: 0.95, order: 4, noShadow: true }), [0, 1.55, 0])
  const hm = plastic('#1f1f23', 0.4)
  add(g, G.rbox(0.12, 0.92, 0.16, 0.05, 1), hm, [0.66, 1.5, 0])
  add(g, G.rbox(0.2, 0.1, 0.12, 0.04, 1), hm, [0.56, 1.92, 0])
  add(g, G.rbox(0.2, 0.1, 0.12, 0.04, 1), hm, [0.52, 1.1, 0])
}

function rollingpin(g) {
  const woodT = canvasTex('rollingpin', 128, 128, (c, w, h) => {
    woodGrain(c, w, h, { base: '#e0b47a', dark: '#b07a42', light: '#f2cf98', along: 'y', seed: 14, lines: 22 })
    speckle(c, w, h, 50, ['#ffffff'], { min: 0.6, max: 1.8, alpha: 0.7, seed: 2 })
  }, { repeat: [2, 1] })
  const wood = mat('#ffffff', { roughness: 0.55, map: woodT })
  const p = grp(g, [0, 0, 0], [0, 0, -PI / 2])
  add(p, G.lathe([[0, -1.0], [0.2, -1.0], [0.24, -0.97], [0.25, -0.9], [0.25, 0.9], [0.24, 0.97], [0.2, 1.0], [0, 1.0]], 26, 0.02, 1, 'y'), wood)
  const red = mat('#d8343b', { roughness: 0.35 })
  for (const s of [-1, 1]) {
    const h = grp(p, [0, s * 1.0, 0], s < 0 ? [PI, 0, 0] : null)
    add(h, G.cyl(0.05, 0.05, 0.06, 10), chrome(), [0, 0.03, 0])
    add(h, G.lathe([[0, 0.04], [0.09, 0.04], [0.12, 0.08], [0.13, 0.25], [0.11, 0.42], [0.12, 0.46], [0, 0.5]], 18, 0.02), wood)
    add(h, G.tor(0.125, 0.02, 5, 14), red, [0, 0.12, 0], [PI / 2, 0, 0])
  }
}

function plate(g) {
  const rim = canvasTex('plate-rim', 256, 128, (c, w, h) => {
    c.fillStyle = '#fdfcf8'
    c.fillRect(0, 0, w, h)
    const Y = (v) => (1 - v) * h
    const blue = '#2c5fb5'
    c.fillStyle = '#d9a63a'
    c.fillRect(0, Y(1), w, Y(0.975) - Y(1))
    c.fillStyle = blue
    c.fillRect(0, Y(0.94), w, 3)
    c.fillRect(0, Y(0.72), w, 2)
    for (let i = 0; i < 16; i++) {
      const x = (i + 0.5) * (w / 16)
      c.beginPath()
      c.ellipse(x, Y(0.84), 6, 9, 0, 0, TAU)
      c.fill()
      c.beginPath()
      c.arc(x + w / 32, Y(0.8), 2.5, 0, TAU)
      c.fill()
      c.beginPath()
      c.arc(x + w / 32, Y(0.88), 2.5, 0, TAU)
      c.fill()
    }
    c.fillStyle = blue
    for (let i = 0; i < 8; i++) {
      c.beginPath()
      c.ellipse((i + 0.5) * (w / 8), Y(0.2), 10, 12, 0, 0, TAU)
      c.fill()
    }
    c.fillStyle = '#d9a63a'
    c.fillRect(0, Y(0.06), w, Y(0) - Y(0.06))
  })
  add(g, G.lathe([[0, 0], [0.5, 0], [0.52, 0.02], [0.55, 0.03], [0.62, 0.035], [0.85, 0.12], [0.9, 0.15], [0.88, 0.155], [0.62, 0.07], [0.55, 0.06], [0, 0.06]], 40, 0.012, 1, 'r'), ceramic('#ffffff', rim))
}

// =========================================================================================
//  BATHROOM
// =========================================================================================
function duck(g) {
  const y = mat('#ffd21a', { roughness: 0.3 })
  add(g, G.sph(0.58, 24, 14), y, [0, 0.47, -0.1], null, [1.1, 0.82, 1.15])
  add(g, G.sph(0.3, 14, 10), y, [0, 0.7, -0.68], [0.75, 0, 0], [0.75, 0.6, 1.15])
  add(g, G.sph(0.4, 20, 14), y, [0, 0.98, 0.22])
  const beak = mat('#ff8a1a', { roughness: 0.3 })
  add(g, G.sph(0.21, 14, 8), beak, [0, 0.93, 0.56], null, [1.15, 0.36, 1.0])
  add(g, G.sph(0.17, 12, 6), beak, [0, 0.87, 0.52], null, [1.0, 0.3, 0.9])
  for (const s of [-1, 1]) {
    add(g, G.sph(0.1, 12, 10), ceramic('#ffffff'), [s * 0.19, 1.1, 0.53], null, [1, 1, 0.5])
    add(g, G.sph(0.065, 12, 10), mat('#141418', { roughness: 0.1 }), [s * 0.2, 1.1, 0.575])
    add(g, G.sph(0.022, 6, 4), glow('#ffffff', 0.6), [s * 0.18, 1.13, 0.625])
    add(g, G.sph(0.3, 10, 8), y, [s * 0.58, 0.56, -0.15], [0.35, s * 0.15, 0], [0.32, 0.55, 1])
  }
}

function toothbrush(g) {
  const wht = mat('#f6f8fb', { roughness: 0.25 })
  const teal = mat('#2bb3c0', { roughness: 0.3 })
  add(g, G.lathe([[0, 0], [0.2, 0], [0.21, 0.07], [0, 0.07]], 20, 0.015), teal)
  add(g, G.lathe([[0, 0.06], [0.15, 0.06], [0.17, 0.1], [0.17, 0.9], [0.15, 1.1], [0.08, 1.22], [0.055, 1.28], [0.05, 1.64], [0.04, 1.68], [0, 1.69]], 20, 0.03), wht)
  add(g, G.tor(0.17, 0.02, 6, 24), teal, [0, 0.95, 0], [PI / 2, 0, 0])
  add(g, G.rbox(0.1, 0.2, 0.06, 0.03, 2), teal, [0, 0.66, 0.155])
  add(g, G.cyl(0.022, 0.022, 0.02, 10), wht, [0, 0.66, 0.19], yAxisToZ)
  add(g, G.rbox(0.13, 0.27, 0.08, 0.035, 2), wht, [0, 1.64, 0.01])
  const brW = mat('#ffffff', { roughness: 0.7 })
  const brB = mat('#5fd0e0', { roughness: 0.7 })
  for (let r = 0; r < 5; r++) for (let c = 0; c < 2; c++) add(g, G.cyl(0.024, 0.024, 0.11, 6), (r + c) % 2 ? brW : brB, [-0.032 + c * 0.064, 1.54 + r * 0.05, 0.1], yAxisToZ)
}

function perfume(g) {
  const prof = [[0, 0], [0.32, 0], [0.37, 0.06], [0.37, 0.5], [0.28, 0.72], [0.13, 0.8], [0, 0.8]]
  add(g, G.lathe(prof, 8, 0), glass('#ffc8e2', 0.5, { flat: true, env: 2.2 }))
  add(g, G.lathe(prof.map(([x, y]) => [x * 0.86, y * 0.82 + 0.03]).slice(0, 4).concat([[0, 0.44]]), 8, 0), mat('#ff4f98', { roughness: 0.1, opacity: 0.78, emissive: '#ff2f86', ei: 0.3, flat: true, order: 2, noShadow: true }))
  const au = gold(0.2)
  add(g, G.cyl(0.08, 0.09, 0.1, 12), au, [0, 0.85, 0])
  add(g, G.lathe([[0, 0], [0.13, 0], [0.15, 0.06], [0.12, 0.26], [0.06, 0.32], [0, 0.32]], 14, 0.03), au, [0, 0.89, 0])
  add(g, G.tor(0.145, 0.018, 4, 16), au, [0, 0.93, 0], [PI / 2, 0, 0])
  add(g, tube([[0.1, 1.0, 0], [0.24, 1.03, 0], [0.33, 0.95, 0]], 0.018, { seg: 10, radial: 5 }), au)
  add(g, G.sph(0.1, 14, 10), mat('#e8548f', { roughness: 0.85 }), [0.38, 0.84, 0], null, [1, 1.25, 1])
  add(g, G.cone(0.05, 0.14, 8), au, [0.38, 0.66, 0], [PI, 0, 0])
}

function shampoo(g) {
  const label = canvasTex('shampoo', 256, 128, (c, w, h) => {
    c.fillStyle = '#25b5a8'
    c.fillRect(0, 0, w, h)
    const m = w / 2
    c.fillStyle = '#ffffff'
    rr(c, m - 46, 22, 92, 70, 10)
    c.fill()
    c.fillStyle = '#bff0ea'
    for (const [x, y, r] of [[m - 30, 34, 6], [m + 32, 36, 4], [m + 24, 78, 5], [m - 34, 80, 3]]) {
      c.beginPath()
      c.arc(x, y, r, 0, TAU)
      c.fill()
    }
    txt(c, 'SUDS', m, 52, 26, '#1a7f76')
    txt(c, 'silver hair', m, 74, 11, '#1a7f76', { italic: true })
    c.fillStyle = 'rgba(255,255,255,0.35)'
    for (let i = 0; i < 6; i++) {
      c.beginPath()
      c.arc(20 + i * 40, 110 - (i % 2) * 8, 4 + (i % 3), 0, TAU)
      c.fill()
    }
  }, { text: true })
  const b = grp(g, null, null, [1, 1, 0.78])
  add(b, G.lathe([[0, 0], [0.34, 0], [0.37, 0.05], [0.38, 0.9], [0.33, 1.15], [0.2, 1.25], [0.14, 1.28], [0, 1.28]], 28, 0.04, 1, 'y'), mat('#ffffff', { roughness: 0.25, map: label }))
  const capM = mat('#f7f7f2', { roughness: 0.3 })
  add(b, G.lathe([[0, 1.26], [0.17, 1.26], [0.18, 1.44], [0.15, 1.5], [0, 1.5]], 20, 0.02), capM)
  add(b, G.tor(0.18, 0.012, 4, 24), plastic('#c9c9c0'), [0, 1.42, 0], [PI / 2, 0, 0])
  add(g, G.rbox(0.12, 0.04, 0.06, 0.015, 1), capM, [0, 1.44, 0.15])
  add(g, G.cyl(0.03, 0.03, 0.03, 8), plastic('#c9c9c0'), [0, 1.51, -0.04])
}

function tp(g) {
  const quilt = canvasTex('tp-quilt', 64, 64, (c, w, h) => {
    c.fillStyle = '#fbfbf7'
    c.fillRect(0, 0, w, h)
    c.strokeStyle = 'rgba(160,170,190,0.45)'
    c.lineWidth = 1.5
    c.beginPath()
    c.moveTo(0, 0)
    c.lineTo(w, h)
    c.moveTo(w, 0)
    c.lineTo(0, h)
    c.stroke()
    c.fillStyle = 'rgba(160,170,190,0.4)'
    c.beginPath()
    c.arc(w / 2, h / 2, 3, 0, TAU)
    c.fill()
  }, { repeat: [10, 4] })
  const paper = mat('#ffffff', { roughness: 0.95, map: quilt })
  add(g, G.cyl(0.47, 0.47, 0.95, 40, true), paper)
  const rings = canvasTex('tp-rings', 128, 128, (c, w, h) => {
    c.fillStyle = '#fbfbf7'
    c.fillRect(0, 0, w, h)
    c.strokeStyle = 'rgba(170,175,190,0.5)'
    for (let r = 24; r < 64; r += 3) {
      c.beginPath()
      c.arc(64, 64, r, 0, TAU)
      c.stroke()
    }
  })
  const end = mat('#ffffff', { roughness: 0.95, map: rings })
  add(g, G.ring(0.18, 0.47, 40), end, [0, 0.475, 0], [-PI / 2, 0, 0])
  add(g, G.ring(0.18, 0.47, 40), end, [0, -0.475, 0], [PI / 2, 0, 0])
  const card = mat('#b8895a', { roughness: 0.9 })
  add(g, G.lathe([[0.17, 0.48], [0.17, -0.48]], 20, 0), card)
  add(g, G.ring(0.165, 0.185, 24), card, [0, 0.477, 0], [-PI / 2, 0, 0])
  add(g, G.ring(0.165, 0.185, 24), card, [0, -0.477, 0], [PI / 2, 0, 0])
  // loose sheet peeling off the front
  const flap = cached('tp-flap', () => {
    const geo = new THREE.PlaneGeometry(1, 1, 8, 8)
    const p = geo.attributes.position
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i)
      const v = 0.5 - p.getY(i)
      const a = u * 1.3
      const r = 0.478 + 0.1 * v * v
      p.setXYZ(i, Math.sin(a) * r, 0.2 - v * 0.67, Math.cos(a) * r)
    }
    geo.computeVertexNormals()
    return geo
  })
  add(g, flap, mat('#ffffff', { roughness: 0.95, map: quilt, double: true }))
}

function hairdryer(g) {
  const mint = mat('#5cc6c0', { roughness: 0.28 })
  const b = grp(g, [0, 0.3, 0], yAxisToX)
  add(b, G.lathe([[0, -0.86], [0.26, -0.86], [0.33, -0.8], [0.37, -0.62], [0.38, -0.05], [0.34, 0.25], [0.23, 0.48], [0.2, 0.8], [0.21, 0.88], [0, 0.88]], 26, 0.03), mint)
  add(b, G.tor(0.205, 0.03, 8, 24), chrome(), [0, 0.86, 0], [PI / 2, 0, 0])
  const vent = canvasTex('vent', 64, 64, (c, w, h) => {
    c.fillStyle = '#2a2d33'
    c.fillRect(0, 0, w, h)
    c.strokeStyle = '#8a929e'
    c.lineWidth = 3
    for (const r of [8, 16, 24]) {
      c.beginPath()
      c.arc(32, 32, r, 0, TAU)
      c.stroke()
    }
  })
  add(g, G.circle(0.27, 24), mat('#ffffff', { roughness: 0.5, map: vent }), [-0.865, 0.3, 0], [0, -PI / 2, 0])
  add(g, G.circle(0.18, 20), mat('#ffffff', { roughness: 0.5, map: vent }), [0.885, 0.3, 0], [0, PI / 2, 0])
  const h = grp(g, [-0.18, -0.25, 0], [0, 0, 0.2])
  add(h, G.rbox(0.28, 0.95, 0.32, 0.13, 2), mat('#f2efe6', { roughness: 0.35 }), [0, -0.2, 0])
  add(h, G.rbox(0.07, 0.2, 0.12, 0.03, 1), plastic('#e2383a'), [0.14, 0.05, 0])
  add(h, G.rbox(0.06, 0.12, 0.1, 0.025, 1), plastic('#2a2d33'), [0.14, -0.2, 0])
  add(g, tube([[-0.1, -0.85, 0], [-0.22, -1.02, 0.08], [-0.05, -1.17, 0.28], [0.18, -1.15, 0.15], [0.25, -1.18, -0.12], [0.05, -1.2, -0.28]], 0.035, { seg: 30, radial: 6 }), plastic('#6b6f78', 0.5))
}

function soap(g) {
  add(g, G.rbox(0.82, 0.28, 0.52, 0.12, 3), mat('#c7a6e8', { roughness: 0.45 }), [0, 0.14, 0])
  const emb = canvasTex('soap-emboss', 128, 80, (c, w, h) => {
    c.clearRect(0, 0, w, h)
    c.strokeStyle = 'rgba(255,255,255,0.75)'
    c.lineWidth = 3
    c.beginPath()
    c.ellipse(w / 2, h / 2, 54, 30, 0, 0, TAU)
    c.stroke()
    txt(c, 'SOAP', w / 2, h / 2 + 2, 26, 'rgba(255,255,255,0.85)')
  }, { text: true })
  add(g, G.plane(0.52, 0.32), mat('#e9dbf7', { roughness: 0.4, map: emb, opacity: 0.99, order: 1 }), [0, 0.2805, 0], [-PI / 2, 0, 0])
  const bub = mat('#ffffff', { roughness: 0.02, metalness: 0.1, opacity: 0.35, env: 2.5, emissive: '#b8e4ff', ei: 0.18, order: 3 })
  for (const [x, y, z, r] of [[0.18, 0.37, 0.05, 0.1], [0.32, 0.33, -0.12, 0.065], [0.06, 0.32, -0.16, 0.05], [-0.36, 0.08, 0.27, 0.06]]) add(g, G.sph(r, 14, 10), bub, [x, y, z])
}

function dentures(g) {
  const gum = mat('#ff7f9c', { roughness: 0.3 })
  const au = gold(0.16)
  const Ro = 0.44
  const Ri = 0.25
  const a0 = -0.62
  const a1 = PI + 0.62
  const mid = (Ro + Ri) / 2
  const cr = (Ro - Ri) / 2
  const lower = () => {
    const s = new THREE.Shape()
    s.absarc(0, 0, Ro, a0, a1, false)
    s.absarc(mid * Math.cos(a1), mid * Math.sin(a1), cr, a1, a1 + PI, false)
    s.absarc(0, 0, Ri, a1, a0, true)
    s.absarc(mid * Math.cos(a0), mid * Math.sin(a0), cr, a0 + PI, a0 + TAU, false)
    return s
  }
  const upper = () => {
    const s = new THREE.Shape()
    s.absarc(0, 0, Ro, a0, a1, false)
    s.closePath()
    return s
  }
  const tooth = G.lathe([[0, 0], [0.055, 0], [0.058, 0.08], [0.045, 0.12], [0, 0.125]], 8, 0)
  const teeth = (parent, dir, skip) => {
    for (let i = 0; i < 10; i++) {
      if (i === skip) continue
      const a = 0.12 + (i / 9) * (PI - 0.24)
      const x = Math.cos(a) * mid
      const z = Math.sin(a) * mid
      const front = Math.abs(i - 4.5) < 2.5
      add(parent, tooth, au, [x, 0, z], [dir > 0 ? 0 : PI, -a + PI / 2, 0, 'YXZ'], front ? [1.05, 1, 0.75] : [1.35, 0.9, 1.0])
    }
  }
  const lo = grp(g, [0, 0.08, 0])
  add(lo, extrude('dent-lower', lower, 0.1, { bevel: 0.035, bevelSeg: 2, curveSeg: 10 }), gum, [0, 0, 0], [PI / 2, 0, 0])
  teeth(grp(lo, [0, 0.07, 0]), 1, 7)
  const hi = grp(g, [0, 0.42, -0.25], [-0.1, 0, 0])
  const hiIn = grp(hi, [0, 0, 0.25])
  add(hiIn, extrude('dent-upper', upper, 0.1, { bevel: 0.035, bevelSeg: 2, curveSeg: 14 }), gum, [0, 0, 0], [PI / 2, 0, 0])
  teeth(grp(hiIn, [0, -0.07, 0]), -1, -1)
  add(hiIn, gemGeo(6), gem('#bfefff', 0.5), [Math.cos(PI / 2 + 0.06) * mid, -0.16, Math.sin(PI / 2 + 0.06) * mid + 0.04], [PI / 2, 0, 0], [0.03, 0.02, 0.03])
}

// =========================================================================================
//  BEDROOM
// =========================================================================================
function alarmclock(g) {
  buildAlarmClock(g)
}

function jewelbox(g) {
  const woodT = woodTex('jewel', '#7a3418', '#4e1f0b', '#9a4a26', 'x', 17)
  const wood = mat('#ffffff', { roughness: 0.3, map: woodT })
  const velvet = cloth('#b0122e')
  const au = gold(0.2)
  const W = 1.5
  const D = 1.04
  const H = 0.56
  const t = 0.08
  add(g, G.rbox(W, 0.1, D, 0.03, 1), wood, [0, 0.09, 0])
  add(g, G.rbox(W, H, t, 0.03, 1), wood, [0, 0.04 + H / 2, D / 2 - t / 2])
  add(g, G.rbox(W, H, t, 0.03, 1), wood, [0, 0.04 + H / 2, -D / 2 + t / 2])
  add(g, G.rbox(t, H, D, 0.03, 1), wood, [W / 2 - t / 2, 0.04 + H / 2, 0])
  add(g, G.rbox(t, H, D, 0.03, 1), wood, [-W / 2 + t / 2, 0.04 + H / 2, 0])
  add(g, G.box(W - 2 * t, 0.2, D - 2 * t), velvet, [0, 0.42, 0])
  for (const x of [-0.35, 0, 0.35]) add(g, G.cap(0.07, D - 2 * t - 0.14, 2, 8), velvet, [x, 0.52, 0], yAxisToZ)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    add(g, G.sph(0.06, 6, 4), au, [sx * (W / 2 - 0.04), 0.02, sz * (D / 2 - 0.04)])
    add(g, G.box(0.1, 0.1, 0.1), au, [sx * (W / 2 - 0.02), 0.6, sz * (D / 2 - 0.02)])
  }
  add(g, G.rbox(0.16, 0.16, 0.03, 0.03, 1), au, [0, 0.5, D / 2 + 0.01])
  add(g, G.box(0.03, 0.06, 0.01), mat('#1a1a1a'), [0, 0.49, D / 2 + 0.028])
  // lid, hinged at the back, ajar
  const lid = grp(g, [0, 0.6, -D / 2], [-0.38, 0, 0])
  add(lid, G.rbox(W + 0.03, 0.13, D + 0.03, 0.05, 1), wood, [0, 0.065, D / 2])
  add(lid, G.box(W - 0.14, 0.02, D - 0.14), velvet, [0, -0.005, D / 2])
  add(lid, G.circle(0.22, 24), mat('#dff2ff', { roughness: 0.03, metalness: 1, env: 1.6 }), [0, -0.017, D / 2], [PI / 2, 0, 0], [1.4, 1, 1])
  add(lid, G.tor(0.22, 0.02, 4, 20), au, [0, -0.017, D / 2], [PI / 2, 0, 0], [1.4, 1, 1])
  add(lid, gemGeo(8), gem('#e0115f'), [0, 0.13, D / 2], null, [0.1, 0.08, 0.1])
  add(lid, G.tor(0.12, 0.018, 4, 16), au, [0, 0.135, D / 2], [PI / 2, 0, 0])
  // treasure inside + spilling out
  const ruby = gem('#e0115f')
  const sapph = gem('#2a5bff')
  const emer = gem('#18c06a')
  add(g, gemGeo(8), ruby, [-0.3, 0.62, -0.1], [0.4, 0, 0.3], [0.12, 0.1, 0.12])
  add(g, gemGeo(8), sapph, [0.25, 0.62, 0.05], [-0.3, 0, -0.2], [0.11, 0.09, 0.11])
  add(g, gemGeo(8), emer, [0.05, 0.6, -0.22], [0.2, 0, 0.5], [0.1, 0.08, 0.1])
  add(g, G.tor(0.09, 0.025, 5, 14), au, [0.45, 0.62, -0.15], [1.2, 0, 0.3])
  add(g, gemGeo(6), sapph, [0.5, 0.06, 0.72], [0.3, 0, 1.2], [0.08, 0.06, 0.08])
  add(g, gemGeo(6), ruby, [-0.55, 0.05, 0.66], [-0.2, 0, -1.4], [0.075, 0.06, 0.075])
  add(g, G.tor(0.08, 0.022, 5, 14), au, [-0.25, 0.025, 0.7], [PI / 2, 0, 0])
  add(g, gemGeo(6), emer, [-0.25, 0.06, 0.7 + 0.08], [PI / 2, 0, 0], [0.04, 0.03, 0.04])
  const pc = new THREE.CatmullRomCurve3([[-0.35, 0.58, 0.0], [-0.25, 0.66, 0.38], [-0.12, 0.64, 0.56], [-0.02, 0.4, 0.6], [0.06, 0.14, 0.6], [0.22, 0.04, 0.7], [0.38, 0.04, 0.64]].map((p) => new V3(...p)))
  const P = new V3()
  for (let i = 0; i < 13; i++) {
    pc.getPointAt(i / 12, P)
    add(g, G.sph(0.058, 7, 5), pearl(), [P.x, P.y, P.z])
  }
}

function pillow(g) {
  const fab = canvasTex('pillowcase', 128, 128, (c, w, h) => {
    c.fillStyle = '#b8d4ee'
    c.fillRect(0, 0, w, h)
    c.fillStyle = 'rgba(255,255,255,0.7)'
    for (let x = 4; x < w; x += 12) c.fillRect(x, 0, 3, h)
    c.fillStyle = 'rgba(255,255,255,0.9)'
    for (let i = 0; i < 6; i++) {
      const x = 22 + (i % 3) * 42
      const y = 30 + Math.floor(i / 3) * 64 + (i % 2) * 10
      c.beginPath()
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * TAU - PI / 2
        const r = k % 2 ? 2.5 : 6
        c.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r)
      }
      c.fill()
    }
  })
  cushionLike(g, { w: 2.9, h: 0.78, d: 1.94, corner: 3.6, fabricTex: fab, piping: cloth('#ffffff'), buttonMat: null })
}

function slipper(g) {
  const fur = canvasTex('fur-maroon', 128, 128, (c, w, h) => {
    c.fillStyle = '#5e1622'
    c.fillRect(0, 0, w, h)
    const r = rng(31)
    for (let i = 0; i < 900; i++) {
      const x = r() * w
      const y = r() * h
      const a = r() * TAU
      c.strokeStyle = r() < 0.5 ? 'rgba(150,55,70,0.45)' : 'rgba(40,5,12,0.5)'
      c.lineWidth = 1
      c.beginPath()
      c.moveTo(x, y)
      c.lineTo(x + Math.cos(a) * 4, y + Math.sin(a) * 4)
      c.stroke()
    }
  }, { repeat: [2, 2] })
  const fuzz = cloth('#ffffff', fur)
  const fleece = cloth('#f1e3cf')
  add(g, extrude('slippersole', () => footShape(2.3, 0.45, 0.55), 0.12, { bevel: 0.04, curveSeg: 10 }), rubber('#8a6a4f'), [0, 0.1, 0], [PI / 2, 0, 0])
  add(g, shapeGeo('slipperinsole', () => footShape(2.18, 0.42, 0.52), 10), fleece, [0, 0.205, 0], [-PI / 2, 0, PI], [1, 1, 1])
  const capY = 0.2
  const capZ = -0.02
  add(g, G.sph(0.6, 24, 12, 0, PI, 0, PI / 2), fuzz, [0, capY, capZ], null, [0.96, 0.82, 1.9])
  add(g, G.tor(0.6, 0.075, 8, 24, PI), fleece, [0, capY, capZ], null, [0.96, 0.82, 1])
  // soft heel rim
  const pts = []
  for (let i = 0; i <= 12; i++) {
    const a = PI * 0.08 + (i / 12) * PI * 0.84
    pts.push([Math.cos(a) * 0.5, 0.25, -0.62 - Math.sin(a) * 0.52])
  }
  add(g, tube(pts, 0.07, { seg: 24, radial: 6 }), fuzz)
  add(g, G.sph(0.15, 12, 10), cloth('#ffffff', canvasTex('pompom', 64, 64, (c, w, h) => {
    weave(c, w, h, '#f4dfe3', { step: 2, alpha: 0.25, seed: 2 })
  })), [0, 0.67, 0.45])
}

function teddy(g) {
  const fur = canvasTex('teddy-fur', 128, 128, (c, w, h) => {
    c.fillStyle = '#a8743f'
    c.fillRect(0, 0, w, h)
    const r = rng(8)
    for (let i = 0; i < 700; i++) {
      const x = r() * w
      const y = r() * h
      const a = r() * TAU
      c.strokeStyle = r() < 0.5 ? 'rgba(200,150,90,0.5)' : 'rgba(110,70,30,0.45)'
      c.lineWidth = 1.2
      c.beginPath()
      c.moveTo(x, y)
      c.lineTo(x + Math.cos(a) * 5, y + Math.sin(a) * 5)
      c.stroke()
    }
    c.fillStyle = 'rgba(220,190,140,0.25)'
    c.beginPath()
    c.ellipse(w * 0.7, h * 0.4, 18, 12, 0.4, 0, TAU)
    c.fill()
  }, { repeat: [2, 2] })
  const furM = cloth('#ffffff', fur)
  const tan = cloth('#e3c08f')
  add(g, G.sph(0.56, 16, 10), furM, [0, 0.75, 0], null, [1, 1.1, 0.88])
  add(g, G.sph(0.4, 12, 8), tan, [0, 0.7, 0.24], null, [1, 1.15, 0.6])
  const plaid = canvasTex('patch', 64, 64, (c, w, h) => {
    c.fillStyle = '#3d6fb8'
    c.fillRect(0, 0, w, h)
    c.fillStyle = 'rgba(255,255,255,0.35)'
    for (let i = 0; i < 4; i++) {
      c.fillRect(i * 16 + 4, 0, 4, h)
      c.fillRect(0, i * 16 + 4, w, 4)
    }
    c.fillStyle = 'rgba(240,200,60,0.5)'
    c.fillRect(0, 30, w, 2)
    c.fillRect(30, 0, 2, h)
    stitches(c, 5, 5, w - 10, h - 10, 2, '#f6efd9', 2, [4, 3])
  })
  add(g, G.rbox(0.3, 0.3, 0.04, 0.02, 1), cloth('#ffffff', plaid), [0.16, 0.86, 0.47], [-0.2, 0.25, 0.15])
  add(g, G.sph(0.48, 16, 12), furM, [0, 1.74, 0.04], null, [1.06, 0.95, 0.95])
  for (const s of [-1, 1]) {
    add(g, G.sph(0.17, 10, 8), furM, [s * 0.38, 2.1, -0.02], null, [1, 1, 0.55])
    add(g, G.sph(0.11, 8, 6), tan, [s * 0.38, 2.09, 0.05], null, [1, 1, 0.3])
    const arm = grp(g, [s * 0.5, 1.05, 0.12], [-0.5, 0, s * 0.75])
    add(arm, G.cap(0.15, 0.36, 3, 9), furM, [0, -0.25, 0])
    add(arm, G.sph(0.11, 8, 6), tan, [0, -0.47, 0.06], null, [1, 0.7, 0.6])
    add(g, G.cap(0.2, 0.34, 3, 10), furM, [s * 0.32, 0.22, 0.38], yAxisToZ)
    add(g, G.cyl(0.15, 0.15, 0.03, 16), tan, [s * 0.32, 0.22, 0.76], yAxisToZ)
  }
  add(g, G.sph(0.2, 10, 8), tan, [0, 1.62, 0.4], null, [1.15, 0.85, 0.9])
  add(g, G.sph(0.08, 10, 6), mat('#3a2418', { roughness: 0.2 }), [0, 1.69, 0.58], null, [1.3, 0.85, 0.8])
  add(g, G.tor(0.06, 0.012, 4, 10, PI), mat('#3a2418'), [0, 1.56, 0.57], [0, 0, PI])
  add(g, G.sph(0.06, 12, 10), mat('#141418', { roughness: 0.1 }), [-0.17, 1.86, 0.4])
  add(g, G.sph(0.02, 6, 4), glow('#ffffff', 0.5), [-0.15, 1.88, 0.455])
  add(g, G.cyl(0.065, 0.065, 0.03, 14), plastic('#3d6fb8', 0.4), [0.17, 1.86, 0.42], [PI / 2 - 0.3, 0.3, 0])
  // red bow
  const bow = cloth('#d8343b')
  add(g, G.sph(0.06, 8, 6), bow, [0, 1.3, 0.42])
  for (const s of [-1, 1]) add(g, G.cone(0.11, 0.22, 10), bow, [s * 0.12, 1.3, 0.4], [0, 0, s * PI / 2], [1, 1, 0.45])
}

function watch(g) {
  const au = gold(0.18)
  add(g, G.lathe([[0, 0], [0.3, 0], [0.33, 0.03], [0.34, 0.08], [0.32, 0.13], [0.29, 0.14], [0.28, 0.12], [0, 0.12]], 30, 0.015), au)
  const dial = canvasTex('watchdial', 128, 128, (c, w, h) => {
    const m = w / 2
    const gr = c.createRadialGradient(m, m, 10, m, m, 64)
    gr.addColorStop(0, '#fbf0d2')
    gr.addColorStop(1, '#e8d3a0')
    c.fillStyle = gr
    c.fillRect(0, 0, w, h)
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU
      c.save()
      c.translate(m + Math.sin(a) * 48, m - Math.cos(a) * 48)
      c.rotate(a)
      c.fillStyle = '#9a6a18'
      c.fillRect(-2.5, -7, 5, i % 3 ? 10 : 14)
      c.restore()
    }
    txt(c, 'GRANDPA', m, m - 22, 10, '#5a3c0a')
    c.fillStyle = '#ffffff'
    c.fillRect(m + 24, m - 6, 14, 12)
    txt(c, '23', m + 31, m + 1, 9, '#2a2320')
    c.strokeStyle = '#2a2320'
    c.lineCap = 'round'
    c.lineWidth = 4
    c.beginPath()
    c.moveTo(m, m)
    c.lineTo(m - 18, m + 18)
    c.stroke()
    c.lineWidth = 3
    c.beginPath()
    c.moveTo(m, m)
    c.lineTo(m + 6, m - 40)
    c.stroke()
  }, { text: true })
  add(g, G.circle(0.28, 32), mat('#ffffff', { roughness: 0.4, map: dial }), [0, 0.121, 0], [-PI / 2, 0, 0])
  const th = 0.45
  const Rc = 0.29 / Math.sin(th)
  add(g, G.sph(Rc, 28, 4, 0, TAU, 0, th), glass('#ffffff', 0.22), [0, 0.13 - Rc * Math.cos(th), 0])
  add(g, G.cyl(0.05, 0.05, 0.07, 12), au, [0.37, 0.07, 0], [0, 0, PI / 2])
  // bracelet: overlapping links following an arc, curling up on both sides
  for (const s of [-1, 1]) {
    add(g, G.rbox(0.36, 0.07, 0.08, 0.02, 1), au, [0, 0.05, s * 0.33])
    const Rb = 0.2
    for (let i = 0; i < 4; i++) {
      const th = 0.2 + i * 0.4
      add(g, G.rbox(0.38, 0.055, 0.105, 0.022, 1), au, [0, 0.035 + Rb * (1 - Math.cos(th)), s * (0.36 + Rb * Math.sin(th))], [s * th, 0, 0])
    }
  }
}

function photo(g) {
  const pic = canvasTex('couple', 184, 256, (c, w, h) => {
    c.fillStyle = '#fbf6ea'
    c.fillRect(0, 0, w, h)
    const gr = c.createLinearGradient(0, 0, 0, h)
    gr.addColorStop(0, '#f5d9a8')
    gr.addColorStop(1, '#e6b88a')
    c.fillStyle = gr
    c.fillRect(10, 10, w - 20, h - 20)
    c.fillStyle = 'rgba(255,255,255,0.35)'
    c.beginPath()
    c.arc(w * 0.75, 50, 26, 0, TAU)
    c.fill()
    const person = (x, top, body, hair, isGrandpa) => {
      c.fillStyle = body
      c.beginPath()
      c.ellipse(x, h - 40, 44, 70, 0, PI, TAU)
      c.fill()
      c.fillRect(x - 44, h - 40, 88, 30)
      if (isGrandpa) {
        c.fillStyle = '#ffffff'
        c.beginPath()
        c.moveTo(x - 12, h - 108)
        c.lineTo(x, h - 96)
        c.lineTo(x + 12, h - 108)
        c.fill()
        c.fillStyle = '#d8343b'
        c.fillRect(x - 9, h - 106, 18, 8)
      }
      c.fillStyle = '#f2c9a0'
      c.beginPath()
      c.arc(x, top, 30, 0, TAU)
      c.fill()
      c.fillStyle = hair
      if (isGrandpa) {
        c.beginPath()
        c.arc(x - 27, top - 2, 10, 0, TAU)
        c.arc(x + 27, top - 2, 10, 0, TAU)
        c.fill()
        c.beginPath()
        c.ellipse(x, top + 10, 14, 6, 0, 0, TAU)
        c.fill()
      } else {
        c.beginPath()
        c.arc(x, top - 10, 30, PI, TAU)
        c.fill()
        c.beginPath()
        c.arc(x, top - 40, 13, 0, TAU)
        c.fill()
      }
      c.strokeStyle = '#4a3220'
      c.lineWidth = 2
      for (const s of [-1, 1]) {
        c.beginPath()
        c.arc(x + s * 11, top - 3, 8, 0, TAU)
        c.stroke()
      }
      c.beginPath()
      c.arc(x, top + 15, 9, 0.2, PI - 0.2)
      c.stroke()
      c.fillStyle = 'rgba(240,120,120,0.45)'
      for (const s of [-1, 1]) {
        c.beginPath()
        c.arc(x + s * 18, top + 9, 5, 0, TAU)
        c.fill()
      }
    }
    person(w * 0.33, h * 0.52, '#d9a23a', '#ffffff', true)
    person(w * 0.68, h * 0.5, '#c86a8a', '#d9d9df', false)
    c.fillStyle = '#e2503a'
    c.beginPath()
    c.moveTo(w / 2, 74)
    c.bezierCurveTo(w / 2 - 14, 62, w / 2 - 8, 50, w / 2, 58)
    c.bezierCurveTo(w / 2 + 8, 50, w / 2 + 14, 62, w / 2, 74)
    c.fill()
  })
  const fr = grp(g, [0, 0, 0], [-0.05, 0, 0])
  const woodT = woodTex('photo', '#9a5b2e', '#6e3b1a', '#b9763f', 'y', 21)
  add(fr, extrude('photoframe', () => {
    const s = roundRectShape(1.3, 1.7, 0.06)
    s.holes.push(roundRectPath(1.02, 1.42, 0.03))
    return s
  }, 0.08, { bevel: 0.03, bevelSeg: 2, curveSeg: 4 }), mat('#ffffff', { roughness: 0.35, map: woodT }))
  add(fr, extrude('photolip', () => {
    const s = roundRectShape(1.08, 1.48, 0.02)
    s.holes.push(roundRectPath(0.98, 1.38, 0.01))
    return s
  }, 0.02, { bevel: 0.01, bevelSeg: 1 }), gold(0.25), [0, 0, 0.03])
  add(fr, G.plane(1.04, 1.44), mat('#ffffff', { roughness: 0.5, map: pic }), [0, 0, 0.0])
  add(fr, G.rbox(1.2, 1.6, 0.03, 0.01, 1), matte('#5a3a24'), [0, 0, -0.06])
  add(g, G.rbox(0.2, 1.0, 0.04, 0.015, 1), matte('#5a3a24'), [0, -0.42, -0.13], [0.17, 0, 0])
}

function cash(g) {
  const edges = canvasTex('cash-edges', 64, 64, (c, w, h) => {
    c.fillStyle = '#d6ebc8'
    c.fillRect(0, 0, w, h)
    for (let y = 0; y < h; y += 2) {
      c.fillStyle = y % 4 ? 'rgba(80,130,80,0.35)' : 'rgba(255,255,255,0.5)'
      c.fillRect(0, y, w, 1)
    }
  })
  add(g, G.box(1.14, 0.42, 0.56), mat('#ffffff', { roughness: 0.8, map: edges }), [0, 0.21, 0])
  const nm = noteMat()
  add(g, G.plane(1.14, 0.56), nm, [0, 0.4205, 0], [-PI / 2, 0, 0])
  add(g, G.box(1.16, 0.01, 0.57), nm, [0.04, 0.435, 0.02], [0, 0.08, 0.02])
  add(g, G.box(0.24, 0.452, 0.575), mat('#f3ead0', { roughness: 0.7 }), [0, 0.215, 0])
  const band = canvasTex('cash-band', 64, 128, (c, w, h) => {
    c.fillStyle = '#f3ead0'
    c.fillRect(0, 0, w, h)
    c.fillStyle = '#c9a23a'
    c.fillRect(0, 0, 6, h)
    c.fillRect(w - 6, 0, 6, h)
    c.save()
    c.translate(w / 2, h / 2)
    c.rotate(-PI / 2)
    txt(c, '$10,000', 0, 1, 22, '#2f7a44')
    c.restore()
  }, { text: true })
  add(g, G.plane(0.24, 0.575), mat('#ffffff', { roughness: 0.7, map: band }), [0.03, 0.442, 0.0], [-PI / 2, 0, 0.08])
}

function necklace(g) {
  const curve = new THREE.CatmullRomCurve3([[0, 0, -0.5], [0.38, 0, -0.4], [0.53, 0, -0.06], [0.44, 0, 0.26], [0.2, 0, 0.44], [0, 0, 0.5], [-0.2, 0, 0.44], [-0.44, 0, 0.26], [-0.53, 0, -0.06], [-0.38, 0, -0.4]].map((p) => new V3(...p)), true)
  const P = new V3()
  const pr = pearl()
  const N = 27
  for (let i = 0; i < N; i++) {
    const t = i / N
    curve.getPointAt(t, P)
    if (Math.abs(P.x) < 0.07 && P.z > 0.4) continue
    if (Math.abs(P.x) < 0.04 && P.z < -0.45) continue
    add(g, G.sph(0.06, 8, 6), pr, [P.x, 0.06, P.z])
  }
  const au = gold(0.2)
  add(g, G.cyl(0.035, 0.035, 0.1, 10), au, [0, 0.045, -0.5], [0, 0, PI / 2])
  add(g, G.tor(0.05, 0.014, 6, 12), au, [0, 0.07, 0.52], [0, PI / 2, 0])
  const pend = grp(g, [0, 0.1, 0.68], [-0.45, 0, 0])
  add(pend, G.tor(0.14, 0.026, 5, 18), au, [0, 0, 0], [PI / 2, 0, 0], [1, 1.25, 1])
  add(pend, gemGeo(8), gem('#2a5bff', 0.55), [0, 0.0, 0], null, [0.13, 0.12, 0.165])
}

function diary(g) {
  const coverTex = canvasTex('diary-cover', 128, 192, (c, w, h) => {
    weave(c, w, h, '#6b3fa0', { step: 2, alpha: 0.18, seed: 4 })
    c.strokeStyle = '#f2c94c'
    c.lineWidth = 2
    rr(c, 10, 10, w - 20, h - 20, 12)
    c.stroke()
    txt(c, 'MY', w / 2, 40, 18, '#f2c94c')
    txt(c, 'SECRET', w / 2, 62, 20, '#ffffff')
    txt(c, 'DIARY', w / 2, 84, 22, '#f2c94c')
    c.fillStyle = '#ff6fa8'
    const hx = w / 2
    const hy = 120
    c.beginPath()
    c.moveTo(hx, hy + 18)
    c.bezierCurveTo(hx - 30, hy - 4, hx - 14, hy - 24, hx, hy - 10)
    c.bezierCurveTo(hx + 14, hy - 24, hx + 30, hy - 4, hx, hy + 18)
    c.fill()
    txt(c, 'KEEP OUT!', w / 2, 162, 15, '#ff6fa8')
  }, { text: true })
  bookLike(g, { w: 1.2, h: 0.4, d: 1.6, cover: mat('#6b3fa0', { roughness: 0.8 }), coverTex, pageTex: pagesTex(), corner: gold(0.25) })
  const strap = mat('#4a2a75', { roughness: 0.6 })
  add(g, G.rbox(0.36, 0.03, 0.26, 0.012, 1), strap, [0.46, 0.215, 0])
  add(g, G.rbox(0.04, 0.42, 0.26, 0.015, 1), strap, [0.63, 0, 0])
  const heart = () => {
    const s = new THREE.Shape()
    s.moveTo(0, -0.1)
    s.bezierCurveTo(-0.14, 0.0, -0.08, 0.12, 0, 0.05)
    s.bezierCurveTo(0.08, 0.12, 0.14, 0.0, 0, -0.1)
    return s
  }
  add(g, extrude('heartlock', heart, 0.03, { bevel: 0.015, bevelSeg: 2, curveSeg: 10 }), gold(0.18), [0.34, 0.245, 0], [-PI / 2, 0, PI / 2])
  add(g, G.cyl(0.018, 0.018, 0.02, 8), mat('#1a1a1a'), [0.345, 0.275, 0])
  add(g, G.box(0.05, 0.02, 0.012), mat('#1a1a1a'), [0.31, 0.275, 0])
}

// =========================================================================================
//  GARAGE
// =========================================================================================
function toolbox(g) {
  const red = mat('#d9322e', { roughness: 0.32, metalness: 0.3 })
  const ch = chrome()
  add(g, G.rbox(2.3, 0.86, 1.1, 0.06, 2), red, [0, 0.45, 0])
  add(g, G.rbox(2.31, 0.03, 1.11, 0.01, 1), plastic('#2a2a2e'), [0, 0.885, 0])
  add(g, G.rbox(2.33, 0.26, 1.13, 0.07, 2), red, [0, 1.03, 0])
  add(g, G.rbox(2.0, 0.05, 0.7, 0.025, 1), red, [0, 1.17, 0])
  for (const x of [-0.5, 0.5]) add(g, G.rbox(0.09, 0.2, 0.12, 0.03, 1), ch, [x, 1.25, 0])
  add(g, G.cap(0.07, 0.86, 3, 10), plastic('#1f1f23', 0.45), [0, 1.33, 0], [0, 0, PI / 2])
  for (const x of [-0.72, 0.72]) {
    add(g, G.rbox(0.22, 0.3, 0.05, 0.025, 1), ch, [x, 0.86, 0.565])
    add(g, G.rbox(0.1, 0.12, 0.02, 0.01, 1), plastic('#1f1f23'), [x, 0.82, 0.595])
  }
  const riv = chrome()
  for (const sz of [-1, 1]) for (const x of [-1.05, -0.4, 0.4, 1.05]) add(g, G.sph(0.03, 6, 4), riv, [x, 0.12, sz * 0.552])
  for (const y of [0.32, 0.6]) add(g, G.rbox(2.0, 0.05, 0.03, 0.015, 1), red, [0, y, 0.555])
  const sticker = canvasTex('tools-label', 128, 40, (c, w, h) => {
    c.fillStyle = '#ffcf26'
    rr(c, 0, 0, w, h, 8)
    c.fill()
    c.fillStyle = '#1f1f23'
    rr(c, 4, 4, w - 8, h - 8, 6)
    c.fill()
    txt(c, 'TOOLS', w / 2, h / 2 + 1, 24, '#ffcf26')
  }, { text: true })
  add(g, G.plane(0.7, 0.22), mat('#ffffff', { roughness: 0.4, map: sticker }), [0, 0.46, 0.58])
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(g, G.rbox(0.18, 0.04, 0.14, 0.015, 1), plastic('#1f1f23'), [sx * 1.0, 0.01, sz * 0.42])
}

function hammer(g) {
  const steel = metal('#8d939c', 0.3)
  const ch = chrome()
  const z = 0.82
  // striking face at -X, split claw at +X (so the claw shows in the usual 3/4 view)
  add(g, G.rbox(0.24, 0.34, 0.28, 0.05, 2), steel, [-0.02, 0, z])
  add(g, G.cyl(0.13, 0.15, 0.07, 18), steel, [-0.17, 0, z], [0, 0, PI / 2])
  add(g, G.cyl(0.16, 0.16, 0.06, 18), ch, [-0.23, 0, z], [0, 0, PI / 2])
  for (const y of [-0.075, 0.075]) add(g, tube([[0.06, y, z], [0.19, y, z - 0.01], [0.27, y, z - 0.11], [0.28, y, z - 0.25]], 0.075, { seg: 12, radial: 8, taper: (t) => 1 - 0.75 * t }), steel)
  add(g, G.cap(0.1, 1.0, 3, 12), mat('#c98a4b', { roughness: 0.5 }), [0, 0, 0.1], yAxisToZ, [0.85, 1, 1])
  const grip = rubber('#e2532d')
  add(g, G.cap(0.13, 0.7, 4, 14), grip, [0, 0, -0.72], yAxisToZ, [0.88, 1, 1])
  for (const zz of [-0.45, -0.7, -0.95]) add(g, G.tor(0.12, 0.025, 6, 18), rubber('#b83c1f'), [0, 0, zz], null, [0.9, 1.04, 1])
}

function wrench(g) {
  const shape = () => {
    const s = new THREE.Shape()
    const R = 0.17
    const c1 = 0.82
    s.moveTo(0.09, -0.62)
    s.lineTo(0.06, -0.3)
    s.lineTo(0.06, 0.3)
    s.lineTo(0.077, 0.669)
    const ang = (x, y) => Math.atan2(y - c1, x)
    s.absarc(0, c1, R, ang(0.077, 0.669), 1.13, false)
    s.lineTo(0.068, 0.86)
    s.absarc(0, 0.86, 0.068, 0, -PI, true)
    s.lineTo(-0.068, c1 + R * Math.sin(PI - 1.13))
    s.absarc(0, c1, R, PI - 1.13, PI - ang(0.077, 0.669), false)
    s.lineTo(-0.06, 0.3)
    s.lineTo(-0.06, -0.3)
    s.lineTo(-0.09, -0.62)
    s.absarc(0, -0.82, R, 2.2, TAU + 0.94, false)
    s.lineTo(0.09, -0.62)
    const hole = new THREE.Path()
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * TAU
      const r = i % 2 ? 0.1 : 0.115
      const x = Math.cos(a) * r
      const y = -0.82 + Math.sin(a) * r
      i === 0 ? hole.moveTo(x, y) : hole.lineTo(x, y)
    }
    s.holes.push(hole)
    return s
  }
  const ch = mat('#e6eaef', { roughness: 0.14, metalness: 1, env: 1.3 })
  add(g, extrude('wrench', shape, 0.12, { bevel: 0.03, bevelSeg: 2, curveSeg: 14 }), ch, [0, 0, 0], [PI / 2, 0, 0])
  add(g, G.rbox(0.07, 0.03, 0.62, 0.015, 1), ch, [0, 0.09, 0])
}

function drill(g) {
  const orange = mat('#ff7b1c', { roughness: 0.35 })
  const darkR = rubber('#2f3136')
  add(g, G.cap(0.28, 0.45, 3, 14), orange, [-0.12, 0.42, 0], [0, 0, PI / 2], [1, 1, 0.95])
  add(g, G.sph(0.25, 12, 8), darkR, [-0.55, 0.42, 0], null, [0.55, 1, 0.92])
  for (const y of [0.36, 0.42, 0.48]) for (const s of [-1, 1]) add(g, G.rbox(0.16, 0.025, 0.02, 0.01, 1), darkR, [-0.32, y, s * 0.262])
  const rib = canvasTex('chuckrib', 64, 16, (c, w, h) => {
    c.fillStyle = '#2a2b30'
    c.fillRect(0, 0, w, h)
    for (let x = 0; x < w; x += 4) {
      c.fillStyle = '#45464d'
      c.fillRect(x, 0, 2, h)
    }
  }, { repeat: [5, 1] })
  add(g, G.cyl(0.14, 0.17, 0.24, 18), mat('#ffffff', { roughness: 0.5, map: rib }), [0.42, 0.42, 0], yAxisToX)
  add(g, G.cyl(0.07, 0.11, 0.1, 14), chrome(), [0.59, 0.42, 0], yAxisToX)
  const bit = canvasTex('bit', 32, 64, (c, w, h) => {
    c.fillStyle = '#e6eaef'
    c.fillRect(0, 0, w, h)
    c.fillStyle = '#7a8088'
    for (let i = -2; i < 8; i++) {
      c.beginPath()
      c.moveTo(0, i * 10)
      c.lineTo(w, i * 10 + 12)
      c.lineTo(w, i * 10 + 16)
      c.lineTo(0, i * 10 + 4)
      c.fill()
    }
  })
  add(g, G.cyl(0.028, 0.028, 0.3, 8), mat('#ffffff', { roughness: 0.15, metalness: 1, map: bit }), [0.79, 0.42, 0], yAxisToX)
  add(g, G.cone(0.028, 0.06, 8), chrome(), [0.97, 0.42, 0], yAxisToX)
  const grip = grp(g, [-0.15, 0.0, 0], [0, 0, -0.25])
  add(grip, G.rbox(0.28, 0.72, 0.3, 0.12, 2), darkR, [0, -0.1, 0])
  add(grip, G.rbox(0.3, 0.4, 0.2, 0.08, 2), orange, [-0.01, -0.12, 0], null, [1, 1, 1.6])
  add(g, G.rbox(0.09, 0.2, 0.12, 0.04, 2), plastic('#1f1f23', 0.4), [0.05, 0.12, 0])
  add(g, G.rbox(0.06, 0.08, 0.36, 0.02, 1), plastic('#1f1f23', 0.4), [0.0, 0.3, 0])
  add(g, G.rbox(0.62, 0.34, 0.58, 0.08, 2), plastic('#26272c', 0.4), [-0.22, -0.64, 0])
  add(g, G.rbox(0.64, 0.06, 0.6, 0.03, 1), orange, [-0.22, -0.5, 0])
  const bl = canvasTex('drill-label', 128, 64, (c, w, h) => {
    c.fillStyle = '#26272c'
    c.fillRect(0, 0, w, h)
    c.fillStyle = '#ff7b1c'
    c.beginPath()
    c.moveTo(30, 8)
    c.lineTo(16, 36)
    c.lineTo(28, 36)
    c.lineTo(22, 58)
    c.lineTo(44, 26)
    c.lineTo(32, 26)
    c.lineTo(40, 8)
    c.fill()
    txt(c, '18V', 86, 34, 30, '#ffffff')
  }, { text: true })
  add(g, G.plane(0.4, 0.2), mat('#ffffff', { roughness: 0.4, map: bl }), [-0.22, -0.68, 0.291])
  for (let i = 0; i < 3; i++) add(g, G.box(0.04, 0.025, 0.01), glow('#5dff7a', 1.2), [-0.42 + i * 0.06, -0.55, 0.291])
}

function paintcan(g) {
  const label = canvasTex('paint-label', 256, 128, (c, w, h) => {
    c.fillStyle = '#f7f3ea'
    c.fillRect(0, 0, w, h)
    c.fillStyle = '#3a8ee6'
    c.fillRect(0, 0, w, 16)
    c.fillRect(0, h - 16, w, 16)
    const m = w / 2
    c.fillStyle = '#3a8ee6'
    c.beginPath()
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * TAU
      const r = i % 2 ? 22 : 32
      c.lineTo(m - 52 + Math.cos(a) * r, h / 2 + Math.sin(a) * r)
    }
    c.fill()
    txt(c, 'GRANDPA’S', m + 26, h / 2 - 22, 16, '#2a2d33')
    txt(c, 'PAINT', m + 26, h / 2 + 2, 30, '#2a2d33')
    txt(c, 'SKY BLUE', m + 26, h / 2 + 28, 15, '#3a8ee6')
  }, { text: true })
  const tin = metal('#c4cad2', 0.32)
  add(g, G.cyl(0.44, 0.44, 0.9, 40), tin, [0, 0.47, 0])
  add(g, G.cyl(0.446, 0.446, 0.62, 40, true), mat('#ffffff', { roughness: 0.6, map: label }), [0, 0.45, 0])
  add(g, G.tor(0.44, 0.03, 5, 36), tin, [0, 0.92, 0], [PI / 2, 0, 0])
  add(g, G.tor(0.44, 0.03, 5, 36), tin, [0, 0.03, 0], [PI / 2, 0, 0])
  add(g, G.tor(0.34, 0.018, 4, 32), tin, [0, 0.925, 0], [PI / 2, 0, 0])
  const blue = mat('#3a8ee6', { roughness: 0.15 })
  add(g, dripGeo('paint', 0.455, 0.03, [[0.1, 0.16, 0.36], [0.5, 0.11, 0.18], [-0.35, 0.12, 0.26], [0.95, 0.1, 0.12]], 64, 4), blue, [0, 0.95, 0])
  add(g, G.sph(0.08, 10, 8), blue, [0.05, 0.935, 0.4], null, [1.6, 0.5, 1])
  const blob = () => {
    const pts = []
    for (let i = 0; i < 30; i++) {
      const a = (i / 30) * TAU
      const r = 0.16 + 0.04 * Math.sin(3 * a) + 0.03 * Math.cos(5 * a + 1)
      pts.push([Math.cos(a) * r, Math.sin(a) * r])
    }
    return polyShape(pts)
  }
  add(g, extrude('paintpuddle', blob, 0.01, { bevel: 0.01, bevelSeg: 1 }), blue, [0.12, 0.935, 0.22], [-PI / 2, 0, 0])
  for (const s of [-1, 1]) add(g, G.cyl(0.05, 0.05, 0.03, 12), tin, [s * 0.45, 0.8, 0], [0, 0, PI / 2])
  const bail = grp(g, [0, 0.8, 0], [-0.9, 0, 0])
  add(bail, G.tor(0.45, 0.014, 5, 32, PI), metal('#9aa1ab', 0.3))
  add(bail, G.cyl(0.04, 0.04, 0.3, 10), plastic('#2a2d33'), [0, 0.45, 0], [0, 0, PI / 2])
}

function flashlight(g) {
  const b = grp(g, [0, 0, 0], yAxisToZ)
  const ch = chrome()
  add(b, G.lathe([[0, -0.9], [0.15, -0.9], [0.17, -0.87], [0.17, -0.7], [0.15, -0.69]], 20, 0.02), ch)
  const knurl = canvasTex('knurl', 64, 64, (c, w, h) => {
    c.fillStyle = '#c42a2f'
    c.fillRect(0, 0, w, h)
    c.strokeStyle = 'rgba(80,0,10,0.45)'
    for (let i = -8; i < 16; i++) {
      c.beginPath()
      c.moveTo(i * 8, 0)
      c.lineTo(i * 8 + 32, h)
      c.moveTo(i * 8 + 32, 0)
      c.lineTo(i * 8, h)
      c.stroke()
    }
  }, { repeat: [4, 4] })
  add(b, G.cyl(0.16, 0.16, 0.96, 24), mat('#ffffff', { roughness: 0.35, metalness: 0.5, map: knurl }), [0, -0.22, 0])
  add(b, G.lathe([[0.155, 0.24], [0.2, 0.38], [0.245, 0.6], [0.25, 0.82], [0.23, 0.86]], 24, 0.02), ch)
  add(b, G.tor(0.225, 0.02, 6, 28), ch, [0, 0.85, 0], [PI / 2, 0, 0])
  add(b, G.circle(0.21, 24), mat('#fff6d2', { emissive: '#ffe9a0', ei: 0.6, roughness: 0.1 }), [0, 0.84, 0], [-PI / 2, 0, 0])
  add(g, G.rbox(0.1, 0.07, 0.18, 0.03, 2), rubber('#1f1f23'), [0, 0.165, 0.12])
  add(g, G.tor(0.07, 0.018, 6, 14), ch, [0, 0, -0.95], [0, PI / 2, 0])
}

function gascan(g) {
  const red = mat('#d42a2a', { roughness: 0.3 })
  add(g, G.rbox(1.3, 1.2, 0.7, 0.13, 3), red, [0, 0.62, 0])
  for (const sz of [-1, 1]) {
    for (const r of [0.72, -0.72]) add(g, G.rbox(1.2, 0.12, 0.04, 0.02, 1), red, [0, 0.62, sz * 0.36], [0, 0, r])
    add(g, G.rbox(1.12, 1.02, 0.03, 0.04, 1), mat('#b81f1f', { roughness: 0.35 }), [0, 0.62, sz * 0.345])
  }
  add(g, G.cap(0.06, 0.78, 3, 10), red, [-0.08, 1.44, 0], [0, 0, PI / 2])
  for (const x of [-0.42, -0.08, 0.26]) add(g, G.rbox(0.08, 0.24, 0.1, 0.03, 1), red, [x, 1.3, 0])
  const sp = grp(g, [0.48, 1.24, 0], [0, 0, -0.5])
  add(sp, G.cyl(0.08, 0.1, 0.14, 14), red, [0, 0.04, 0])
  add(sp, G.cyl(0.13, 0.13, 0.12, 16), plastic('#ffcf26', 0.35), [0, 0.16, 0])
  const warn = canvasTex('gas-warn', 64, 64, (c, w, h) => {
    c.clearRect(0, 0, w, h)
    c.fillStyle = '#ffcf26'
    c.beginPath()
    c.moveTo(32, 2)
    c.lineTo(62, 32)
    c.lineTo(32, 62)
    c.lineTo(2, 32)
    c.fill()
    c.fillStyle = '#1f1f23'
    c.beginPath()
    c.moveTo(32, 14)
    c.bezierCurveTo(44, 28, 42, 44, 32, 48)
    c.bezierCurveTo(22, 44, 22, 30, 28, 24)
    c.bezierCurveTo(28, 32, 32, 34, 32, 14)
    c.fill()
  })
  add(g, G.plane(0.34, 0.34), mat('#ffffff', { roughness: 0.4, map: warn, alphaTest: 0.5 }), [0, 0.62, 0.385])
}

function hubcap(g) {
  const face = canvasTex('hubcap', 256, 128, (c, w, h) => {
    c.fillStyle = '#ffffff'
    c.fillRect(0, 0, w, h)
    const Y = (v) => (1 - v) * h
    c.fillStyle = '#26282d'
    for (let i = 0; i < 6; i++) {
      const x0 = (i / 6) * w + 9
      rr(c, x0, Y(0.8), w / 6 - 18, Y(0.32) - Y(0.8), 8)
      c.fill()
    }
    c.fillStyle = '#c9ced6'
    c.fillRect(0, Y(0.9), w, 3)
  })
  add(g, G.lathe([[0, 0.02], [0.9, 0.02], [0.98, 0.0], [1.0, 0.03], [0.96, 0.08], [0.8, 0.13], [0.3, 0.22], [0.16, 0.26], [0.13, 0.3], [0, 0.3]], 44, 0.02, 1, 'r'), mat('#ffffff', { roughness: 0.1, metalness: 1, map: face, env: 1.4 }))
  const ch = chrome()
  const spoke = extrude('hubspoke', () => polyShape([[-0.08, 0], [0.08, 0], [0.05, 0.52], [-0.05, 0.52]]), 0.04, { bevel: 0.02, bevelSeg: 2 })
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU
    const sg = grp(g, [0, 0, 0], [0, a, 0])
    add(sg, spoke, ch, [0, 0.25, 0.27], [PI / 2 + 0.18, 0, 0])
  }
  const emb = canvasTex('hub-emblem', 64, 64, (c, w, h) => {
    c.fillStyle = '#d8343b'
    c.beginPath()
    c.arc(32, 32, 31, 0, TAU)
    c.fill()
    txt(c, 'G', 32, 34, 40, '#ffffff')
  }, { text: true })
  add(g, G.circle(0.11, 24), mat('#ffffff', { roughness: 0.25, map: emb }), [0, 0.302, 0], [-PI / 2, 0, 0])
  around(5, 0.21, (i, a, x, z) => add(g, G.cyl(0.03, 0.035, 0.06, 6), ch, [x, 0.22, z]), PI / 6)
}

// =========================================================================================
//  STUDY (secret room)
// =========================================================================================
function goldbar(g) {
  const au = mat('#f7c84a', { roughness: 0.2, metalness: 1, emissive: '#7a5000', ei: 0.5, flat: true, env: 1.6 })
  add(g, frustumGeo(1.4, 0.7, 1.08, 0.44, 0.5), au, [0, 0.25, 0])
  const stamp = canvasTex('goldstamp', 256, 96, (c, w, h) => {
    c.fillStyle = '#f5c242'
    c.fillRect(0, 0, w, h)
    c.strokeStyle = '#a5740f'
    c.lineWidth = 4
    rr(c, 6, 6, w - 12, h - 12, 10)
    c.stroke()
    txt(c, 'FINE GOLD', w / 2, 30, 26, '#8a5d0a')
    txt(c, '999.9', w / 2, 60, 24, '#8a5d0a')
    txt(c, '1 KG • GRANDPA RESERVE', w / 2, 82, 12, '#8a5d0a')
  }, { text: true })
  add(g, G.plane(0.96, 0.36), mat('#ffffff', { roughness: 0.25, metalness: 1, map: stamp, emissive: '#7a5000', ei: 0.45 }), [0, 0.501, 0], [-PI / 2, 0, 0])
}

function crown(g) {
  const au = gold(0.16)
  add(g, G.lathe([[0.66, 0.12], [0.72, 0.12], [0.74, 0.16], [0.74, 0.44], [0.72, 0.48], [0.66, 0.48], [0.64, 0.44], [0.64, 0.16], [0.66, 0.12]], 28, 0.02, 1), au)
  const ermine = canvasTex('ermine', 128, 32, (c, w, h) => {
    weave(c, w, h, '#fbf8f2', { step: 2, alpha: 0.12, seed: 9 })
    c.fillStyle = '#1a1a1f'
    for (let i = 0; i < 8; i++) {
      const x = (i + 0.5) * (w / 8)
      c.beginPath()
      c.moveTo(x, 8)
      c.lineTo(x - 3, 22)
      c.lineTo(x + 3, 22)
      c.fill()
    }
  }, { repeat: [3, 1] })
  add(g, G.tor(0.75, 0.1, 7, 36), cloth('#ffffff', ermine), [0, 0.1, 0], [PI / 2, 0, 0])
  add(g, G.sph(0.66, 18, 7, 0, TAU, 0, PI / 2), cloth('#a8102c', feltTex('#a8102c', 'velvet-red')), [0, 0.42, 0], null, [1, 0.72, 1])
  const cross = extrude('crosspattee', () => {
    const cy = 0.15
    const a = 0.035
    const b = 0.09
    const L = 0.14
    return polyShape([[-b, cy + L], [b, cy + L], [a, cy + a], [L, cy + b], [L, cy - b], [a, cy - a], [b, cy - L], [-b, cy - L], [-a, cy - a], [-L, cy - b], [-L, cy + b], [-a, cy + a]])
  }, 0.05, { bevel: 0.02, bevelSeg: 1 })
  const spike = extrude('crownspike', () => polyShape([[-0.09, 0], [0.09, 0], [0.025, 0.2], [-0.025, 0.2]]), 0.05, { bevel: 0.02, bevelSeg: 1 })
  const ruby = gem('#e0115f', 0.6)
  const sapph = gem('#2a5bff', 0.6)
  const emer = gem('#18c06a', 0.6)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU
    const p = grp(g, [Math.sin(a) * 0.69, 0.46, Math.cos(a) * 0.69], [0.15, a, 0, 'YXZ'])
    if (i % 2 === 0) {
      add(p, cross, au)
      add(p, gemGeo(6), i === 0 ? ruby : sapph, [0, 0.15, 0.05], [PI / 2, 0, 0], i === 0 ? [0.06, 0.04, 0.06] : [0.045, 0.03, 0.045])
    } else {
      add(p, spike, au)
      add(p, G.sph(0.05, 8, 6), pearl(), [0, 0.24, 0])
    }
    const ga = a + TAU / 16
    add(g, gemGeo(6), [ruby, emer, sapph][i % 3], [Math.sin(ga) * 0.74, 0.3, Math.cos(ga) * 0.74], [PI / 2, ga, 0, 'YXZ'], [0.08, 0.11, 0.08])
  }
  add(g, gemGeo(8), ruby, [0, 0.3, 0.74], [PI / 2, 0, 0], [0.12, 0.13, 0.12])
  for (const a of [0, PI / 2]) add(g, G.tor(0.62, 0.045, 5, 20, PI), au, [0, 0.46, 0], [0, a, 0], [1, 0.75, 1])
  add(g, G.sph(0.1, 12, 8), au, [0, 1.0, 0])
  add(g, G.box(0.05, 0.18, 0.05), au, [0, 1.16, 0])
  add(g, G.box(0.14, 0.05, 0.05), au, [0, 1.18, 0])
}

const LANDS = [
  [[-165, 65], [-140, 70], [-95, 75], [-75, 70], [-60, 55], [-55, 48], [-70, 43], [-80, 30], [-82, 25], [-97, 25], [-97, 18], [-88, 15], [-83, 9], [-78, 8], [-90, 16], [-105, 20], [-112, 25], [-117, 32], [-124, 40], [-125, 49], [-135, 58], [-150, 60], [-165, 62]],
  [[-50, 82], [-25, 80], [-20, 70], [-42, 60], [-52, 65], [-60, 76]],
  [[-78, 8], [-60, 10], [-50, 0], [-35, -6], [-40, -22], [-48, -28], [-58, -38], [-65, -55], [-72, -50], [-72, -30], [-70, -18], [-80, -5], [-80, 2]],
  [[-10, 36], [-9, 43], [-2, 48], [-5, 58], [5, 62], [15, 70], [30, 71], [60, 70], [80, 73], [105, 78], [140, 72], [170, 68], [180, 65], [160, 58], [140, 52], [130, 42], [122, 30], [110, 20], [105, 10], [100, 15], [95, 17], [90, 22], [80, 10], [73, 20], [66, 25], [57, 26], [50, 30], [48, 30], [35, 36], [28, 41], [22, 38], [15, 40], [10, 44], [3, 43]],
  [[-17, 21], [-10, 30], [-5, 36], [10, 37], [20, 32], [32, 31], [35, 25], [43, 12], [51, 12], [40, -3], [40, -15], [35, -25], [20, -35], [16, -28], [12, -15], [9, -1], [8, 4], [-8, 4], [-15, 10]],
  [[114, -22], [122, -18], [132, -12], [142, -11], [146, -18], [153, -26], [150, -37], [140, -38], [132, -32], [115, -34]],
  [[-5, 50], [2, 52], [-2, 58], [-6, 57]],
  [[130, 31], [140, 35], [142, 42], [138, 38]],
  [[44, -25], [50, -15], [48, -13], [43, -20]],
  [[95, 5], [105, -6], [115, -8], [118, -3], [110, 2]],
]
function globe(g) {
  const map = canvasTex('globe-map', 256, 128, (c, w, h) => {
    c.fillStyle = '#9fc4bb'
    c.fillRect(0, 0, w, h)
    speckle(c, w, h, 300, ['#8fb5ab', '#b0d2c8'], { min: 0.6, max: 1.8, seed: 5 })
    const X = (lon) => ((lon + 180) / 360) * w
    const Y = (lat) => ((90 - lat) / 180) * h
    c.fillStyle = '#ead7a2'
    c.strokeStyle = '#8a5a2b'
    c.lineWidth = 1.2
    for (const poly of LANDS) {
      c.beginPath()
      poly.forEach(([lo, la], i) => (i ? c.lineTo(X(lo), Y(la)) : c.moveTo(X(lo), Y(la))))
      c.closePath()
      c.fill()
      c.stroke()
    }
    c.beginPath()
    c.moveTo(0, Y(-68))
    for (let lo = -180; lo <= 180; lo += 15) c.lineTo(X(lo), Y(-68 + Math.sin(lo * 0.1) * 3))
    c.lineTo(w, h)
    c.lineTo(0, h)
    c.closePath()
    c.fillStyle = '#f4f0e6'
    c.fill()
    c.strokeStyle = 'rgba(110,70,30,0.35)'
    c.lineWidth = 0.8
    for (let la = -60; la <= 60; la += 30) {
      c.beginPath()
      c.moveTo(0, Y(la))
      c.lineTo(w, Y(la))
      c.stroke()
    }
    for (let lo = -180; lo < 180; lo += 30) {
      c.beginPath()
      c.moveTo(X(lo), 0)
      c.lineTo(X(lo), h)
      c.stroke()
    }
    c.strokeStyle = 'rgba(140,40,30,0.6)'
    c.lineWidth = 1.2
    c.beginPath()
    c.moveTo(0, Y(0))
    c.lineTo(w, Y(0))
    c.stroke()
    // compass rose in the Pacific
    const cx = X(-140)
    const cy = Y(-25)
    c.fillStyle = '#8a3a2a'
    for (let i = 0; i < 4; i++) {
      c.save()
      c.translate(cx, cy)
      c.rotate((i * PI) / 2)
      c.beginPath()
      c.moveTo(0, -9)
      c.lineTo(2.5, 0)
      c.lineTo(-2.5, 0)
      c.fill()
      c.restore()
    }
  })
  const woodT = woodTex('globe-stand', '#5e3218', '#3a1c0c', '#7a4526', 'x', 25)
  const wood = mat('#ffffff', { roughness: 0.3, map: woodT })
  add(g, G.lathe([[0, 0], [0.6, 0], [0.63, 0.05], [0.6, 0.1], [0.42, 0.14], [0.3, 0.24], [0.12, 0.33], [0.1, 0.52], [0.14, 0.56], [0.08, 0.64], [0.07, 0.7], [0, 0.71]], 26, 0.025), wood)
  const cy = 0.7 + 0.93
  const tilt = 0.41
  add(g, G.sph(0.85, 28, 18), mat('#ffffff', { roughness: 0.4, map: map }), [0, cy, 0], [0, -0.6, -tilt, 'ZYX'])
  const br = brass()
  add(g, G.tor(0.93, 0.035, 6, 48), br, [0, cy, 0])
  for (const s of [-1, 1]) add(g, G.cyl(0.03, 0.03, 0.16, 8), br, [s * Math.sin(tilt) * 0.88, cy + s * Math.cos(tilt) * 0.88, 0], [0, 0, -tilt])
  add(g, G.sph(0.05, 10, 8), br, [Math.sin(tilt) * 0.97, cy + Math.cos(tilt) * 0.97, 0])
  add(g, G.cyl(0.06, 0.08, 0.12, 12), br, [0, 0.72, 0])
}

function painting(g) {
  const land = canvasTex('landscape', 256, 192, (c, w, h) => {
    const sky = c.createLinearGradient(0, 0, 0, h * 0.6)
    sky.addColorStop(0, '#6fb3e8')
    sky.addColorStop(1, '#f6e3b0')
    c.fillStyle = sky
    c.fillRect(0, 0, w, h)
    c.fillStyle = '#ffe48a'
    c.beginPath()
    c.arc(w * 0.78, h * 0.22, 18, 0, TAU)
    c.fill()
    c.fillStyle = 'rgba(255,255,255,0.9)'
    for (const [x, y, s] of [[50, 36, 1], [140, 28, 0.8], [200, 60, 0.6]]) {
      for (const [dx, dy, r] of [[0, 0, 12], [12, -4, 14], [26, 0, 11], [12, 5, 10]]) {
        c.beginPath()
        c.arc(x + dx * s, y + dy * s, r * s, 0, TAU)
        c.fill()
      }
    }
    c.fillStyle = '#8aa7c8'
    c.beginPath()
    c.moveTo(0, h * 0.55)
    c.quadraticCurveTo(w * 0.2, h * 0.38, w * 0.42, h * 0.52)
    c.quadraticCurveTo(w * 0.65, h * 0.36, w, h * 0.5)
    c.lineTo(w, h)
    c.lineTo(0, h)
    c.fill()
    c.fillStyle = '#7bbf5a'
    c.beginPath()
    c.moveTo(0, h * 0.66)
    c.quadraticCurveTo(w * 0.35, h * 0.5, w * 0.7, h * 0.64)
    c.quadraticCurveTo(w * 0.85, h * 0.7, w, h * 0.62)
    c.lineTo(w, h)
    c.lineTo(0, h)
    c.fill()
    c.fillStyle = '#5a9e3e'
    c.beginPath()
    c.moveTo(0, h * 0.8)
    c.quadraticCurveTo(w * 0.5, h * 0.66, w, h * 0.82)
    c.lineTo(w, h)
    c.lineTo(0, h)
    c.fill()
    c.fillStyle = '#6fb3e8'
    c.beginPath()
    c.moveTo(w * 0.45, h * 0.66)
    c.bezierCurveTo(w * 0.55, h * 0.74, w * 0.3, h * 0.84, w * 0.42, h)
    c.lineTo(w * 0.62, h)
    c.bezierCurveTo(w * 0.48, h * 0.86, w * 0.68, h * 0.74, w * 0.5, h * 0.66)
    c.fill()
    const bx = w * 0.7
    const by = h * 0.6
    c.fillStyle = '#c8402f'
    c.fillRect(bx, by - 16, 30, 18)
    c.fillStyle = '#7a2a20'
    c.beginPath()
    c.moveTo(bx - 4, by - 15)
    c.lineTo(bx + 15, by - 30)
    c.lineTo(bx + 34, by - 15)
    c.fill()
    c.fillStyle = '#f6efd9'
    c.fillRect(bx + 11, by - 10, 8, 12)
    for (const [x, y, r] of [[w * 0.18, h * 0.62, 16], [w * 0.26, h * 0.66, 12], [w * 0.9, h * 0.66, 14]]) {
      c.fillStyle = '#6b4226'
      c.fillRect(x - 2, y, 4, r)
      c.fillStyle = '#3f7f33'
      c.beginPath()
      c.arc(x, y, r, 0, TAU)
      c.fill()
    }
    speckle(c, w, h * 0.3, 90, ['#ff6f8f', '#ffffff', '#ffe14d'], { min: 1, max: 2.2, seed: 3 })
    c.translate(0, h * 0.8)
    speckle(c, w, h * 0.2, 80, ['#ff6f8f', '#ffffff', '#ffe14d'], { min: 1, max: 2.4, seed: 6 })
    c.setTransform(1, 0, 0, 1, 0, 0)
    speckle(c, w, h, 500, ['rgba(255,255,255,0.18)', 'rgba(0,0,0,0.08)'], { min: 0.8, max: 2, seed: 9 })
  })
  const au = gold(0.24)
  add(g, extrude('paintframe', () => {
    const s = roundRectShape(2.1, 1.7, 0.04)
    s.holes.push(roundRectPath(1.72, 1.32, 0.02))
    return s
  }, 0.16, { bevel: 0.05, bevelSeg: 2, curveSeg: 4 }), au)
  add(g, extrude('paintframe2', () => {
    const s = roundRectShape(1.72, 1.32, 0.02)
    s.holes.push(roundRectPath(1.62, 1.22, 0.01))
    return s
  }, 0.08, { bevel: 0.02, bevelSeg: 1, curveSeg: 3 }), mat('#b8892f', { roughness: 0.35, metalness: 0.9 }), [0, 0, 0.0])
  add(g, G.plane(1.64, 1.24), mat('#ffffff', { roughness: 0.75, map: land }), [0, 0, -0.03])
  add(g, G.rbox(1.9, 1.5, 0.04, 0.01, 1), matte('#4a3424'), [0, 0, -0.09])
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    add(g, G.sph(0.09, 10, 6), au, [sx * 0.98, sy * 0.78, 0.12], null, [1, 1, 0.5])
    add(g, G.tor(0.09, 0.02, 4, 14), au, [sx * 0.98, sy * 0.78, 0.1])
  }
  add(g, G.sph(0.08, 10, 8), au, [0, 0.82, 0.12], null, [1.6, 0.8, 0.5])
}

function diamond(g) {
  const geo = gemGeo(10, { table: 0.55, crown: 0.48, girdle: 0.06, pavilion: 1.35 })
  add(g, geo, mat('#d9f4ff', { roughness: 0.02, metalness: 0.15, opacity: 0.62, double: true, flat: true, env: 2.6, emissive: '#9fdcff', ei: 0.28, order: 3 }))
  add(g, geo, mat('#ffffff', { roughness: 0.05, emissive: '#cfefff', ei: 0.7, opacity: 0.55, flat: true, order: 2, noShadow: true }), [0, 0.05, 0], [0, PI / 10, 0], 0.55)
  const star = glow('#ffffff', 2.2)
  const sparkle = (p, s) => {
    for (const sc of [[0.025, 0.24, 0.025], [0.24, 0.025, 0.025], [0.025, 0.025, 0.24]]) add(g, G.oct(1), star, p, [0.3, 0.4, 0], sc.map((v) => v * s))
  }
  sparkle([0.62, 0.35, 0.5], 1)
  sparkle([-0.55, 0.1, 0.6], 0.7)
}

function coinjar(g) {
  const coinsTex = canvasTex('coins', 256, 128, (c, w, h) => {
    c.fillStyle = '#6a4a18'
    c.fillRect(0, 0, w, h)
    const r = rng(77)
    const cols = [['#f5c242', '#b8861f'], ['#d8dde3', '#8a929e'], ['#d27c4c', '#8a4a24']]
    for (let i = 0; i < 260; i++) {
      const [a, b] = cols[(r() * 3) | 0]
      const x = r() * w
      const y = r() * h
      const rad = 7 + r() * 6
      c.fillStyle = b
      c.beginPath()
      c.ellipse(x, y + 1.5, rad, rad * (0.35 + r() * 0.6), r() * PI, 0, TAU)
      c.fill()
      c.fillStyle = a
      c.beginPath()
      c.ellipse(x, y, rad, rad * (0.35 + r() * 0.6), r() * PI, 0, TAU)
      c.fill()
    }
  })
  add(g, G.cyl(0.55, 0.55, 1.0, 32), mat('#ffffff', { roughness: 0.3, metalness: 0.6, map: coinsTex }), [0, 0.56, 0])
  const r = rng(5)
  const coinMats = [gold(0.25), metal('#d8dde3', 0.25), copper()]
  for (let i = 0; i < 9; i++) {
    const a = r() * TAU
    const d = Math.sqrt(r()) * 0.4
    add(g, G.cyl(0.11, 0.11, 0.025, 16), coinMats[i % 3], [Math.sin(a) * d, 1.08 + r() * 0.04, Math.cos(a) * d], [r() * 0.5 - 0.25, 0, r() * 0.5 - 0.25])
  }
  add(g, G.lathe([[0, 0], [0.5, 0], [0.57, 0.04], [0.59, 0.15], [0.59, 1.15], [0.52, 1.25], [0.45, 1.3], [0.45, 1.38]], 28, 0.03), glass('#e8f6ff', 0.3))
  const lidRib = canvasTex('lidrib', 64, 16, (c, w, h) => {
    c.fillStyle = '#d6a84a'
    c.fillRect(0, 0, w, h)
    for (let x = 0; x < w; x += 4) {
      c.fillStyle = '#a87a22'
      c.fillRect(x, 0, 2, h)
    }
  }, { repeat: [12, 1] })
  add(g, G.cyl(0.48, 0.48, 0.16, 36), mat('#ffffff', { roughness: 0.3, metalness: 0.95, map: lidRib }), [0, 1.44, 0])
  add(g, G.cyl(0.46, 0.46, 0.02, 36), brass(), [0, 1.52, 0])
  add(g, G.rbox(0.36, 0.03, 0.07, 0.012, 1), mat('#2a2418'), [0, 1.535, 0])
  add(g, G.cyl(0.13, 0.13, 0.03, 18), gold(0.25), [0.02, 1.6, 0], yAxisToZ)
  const label = canvasTex('jar-label', 128, 64, (c, w, h) => {
    c.fillStyle = '#e8d3a6'
    c.fillRect(0, 0, w, h)
    c.strokeStyle = '#8a5a2b'
    c.lineWidth = 2
    c.strokeRect(4, 4, w - 8, h - 8)
    txt(c, 'SAVINGS', w / 2, 26, 22, '#5a3415')
    txt(c, 'for a rainy day', w / 2, 46, 11, '#5a3415', { italic: true })
  }, { text: true })
  add(g, G.arcCyl(0.6, 0.38, -0.62, 1.24, 12), mat('#ffffff', { roughness: 0.85, map: label }), [0, 0.7, 0])
}

const BUILDERS = {
  umbrella, boot, fedora, keys, vase, wallet, pocketwatch, snowglobe,
  remote, lamp, cushion, book, record, trophy, teacup, cookietin, piggybank, yarn, camera, radio,
  toaster, pan, teapot, cheese, cake, mug, milk, blender, rollingpin, plate,
  duck, toothbrush, perfume, shampoo, tp, hairdryer, soap, dentures,
  alarmclock, jewelbox, pillow, slipper, teddy, watch, photo, cash, necklace, diary,
  toolbox, hammer, wrench, drill, paintcan, flashlight, gascan, hubcap,
  goldbar, crown, globe, painting, diamond, coinjar,
}
