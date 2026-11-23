// Shared building blocks for the procedural loot / gadget models.
//
// Everything here is cached: materials by their look, geometries by their
// parameters, canvas textures by key. Models are built once from many small
// meshes, then `finish()` bakes them into ONE mesh per material, centred on the
// bounding box and fitted to the requested size; callers clone that template
// (clones share geometry + materials, so do not dispose them per instance).
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { batchByLook } from '../../merge.js'

export { THREE }
export const PI = Math.PI
export const TAU = Math.PI * 2
const V2 = THREE.Vector2
const V3 = THREE.Vector3

// --- Random ---------------------------------------------------------------------------
export function rng(seed = 1) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- Materials --------------------------------------------------------------------------
// mat(colour, { roughness, metalness, emissive, ei (emissive intensity), emap (emissive map), map,
//   opacity, alphaTest, double, flat, env (envMapIntensity), order (renderOrder), noShadow, depthWrite })
const mats = new Map()
export function mat(color = '#ffffff', o = {}) {
  const key = [color, o.roughness ?? 0.55, o.metalness ?? 0, o.emissive ?? '', o.ei ?? 1, o.map?.uuid ?? '', o.opacity ?? 1,
    o.double ? 1 : 0, o.flat ? 1 : 0, o.env ?? 1, o.order ?? 0, o.noShadow ? 1 : 0, o.depthWrite ?? '', o.bump?.uuid ?? '', o.emap?.uuid ?? '', o.alphaTest ?? 0].join('|')
  let m = mats.get(key)
  if (m) return m
  m = new THREE.MeshStandardMaterial({
    color,
    roughness: o.roughness ?? 0.55,
    metalness: o.metalness ?? 0,
    map: o.map ?? null,
    flatShading: !!o.flat,
    envMapIntensity: o.env ?? 1,
    side: o.double ? THREE.DoubleSide : THREE.FrontSide,
  })
  if (o.emissive) {
    m.emissive.set(o.emissive)
    m.emissiveIntensity = o.ei ?? 1
    if (o.emap) m.emissiveMap = o.emap
  }
  if (o.alphaTest) m.alphaTest = o.alphaTest
  if (o.bump) {
    m.bumpMap = o.bump
    m.bumpScale = o.bumpScale ?? 1
  }
  if ((o.opacity ?? 1) < 1) {
    m.transparent = true
    m.opacity = o.opacity
    m.depthWrite = o.depthWrite ?? false
  }
  m.userData.order = o.order ?? (m.transparent ? 2 : 0)
  m.userData.noShadow = !!o.noShadow
  mats.set(key, m)
  return m
}

// Shorthands for the common looks.
export const paint = (c, r = 0.38, map) => mat(c, { roughness: r, map })
export const plastic = (c, r = 0.42, map) => mat(c, { roughness: r, map })
export const matte = (c, map) => mat(c, { roughness: 0.88, map })
export const cloth = (c, map) => mat(c, { roughness: 0.96, map })
export const ceramic = (c, map) => mat(c, { roughness: 0.16, map, env: 1.2 })
export const rubber = (c, map) => mat(c, { roughness: 0.62, map })
export const metal = (c = '#b9c0c8', r = 0.3, map) => mat(c, { roughness: r, metalness: 0.9, map })
export const chrome = (map) => mat('#eef2f6', { roughness: 0.08, metalness: 1, map, env: 1.3 })
// With a map the map carries the gold colour (white base), so engravings stay golden.
export const gold = (r = 0.2, map) => mat(map ? '#ffffff' : '#f5c242', { roughness: r, metalness: 1, map, emissive: '#5a3800', ei: 0.4, env: 1.4 })
export const brass = (map) => mat('#d6a84a', { roughness: 0.3, metalness: 0.95, map, emissive: '#2a1800', ei: 0.3 })
export const copper = () => mat('#d27c4c', { roughness: 0.3, metalness: 0.95, emissive: '#2a0e00', ei: 0.3 })
export const iron = (c = '#2c2c31') => mat(c, { roughness: 0.55, metalness: 0.65 })
// Hollow glass shells do not cast shadows (they would black out what is inside).
export const glass = (c = '#dff3ff', opacity = 0.42, o = {}) =>
  mat(c, { roughness: 0.04, metalness: 0.05, opacity, env: 1.6, noShadow: true, order: 3, ...o })
