// Grandpa: a ~10.5 m procedural character (our own design: mustard knitted cardigan over a light-blue
// shirt and red bow tie, brown corduroy trousers, maroon fuzzy slippers, round gold glasses, bushy white
// eyebrows + mustache, bald crown with fluffy side tufts, big nose and ears, a walking cane), and his
// procedural animation: a pose table (targets per joint) blended every frame, a locomotion cycle on top,
// a face (blinks, brows, mouth, eyelids) and props (cane, newspaper). The brain (brain.js) drives it.
import {
  AdditiveBlending, CanvasTexture, CapsuleGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry,
  RepeatWrapping, RingGeometry, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, TorusGeometry, Vector3, CircleGeometry, BoxGeometry,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { GRANDPA } from '../config.js'
import { paintFabric } from './paint.js'
import { infoLabel } from './kit.js'

const lerp = (a, b, t) => a + (b - a) * t
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt))

function tex(c, rep = 2) {
  const t = new CanvasTexture(c)
  t.wrapS = t.wrapT = RepeatWrapping
  t.repeat.set(rep, rep)
  t.colorSpace = SRGBColorSpace
  return t
}
function corduroy() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const x = c.getContext('2d')
  x.fillStyle = '#7a5a3c'
  x.fillRect(0, 0, 128, 128)
  for (let i = 0; i < 128; i += 6) {
    x.fillStyle = 'rgba(255,230,190,0.12)'
    x.fillRect(i, 0, 3, 128)
    x.fillStyle = 'rgba(40,20,5,0.2)'
    x.fillRect(i + 3, 0, 1, 128)
  }
  return c
}

const geo = {
  sphere: new SphereGeometry(1, 24, 18),
  sphereLo: new SphereGeometry(1, 12, 9),
  cap: (r, l) => new CapsuleGeometry(r, l, 6, 14),
  cyl: (a, b, h) => new CylinderGeometry(a, b, h, 14),
}

