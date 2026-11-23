// Dev page (/models-test.html): every loot + gadget model in a labelled grid next to a
// 1.8 m player capsule, with the HUD thumbnails in a strip. B toggles the spec boxes,
// L the labels. window.__models.focus(id) frames one model (also ?focus=id).
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js'
import { LOOT_IDS, LOOT_SIZES, makeLoot } from './loot.js'
import { GADGET_IDS, GADGET_SIZES, makeGadget, makeMarble, makeBananaPeel, makeFoamRocket } from './gadgets.js'
import { thumbnail } from './thumbs.js'
import { triangleCount } from './modelKit.js'

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.setSize(innerWidth, innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.0
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap
document.body.prepend(renderer.domElement)

const labels = new CSS2DRenderer()
labels.setSize(innerWidth, innerHeight)
Object.assign(labels.domElement.style, { position: 'fixed', top: '0', left: '0', pointerEvents: 'none' })
document.body.appendChild(labels.domElement)

const scene = new THREE.Scene()
scene.background = new THREE.Color('#cfd8e3')
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.55
scene.add(new THREE.HemisphereLight(0xe4f0ff, 0x8a7a68, 0.8))
const sun = new THREE.DirectionalLight(0xfff2dc, 2.4)
sun.position.set(-18, 40, 26)
sun.castShadow = true
sun.shadow.mapSize.set(4096, 4096)
sun.shadow.bias = -0.0004
sun.shadow.normalBias = 0.02
const sc = sun.shadow.camera
sc.left = -60
sc.right = 60
sc.top = 60
sc.bottom = -60
sc.near = 1
sc.far = 140
scene.add(sun)

const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: '#bdb6aa', roughness: 0.95 }))
floor.rotation.x = -Math.PI / 2
floor.receiveShadow = true
scene.add(floor)
const grid = new THREE.GridHelper(400, 200, 0x9a9488, 0xaaa498)
grid.position.y = 0.002
grid.material.transparent = true
grid.material.opacity = 0.35
scene.add(grid)

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 600)
const controls = new OrbitControls(camera, renderer.domElement)
controls.enableDamping = true

// --- Layout -----------------------------------------------------------------------------
const ROOMS = [
  ['HALLWAY', ['umbrella', 'boot', 'fedora', 'keys', 'vase', 'wallet', 'pocketwatch', 'snowglobe']],
  ['LIVING', ['remote', 'lamp', 'cushion', 'book', 'record', 'trophy', 'teacup', 'cookietin', 'piggybank', 'yarn', 'camera', 'radio']],
  ['KITCHEN', ['toaster', 'pan', 'teapot', 'cheese', 'cake', 'mug', 'milk', 'blender', 'rollingpin', 'plate']],
  ['BATHROOM', ['duck', 'toothbrush', 'perfume', 'shampoo', 'tp', 'hairdryer', 'soap', 'dentures']],
  ['BEDROOM', ['alarmclock', 'jewelbox', 'pillow', 'slipper', 'teddy', 'watch', 'photo', 'cash', 'necklace', 'diary']],
  ['GARAGE', ['toolbox', 'hammer', 'wrench', 'drill', 'paintcan', 'flashlight', 'gascan', 'hubcap']],
  ['STUDY', ['goldbar', 'crown', 'globe', 'painting', 'diamond', 'coinjar']],
]
const items = new Map() // name -> { obj, size }
const specBoxes = []
const labelObjs = []
const problems = []
let maxTris = { n: 0, id: '' }
let totalTris = 0
const playerMat = new THREE.MeshStandardMaterial({ color: '#4a90e2', roughness: 0.5 })
const playerGeo = new THREE.CapsuleGeometry(0.35, 1.1, 4, 16)

function label(text, html, pos, cls = 'lbl') {
  const d = document.createElement('div')
  d.className = cls
  d.innerHTML = html ?? text
  const o = new CSS2DObject(d)
  o.position.copy(pos)
  scene.add(o)
  labelObjs.push(o)
  return o
}

