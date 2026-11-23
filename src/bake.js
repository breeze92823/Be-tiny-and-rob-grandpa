import { BufferAttribute, Group, Matrix4, Mesh } from 'three'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { batchByLook } from './merge.js'

// --- Baking: one mesh per look ------------------------------------------------------
// Props are built from many small meshes (a palm is ~20); merging the ones
// that share a look keeps a set piece to a handful of draw calls (mobile).
// Pieces whose materials differ only by colour share one draw call too (merge.js:
// the colour moves into the vertices, the pixels stay identical).
const rel = new Matrix4()

// Merges { material, geo } pieces (geometry already in the target space) into meshes.
function mergePieces(pieces) {
  const out = []
  for (const { material, geos } of batchByLook(pieces)) {
    const names = Object.keys(geos[0].attributes).filter((n) => geos.every((g) => g.attributes[n]))
    for (const g of geos) {
      for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n)
      g.morphAttributes = {}
      g.clearGroups()
    }
    const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos)
    for (const g of geos) if (g !== merged) g.dispose()
    if (merged) out.push(new Mesh(merged, material))
  }
  return out
}
// Indexed geometry lets the GPU reuse a shared corner's vertex shader result (a box: 24 vertices for
// 36 corners). Unindexed sources get their exact duplicate corners welded first (mergeVertices only
// joins vertices whose position, normal and uv all match, so nothing moves or reshades).
function indexed(src) {
  let g = src.clone()
  if (!g.index) {
    for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(n)) g.deleteAttribute(n)
    g = mergeVertices(g)
  }
  if (!(g.index.array instanceof Uint32Array)) g.setIndex(new BufferAttribute(new Uint32Array(g.index.array), 1))
  return g
}
const piece = (o, matrix) => {
  const geo = indexed(o.geometry).applyMatrix4(matrix)
  // a mirrored placement flips the winding: swap two corners per triangle so faces still face out
  if (matrix.determinant() < 0) {
    const idx = geo.index.array
    for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]]
  }
  return { material: o.material, geo }
}
const freeze = (o) => {
  o.updateMatrix()
  o.matrixAutoUpdate = false
}

export function bake(root, castShadow = false) {
  return bakeBy(root, () => 0, castShadow).get(0) ?? new Group()
}

// bake() split into groups: keyOf(mesh) (world matrices are up to date) picks each mesh's group, e.g.
// the room it stands in, so whole groups can be hidden at once. Returns Map key -> Group.
export function bakeBy(root, keyOf, castShadow = false) {
  root.updateMatrixWorld(true)
  const inv = root.matrixWorld.clone().invert()
  const buckets = new Map() // key -> { pieces, out }
  root.traverse((o) => {
    if (!o.isMesh) return
    const key = keyOf(o)
    let b = buckets.get(key)
    if (!b) buckets.set(key, (b = { pieces: [], out: new Group() }))
    rel.multiplyMatrices(inv, o.matrixWorld)
    if (Array.isArray(o.material)) {
      b.out.add(new Mesh(o.geometry.clone().applyMatrix4(rel), o.material)) // multi-material: kept as is
      return
    }
    b.pieces.push(piece(o, rel))
  })
  const result = new Map()
  for (const [key, { pieces, out }] of buckets) {
    for (const m of mergePieces(pieces)) out.add(m)
    out.traverse((o) => {
      if (!o.isMesh) return
      o.castShadow = castShadow
      freeze(o) // baked scenery never moves: skip the per-frame matrix recompute
    })
    result.set(key, out)
  }
  return result
}

// Merges a group's OWN leaf meshes in place (one mesh per look), for rigid assemblies that move as a
// whole (doors, sashes, the secret shelf, the phone body). Child groups are left alone (they may move
// on their own: the phone's dial, its handset) and so are meshes with children, multi-material,
// instanced, skinned or hidden ones. Each piece keeps its shadow flags and render order.
// Only call it on groups whose individual meshes nothing refers to afterwards.
export function compact(group) {
  group.updateMatrixWorld(true)
  const inv = group.matrixWorld.clone().invert()
  const buckets = new Map() // "cast|receive|order" -> pieces
  for (const o of [...group.children]) {
    if (!o.isMesh || o.children.length || Array.isArray(o.material) || o.isInstancedMesh || o.isSkinnedMesh || !o.visible) continue
    rel.multiplyMatrices(inv, o.matrixWorld)
    const key = `${o.castShadow ? 1 : 0}|${o.receiveShadow ? 1 : 0}|${o.renderOrder}`
    let list = buckets.get(key)
    if (!list) buckets.set(key, (list = []))
    list.push(piece(o, rel))
    group.remove(o)
  }
  for (const [key, pieces] of buckets) {
    const [cast, receive, order] = key.split('|')
    for (const m of mergePieces(pieces)) {
      m.castShadow = cast === '1'
      m.receiveShadow = receive === '1'
      m.renderOrder = +order
      freeze(m)
      group.add(m)
    }
  }
  return group
}
