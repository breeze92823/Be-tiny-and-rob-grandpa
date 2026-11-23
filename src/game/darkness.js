// Rooms with their lights switched off. Every lit material in the scene gets a tiny shader patch: a
// fragment inside a dark room's box (x/z inside the room's walls, below the ceiling) is dimmed to a
// cool moonlit blue, eased in and out per room. Near the local thief the dark lifts a little (eyes
// adjusting), so you can still find your way. Additive / overlay materials (FX, Grandpa's cone, x-ray,
// labels) are left alone so they stay readable.
import { AdditiveBlending, Vector4 } from 'three'
import { ROOMS } from '../config.js'

export const DARK = {
  tint: [0.055, 0.07, 0.13], // what a dark room multiplies colours by (before tone mapping, so it reads ~4x lighter)
  // box edges 0.3 PAST the wall centrelines: doors / frames inside the wall go dark with either room,
  // while each wall's faces (centreline +-0.6) still sit 0.3 clear of the neighbour's box
  inset: -0.3,
  ceiling: 16.3,
  ease: 2.5, // 1/s fade in / out
  nearLift: 0.3, // how much the dark lifts right next to the local thief
  nearRadius: [1.5, 6], // full lift inside, none outside (m)
  sight: 0.3, // Grandpa's sight of a thief standing in a dark room (multiplier)
  relightDelay: 6, // s before Grandpa goes to switch a room's lights back on
  relightRetry: 25, // s before he tries again (busy chasing, or called away on the way)
}
const MAX = 8
const uniforms = {
  uDarkBox: { value: Array.from({ length: MAX }, () => new Vector4()) },
  uDarkK: { value: new Array(MAX).fill(0) },
  uDarkSee: { value: new Vector4() },
}
const rooms = ROOMS.slice(0, MAX).map((r, i) => {
  uniforms.uDarkBox.value[i].set(r.x0 + DARK.inset, r.z0 + DARK.inset, r.x1 - DARK.inset, r.z1 - DARK.inset)
  return { id: r.id, i, x0: r.x0 + DARK.inset, z0: r.z0 + DARK.inset, x1: r.x1 - DARK.inset, z1: r.z1 - DARK.inset, dark: false, k: 0 }
})
const byId = new Map(rooms.map((r) => [r.id, r]))

const VERT_HEAD = 'varying vec3 vDarkW;'
const VERT_BODY = `{
  vec4 dw = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    dw = batchingMatrix * dw;
  #endif
  #ifdef USE_INSTANCING
    dw = instanceMatrix * dw;
  #endif
  vDarkW = ( modelMatrix * dw ).xyz;
}`
const FRAG_HEAD = `varying vec3 vDarkW;
uniform vec4 uDarkBox[${MAX}];
uniform float uDarkK[${MAX}];
uniform vec4 uDarkSee;
vec3 darkTint( vec3 p ) {
  float k = 0.0;
  for ( int i = 0; i < ${MAX}; i ++ ) {
    if ( uDarkK[ i ] <= 0.0 ) continue;
    vec4 b = uDarkBox[ i ];
    float inside = step( b.x, p.x ) * step( p.x, b.z ) * step( b.y, p.z ) * step( p.z, b.w ) * step( p.y, ${DARK.ceiling.toFixed(2)} );
    k = max( k, inside * uDarkK[ i ] );
  }
  if ( k <= 0.0 ) return vec3( 1.0 );
  float lift = uDarkSee.w * ( 1.0 - smoothstep( ${DARK.nearRadius[0].toFixed(1)}, ${DARK.nearRadius[1].toFixed(1)}, distance( p, uDarkSee.xyz ) ) ) * ${DARK.nearLift.toFixed(2)};
  vec3 dim = mix( vec3( ${DARK.tint.map((v) => v.toFixed(3)).join(', ')} ), vec3( 1.0 ), lift );
  return mix( vec3( 1.0 ), dim, k );
}`

const patched = new WeakSet()
function patchMaterial(mat) {
  if (patched.has(mat)) return
  patched.add(mat)
  const lit = mat.isMeshStandardMaterial || mat.isMeshBasicMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial || mat.isMeshToonMaterial
  if (!lit || mat.blending === AdditiveBlending || mat.depthTest === false) return
  const prev = mat.onBeforeCompile
  mat.onBeforeCompile = function (shader, renderer) {
    prev?.call(this, shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.rgb *= darkTint( vDarkW );')
  }
  const prevKey = mat.customProgramCacheKey
  mat.customProgramCacheKey = function () {
    return `${prevKey.call(this)}|dark`
  }
  mat.needsUpdate = true
}

// Patches every material under `root` not seen yet (call once after building, then now and then for
// late arrivals: loot, avatars, gadgets).
export function patchDarkness(root) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) if (m) patchMaterial(m)
  })
}

export function setRoomDark(id, dark) {
  const r = byId.get(id)
  if (r) r.dark = !!dark
}
export const isRoomDark = (id) => !!byId.get(id)?.dark
export const darkMask = () => rooms.reduce((m, r) => (r.dark ? m | (1 << r.i) : m), 0)
export function applyDarkMask(mask) {
  for (const r of rooms) r.dark = !!(mask & (1 << r.i))
}
export function clearDarkness() {
  for (const r of rooms) {
    r.dark = false
    r.k = 0
    uniforms.uDarkK.value[r.i] = 0
  }
}
// 0..1: how dark it is at a point (any room).
export function darknessAt(p) {
  let k = 0
  for (const r of rooms) if (r.k > 0 && p.x >= r.x0 && p.x <= r.x1 && p.z >= r.z0 && p.z <= r.z1 && p.y <= DARK.ceiling) k = Math.max(k, r.k)
  return k
}
// Per frame: ease each room toward its state; `see` = the local thief's chest (or null).
export function updateDarkness(dt, see) {
  for (const r of rooms) {
    const target = r.dark ? 1 : 0
    r.k = r.k < target ? Math.min(target, r.k + dt * DARK.ease) : Math.max(target, r.k - dt * DARK.ease)
    uniforms.uDarkK.value[r.i] = r.k
  }
  if (see) uniforms.uDarkSee.value.set(see.x, see.y, see.z, 1)
  else uniforms.uDarkSee.value.w = 0
}