export const glow = (c, ei = 1.4, o = {}) => mat(c, { emissive: c, ei, roughness: 0.4, ...o })
export const gem = (c, ei = 0.35) => mat(c, { roughness: 0.04, metalness: 0.35, emissive: c, ei, flat: true, env: 2 })
export const pearl = () => mat('#fbf3ea', { roughness: 0.18, metalness: 0.12, emissive: '#3a2f2a', ei: 0.15, env: 1.4 })

// --- Geometry cache ---------------------------------------------------------------------
const geos = new Map()
export function cached(key, make) {
  let g = geos.get(key)
  if (!g) geos.set(key, (g = make()))
  return g
}
// --- Detail level ------------------------------------------------------------------------
// withDetail(0.5, build) builds a model with about half the curve segments (the low-detail LOD
// used for distant loot); 1 = full detail. Every curved primitive below scales its segment
// counts by it (never below a floor that keeps the silhouette round).
let detail = 1
export function withDetail(d, fn) {
  const prev = detail
  detail = d
  try {
    return fn()
  } finally {
    detail = prev
  }
}
export const isLowDetail = () => detail < 1
const lo = (n, min) => (detail === 1 ? n : Math.max(Math.min(n, min), Math.round(n * detail)))

const k = (...a) => a.map((v) => (typeof v === 'number' ? +v.toFixed(4) : Array.isArray(v) ? JSON.stringify(v) : String(v))).join(',')

export const G = {
  box: (w, h, d) => cached('box' + k(w, h, d), () => new THREE.BoxGeometry(w, h, d)),
  rbox: (w, h, d, r = 0.06, s = 2, _s = (s = lo(s, 1))) => cached('rbox' + k(w, h, d, r, s), () => new RoundedBoxGeometry(w, h, d, s, Math.max(0.001, r))),
  // Cylinders start at theta = PI so the middle of a texture (u = 0.5) faces +Z.
  cyl: (rt, rb, h, seg = 20, open = false, hs = 1, _s = (seg = lo(seg, 8))) => cached('cyl' + k(rt, rb, h, seg, open, hs), () => new THREE.CylinderGeometry(rt, rb, h, seg, hs, open, PI)),
  arcCyl: (r, h, ts, tl, seg = 16, _s = (seg = lo(seg, 4))) => cached('acyl' + k(r, h, ts, tl, seg), () => new THREE.CylinderGeometry(r, r, h, seg, 1, true, ts, tl)),
  sph: (r, ws = 20, hs = 14, ps = 0, pl = TAU, ts = 0, tl = PI, _s = ((ws = lo(ws, 8)), (hs = lo(hs, 6)))) => cached('sph' + k(r, ws, hs, ps, pl, ts, tl), () => new THREE.SphereGeometry(r, ws, hs, ps, pl, ts, tl)),
  tor: (R, r, rs = 8, ts = 24, arc = TAU, _s = ((rs = lo(rs, 4)), (ts = lo(ts, 8)))) => cached('tor' + k(R, r, rs, ts, arc), () => new THREE.TorusGeometry(R, r, rs, ts, arc)),
  cap: (r, len, cs = 3, rs = 12, _s = ((cs = lo(cs, 1)), (rs = lo(rs, 8)))) => cached('cap' + k(r, len, cs, rs), () => new THREE.CapsuleGeometry(r, len, cs, rs)),
  cone: (r, h, seg = 16, open = false, _s = (seg = lo(seg, 8))) => cached('cone' + k(r, h, seg, open), () => new THREE.ConeGeometry(r, h, seg, 1, open, PI)),
  circle: (r, seg = 24, _s = (seg = lo(seg, 8))) => cached('circ' + k(r, seg), () => new THREE.CircleGeometry(r, seg)),
  ring: (ri, ro, seg = 24, _s = (seg = lo(seg, 8))) => cached('ring' + k(ri, ro, seg), () => new THREE.RingGeometry(ri, ro, seg)),
  plane: (w, h, ws = 1, hs = 1) => cached('plane' + k(w, h, ws, hs), () => new THREE.PlaneGeometry(w, h, ws, hs)),
  oct: (r) => cached('oct' + k(r), () => new THREE.OctahedronGeometry(r, 0)),
  ico: (r, d = 0) => cached('ico' + k(r, d), () => new THREE.IcosahedronGeometry(r, d)),
  dode: (r) => cached('dode' + k(r), () => new THREE.DodecahedronGeometry(r, 0)),
  // Lathe from [[x, y(, bevelRadius)], ...] (bottom to top on the outside). Corners get
  // rounded by `bevel` (per point override as the 3rd value) so shapes read soft.
  // uv: '' = three's default (v by point index), 'y' = v is the normalised height,
  // 'r' = v is the normalised radius (for plates / dishes). u = 0.5 always faces +Z.
  lathe: (pts, seg = 24, bevel = 0.02, steps = 1, uv = '', _s = (seg = lo(seg, 8))) =>
    cached('lathe' + k(pts, seg, bevel, steps, uv), () => {
      const p = bevel > 0 ? roundPolyline(pts, bevel, steps) : pts
      const g = new THREE.LatheGeometry(p.map(([x, y]) => new V2(Math.max(0, x), y)), seg, PI)
      if (uv) remapLatheV(g, uv)
      return g
    }),
}

