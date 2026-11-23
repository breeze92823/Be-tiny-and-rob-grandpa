import { DoubleSide, Vector3 } from 'three'

// Render-cost trims that leave every pixel exactly as it was.

// --- Flat see-through pieces in one pass ------------------------------------------------------------
// three.js draws a transparent DoubleSide material in TWO passes (back faces, then front faces), and
// flips material.side + needsUpdate twice per object per frame to do it, which re-validates the shader
// program each time (CPU heavy with ~50 glass panes, rings and decals). For a mesh whose triangles all
// face the same way (a window pane, a ring, a sign) every triangle is front-facing or every triangle is
// back-facing, so one of those passes never draws a pixel: a single DoubleSide pass draws the same
// pixels in the same order. Closed shapes (glass boxes, bottles) keep the two passes.
const facing = new WeakMap() // geometry -> all triangles face one way?
const _a = new Vector3()
const _b = new Vector3()
const _c = new Vector3()
const _n = new Vector3()
const _ref = new Vector3()
function oneWay(geo) {
  let v = facing.get(geo)
  if (v !== undefined) return v
  v = false
  const pos = geo.attributes.position
  if (pos && !geo.morphAttributes.position) {
    const idx = geo.index
    const count = idx ? idx.count : pos.count
    const at = (i) => (idx ? idx.getX(i) : i)
    let have = false
    v = true
    for (let i = 0; i + 2 < count && v; i += 3) {
      _a.fromBufferAttribute(pos, at(i))
      _b.fromBufferAttribute(pos, at(i + 1))
      _c.fromBufferAttribute(pos, at(i + 2))
      _n.subVectors(_c, _b).cross(_a.sub(_b))
      const len = _n.length()
      if (len < 1e-12) continue // degenerate: never drawn
      _n.divideScalar(len)
      if (!have) {
        _ref.copy(_n)
        have = true
      } else if (_n.dot(_ref) < 0.9999) v = false
    }
  }
  facing.set(geo, v)
  return v
}

export function singlePassFlat(root) {
  const verdict = new Map() // material -> every mesh using it is one-way flat
  root.traverse((o) => {
    if (!o.isMesh) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) {
      if (!m || !m.transparent || m.side !== DoubleSide) continue
      // instances / groups can turn pieces different ways: keep two passes for those
      const ok = !o.isInstancedMesh && !o.isSkinnedMesh && !Array.isArray(o.material) && oneWay(o.geometry)
      verdict.set(m, (verdict.get(m) ?? true) && ok)
    }
  })
  for (const [m, ok] of verdict) m.forceSinglePass = ok
}

// --- Far lights off -----------------------------------------------------------------------------------
// A point light with a range lights nothing farther than `distance` from it, and anything farther than
// fog.far from the camera is pure fog colour. So once the camera is more than distance + fog.far away,
// the light changes no pixel, yet every lit fragment would still loop over it. Lights tagged
// userData.farCull (the hideout's candle + fill, the TV, the fireplace) switch off out there. The house
// and the hideout are 1.5 km apart and hold two each, so the light count (and the shader programs)
// stay the same in both places: no recompiles when you travel.
const MARGIN = 50
export function createFarLights(root) {
  const lights = []
  root.traverse((o) => {
    if (o.isLight && o.userData.farCull && o.distance > 0) lights.push(o)
  })
  const wp = new Vector3()
  const cam = new Vector3()
  return {
    update(camera, fogFar, enabled) {
      camera.getWorldPosition(cam)
      for (const l of lights) {
        l.getWorldPosition(wp)
        l.visible = enabled && wp.distanceTo(cam) <= l.distance + fogFar + MARGIN
      }
    },
  }
}
