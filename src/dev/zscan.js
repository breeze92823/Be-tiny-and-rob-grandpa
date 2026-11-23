// Dev tool: finds Z-fighting in the live scene. Not loaded by the game; run it from the browser console:
//   const z = await import('/src/dev/zscan.js'); z.scan(__game.scene)
// It collects every visible opaque triangle in world space, finds pairs that face the same way, lie
// within `gap` metres of the same plane and overlap in area, then drops the pairs nobody can see: a
// point just in front of them is inside a solid, or pressed flat against another face. What is left is
// grouped into clusters (one per ~1 m cell and plane) with a position, the plane normal and colours.
import { AdditiveBlending, Vector3 } from 'three'

export function scan(scene, { gap = 0.006, region = null } = {}) {
  const tris = collect(scene, region)
  const grid = buildGrid(tris)
  const clusters = findOverlaps(tris, gap)
  const visible = clusters.filter((h) => isVisible(grid, h))
  return { triangles: tris.length, overlaps: clusters.length, visible: visible.length, list: visible.map((h) => `${h.at.join(',')} n(${h.n.join(',')}) gap ${h.gap} ${h.colors} area ${h.area}`) }
}

// Every triangle on the plane through `p` with normal `n` (within `gap`) whose bounds contain p's
// in-plane position: { mesh (uuid), color, tri bounds } — to tell which pieces fight at a spot.
export function facesAt(scene, p, n, gap = 0.006) {
  const P = new Vector3(p.x, p.y, p.z)
  const N = new Vector3(n.x, n.y, n.z).normalize()
  return collect(scene, { x0: p.x - 30, x1: p.x + 30, z0: p.z - 30, z1: p.z + 30 })
    .filter((t) => t.n.dot(N) > 0.999 && Math.abs(t.d - N.dot(P)) < gap)
    .filter((t) => {
      const lo = new Vector3().copy(t.a).min(t.b).min(t.c).subScalar(0.01)
      const hi = new Vector3().copy(t.a).max(t.b).max(t.c).addScalar(0.01)
      return P.x >= lo.x && P.x <= hi.x && P.y >= lo.y && P.y <= hi.y && P.z >= lo.z && P.z <= hi.z
    })
    .map((t) => ({ mesh: t.uuid, color: t.color, lo: [t.a, t.b, t.c].reduce((m, v) => m.min(v), t.a.clone()).toArray().map((v) => +v.toFixed(2)), hi: [t.a, t.b, t.c].reduce((m, v) => m.max(v), t.a.clone()).toArray().map((v) => +v.toFixed(2)) }))
}

function collect(scene, region) {
  const tris = []
  let meshId = 0
  const a = new Vector3()
  const b = new Vector3()
  const c = new Vector3()
  scene.updateMatrixWorld(true)
  scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return
    for (let p = o; p; p = p.parent) if (!p.visible) return
    const m = Array.isArray(o.material) ? o.material[0] : o.material
    if (!m || m.blending === AdditiveBlending || m.depthTest === false || (m.transparent && m.opacity < 0.3)) return
    const pos = o.geometry.attributes.position
    if (!pos) return
    const idx = o.geometry.index
    const n = idx ? idx.count : pos.count
    const id = meshId++
    for (let i = 0; i < n; i += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld)
      b.fromBufferAttribute(pos, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(o.matrixWorld)
      c.fromBufferAttribute(pos, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(o.matrixWorld)
      if (region && !inRegion(a, region)) continue
      const nn = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a))
      const area = nn.length() / 2
      if (area < 0.01) continue
      nn.normalize()
      tris.push({ a: a.clone(), b: b.clone(), c: c.clone(), n: nn, d: nn.dot(a), area, mesh: id, uuid: o.uuid.slice(0, 8), po: !!m.polygonOffset, color: m.color ? `#${m.color.getHexString()}` : '' })
    }
  })
  return tris
}
const inRegion = (p, r) => p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1