export function remapLatheV(g, mode) {
  const pos = g.attributes.position
  const uv = g.attributes.uv
  let lo = Infinity
  let hi = -Infinity
  const val = (i) => (mode === 'y' ? pos.getY(i) : Math.hypot(pos.getX(i), pos.getZ(i)))
  for (let i = 0; i < pos.count; i++) {
    const v = val(i)
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  for (let i = 0; i < pos.count; i++) uv.setY(i, (val(i) - lo) / (hi - lo || 1))
}

// Rounds every interior corner of a 2D polyline (quadratic bezier between the points
// `r` back along each edge). [x, y, r] overrides the radius for that corner (0 = sharp).
export function roundPolyline(pts, r = 0.02, steps = 2) {
  const out = [pts[0].slice(0, 2)]
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py, pr] = pts[i]
    const rad = pr ?? r
    if (rad <= 0) {
      out.push([px, py])
      continue
    }
    const [ax, ay] = pts[i - 1]
    const [bx, by] = pts[i + 1]
    const la = Math.hypot(ax - px, ay - py)
    const lb = Math.hypot(bx - px, by - py)
    if (la < 1e-6 || lb < 1e-6) {
      out.push([px, py])
      continue
    }
    const d1 = Math.min(rad, la * 0.45)
    const d2 = Math.min(rad, lb * 0.45)
    const p1 = [px + ((ax - px) / la) * d1, py + ((ay - py) / la) * d1]
    const p2 = [px + ((bx - px) / lb) * d2, py + ((by - py) / lb) * d2]
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const u = 1 - t
      out.push([u * u * p1[0] + 2 * u * t * px + t * t * p2[0], u * u * p1[1] + 2 * u * t * py + t * t * p2[1]])
    }
  }
  out.push(pts[pts.length - 1].slice(0, 2))
  return out
}

