import { BufferAttribute } from 'three'

// --- Colour-merging for baked meshes ------------------------------------------------------------
// Baking (bake.js, modelKit.finish) merges meshes that share a material into one draw call. Most
// materials only differ by their base colour, so grouping by material alone still leaves one draw
// call per colour (the house had ~200, a loot model ~10). Here materials that are the same LOOK
// apart from colour share one copy whose colour is white with `vertexColors` on, and each piece
// carries its old colour as a vertex colour. The shader multiplies the two, so every pixel comes
// out exactly as before, in a fraction of the draw calls (and the shadow pass shrinks with it).
//
// Only materials nothing changes at runtime take part: emissive (lamp bulbs, the toaster coil),
// transparent (fades), neon (userData.k, recoloured by setNeonBloom), already vertex-coloured, or
// shader-patched ones keep their own material, exactly as before.

const ids = new WeakMap()
let nextId = 1
const idOf = (o) => {
  let i = ids.get(o)
  if (!i) ids.set(o, (i = nextId++))
  return i
}
const SKIP = new Set(['uuid', 'id', 'name', 'version', 'color', 'userData', '_listeners'])
const isPlain = (v) => Object.getPrototypeOf(v) === Object.prototype || Array.isArray(v)

// Everything about a material except its base colour (and identity).
export function lookKey(m) {
  const parts = [m.type]
  for (const k of Object.keys(m)) {
    if (SKIP.has(k)) continue
    const v = m[k]
    let s
    if (v === null || v === undefined) s = ''
    else if (typeof v === 'object') {
      if (v.isTexture) s = '#' + idOf(v)
      else if (typeof v.toArray === 'function') s = v.toArray().join(',')
      else if (isPlain(v)) s = JSON.stringify(v)
      else s = '#' + idOf(v)
    } else if (typeof v === 'function') s = '#' + idOf(v)
    else s = String(v)
    parts.push(k + '=' + s)
  }
  parts.push('ud=' + JSON.stringify(m.userData))
  return parts.join('|')
}

const own = (m, k) => Object.prototype.hasOwnProperty.call(m, k)
// Can this material's colour move into the vertices without changing anything?
export function canTint(m) {
  if (!m || !m.color || !m.isMaterial || m.isShaderMaterial) return false
  if (m.vertexColors || m.transparent || m.userData?.k !== undefined) return false
  if (m.emissive && (m.emissive.r || m.emissive.g || m.emissive.b)) return false
  if (own(m, 'onBeforeCompile') || own(m, 'customProgramCacheKey')) return false
  return true
}

// One shared white, vertex-coloured copy per look.
const tinted = new Map()
export function tintedMaterial(m) {
  const key = lookKey(m)
  let t = tinted.get(key)
  if (!t) {
    t = m.clone()
    t.color.setRGB(1, 1, 1)
    t.vertexColors = true
    tinted.set(key, t)
  }
  return t
}

// Adds a constant `color` attribute (linear rgb, as the material held it) to a geometry.
export function paintVertices(geo, color) {
  const n = geo.attributes.position.count
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n * 3; i += 3) {
    a[i] = color.r
    a[i + 1] = color.g
    a[i + 2] = color.b
  }
  geo.setAttribute('color', new BufferAttribute(a, 3))
  return geo
}

// Groups { material, geo } pieces into draw batches: [{ material, geos }]. Pieces whose materials
// differ only by colour land in one batch (vertex-coloured); all others batch per material.
export function batchByLook(pieces) {
  const batches = new Map() // key -> { material, tint, geos: [{ geo, color }] }
  const keys = new Map() // material -> batch key (a material repeats across many pieces)
  for (const { material, geo } of pieces) {
    const tint = canTint(material)
    let key = keys.get(material)
    if (key === undefined) keys.set(material, (key = tint ? 'look:' + lookKey(material) : material))
    let b = batches.get(key)
    if (!b) batches.set(key, (b = { material, tint, geos: [], colors: new Set() }))
    b.geos.push({ geo, color: material.color })
    if (tint) b.colors.add(material.color.r + ',' + material.color.g + ',' + material.color.b)
  }
  const out = []
  for (const b of batches.values()) {
    // One colour only: keep the original material (nothing to gain).
    if (!b.tint || b.colors.size < 2) {
      // several materials can share a look but be separate objects with one colour: any of them is fine
      out.push({ material: b.material, geos: b.geos.map((g) => g.geo) })
      continue
    }
    out.push({ material: tintedMaterial(b.material), geos: b.geos.map(({ geo, color }) => paintVertices(geo, color)) })
  }
  return out
}