function check(name, obj, spec, originBottom = false) {
  const b = new THREE.Box3().setFromObject(obj, true)
  const s = b.getSize(new THREE.Vector3())
  const c = b.getCenter(new THREE.Vector3()).sub(obj.position)
  if (originBottom) c.y -= s.y / 2
  const bad = spec && [0, 1, 2].some((i) => Math.abs(s.getComponent(i) / spec[i] - 1) > 0.1)
  const off = c.length() > 0.02
  if (bad) problems.push(`${name}: size ${s.toArray().map((v) => v.toFixed(2)).join('x')} vs spec ${spec.join('x')}`)
  if (off) problems.push(`${name}: origin off-centre by ${c.toArray().map((v) => v.toFixed(2)).join(',')}`)
  obj.traverse((o) => {
    if (o.isMesh && (!o.castShadow && !o.material.transparent)) problems.push(`${name}: opaque mesh without castShadow`)
    if (o.isMesh && !o.receiveShadow) problems.push(`${name}: mesh without receiveShadow`)
  })
  const tris = triangleCount(obj)
  totalTris += tris
  if (tris > maxTris.n) maxTris = { n: tris, id: name }
  return tris
}

function place(name, obj, spec, x, z, originBottom = false) {
  const size = spec || new THREE.Box3().setFromObject(obj, true).getSize(new THREE.Vector3()).toArray()
  obj.position.set(x + size[0] / 2, originBottom ? 0 : size[1] / 2, z)
  scene.add(obj)
  const tris = check(name, obj, spec, originBottom)
  items.set(name, { obj, size })
  const box = new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(x, 0, z - size[2] / 2), new THREE.Vector3(x + size[0], size[1], z + size[2] / 2)), 0xff3b6b)
  box.visible = false
  scene.add(box)
  specBoxes.push(box)
  label(name, `${name} <i>${size.map((v) => +v.toFixed(2)).join('×')} · ${(tris / 1000).toFixed(1)}k▲</i>`, new THREE.Vector3(x + size[0] / 2, 0.05, z + size[2] / 2 + 0.5))
  return x + size[0] + 1.4
}

function addPlayer(x, z) {
  const p = new THREE.Mesh(playerGeo, playerMat)
  p.position.set(x + 0.35, 0.9, z)
  p.castShadow = p.receiveShadow = true
  scene.add(p)
  return x + 2
}

let z = 0
for (const [room, ids] of ROOMS) {
  const depth = Math.max(...ids.map((id) => LOOT_SIZES[id][2]))
  label(room, null, new THREE.Vector3(-3, 0.3, z), 'row')
  let x = addPlayer(0, z)
  for (const id of ids) x = place(id, makeLoot(id), LOOT_SIZES[id], x, z)
  z += depth + 3.2
}
{
  label('GADGETS', null, new THREE.Vector3(-3, 0.3, z), 'row')
  let x = addPlayer(0, z)
  for (const id of GADGET_IDS) x = place('g:' + id, makeGadget(id), GADGET_SIZES[id], x, z)
  z += 2.4 + 3.2
  label('SPAWNED', null, new THREE.Vector3(-3, 0.3, z), 'row')
  x = addPlayer(0, z)
  for (let i = 0; i < 6; i++) x = place('marble' + i, makeMarble(i), [0.35, 0.35, 0.35], x, z) - 0.9
  x += 0.8
  x = place('bananapeel', makeBananaPeel(), [1.2, 0.25, 1.2], x, z, true)
  x = place('foamrocket', makeFoamRocket(), null, x, z)
}

const allIds = new Set(LOOT_IDS)
for (const [, ids] of ROOMS) for (const id of ids) allIds.delete(id)
if (allIds.size) problems.push('not laid out: ' + [...allIds].join(', '))
const unknown = makeLoot('does-not-exist')
if (!unknown.isGroup) problems.push('unknown id did not return a group')