// --- Geometry builders --------------------------------------------------------------------
// Tube along a smooth curve through `pts`; `taper(t)` scales the radius along it.
export function tube(pts, radius, { seg = 24, radial = 8, closed = false, taper = null, tension = 0.5 } = {}) {
  seg = lo(seg, 6)
  radial = lo(radial, 4)
  return cached('tube' + k(pts, radius, seg, radial, closed, taper ? taper.toString() : '', tension), () => {
    const curve = new THREE.CatmullRomCurve3(pts.map((p) => new V3(p[0], p[1], p[2])), closed, 'catmullrom', tension)
    const g = new THREE.TubeGeometry(curve, seg, radius, radial, closed)
    if (taper) {
      const pos = g.attributes.position
      const P = new V3()
      const v = new V3()
      for (let i = 0; i <= seg; i++) {
        curve.getPointAt(i / seg, P)
        const s = taper(i / seg)
        for (let j = 0; j <= radial; j++) {
          const idx = i * (radial + 1) + j
          v.fromBufferAttribute(pos, idx).sub(P).multiplyScalar(s).add(P)
          pos.setXYZ(idx, v.x, v.y, v.z)
        }
      }
      if (!closed) capTubeEnds(g, curve, seg, radial)
      g.computeVertexNormals()
    } else if (!closed) capTubeEnds(g, curve, seg, radial)
    return g
  })
}
// Closes both ends of a TubeGeometry with fans (keeps it indexed).
function capTubeEnds(g, curve, seg, radial) {
  const pos = Array.from(g.attributes.position.array)
  const nor = Array.from(g.attributes.normal.array)
  const uv = Array.from(g.attributes.uv.array)
  const idx = Array.from(g.index.array)
  for (const end of [0, 1]) {
    const ring = end ? seg : 0
    const P = curve.getPointAt(end)
    const T = curve.getTangentAt(end).multiplyScalar(end ? 1 : -1)
    const c = pos.length / 3
    pos.push(P.x, P.y, P.z)
    nor.push(T.x, T.y, T.z)
    uv.push(0.5, 0.5)
    const start = c + 1
    for (let j = 0; j <= radial; j++) {
      const s = (ring * (radial + 1) + j) * 3
      pos.push(pos[s], pos[s + 1], pos[s + 2])
      nor.push(T.x, T.y, T.z)
      uv.push(0.5, 0.5)
    }
    for (let j = 0; j < radial; j++) {
      if (end) idx.push(c, start + j, start + j + 1)
      else idx.push(c, start + j + 1, start + j)
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.setIndex(idx)
}

// Extruded 2D shape (XY), centred on z, UVs remapped to the shape's bounds (0..1),
// so a canvas texture covers the face exactly once.
export function extrude(key, makeShape, depth, { bevel = 0.02, bevelSeg = 2, curveSeg = 10 } = {}) {
  bevelSeg = lo(bevelSeg, 1)
  curveSeg = lo(curveSeg, 3)
  return cached('ext' + key + k(depth, bevel, bevelSeg, curveSeg), () => {
    const g = new THREE.ExtrudeGeometry(makeShape(), {
      depth,
      bevelEnabled: bevel > 0,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: bevelSeg,
      curveSegments: curveSeg,
    })
    g.translate(0, 0, -depth / 2)
    planarUV(g)
    return g
  })
}
export function shapeGeo(key, makeShape, curveSeg = 12) {
  curveSeg = lo(curveSeg, 3)
  return cached('shp' + key + curveSeg, () => {
    const g = new THREE.ShapeGeometry(makeShape(), curveSeg)
    planarUV(g)
    return g
  })
}
// uv = position projected on the XY plane, normalised to the geometry's bounds.
export function planarUV(g) {
  g.computeBoundingBox()
  const b = g.boundingBox
  const w = b.max.x - b.min.x || 1
  const h = b.max.y - b.min.y || 1
  const pos = g.attributes.position
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - b.min.x) / w
    uv[i * 2 + 1] = (pos.getY(i) - b.min.y) / h
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return g
}

// Rounded rectangle Shape centred on the origin.
export function roundRectShape(w, h, r) {
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  r = Math.min(r, w / 2, h / 2)
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  return s
}
export function roundRectPath(w, h, r, cx = 0, cy = 0) {
  const s = new THREE.Path()
  const x = cx - w / 2
  const y = cy - h / 2
  r = Math.min(r, w / 2, h / 2)
  s.moveTo(x + r, y)
  s.quadraticCurveTo(x, y, x, y + r)
  s.lineTo(x, y + h - r)
  s.quadraticCurveTo(x, y + h, x + r, y + h)
  s.lineTo(x + w - r, y + h)
  s.quadraticCurveTo(x + w, y + h, x + w, y + h - r)
  s.lineTo(x + w, y + r)
  s.quadraticCurveTo(x + w, y, x + w - r, y)
  s.lineTo(x + r, y)
  return s
}
export function polyShape(pts) {
  const s = new THREE.Shape()
  s.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1])
  s.closePath()
  return s
}

