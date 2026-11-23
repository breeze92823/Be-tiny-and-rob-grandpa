// HUD thumbnails: renders a loot / gadget model in a 3/4 view on a transparent
// background with ONE shared, lazily created offscreen WebGLRenderer. Results are
// cached per kind + id + size as PNG data URLs. Never throws: '' when WebGL fails.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { makeLoot } from './loot.js'
import { makeGadget } from './gadgets.js'

const cache = new Map()
let renderer = null
let scene = null
let camera = null
let failed = false
const VIEW = new THREE.Vector3(0.78, 0.62, 1).normalize() // camera direction: front-right, above
const SS = 2 // supersampling

function setup() {
  const canvas = document.createElement('canvas')
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'low-power' })
  renderer.setPixelRatio(1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.setClearColor(0x000000, 0)
  scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  pmrem.dispose()
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7a68, 0.9))
  const key = new THREE.DirectionalLight(0xfff4e0, 2.2)
  key.position.set(3, 6, 5)
  scene.add(key)
  const rim = new THREE.DirectionalLight(0xcfe3ff, 1.1)
  rim.position.set(-4, 3, -5)
  scene.add(rim)
  camera = new THREE.PerspectiveCamera(26, 1, 0.01, 200)
}

const _box = new THREE.Box3()
const _c = new THREE.Vector3()
const _p = new THREE.Vector3()
const _m = new THREE.Matrix4()

// Frames the model tightly from the VIEW direction using its actual vertices
// (an AABB seen from a 3/4 angle is much bigger than the model inside it).
function points(obj) {
  const pts = []
  obj.updateMatrixWorld(true)
  obj.traverse((o) => {
    if (!o.isMesh) return
    const pos = o.geometry.attributes.position
    const step = Math.max(1, Math.floor(pos.count / 4000))
    for (let i = 0; i < pos.count; i += step) pts.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld))
  })
  return pts
}
function frame(obj) {
  _box.setFromObject(obj, true)
  _box.getCenter(_c)
  const radius = _box.getSize(_p).length() / 2 || 1
  const pts = points(obj)
  camera.position.copy(_c).addScaledVector(VIEW, radius * 4)
  camera.lookAt(_c)
  camera.updateMatrixWorld(true)
  _m.copy(camera.matrixWorldInverse)
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  let need = -Infinity
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const q of pts) {
    _p.copy(q).applyMatrix4(_m)
    // perspective-correct extents at this depth, scaled back to the target plane
    const k = (radius * 4) / -_p.z
    minX = Math.min(minX, _p.x * k)
    maxX = Math.max(maxX, _p.x * k)
    minY = Math.min(minY, _p.y * k)
    maxY = Math.max(maxY, _p.y * k)
  }
  // shift the view so the projected model is centred, then move until it just fits
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0)
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
  const target = _c.clone().addScaledVector(right, cx).addScaledVector(up, cy)
  camera.position.copy(target).addScaledVector(VIEW, radius * 4)
  camera.lookAt(target)
  camera.updateMatrixWorld(true)
  _m.copy(camera.matrixWorldInverse)
  for (const q of pts) {
    _p.copy(q).applyMatrix4(_m)
    const d = Math.max(Math.abs(_p.x), Math.abs(_p.y)) / (tan * 0.95) + _p.z
    need = Math.max(need, d)
  }
  const dist = radius * 4 + need
  camera.position.copy(target).addScaledVector(VIEW, dist)
  camera.near = Math.max(0.01, dist - radius * 2)
  camera.far = dist + radius * 2
  camera.lookAt(target)
  camera.updateProjectionMatrix()
}

// Background warm-up: compiles the model's shaders off the main thread (KHR_parallel_shader_compile)
// before thumbnail() renders it, so the first thumbnail of a kind costs ~20 ms instead of ~150 ms of
// blocking shader compiles. Same picture; resolves when the thumbnail is cached.
export async function warmThumbnail(kind, id, size = 128) {
  const key = kind + ':' + id + ':' + size
  if (cache.has(key) || failed || typeof document === 'undefined') return
  if (!renderer) {
    try {
      setup()
    } catch (e) {
      failed = true
      renderer = null
      return
    }
  }
  try {
    const obj = kind === 'gadget' ? makeGadget(id) : makeLoot(id)
    scene.add(obj)
    try {
      await renderer.compileAsync(scene, camera)
    } finally {
      scene.remove(obj)
    }
  } catch (e) {
    // fall through: thumbnail() compiles synchronously if needed
  }
  thumbnail(kind, id, size)
}

export function thumbnail(kind, id, size = 128) {
  const key = kind + ':' + id + ':' + size
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  if (failed || typeof document === 'undefined') return ''
  if (!renderer) {
    try {
      setup()
    } catch (e) {
      failed = true
      renderer = null
      return ''
    }
  }
  let url = ''
  let obj = null
  try {
    obj = kind === 'gadget' ? makeGadget(id) : makeLoot(id)
    scene.add(obj)
    frame(obj)
    const px = Math.max(16, Math.round(size)) * SS
    renderer.setSize(px, px, false)
    renderer.render(scene, camera)
    const out = document.createElement('canvas')
    out.width = out.height = Math.round(size)
    const ctx = out.getContext('2d')
    ctx.imageSmoothingQuality = 'high'
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = size * 0.04
    ctx.shadowOffsetY = size * 0.02
    const inset = size * 0.03
    ctx.drawImage(renderer.domElement, inset, inset, size - inset * 2, size - inset * 2)
    url = out.toDataURL('image/png')
  } catch (e) {
    url = ''
  } finally {
    if (obj && scene) scene.remove(obj)
  }
  cache.set(key, url)
  return url
}