// --- Info + thumbnails ---------------------------------------------------------------------
const info = document.getElementById('info')
function renderInfo(thumbMs) {
  info.innerHTML =
    `<b>Models test</b> — ${LOOT_IDS.length} loot, ${GADGET_IDS.length} gadgets + marbles/peel/rocket<br>` +
    `checks: ${problems.length ? `<span class="bad">${problems.length} problem(s)</span><br>` + problems.slice(0, 8).join('<br>') : '<span class="ok">all sizes within ±10 %, origins centred</span>'}<br>` +
    `triangles: max ${maxTris.id} ${(maxTris.n / 1000).toFixed(1)}k, total ${(totalTris / 1000).toFixed(0)}k<br>` +
    `${thumbMs != null ? `thumbnails: ${thumbMs.toFixed(0)} ms<br>` : ''}` +
    `<i>drag = orbit · B = spec boxes · L = labels · click a thumbnail to focus</i>`
}
renderInfo(null)
if (problems.length) console.warn('[models-test]', problems)

const strip = document.getElementById('strip')
const queue = [...LOOT_IDS.map((id) => ['loot', id]), ...GADGET_IDS.map((id) => ['gadget', id])]
const t0 = performance.now()
function nextThumbs() {
  const end = performance.now() + 12
  while (queue.length && performance.now() < end) {
    const [kind, id] = queue.shift()
    const url = thumbnail(kind, id, 128)
    const f = document.createElement('figure')
    f.innerHTML = `<img alt="${id}" src="${url}"><figcaption>${id}</figcaption>`
    f.onclick = () => focus(kind === 'gadget' ? 'g:' + id : id)
    strip.appendChild(f)
  }
  if (queue.length) setTimeout(nextThumbs, 0)
  else renderInfo(performance.now() - t0)
}
setTimeout(nextThumbs, 50)

// --- Camera helpers --------------------------------------------------------------------------
function focus(name, dist) {
  const it = items.get(name)
  if (!it) return false
  const p = it.obj.position.clone()
  if (name === 'bananapeel') p.y += it.size[1] / 2
  const r = Math.max(...it.size) * 0.5 + 1.0
  const d = dist ?? r * 2.4
  controls.target.copy(p)
  camera.position.copy(p).add(new THREE.Vector3(0.75, 0.6, 1).normalize().multiplyScalar(d))
  controls.update()
  return true
}
function overview(row = 0) {
  const zz = row * 6
  controls.target.set(14, 0, zz + 6)
  camera.position.set(14, 22, zz + 34)
  controls.update()
}
// Frames several models at once (names as in the labels; gadgets are 'g:<id>').
function view(names, k = 1, dir = [0.55, 0.5, 1]) {
  const box = new THREE.Box3()
  for (const n of names) {
    const it = items.get(n)
    if (it) box.expandByObject(it.obj)
  }
  if (box.isEmpty()) return false
  const c = box.getCenter(new THREE.Vector3())
  const r = box.getSize(new THREE.Vector3()).length() / 2
  controls.target.copy(c)
  camera.position.copy(c).add(new THREE.Vector3(...dir).normalize().multiplyScalar(r * 2.1 * k))
  controls.update()
  return true
}
window.__models = { focus, view, overview, items, problems, camera, controls, scene, renderer }
const q = new URLSearchParams(location.search)
if (!(q.get('focus') && focus(q.get('focus')))) overview()

addEventListener('keydown', (e) => {
  if (e.key === 'b' || e.key === 'B') for (const b of specBoxes) b.visible = !b.visible
  if (e.key === 'l' || e.key === 'L') for (const l of labelObjs) l.visible = !l.visible
})
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(innerWidth, innerHeight)
  labels.setSize(innerWidth, innerHeight)
})
renderer.setAnimationLoop(() => {
  controls.update()
  renderer.render(scene, camera)
  labels.render(scene, camera)
})