// Soft square cushion / pillow: top and bottom bulge from a shared seam at y = 0.
// tufts: [[x, z], ...] dimple centres (button tufting).
export function pillowGeo(w, h, d, { seg = 20, tufts = [], tuftDepth = 0.25, tuftSize = 0.18, corner = 3.2 } = {}) {
  seg = lo(seg, 6)
  return cached('pillow' + k(w, h, d, seg, tufts, tuftDepth, tuftSize, corner), () => {
    const parts = []
    for (const side of [1, -1]) {
      const g = new THREE.PlaneGeometry(1, 1, seg, seg)
      const pos = g.attributes.position
      for (let i = 0; i < pos.count; i++) {
        // Bias the grid toward the edges (where the bulge curves the most).
        const sx = pos.getX(i) * 2
        const sz = -pos.getY(i) * 2
        const ex = Math.sign(sx) * Math.pow(Math.abs(sx), 0.8)
        const ez = Math.sign(sz) * Math.pow(Math.abs(sz), 0.8)
        const x = (ex * w) / 2
        const z = (ez * d) / 2
        const fx = Math.max(0, 1 - Math.pow(Math.abs(ex), corner))
        const fz = Math.max(0, 1 - Math.pow(Math.abs(ez), corner))
        let y = (h / 2) * Math.pow(fx * fz, 0.42)
        for (const [tx, tz] of tufts) {
          const dd = ((x - tx) ** 2 + (z - tz) ** 2) / (tuftSize * tuftSize)
          y -= tuftDepth * (h / 2) * Math.exp(-dd)
        }
        // Edges pinch in a touch so the seam reads.
        pos.setXYZ(i, x * (0.97 + 0.03 * fz), side * y, z * (0.97 + 0.03 * fx))
      }
      if (side < 0) {
        const idx = g.index.array
        for (let t = 0; t < idx.length; t += 3) {
          const a = idx[t + 1]
          idx[t + 1] = idx[t + 2]
          idx[t + 2] = a
        }
      }
      g.computeVertexNormals()
      parts.push(g)
    }
    const m = mergeGeometries(parts)
    return m
  })
}

// Height of pillowGeo's top surface at (x, z) (same parameters).
export function pillowY(w, h, d, x, z, { tufts = [], tuftDepth = 0.25, tuftSize = 0.18, corner = 3.2 } = {}) {
  const fx = Math.max(0, 1 - Math.pow(Math.abs((2 * x) / w), corner))
  const fz = Math.max(0, 1 - Math.pow(Math.abs((2 * z) / d), corner))
  let y = (h / 2) * Math.pow(fx * fz, 0.42)
  for (const [tx, tz] of tufts) y -= tuftDepth * (h / 2) * Math.exp(-((x - tx) ** 2 + (z - tz) ** 2) / (tuftSize * tuftSize))
  return y
}

// Brilliant-cut gem: unit girdle radius, table on top. Flat-shaded, non-indexed.
export function gemGeo(n = 8, { table = 0.55, crown = 0.32, girdle = 0.06, pavilion = 0.75, culet = 0 } = {}) {
  return cached('gem' + k(n, table, crown, girdle, pavilion, culet), () => {
    const P = []
    const ring = (r, y, off) => Array.from({ length: n }, (_, i) => {
      const a = ((i + off) / n) * TAU
      return new V3(Math.sin(a) * r, y, Math.cos(a) * r)
    })
    const yTop = girdle / 2 + crown
    const tableR = ring(table, yTop, 0)
    const crownR = ring((1 + table) / 2 + 0.06, girdle / 2 + crown * 0.45, 0.5)
    const g1 = ring(1, girdle / 2, 0)
    const g1b = ring(1, girdle / 2, 0.5)
    const g2 = ring(1, -girdle / 2, 0)
    const g2b = ring(1, -girdle / 2, 0.5)
    const pavR = ring(0.45, -girdle / 2 - pavilion * 0.55, 0.5)
    const top = new V3(0, yTop, 0)
    const bot = new V3(0, -girdle / 2 - pavilion, 0)
    const tri = (a, b, c) => P.push(a, b, c)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      tri(top, tableR[i], tableR[j])
      // crown: table edge down to the girdle, alternating star / kite facets
      tri(tableR[i], crownR[i], tableR[j])
      tri(tableR[i], g1[i], crownR[i])
      tri(crownR[i], g1[i], g1b[i])
      tri(crownR[i], g1b[i], g1[j])
      tri(crownR[i], g1[j], tableR[j])
      // girdle band
      tri(g1[i], g2[i], g2b[i])
      tri(g1[i], g2b[i], g1b[i])
      tri(g1b[i], g2b[i], g2[j])
      tri(g1b[i], g2[j], g1[j])
      // pavilion
      tri(g2[i], pavR[i], g2b[i])
      tri(g2b[i], pavR[i], g2[j])
      tri(pavR[i], bot, pavR[j])
      tri(g2[j], pavR[i], pavR[j])
    }
    const pos = new Float32Array(P.length * 3)
    P.forEach((p, i) => p.toArray(pos, i * 3))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(P.length * 2), 2))
    fixWinding(g)
    g.computeVertexNormals()
    return g
  })
}
// Makes every triangle of a convex-ish closed mesh face away from its centre.
function fixWinding(g) {
  const p = g.attributes.position
  const a = new V3()
  const b = new V3()
  const c = new V3()
  const n = new V3()
  const m = new V3()
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i)
    b.fromBufferAttribute(p, i + 1)
    c.fromBufferAttribute(p, i + 2)
    n.subVectors(b, a).cross(m.subVectors(c, a))
    m.copy(a).add(b).add(c).divideScalar(3)
    if (n.dot(m) < 0) {
      p.setXYZ(i + 1, c.x, c.y, c.z)
      p.setXYZ(i + 2, b.x, b.y, b.z)
    }
  }
}