// --- coplanar overlapping pairs -------------------------------------------------------------------------
function basis(n) {
  const u = Math.abs(n.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)
  const e1 = new Vector3().crossVectors(u, n).normalize()
  return [e1, new Vector3().crossVectors(n, e1)]
}
const proj = (p, B) => [p.dot(B[0]), p.dot(B[1])]
const edge = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
// strictly inside (a margin from every edge), so triangles that only share an edge don't count
function inside(pt, [a, b, c]) {
  const d1 = edge(pt, a, b)
  const d2 = edge(pt, b, c)
  const d3 = edge(pt, c, a)
  if ((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0)) return false
  return Math.min(Math.abs(d1), Math.abs(d2), Math.abs(d3)) > 0.01 * Math.sqrt(Math.abs(edge(a, b, c)))
}
function samples(t) {
  const c = [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3]
  return [c, ...t.map((v) => [v[0] * 0.6 + c[0] * 0.4, v[1] * 0.6 + c[1] * 0.4])]
}
const sharedVerts = (A, B) => [A.a, A.b, A.c].filter((v) => [B.a, B.b, B.c].some((w) => v.distanceToSquared(w) < 1e-6)).length
function findOverlaps(tris, gap) {
  const q = (v, s) => Math.round(v / s)
  const buckets = new Map()
  for (const t of tris) {
    t.nk = `${q(t.n.x, 0.05)},${q(t.n.y, 0.05)},${q(t.n.z, 0.05)}`
    const k = `${t.nk}|${q(t.d, 0.01)}`
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k).push(t)
  }
  const hits = new Map()
  for (const [k, list] of buckets) {
    const [nk, dk] = k.split('|')
    const lists = [list, buckets.get(`${nk}|${+dk + 1}`) ?? []]
    for (let li = 0; li < 2; li++) {
      const other = lists[li]
      for (let i = 0; i < list.length; i++) {
        const A = list[i]
        for (let j = li ? 0 : i + 1; j < other.length; j++) {
          const B = other[j]
          if (Math.abs(A.d - B.d) > gap || A.n.dot(B.n) < 0.999) continue
          if (sharedVerts(A, B) >= 2) continue // the two halves of one quad
          if (A.po !== B.po) continue // a polygon-offset decal over its surface: resolved
          const P = basis(A.n)
          const a2 = [proj(A.a, P), proj(A.b, P), proj(A.c, P)]
          const b2 = [proj(B.a, P), proj(B.b, P), proj(B.c, P)]
          if (!samples(a2).some((p) => inside(p, b2)) && !samples(b2).some((p) => inside(p, a2))) continue
          const c = new Vector3().add(A.a).add(A.b).add(A.c).multiplyScalar(1 / 3)
          const key = `${Math.round(c.x)},${Math.round(c.y)},${Math.round(c.z)}|${nk}`
          const h = hits.get(key) ?? { at: [+c.x.toFixed(1), +c.y.toFixed(1), +c.z.toFixed(1)], n: [Math.round(A.n.x), Math.round(A.n.y), Math.round(A.n.z)], nv: A.n, gap: Math.abs(A.d - B.d).toFixed(4), colors: new Set(), area: 0 }
          h.colors.add(A.color)
          h.colors.add(B.color)
          h.area += Math.min(A.area, B.area)
          hits.set(key, h)
        }
      }
    }
  }
  return [...hits.values()].map((h) => ({ ...h, colors: [...h.colors].join(' '), area: +h.area.toFixed(2) })).sort((x, y) => y.area - x.area)
}

// --- visibility -------------------------------------------------------------------------------------------
const CELL = 2
function buildGrid(tris) {
  const grid = new Map()
  for (const t of tris) {
    const lo = [Math.min(t.a.x, t.b.x, t.c.x), Math.min(t.a.y, t.b.y, t.c.y), Math.min(t.a.z, t.b.z, t.c.z)].map((v) => Math.floor(v / CELL))
    const hi = [Math.max(t.a.x, t.b.x, t.c.x), Math.max(t.a.y, t.b.y, t.c.y), Math.max(t.a.z, t.b.z, t.c.z)].map((v) => Math.floor(v / CELL))
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const k = `${x},${y},${z}`
      if (!grid.has(k)) grid.set(k, [])
      grid.get(k).push(t)
    }
  }
  return grid
}
function hitsAlong(grid, o, d, len) {
  const seen = new Set()
  const out = []
  const steps = Math.ceil(len / (CELL / 2))
  for (let s = 0; s <= steps; s++) {
    const px = o.x + (d.x * len * s) / steps
    const py = o.y + (d.y * len * s) / steps
    const pz = o.z + (d.z * len * s) / steps
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = grid.get(`${Math.floor(px / CELL) + dx},${Math.floor(py / CELL) + dy},${Math.floor(pz / CELL) + dz}`)
      if (!list) continue
      for (const t of list) {
        if (seen.has(t)) continue
        seen.add(t)
        const tt = rayTri(o, d, t)
        if (tt > 1e-4 && tt <= len) out.push({ t: tt, tri: t })
      }
    }
  }
  return out.sort((x, y) => x.t - y.t)
}
function rayTri(o, d, t) {
  const e1 = new Vector3().subVectors(t.b, t.a)
  const e2 = new Vector3().subVectors(t.c, t.a)
  const h = new Vector3().crossVectors(d, e2)
  const det = e1.dot(h)
  if (Math.abs(det) < 1e-9) return -1
  const s = new Vector3().subVectors(o, t.a)
  const u = s.dot(h) / det
  if (u < -1e-6 || u > 1 + 1e-6) return -1
  const qv = new Vector3().crossVectors(s, e1)
  const v = d.dot(qv) / det
  if (v < -1e-6 || u + v > 1 + 1e-6) return -1
  return e2.dot(qv) / det
}
// hidden: inside a solid (the first face hit faces away) or pressed flat against something (< 3 cm)
function hiddenAt(grid, o, n) {
  const hs = hitsAlong(grid, o, n, 3)
  if (!hs.length) return false
  const t0 = hs[0].t
  if (t0 < 0.03) return true
  return hs.filter((h) => h.t < t0 + 0.005).some((h) => h.tri.n.dot(n) > 0.1)
}
function isVisible(grid, h) {
  const n = h.nv
  const [x, y, z] = h.at
  if (n.y < -0.9 && y < 0.1) return false // under the floor / the ground
  // the cluster centre and two offset points: at least two must look out into open air
  const pts = [[0, 0], [0.4, 0.4], [-0.4, -0.4]].map(([a, b]) => {
    const p = new Vector3(x, y, z)
    if (Math.abs(n.x) > 0.9) p.add(new Vector3(0, b, a))
    else if (Math.abs(n.y) > 0.9) p.add(new Vector3(a, 0, b))
    else p.add(new Vector3(a, b, 0))
    return p.addScaledVector(n, 0.02)
  })
  return pts.filter((p) => !hiddenAt(grid, p, n)).length >= 2
}