export function createGrandpa(scene) {
  const knit = paintFabric('knit', '#d9a43a', '#b8862a')
  const M = {
    skin: new MeshStandardMaterial({ color: '#f1c7a5', roughness: 0.55 }),
    scalp: new MeshStandardMaterial({ color: '#f0c4a2', roughness: 0.3 }),
    nose: new MeshStandardMaterial({ color: '#e9a58a', roughness: 0.5 }),
    hair: new MeshStandardMaterial({ color: '#f5f5f2', roughness: 0.95 }),
    white: new MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 }),
    pupil: new MeshStandardMaterial({ color: '#2a2a33', roughness: 0.2 }),
    gold: new MeshStandardMaterial({ color: '#d8b15a', roughness: 0.25, metalness: 1 }),
    lens: new MeshStandardMaterial({ color: '#e8f4ff', roughness: 0.05, transparent: true, opacity: 0.22 }),
    mouth: new MeshStandardMaterial({ color: '#5a1f22', roughness: 0.8 }),
    shirt: new MeshStandardMaterial({ color: '#a9c7e6', roughness: 0.8 }),
    cardigan: new MeshStandardMaterial({ map: tex(knit.color, 3), bumpMap: tex(knit.bump, 3), bumpScale: 0.6, roughness: 0.95 }),
    button: new MeshStandardMaterial({ color: '#5b3a22', roughness: 0.4 }),
    bow: new MeshStandardMaterial({ color: '#c0392b', roughness: 0.6 }),
    trousers: new MeshStandardMaterial({ map: tex(corduroy(), 2), roughness: 0.9 }),
    slipper: new MeshStandardMaterial({ color: '#8e2f3f', roughness: 1 }),
    sole: new MeshStandardMaterial({ color: '#3d2a22', roughness: 0.8 }),
    cane: new MeshStandardMaterial({ color: '#5b3a22', roughness: 0.45 }),
    paper: new MeshStandardMaterial({ color: '#efeadc', roughness: 0.9, side: DoubleSide }),
    watch: new MeshStandardMaterial({ color: '#c0c6cc', roughness: 0.2, metalness: 1 }),
  }
  const all = [] // every mesh (x-ray silhouettes, shadows)
  const mk = (g, mat, parent, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => {
    const m = new Mesh(g, mat)
    m.position.set(x, y, z)
    m.scale.set(sx, sy, sz)
    m.castShadow = true
    m.receiveShadow = true
    parent.add(m)
    all.push(m)
    return m
  }
  const joint = (parent, x, y, z) => {
    const j = new Group()
    j.position.set(x, y, z)
    parent.add(j)
    return j
  }

  // --- Rig ---------------------------------------------------------------------------------------------
  const root = new Group() // feet on the floor, yaw
  scene.add(root)
  const tilt = joint(root, 0, 0, 0) // falling / lying (pivot at the feet)
  const hips = joint(tilt, 0, 4.6, 0)
  const spine = joint(hips, 0, 0, 0)
  const chest = joint(spine, 0, 2.2, 0)
  const neck = joint(chest, 0, 1.25, 0.15)
  const head = joint(neck, 0, 0.95, 0)

  // pelvis + belly
  mk(geo.sphere, M.trousers, hips, 0, 0.15, 0, 1.75, 0.9, 1.35)
  mk(geo.sphere, M.shirt, spine, 0, 1.3, 0.05, 1.75, 1.75, 1.6)
  // cardigan shell (open at the front: two half shells as rotated spheres)
  const cardL = mk(geo.sphere, M.cardigan, spine, -0.62, 1.35, -0.12, 1.3, 1.85, 1.6)
  const cardR = mk(geo.sphere, M.cardigan, spine, 0.62, 1.35, -0.12, 1.3, 1.85, 1.6)
  cardL.rotation.y = -0.15
  cardR.rotation.y = 0.15
  mk(geo.sphere, M.cardigan, chest, 0, 0.35, -0.2, 2.0, 0.9, 1.35) // shoulders / yoke
  for (let i = 0; i < 4; i++) {
    mk(geo.sphereLo, M.button, spine, -0.42, 2.2 - i * 0.55, 1.44 - i * 0.02, 0.12, 0.12, 0.06)
  }
  // bow tie + collar
  const bow = joint(chest, 0, 0.75, 1.1)
  mk(geo.sphereLo, M.bow, bow, -0.32, 0, 0, 0.36, 0.24, 0.12)
  mk(geo.sphereLo, M.bow, bow, 0.32, 0, 0, 0.36, 0.24, 0.12)
  mk(geo.sphereLo, M.bow, bow, 0, 0, 0.03, 0.12, 0.14, 0.12)
  mk(geo.sphereLo, M.shirt, chest, 0, 0.85, 0.72, 0.85, 0.28, 0.55)
  // neck
  mk(geo.cyl(0.55, 0.62, 0.9), M.skin, neck, 0, 0.25, 0)

  // --- Head + face ---
  mk(geo.sphere, M.skin, head, 0, 0.55, 0, 1.12, 1.18, 1.1)
  mk(geo.sphere, M.scalp, head, 0, 0.9, -0.05, 1.05, 0.95, 1.02) // shiny bald crown
  mk(geo.sphere, M.skin, head, 0, -0.2, 0.25, 0.95, 0.6, 0.85) // jowls
  const nose = mk(geo.sphere, M.nose, head, 0, 0.42, 1.12, 0.36, 0.42, 0.38)
  nose.rotation.x = 0.25
  for (const s of [-1, 1]) {
    mk(geo.sphere, M.skin, head, s * 1.12, 0.5, -0.05, 0.22, 0.42, 0.3) // ears
    // hair tufts (fluffy clusters behind the ears)
    for (let i = 0; i < 4; i++) mk(geo.sphereLo, M.hair, head, s * (1.0 + (i % 2) * 0.12), 0.75 - i * 0.18, -0.45 - (i % 3) * 0.2, 0.34, 0.3, 0.34)
  }
  mk(geo.sphereLo, M.hair, head, 0, 0.55, -1.0, 0.65, 0.35, 0.3) // back fringe
  // eyes, lids, brows
  const eyes = []
  for (const s of [-1, 1]) {
    const eye = joint(head, s * 0.42, 0.72, 0.92)
    mk(geo.sphereLo, M.white, eye, 0, 0, 0, 0.26, 0.28, 0.16)
    const pupil = mk(geo.sphereLo, M.pupil, eye, 0, -0.02, 0.13, 0.11, 0.12, 0.06)
    const lid = mk(geo.sphere, M.skin, eye, 0, 0.0, 0.0, 0.3, 0.32, 0.2) // scaled in y to close
    lid.scale.y = 0.02
    lid.position.y = 0.28
    const brow = joint(head, s * 0.45, 1.08, 0.92)
    for (let i = 0; i < 3; i++) mk(geo.sphereLo, M.hair, brow, s * (i * 0.16 - 0.12), 0.02 - i * 0.03, 0.02, 0.22, 0.12, 0.12)
    eyes.push({ eye, pupil, lid, brow, s })
  }
  // glasses
  const ringG = new TorusGeometry(0.33, 0.045, 8, 22)
  for (const s of [-1, 1]) {
    mk(ringG, M.gold, head, s * 0.43, 0.7, 1.07)
    mk(new CircleGeometry(0.31, 18), M.lens, head, s * 0.43, 0.7, 1.08)
    const arm = mk(new BoxGeometry(0.05, 0.05, 1.1), M.gold, head, s * 0.76, 0.72, 0.55)
    arm.rotation.y = s * 0.12
  }
  mk(new BoxGeometry(0.22, 0.05, 0.05), M.gold, head, 0, 0.74, 1.1)
  // mustache + mouth
  const mouth = mk(geo.sphereLo, M.mouth, head, 0, 0.02, 1.0, 0.28, 0.05, 0.12)
  const stache = joint(head, 0, 0.18, 1.12)
  for (const s of [-1, 1]) {
    const half = mk(geo.cap(0.16, 0.55), M.hair, stache, s * 0.3, -0.06, 0)
    half.rotation.z = s * 1.2
    mk(geo.sphereLo, M.hair, stache, s * 0.58, -0.22, -0.05, 0.16, 0.2, 0.15)
  }

  // --- Arms ---
  const arm = (s) => {
    const shoulder = joint(chest, s * 1.75, 0.3, 0)
    const upper = joint(shoulder, 0, 0, 0)
    mk(geo.sphere, M.cardigan, upper, 0, 0, 0, 0.62, 0.62, 0.62)
    mk(geo.cap(0.52, 1.3), M.cardigan, upper, 0, -0.95, 0)
    const elbow = joint(upper, 0, -1.9, 0)
    mk(geo.cap(0.45, 1.1), M.cardigan, elbow, 0, -0.8, 0)
    mk(geo.cyl(0.5, 0.5, 0.35), M.cardigan, elbow, 0, -1.5, 0) // cuff
    const hand = joint(elbow, 0, -1.85, 0)
    mk(new RoundedBoxGeometry(0.85, 0.95, 0.42, 3, 0.18), M.skin, hand, 0, -0.35, 0.05)
    mk(geo.cap(0.13, 0.35), M.skin, hand, -s * 0.42, -0.2, 0.18).rotation.z = s * 0.8 // thumb
    for (let i = 0; i < 4; i++) mk(geo.cap(0.1, 0.28), M.skin, hand, -0.3 + i * 0.2, -0.88, 0.08)
    if (s < 0) mk(geo.cyl(0.47, 0.47, 0.18), M.watch, elbow, 0, -1.25, 0)
    return { shoulder, upper, elbow, hand }
  }
  const armL = arm(-1)
  const armR = arm(1)

  // --- Legs ---
  const leg = (s) => {
    const hip = joint(hips, s * 0.85, 0, 0)
    mk(geo.cap(0.68, 1.4), M.trousers, hip, 0, -1, 0)
    const knee = joint(hip, 0, -2.0, 0)
    mk(geo.cap(0.6, 1.4), M.trousers, knee, 0, -1, 0)
    const foot = joint(knee, 0, -2.0, 0)
    mk(new RoundedBoxGeometry(1.05, 0.7, 1.85, 3, 0.32), M.slipper, foot, 0, -0.25, 0.4)
    mk(new RoundedBoxGeometry(1.08, 0.16, 1.9, 2, 0.06), M.sole, foot, 0, -0.55, 0.4)
    mk(geo.sphereLo, M.slipper, foot, 0, 0.05, 1.15, 0.32, 0.3, 0.3) // pom-pom
    return { hip, knee, foot }
  }
  const legL = leg(-1)
  const legR = leg(1)

  // --- Props: cane (right hand), newspaper (both hands when reading) ---
  const cane = joint(armR.hand, 0, -0.45, 0.15)
  mk(geo.cyl(0.11, 0.11, 4.8), M.cane, cane, 0, -2.2, 0)
  const hook = mk(new TorusGeometry(0.4, 0.11, 8, 16, Math.PI), M.cane, cane, 0.4, 0.15, 0)
  hook.rotation.z = 0
  mk(geo.cyl(0.13, 0.13, 0.2), M.sole, cane, 0, -4.6, 0)
  const paper = joint(chest, 0, -0.3, 2.3)
  const pc = document.createElement('canvas')
  pc.width = 256
  pc.height = 160
  const px = pc.getContext('2d')
  px.fillStyle = '#efeadc'
  px.fillRect(0, 0, 256, 160)
  px.fillStyle = '#2a2a2a'
  px.font = '700 26px Georgia, serif'
  px.fillText('DAILY TIMES', 40, 30)
  for (let i = 0; i < 10; i++) px.fillRect(14 + (i % 2) * 124, 46 + Math.floor(i / 2) * 22, 110, 6)
  px.fillStyle = '#8a8a8a'
  px.fillRect(150, 92, 90, 54)
  const paperMat = new MeshStandardMaterial({ map: new CanvasTexture(pc), roughness: 0.9, side: DoubleSide })
  paperMat.map.colorSpace = SRGBColorSpace
  const sheet = mk(new PlaneGeometry(3.6, 2.4), paperMat, paper, 0, 0, 0)
  sheet.rotation.y = Math.PI
  paper.visible = false

  // --- Bubble over his head ("?", "!", "Zzz", lines) ---
  const bubble = infoLabel([{ text: '', size: 72, color: '#ffffff' }], 0.03, { depthTest: true, renderOrder: 8 })
  bubble.position.y = GRANDPA.height + 1.6
  root.add(bubble)
  bubble.visible = false
  // Stars circling his head (stunned).
  const stars = new Group()
  const starMat = new SpriteMaterial({ color: '#ffe066', transparent: true, blending: AdditiveBlending, depthWrite: false })
  for (let i = 0; i < 5; i++) {
    const s = new Sprite(starMat)
    s.scale.setScalar(0.7)
    stars.add(s)
  }
  head.add(stars)
  stars.visible = false

  // X-ray silhouettes (seen through walls with the specs).
  const xrayMat = new MeshBasicMaterial({ color: '#4dff8a', transparent: true, opacity: 0.32, depthTest: false, depthWrite: false, blending: AdditiveBlending })
  const xray = []
  for (const m of all) {
    const s = new Mesh(m.geometry, xrayMat)
    s.renderOrder = 20
    s.visible = false
    m.add(s)
    xray.push(s)
  }
  // Vision cone on the floor (only with the specs).
  const coneMat = new MeshBasicMaterial({ color: '#ff5050', transparent: true, opacity: 0.16, depthWrite: false, depthTest: false, side: DoubleSide })
  const cone = new Mesh(new RingGeometry(0.1, 1, 32, 1, Math.PI / 2 - (GRANDPA.fov * Math.PI) / 180, (2 * GRANDPA.fov * Math.PI) / 180), coneMat)
  cone.rotation.x = -Math.PI / 2
  cone.position.y = 0.2
  cone.renderOrder = 19
  cone.visible = false
  root.add(cone)

  // --- Animation --------------------------------------------------------------------------------------
  // Joint targets: [x, y, z] Euler per controlled joint. Poses fill `T` each frame.
  const J = {
    spine, chest, neck, head,
    upL: armL.upper, upR: armR.upper, elL: armL.elbow, elR: armR.elbow, haL: armL.hand, haR: armR.hand,
    hipL: legL.hip, hipR: legR.hip, knL: legL.knee, knR: legR.knee, ftL: legL.foot, ftR: legR.foot,
  }
  const cur = {}
  const T = {}
  for (const k of Object.keys(J)) {
    cur[k] = [0, 0, 0]
    T[k] = [0, 0, 0]
  }
  const body = { hipsY: 4.6, tiltX: 0, tiltZ: 0, rootY: 0, hipsZ: 0 }
  const bodyT = { ...body }
  const face = { brow: 0, mouth: 0, lids: 0, look: 0 }
  const faceT = { ...face }
  let phase = 0
  let blink = 0
  let blinkT = 2
  let poseName = 'idle'
  let poseTime = 0
  let speed = 0
  const set = (k, x = 0, y = 0, z = 0) => {
    T[k][0] = x
    T[k][1] = y
    T[k][2] = z
  }
  const reset = () => {
    for (const k of Object.keys(T)) set(k)
    bodyT.hipsY = 4.6
    bodyT.tiltX = 0
    bodyT.tiltZ = 0
    bodyT.rootY = 0
    bodyT.hipsZ = 0
    faceT.brow = 0
    faceT.mouth = 0
    faceT.lids = 0
  }
  const sitPose = (seatY) => {
    bodyT.hipsY = seatY + 0.5
    set('hipL', -1.45, 0, -0.08)
    set('hipR', -1.45, 0, 0.08)
    set('knL', 1.45)
    set('knR', 1.45)
    set('spine', -0.08)
  }
  // Each pose sets targets; `t` = seconds in the pose, `w` = walk weight (0..1), `s` = phase.
  const POSES = {
    idle(t) {
      set('spine', 0.12 + Math.sin(t * 1.6) * 0.015)
      set('neck', 0.05)
      set('upL', 0.05, 0, -0.12)
      set('upR', 0.05, 0, 0.12)
      set('elL', -0.25)
      set('elR', -0.35)
    },
    look(t) {
      POSES.idle(t)
      set('neck', 0.08, Math.sin(t * 0.9) * 0.85)
      set('head', 0, Math.sin(t * 0.9 + 0.4) * 0.25)
    },
    lookAround(t) {
      POSES.idle(t)
      set('neck', -0.05, Math.sin(t * 1.4) * 1.0)
      set('head', 0.05, Math.sin(t * 1.4 + 0.3) * 0.3)
      faceT.brow = 0.4
    },
    suspicious(t) {
      set('spine', 0.32)
      set('neck', -0.1, Math.sin(t * 0.8) * 0.25, 0.15)
      set('upR', -0.6, 0, 0.9)
      set('elR', -2.3)
      set('haR', 0, 0, -0.4)
      set('upL', 0.1, 0, -0.15)
      set('elL', -0.3)
      faceT.brow = 0.6
    },
    alert(t) {
      const k = Math.max(0, 1 - t * 2.5)
      bodyT.rootY = Math.sin(Math.min(1, t * 4) * Math.PI) * 1.2
      set('spine', -0.1)
      set('upL', -2.6 * (1 - k * 0.3), 0, -0.4)
      set('upR', -2.6 * (1 - k * 0.3), 0, 0.4)
      set('elL', -0.4)
      set('elR', -0.4)
      faceT.brow = 1
      faceT.mouth = 1
    },
    chase(t, w) {
      set('spine', 0.38)
      set('neck', -0.3)
      set('upL', -1.45 + Math.sin(t * 12) * 0.15, 0, -0.25)
      set('upR', -1.45 - Math.sin(t * 12) * 0.15, 0, 0.25)
      set('elL', -0.25)
      set('elR', -0.25)
      set('haL', -0.4)
      set('haR', -0.4)
      faceT.brow = -1
      faceT.mouth = 0.55 + Math.sin(t * 8) * 0.25
      void w
    },
    grab(t) {
      const k = Math.min(1, t / GRANDPA.grabTime)
      set('spine', 0.95 * k)
      set('neck', -0.6 * k)
      set('upL', -1.7 * k, 0, -0.1)
      set('elL', -0.1)
      set('upR', 0.3, 0, 0.3)
      set('elR', -0.6)
      set('hipL', -0.5 * k)
      set('hipR', -0.5 * k)
      set('knL', 0.8 * k)
      set('knR', 0.8 * k)
      bodyT.hipsY = 4.6 - 0.6 * k
      faceT.brow = -0.6
      faceT.mouth = 0.6
    },
    carry(t) {
      set('spine', 0.1)
      set('upL', -1.25, 0.2, -0.2)
      set('elL', -1.25)
      set('haL', 0.3)
      set('upR', 0.05 + Math.sin(t * 2) * 0.05, 0, 0.15)
      set('elR', -0.4)
      set('neck', 0.1, 0.25)
      faceT.brow = -0.3
      faceT.mouth = 0.2 + Math.max(0, Math.sin(t * 5)) * 0.3
    },
    drop(t) {
      POSES.carry(t)
      set('upL', -1.0, 0.6, -0.4)
      set('spine', 0.35)
    },
    tea(t) {
      POSES.idle(t)
      set('upL', -0.65, 0, -0.1)
      set('upR', -0.75 + Math.sin(t * 3) * 0.1, 0, 0.1)
      set('elL', -1.1)
      set('elR', -1.1 + Math.sin(t * 6) * 0.25)
      set('neck', 0.35)
    },
    wash(t) {
      POSES.tea(t)
      set('elL', -0.9 + Math.sin(t * 9) * 0.25)
      set('elR', -0.9 - Math.sin(t * 9) * 0.25)
    },
    tinker(t) {
      POSES.idle(t)
      set('spine', 0.3)
      set('upL', -0.8, 0, -0.1)
      set('elL', -0.9)
      const hammer = Math.abs(Math.sin(t * 5))
      set('upR', -1.2 - hammer * 0.5, 0, 0.2)
      set('elR', -1.5 + hammer * 0.9)
      set('neck', 0.4)
    },
    poke(t) {
      POSES.idle(t)
      set('spine', 0.4)
      set('upR', -1.0 + Math.sin(t * 3) * 0.3, 0, 0.1)
      set('elR', -0.4)
      set('neck', 0.3)
    },
    adjust(t) {
      POSES.idle(t)
      set('upR', -1.9, 0, 0.15)
      set('elR', -0.6 + Math.sin(t * 5) * 0.1)
      set('neck', -0.15)
    },
    // on the phone: right hand up at the ear, free hand gesturing, head nodding along
    phone(t) {
      POSES.idle(t)
      set('upR', -0.9, 0, 0.75)
      set('elR', -2.5)
      set('haR', 0, 0, -0.3)
      set('upL', -0.3 - Math.max(0, Math.sin(t * 1.3)) * 0.5, 0, -0.2)
      set('elL', -0.9 - Math.sin(t * 2.6) * 0.3)
      set('neck', 0.08 + Math.sin(t * 2.2) * 0.06, 0, 0.12)
    },
    water(t) {
      POSES.idle(t)
      set('upR', -1.4, 0, 0.2)
      set('elR', -0.3)
      set('haR', 0.6 + Math.sin(t * 2) * 0.2)
      set('neck', 0.4)
    },
    read(t) {
      sitPose(3)
      set('upL', -0.9, 0, -0.3)
      set('upR', -0.9, 0, 0.3)
      set('elL', -1.3)
      set('elR', -1.3)
      set('neck', 0.3, Math.sin(t * 0.25) * 0.08)
      faceT.lids = 0.35
    },
    sit(t) {
      sitPose(2.8)
      set('upL', -0.4, 0, -0.1)
      set('upR', -0.4, 0, 0.1)
      set('elL', -0.9)
      set('elR', -0.9)
      set('neck', -0.05, Math.sin(t * 0.3) * 0.15)
    },
    sleepBed(t) {
      bodyT.tiltX = -Math.PI / 2
      bodyT.rootY = 3.9 + 1.6
      bodyT.hipsZ = 0
      set('upL', -0.2, 0, -0.35)
      set('upR', -0.2, 0, 0.35)
      set('elL', -0.6)
      set('elR', -0.6)
      set('neck', -0.3 + Math.sin(t * 1.2) * 0.04)
      set('spine', Math.sin(t * 1.2) * 0.03)
      faceT.lids = 1
      faceT.mouth = 0.25 + Math.sin(t * 1.2) * 0.2
    },
    sleepFloor(t) {
      sitPose(0)
      bodyT.hipsY = 1.1
      set('hipL', -1.35, 0, -0.35)
      set('hipR', -1.35, 0, 0.35)
      set('knL', 0.5)
      set('knR', 0.5)
      set('spine', 0.25)
      set('neck', 0.75 + Math.sin(t * 1.3) * 0.05, 0, 0.2)
      set('upL', 0.2, 0, -0.5)
      set('upR', 0.2, 0, 0.5)
      faceT.lids = 1
      faceT.mouth = 0.3 + Math.sin(t * 1.3) * 0.2
    },
    slip(t) {
      // whoops: feet fly up, he falls flat on his back, lies there dazed
      const k = Math.min(1, t / 0.45)
      bodyT.tiltX = -Math.PI / 2 * (k * k)
      bodyT.rootY = Math.sin(k * Math.PI) * 1.5 + 1.2 * k
      set('hipL', -0.6 * k)
      set('hipR', -0.9 * k)
      set('upL', -2.4 * k, 0, -0.6)
      set('upR', -2.4 * k, 0, 0.6)
      faceT.brow = 1
      faceT.mouth = 1
      if (t > 0.6) {
        set('upL', -0.3, 0, -0.9)
        set('upR', -0.3, 0, 0.9)
        set('neck', Math.sin(t * 2) * 0.15, Math.sin(t * 1.3) * 0.3)
        faceT.mouth = 0.4
        faceT.lids = 0.5
      }
    },
    getUp(t) {
      const k = Math.min(1, t / 0.9)
      bodyT.tiltX = -Math.PI / 2 * (1 - k) * (1 - k)
      bodyT.rootY = 1.2 * (1 - k)
      set('spine', 0.5 * (1 - k))
      faceT.brow = -0.8
    },
    stuck(t) {
      set('spine', 0.25 + Math.sin(t * 7) * 0.12, Math.sin(t * 3.5) * 0.25)
      set('upL', -1.2 + Math.sin(t * 9) * 0.6, 0, -0.6)
      set('upR', -1.2 - Math.sin(t * 9) * 0.6, 0, 0.6)
      set('elL', -0.6)
      set('elR', -0.6)
      set('hipL', -0.35 + Math.sin(t * 7) * 0.2)
      set('hipR', -0.35 - Math.sin(t * 7) * 0.2)
      set('knL', 0.7)
      set('knR', 0.7)
      bodyT.hipsY = 4.2
      faceT.brow = -1
      faceT.mouth = 0.5 + Math.sin(t * 7) * 0.4
    },
    stunned(t) {
      set('spine', 0.15 + Math.sin(t * 3) * 0.08, 0, Math.sin(t * 2.2) * 0.15)
      set('neck', 0.2, Math.sin(t * 2.4) * 0.4, Math.sin(t * 2) * 0.2)
      set('upL', 0.1, 0, -0.5 - Math.sin(t * 2) * 0.2)
      set('upR', 0.1, 0, 0.5 + Math.sin(t * 2) * 0.2)
      faceT.lids = 0.4
      faceT.mouth = 0.5
    },
    angry(t) {
      POSES.idle(t)
      set('upR', -2.7, 0, 0.3)
      set('elR', -0.9 + Math.sin(t * 16) * 0.35)
      set('neck', -0.15, 0, Math.sin(t * 8) * 0.1)
      faceT.brow = -1
      faceT.mouth = 0.4 + Math.abs(Math.sin(t * 8)) * 0.5
    },
    smash(t) {
      const k = (t * 1.6) % 1
      set('spine', 0.6)
      set('upR', -2.6 + (k > 0.5 ? 2.4 : 0), 0, 0.2)
      set('elR', -0.3)
      set('neck', 0.4)
      faceT.brow = -1
      faceT.mouth = 0.7
    },
    ouch(t) {
      POSES.idle(t)
      set('spine', -0.25)
      set('upL', -2.0, 0, -0.5)
      set('elL', -2.2)
      set('neck', -0.3, 0, 0.3)
      faceT.brow = 1
      faceT.mouth = 0.9
    },
    yawn(t) {
      POSES.idle(t)
      set('upL', -2.8, 0, -0.3)
      set('upR', -2.8, 0, 0.3)
      set('elL', -0.8)
      set('elR', -0.8)
      set('neck', -0.35)
      faceT.lids = 0.8
      faceT.mouth = 1
    },
  }
  const WALKING = new Set(['idle', 'chase', 'carry', 'look', 'lookAround', 'suspicious', 'angry'])

  const grandpa = {
    root,
    meshes: all,
    head,
    handL: armL.hand,
    eyeWorld: new Vector3(),
    handWorld: new Vector3(),
    get pose() {
      return poseName
    },
    setPose(name) {
      if (name === poseName || !POSES[name]) return
      poseName = name
      poseTime = 0
    },
    // speed: m/s along the ground (drives the gait), dt: frame time.
    animate(dt, moveSpeed, time) {
      poseTime += dt
      speed = damp(speed, moveSpeed, 8, dt)
      reset()
      POSES[poseName](poseTime, 0)
      // Locomotion cycle on top of upright poses.
      const walking = WALKING.has(poseName) && speed > 0.3
      if (walking) {
        const run = Math.min(1, Math.max(0, (speed - 5) / 6))
        phase += dt * speed * (run > 0.5 ? 0.42 : 0.55)
        const s = Math.sin(phase)
        const c = Math.cos(phase)
        const amp = lerp(0.42, 0.85, run)
        T.hipL[0] += s * amp
        T.hipR[0] -= s * amp
        T.knL[0] += Math.max(0, -c) * lerp(0.6, 1.4, run) + 0.1
        T.knR[0] += Math.max(0, c) * lerp(0.6, 1.4, run) + 0.1
        T.ftL[0] += -s * 0.25
        T.ftR[0] += s * 0.25
        if (poseName !== 'chase' && poseName !== 'carry') {
          T.upL[0] -= s * lerp(0.35, 0.7, run)
          T.upR[0] += s * lerp(0.35, 0.7, run)
        }
        T.spine[1] += s * 0.06
        bodyT.hipsY += Math.abs(c) * lerp(0.12, 0.3, run) - 0.1
        // footsteps (each half cycle)
        const halfCycle = Math.floor(phase / Math.PI)
        if (halfCycle !== grandpa._lastStep) {
          grandpa._lastStep = halfCycle
          grandpa.onStep?.(halfCycle % 2 ? 'L' : 'R', Math.min(1, 0.35 + speed / 12))
        }
      }
      // ease toward targets
      const k = poseName === 'alert' || poseName === 'slip' ? 22 : 9
      for (const key of Object.keys(J)) {
        const c = cur[key]
        const t = T[key]
        c[0] = damp(c[0], t[0], k, dt)
        c[1] = damp(c[1], t[1], k, dt)
        c[2] = damp(c[2], t[2], k, dt)
        J[key].rotation.set(c[0], c[1], c[2])
      }
      for (const key of Object.keys(body)) body[key] = damp(body[key], bodyT[key], poseName === 'slip' ? 18 : 7, dt)
      hips.position.y = body.hipsY
      hips.position.z = body.hipsZ
      tilt.rotation.x = body.tiltX
      tilt.position.y = body.rootY
      // face
      blinkT -= dt
      if (blinkT <= 0) {
        blink = 0.16
        blinkT = 2 + Math.random() * 3
      }
      blink = Math.max(0, blink - dt)
      for (const key of Object.keys(face)) face[key] = damp(face[key], faceT[key], 14, dt)
      const lids = Math.max(face.lids, blink > 0 ? 1 : 0)
      for (const e of eyes) {
        e.lid.scale.y = 0.02 + lids * 0.3
        e.lid.position.y = 0.28 - lids * 0.18
        e.brow.position.y = 1.08 + face.brow * 0.16
        e.brow.rotation.z = -e.s * face.brow * -0.35
        e.pupil.scale.setScalar(face.brow > 0.7 ? 0.08 : 0.11)
      }
      mouth.scale.y = 0.05 + face.mouth * 0.3
      mouth.position.y = 0.02 - face.mouth * 0.12
      paper.visible = poseName === 'read'
      cane.visible = poseName !== 'read' && poseName !== 'sleepBed'
      // stars
      stars.visible = poseName === 'stunned' || (poseName === 'slip' && poseTime > 0.6)
      if (stars.visible) {
        stars.children.forEach((s, i) => {
          const a = time * 3 + (i / 5) * Math.PI * 2
          s.position.set(Math.cos(a) * 1.6, 1.9 + Math.sin(a * 2) * 0.15, Math.sin(a) * 1.6)
        })
      }
      root.updateMatrixWorld(true)
      head.getWorldPosition(grandpa.eyeWorld)
      grandpa.eyeWorld.y += 0.7
      armL.hand.getWorldPosition(grandpa.handWorld)
    },
    // "?" "!" "Zzz" or a short line; '' hides it.
    say(text, color = '#ffffff', size = 72) {
      if (!text) {
        bubble.visible = false
        return
      }
      bubble.visible = true
      bubble.setLines([{ text, size, color, outline: '#1a1020' }])
    },
    setXray(on) {
      for (const s of xray) s.visible = on
      cone.visible = on
    },
    setCone(range, fovDeg) {
      cone.scale.setScalar(range)
      void fovDeg
    },
  }
  return grandpa
}