// Truncated pyramid (ingot): bottom bw x bd, top tw x td, height h. Flat shaded.
export function frustumGeo(bw, bd, tw, td, h) {
  return cached('frustum' + k(bw, bd, tw, td, h), () => {
    const g = new THREE.BoxGeometry(1, 1, 1)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) {
      const top = p.getY(i) > 0
      p.setXYZ(i, p.getX(i) * (top ? tw : bw), p.getY(i) * h, p.getZ(i) * (top ? td : bd))
    }
    g.computeVertexNormals()
    return g
  })
}

// Bends a geometry built along +X around the Y axis (x -> angle on a circle of radius R).
export function bendAroundY(g, R) {
  const p = g.attributes.position
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i)
    const z = p.getZ(i)
    const a = x / R
    const r = R + z
    p.setXYZ(i, Math.sin(a) * r, p.getY(i), Math.cos(a) * r)
  }
  g.computeVertexNormals()
  return g
}

// --- Scene graph helpers ------------------------------------------------------------------
// add(parent, geometry, material, [x,y,z], [rx,ry,rz], scale)
export function add(parent, geo, material, p, r, s) {
  const m = new THREE.Mesh(geo, material)
  if (p) m.position.set(p[0], p[1], p[2])
  if (r) m.rotation.set(r[0], r[1], r[2], r[3] || 'XYZ')
  if (s !== undefined) {
    if (typeof s === 'number') m.scale.setScalar(s)
    else m.scale.set(s[0], s[1], s[2])
  }
  m.castShadow = true
  m.receiveShadow = true
  parent.add(m)
  return m
}
export function grp(parent, p, r, s) {
  const g = new THREE.Group()
  if (p) g.position.set(p[0], p[1], p[2])
  if (r) g.rotation.set(r[0], r[1], r[2], r[3] || 'XYZ')
  if (s !== undefined) {
    if (typeof s === 'number') g.scale.setScalar(s)
    else g.scale.set(s[0], s[1], s[2])
  }
  if (parent) parent.add(g)
  return g
}
// Places `count` copies around a circle (radius r, height y), calling make(i, angle, x, z).
export function around(count, r, make, start = 0) {
  for (let i = 0; i < count; i++) {
    const a = start + (i / count) * TAU
    make(i, a, Math.sin(a) * r, Math.cos(a) * r)
  }
}

// --- Baking ----------------------------------------------------------------------------------
const _box = new THREE.Box3()
const _c = new V3()
const _s = new V3()
function prepGeo(geo, matrix) {
  let g = geo.clone()
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
  if (!g.attributes.normal) g.computeVertexNormals()
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
  g.morphAttributes = {}
  g.clearGroups()
  if (!g.index) {
    const n = g.attributes.position.count
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n)
    for (let i = 0; i < n; i++) idx[i] = i
    g.setIndex(new THREE.BufferAttribute(idx, 1))
  } else if (!(g.index.array instanceof Uint32Array)) {
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(g.index.array), 1))
  }
  g.applyMatrix4(matrix)
  if (matrix.determinant() < 0) {
    const idx = g.index.array
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t + 1]
      idx[t + 1] = idx[t + 2]
      idx[t + 2] = a
    }
  }
  return g
}

const _t = new THREE.Vector3()
const DECAL_THICKNESS = 0.035 // m (after the fit to size): a piece thinner than this is a decal
const decals = new WeakMap() // material -> its polygon-offset twin
function decalMaterial(m) {
  if (m.transparent && m.opacity < 0.5) return m // glass etc. sorts by itself
  let d = decals.get(m)
  if (!d) {
    d = m.clone()
    d.polygonOffset = true
    d.polygonOffsetFactor = -1
    d.polygonOffsetUnits = -4
    d.userData = { ...m.userData, decal: true }
    decals.set(m, d)
  }
  return d
}

// Bakes `root` into one mesh per material, centred on its bounding box and scaled per axis
// to exactly `size` [x, y, z] (models are built close to size, so the stretch is tiny).
// Returns a Group; every mesh casts + receives shadows (hollow glass: receive only).
// bottom: true puts the origin at the bottom centre instead of the box centre.
// minPiece: pieces whose largest side (after fitting) is below this are left out (the low-detail LOD
// drops buttons, labels and specks nobody can see from across the room).
export function finish(root, size, { name = '', userData = {}, bottom = false, minPiece = 0 } = {}) {
  root.updateMatrixWorld(true)
  _box.setFromObject(root, true)
  _box.getCenter(_c)
  _box.getSize(_s)
  const fit = new THREE.Matrix4().makeScale(size[0] / (_s.x || 1), size[1] / (_s.y || 1), size[2] / (_s.z || 1))
  fit.multiply(new THREE.Matrix4().makeTranslation(-_c.x, -_c.y, -_c.z))
  if (bottom) fit.premultiply(new THREE.Matrix4().makeTranslation(0, size[1] / 2, 0))
  const pieces = [] // { material, geo }
  root.traverse((o) => {
    if (!o.isMesh) return
    const geo = prepGeo(o.geometry, fit.clone().multiply(o.matrixWorld))
    // Thin pieces (labels, decals, inlays, stripes laid on a surface a hair above it) draw with a
    // polygon offset so they always win the depth test against the surface under them: Z-fighting fix
    // for every loot / gadget model at once (their gaps were 0.4-5 mm, below the depth precision).
    geo.computeBoundingBox()
    geo.boundingBox.getSize(_t)
    if (minPiece > 0 && Math.max(_t.x, _t.y, _t.z) < minPiece) {
      geo.dispose()
      return
    }
    const material = Math.min(_t.x, _t.y, _t.z) < DECAL_THICKNESS ? decalMaterial(o.material) : o.material
    pieces.push({ material, geo })
  })
  const out = new THREE.Group()
  out.name = name
  // One mesh per look: pieces that differ only by colour share a draw call (merge.js).
  const entries = batchByLook(pieces).sort((a, b) => (a.material.userData.order || 0) - (b.material.userData.order || 0))
  for (const { material, geos: list } of entries) {
    const geo = list.length === 1 ? list[0] : mergeGeometries(list, false)
    for (const g of list) if (g !== geo) g.dispose()
    if (!geo) continue
    geo.computeBoundingBox()
    geo.computeBoundingSphere()
    const mesh = new THREE.Mesh(geo, material)
    mesh.castShadow = !material.userData.noShadow
    mesh.receiveShadow = true
    mesh.renderOrder = material.userData.order || 0
    out.add(mesh)
  }
  out.userData = { size: size.slice(), ...userData }
  return out
}

export function triangleCount(obj) {
  let n = 0
  obj.traverse((o) => {
    if (o.isMesh) n += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3
  })
  return Math.round(n)
}

// --- Canvas textures ------------------------------------------------------------------------
export const FONT = '"Fredoka", "Arial Rounded MT Bold", "Trebuchet MS", Arial, sans-serif'
const texs = new Map()
const textTex = new Set()
// canvasTex(key, w, h, paint(ctx, w, h), { repeat: [u, v], wrap, srgb, text })
export function canvasTex(key, w, h, paintFn, o = {}) {
  let t = texs.get(key)
  if (t) return t
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')
  paintFn(ctx, w, h)
  t = new THREE.CanvasTexture(c)
  if (o.srgb !== false) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 4
  if (o.wrap || o.repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1])
  t.userData.paint = paintFn
  texs.set(key, t)
  if (o.text) {
    textTex.add(t)
    watchFont()
  }
  return t
}
// Text textures are repainted once the Fredoka web font has loaded.
let fontWatch = false
function watchFont() {
  if (fontWatch || typeof document === 'undefined' || !document.fonts?.load) return
  fontWatch = true
  document.fonts
    .load('700 40px Fredoka')
    .then((faces) => {
      if (!faces || !faces.length) return
      for (const t of textTex) {
        const c = t.image
        const ctx = c.getContext('2d')
        ctx.clearRect(0, 0, c.width, c.height)
        t.userData.paint(ctx, c.width, c.height)
        t.needsUpdate = true
      }
    })
    .catch(() => {})
}

// Painter helpers (all take a 2D context).
export function rr(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
export function txt(ctx, s, x, y, size, fill, { weight = 700, stroke = null, lw = 0, align = 'center', base = 'middle', font = FONT, maxW, italic = false } = {}) {
  ctx.save()
  ctx.font = `${italic ? 'italic ' : ''}${weight} ${size}px ${font}`
  ctx.textAlign = align
  ctx.textBaseline = base
  if (maxW) {
    const m = ctx.measureText(s).width
    if (m > maxW) {
      ctx.translate(x, y)
      ctx.scale(maxW / m, 1)
      x = 0
      y = 0
    }
  }
  if (stroke && lw) {
    ctx.lineJoin = 'round'
    ctx.strokeStyle = stroke
    ctx.lineWidth = lw
    ctx.strokeText(s, x, y)
  }
  ctx.fillStyle = fill
  ctx.fillText(s, x, y)
  ctx.restore()
}
export function speckle(ctx, w, h, n, colors, { min = 1, max = 3, alpha = 1, seed = 7 } = {}) {
  const r = rng(seed)
  ctx.save()
  ctx.globalAlpha = alpha
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[(r() * colors.length) | 0]
    ctx.beginPath()
    ctx.arc(r() * w, r() * h, min + r() * (max - min), 0, TAU)
    ctx.fill()
  }
  ctx.restore()
}
// Wood grain; `along` 'x' = grain runs horizontally in the canvas.
export function woodGrain(ctx, w, h, { base = '#9a5b2e', dark = '#6e3b1a', light = '#b9763f', seed = 3, along = 'x', lines = 26 } = {}) {
  const r = rng(seed)
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)
  const L = along === 'x' ? h : w
  const S = along === 'x' ? w : h
  for (let i = 0; i < lines; i++) {
    const o = r() * L
    const amp = 2 + r() * 6
    const f = 1 + r() * 3
    const ph = r() * TAU
    ctx.strokeStyle = r() < 0.6 ? dark : light
    ctx.globalAlpha = 0.18 + r() * 0.3
    ctx.lineWidth = 0.6 + r() * 2.2
    ctx.beginPath()
    for (let s = 0; s <= S; s += 4) {
      const off = o + Math.sin((s / S) * TAU * f + ph) * amp
      if (along === 'x') s === 0 ? ctx.moveTo(s, off) : ctx.lineTo(s, off)
      else s === 0 ? ctx.moveTo(off, s) : ctx.lineTo(off, s)
    }
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}
// Dashed stitch line along a rounded rect.
export function stitches(ctx, x, y, w, h, r, color = '#f3e2c0', lw = 2, dash = [6, 5]) {
  ctx.save()
  ctx.setLineDash(dash)
  ctx.strokeStyle = color
  ctx.lineWidth = lw
  rr(ctx, x, y, w, h, r)
  ctx.stroke()
  ctx.restore()
}
// Fabric weave noise over a base colour.
export function weave(ctx, w, h, base, { seed = 5, step = 3, alpha = 0.12 } = {}) {
  ctx.fillStyle = base
  ctx.fillRect(0, 0, w, h)
  const r = rng(seed)
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const v = r()
      ctx.fillStyle = v < 0.5 ? `rgba(0,0,0,${alpha * v})` : `rgba(255,255,255,${alpha * (v - 0.5)})`
      ctx.fillRect(x, y, step, step)
    }
  }
}
// Draws `fn(x)` at x, x - w and x + w so a lathe/cylinder texture wraps seamlessly.
export function wrapDraw(w, x, fn) {
  fn(x)
  fn(x - w)
  fn(x + w)
}
