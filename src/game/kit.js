// Building blocks shared by the house, the yard and the hideout: world-scaled box UVs (so every
// surface keeps one texture scale), a material cache, painted surface materials (colour + bump),
// boxes that can also be solid (Rapier fixed colliders), rounded shapes, info labels (multi-line
// outlined text sprites that can be repainted), glow sprites and money formatting.
import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  RepeatWrapping,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
} from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { RAPIER, addFixed } from '../physics.js'
import { fontReady } from '../propkit.js'
import { paintSoftDot, paintSparkle } from '../textures.js'

// --- Textures (UVs are in metres; `tile` = metres per texture repeat) ----------------------------
const texCache = new Map()
export function tiledTex(key, canvas, tile = 4, srgb = true) {
  const k = `${key}:${tile}:${srgb}`
  if (!texCache.has(k)) {
    const t = new CanvasTexture(canvas)
    t.wrapS = t.wrapT = RepeatWrapping
    t.repeat.set(1 / tile, 1 / tile)
    t.anisotropy = 8
    if (srgb) t.colorSpace = SRGBColorSpace
    texCache.set(k, t)
  }
  return texCache.get(k)
}
export function plainTex(c, srgb = true) {
  const t = new CanvasTexture(c)
  if (srgb) t.colorSpace = SRGBColorSpace
  t.anisotropy = 4
  return t
}

// --- Materials ------------------------------------------------------------------------------------
const matCache = new Map()
export function memo(key, make) {
  if (!matCache.has(key)) matCache.set(key, make())
  return matCache.get(key)
}
// A painted surface ({ color, bump } from paint.js) tiled every `tile` metres.
export function surface(key, painted, { tile = 4, rough = 0.8, metal = 0, bump = 0.6, tint = '#ffffff', extra = {} } = {}) {
  return memo(`surf:${key}:${tile}:${rough}:${tint}:${bump}`, () => {
    const m = new MeshStandardMaterial({
      color: tint,
      map: tiledTex(`${key}-c`, painted.color, tile),
      roughness: rough,
      metalness: metal,
      ...extra,
    })
    if (bump > 0 && painted.bump) {
      m.bumpMap = tiledTex(`${key}-b`, painted.bump, tile, false)
      m.bumpScale = bump
    }
    return m
  })
}
export const solid = (color, rough = 0.6, metal = 0, extra = {}) => memo(`solid:${color}:${rough}:${metal}:${JSON.stringify(extra)}`, () => new MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra }))
export const metal = (color, rough = 0.3) => solid(color, rough, 1)
export const emissive = (color, intensity = 2, base = '#000000') => memo(`emi:${color}:${intensity}:${base}`, () => new MeshStandardMaterial({ color: base, emissive: color, emissiveIntensity: intensity, roughness: 0.5 }))
export const glass = (color = '#cfe9ff', opacity = 0.28) =>
  memo(`glass:${color}:${opacity}`, () => new MeshPhysicalMaterial({ color, roughness: 0.05, metalness: 0, transparent: true, opacity, depthWrite: false, side: DoubleSide, clearcoat: 1, envMapIntensity: 1.5 }))
export const additive = (color, opacity = 0.85, map = null) =>
  memo(`add:${color}:${opacity}:${map ? map.uuid : ''}`, () => new MeshBasicMaterial({ color, map, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false }))
export const unlit = (color, extra = {}) => memo(`unlit:${color}:${JSON.stringify(extra)}`, () => new MeshBasicMaterial({ color, ...extra }))

// --- Geometry -------------------------------------------------------------------------------------
// Box whose UVs are in metres on every face, so textures keep one scale.
export function boxGeo(w, h, d) {
  const g = new BoxGeometry(w, h, d)
  const uv = g.attributes.uv
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]] // px nx py ny pz nz
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v
      uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1])
    }
  }
  return g
}
const roundCache = new Map()
// Rounded box (cached by size): soft furniture edges.
export function roundGeo(w, h, d, r = 0.3, seg = 3) {
  const k = `${w.toFixed(2)}:${h.toFixed(2)}:${d.toFixed(2)}:${r}:${seg}`
  if (!roundCache.has(k)) {
    const g = new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001))
    // metre UVs like boxGeo (approximate: scaled by the largest face extents)
    const uv = g.attributes.uv
    const n = g.attributes.normal
    for (let i = 0; i < uv.count; i++) {
      const ax = Math.abs(n.getX(i))
      const ay = Math.abs(n.getY(i))
      const sx = ax > 0.5 ? d : w
      const sy = ay > 0.5 ? d : h
      uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy)
    }
    roundCache.set(k, g)
  }
  return roundCache.get(k)
}

// A box mesh at (x, y-centre, z). opts: collide (fixed collider), rotY, cast, receive, round (radius).
export function box(parent, w, h, d, mat, x, y, z, { collide = false, rotY = 0, cast = true, receive = true, round = 0 } = {}) {
  const m = new Mesh(round > 0 ? roundGeo(w, h, d, round) : boxGeo(w, h, d), mat)
  m.position.set(x, y, z)
  m.rotation.y = rotY
  m.castShadow = cast
  m.receiveShadow = receive
  parent.add(m)
  if (collide) m.userData.collider = solidCuboid(w / 2, h / 2, d / 2, x, y, z, rotY)
  return m
}
// Box from min/max corners (walls, slabs).
export function boxMM(parent, x0, y0, z0, x1, y1, z1, mat, opts) {
  return box(parent, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, opts)
}
const cylCache = new Map()
export function cylGeo(rTop, rBot, h, seg = 16) {
  const k = `${rTop}:${rBot}:${h}:${seg}`
  if (!cylCache.has(k)) cylCache.set(k, new CylinderGeometry(rTop, rBot, h, seg))
  return cylCache.get(k)
}
export function cyl(parent, rTop, rBot, h, mat, x, y, z, { collide = false, seg = 16, cast = true } = {}) {
  const m = new Mesh(cylGeo(rTop, rBot, h, seg), mat)
  m.position.set(x, y, z)
  m.castShadow = cast
  m.receiveShadow = true
  parent.add(m)
  if (collide) addFixed(RAPIER.ColliderDesc.cylinder(h / 2, Math.max(rTop, rBot)), { x, y, z })
  return m
}
const sphCache = new Map()
export function sphere(parent, r, mat, x, y, z, { sx = 1, sy = 1, sz = 1, seg = 16 } = {}) {
  const k = `${r}:${seg}`
  if (!sphCache.has(k)) sphCache.set(k, new SphereGeometry(r, seg, Math.max(8, seg * 0.75)))
  const m = new Mesh(sphCache.get(k), mat)
  m.position.set(x, y, z)
  m.scale.set(sx, sy, sz)
  m.castShadow = true
  m.receiveShadow = true
  parent.add(m)
  return m
}

export function solidCuboid(hx, hy, hz, x, y, z, rotY = 0, rotX = 0, opts) {
  // rotation: yaw then pitch (pitch about local X)
  const cy = Math.cos(rotY / 2)
  const sy = Math.sin(rotY / 2)
  const cx = Math.cos(rotX / 2)
  const sx = Math.sin(rotX / 2)
  const q = { x: cy * sx, y: sy * cx, z: -sy * sx, w: cy * cx }
  return addFixed(RAPIER.ColliderDesc.cuboid(hx, hy, hz), { x, y, z }, q, opts)
}
export function solidMM(x0, y0, z0, x1, y1, z1, opts) {
  return solidCuboid(Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, Math.abs(z1 - z0) / 2, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0, 0, opts)
}

// --- Sprites --------------------------------------------------------------------------------------
let dotTex = null
let sparkTex = null
export const dotTexture = () => (dotTex ??= plainTex(paintSoftDot(64)))
export const sparkleTexture = () => (sparkTex ??= plainTex(paintSparkle(64)))
export function glowSprite(color, size, opacity = 0.8) {
  const s = new Sprite(new SpriteMaterial({ map: dotTexture(), color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, fog: false }))
  s.scale.set(size, size, 1)
  return s
}
// Flat glowing disc on the ground (pads, the van's door).
export function groundDecal(map, color, size, opacity = 0.9) {
  const m = new Mesh(new PlaneGeometry(size, size), new MeshBasicMaterial({ map, color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, fog: false }))
  m.rotation.x = -Math.PI / 2
  m.renderOrder = 2
  return m
}

// --- Info labels ----------------------------------------------------------------------------------
// lines: [{ text, color, size (px at 1x), outline, weight }]. Returns a Sprite whose .setLines(lines)
// repaints it. worldPerPx sets the scale (metres per canvas pixel).
export const FONT = 'Fredoka, "Arial Black", sans-serif'
function paintLines(c, lines, pad = 10) {
  const ctx = c.getContext('2d')
  let w = 0
  let h = 0
  for (const l of lines) {
    ctx.font = `${l.weight ?? 700} ${l.size}px ${FONT}`
    w = Math.max(w, ctx.measureText(l.text).width)
    h += l.size * 1.12
  }
  const ow = Math.max(...lines.map((l) => l.size * 0.22))
  const cw = Math.ceil(w + pad * 2 + ow * 2)
  const ch = Math.ceil(h + pad * 2)
  if (c.width !== cw || c.height !== ch) {
    c.width = cw
    c.height = ch
  } else ctx.clearRect(0, 0, cw, ch)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  let y = pad
  for (const l of lines) {
    ctx.font = `${l.weight ?? 700} ${l.size}px ${FONT}`
    const cy = y + l.size * 0.56
    ctx.lineWidth = l.size * 0.22
    ctx.strokeStyle = l.outline ?? '#0d0a1f'
    ctx.strokeText(l.text, cw / 2, cy)
    ctx.fillStyle = l.color ?? '#ffffff'
    ctx.fillText(l.text, cw / 2, cy)
    y += l.size * 1.12
  }
}
export function infoLabel(lines, worldPerPx = 0.012, { depthTest = true, renderOrder = 5 } = {}) {
  const c = document.createElement('canvas')
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  const sprite = new Sprite(new SpriteMaterial({ map: t, transparent: true, depthWrite: false, depthTest, fog: false }))
  sprite.renderOrder = renderOrder
  sprite.center.set(0.5, 0)
  let current = lines
  let key = ''
  sprite.setLines = (next) => {
    const k = JSON.stringify(next)
    if (k === key) return
    key = k
    current = next
    const w0 = c.width
    const h0 = c.height
    paintLines(c, next)
    if (w0 !== c.width || h0 !== c.height) t.dispose()
    t.needsUpdate = true
    sprite.scale.set(c.width * worldPerPx, c.height * worldPerPx, 1)
  }
  sprite.setLines(lines)
  fontReady.then(() => {
    key = ''
    sprite.setLines(current)
  })
  sprite.dispose = () => {
    t.dispose()
    sprite.material.dispose()
  }
  return sprite
}

// A canvas-painted sign on a plane. draw(ctx, w, h) paints it; returns { mesh, redraw, setDraw }.
export function canvasSign(w, h, pxW, pxH, draw, { emissiveBoost = 0.35, doubleSided = false, transparent = false } = {}) {
  const c = document.createElement('canvas')
  c.width = pxW
  c.height = pxH
  const t = plainTex(c)
  const mat = new MeshStandardMaterial({ map: t, emissiveMap: t, emissive: new Color('#ffffff'), emissiveIntensity: emissiveBoost, roughness: 0.6, transparent })
  if (doubleSided) mat.side = DoubleSide
  const mesh = new Mesh(new PlaneGeometry(w, h), mat)
  let painter = draw
  const redraw = () => {
    const ctx = c.getContext('2d')
    ctx.clearRect(0, 0, pxW, pxH)
    painter(ctx, pxW, pxH)
    t.needsUpdate = true
  }
  redraw()
  fontReady.then(redraw)
  return {
    mesh,
    redraw,
    setDraw(fn) {
      painter = fn
      redraw()
    },
  }
}

// Rounded-rect path helper for canvas painters.
export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
export function outlinedText(ctx, text, x, y, px, fill = '#fff', stroke = '#120a2a', weight = 700) {
  ctx.font = `${weight} ${px}px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.lineJoin = 'round'
  ctx.lineWidth = px * 0.2
  ctx.strokeStyle = stroke
  ctx.strokeText(text, x, y)
  ctx.fillStyle = fill
  ctx.fillText(text, x, y)
}

// --- Money formatting ------------------------------------------------------------------------------
const SUFFIX = ['', 'K', 'M', 'B', 'T']
export function fmt(n, digits = 2) {
  if (!Number.isFinite(n)) return '0'
  const neg = n < 0
  n = Math.abs(n)
  if (n < 10000) return (neg ? '-' : '') + Math.floor(n).toLocaleString('en-US')
  let i = 0
  while (n >= 1000 && i < SUFFIX.length - 1) {
    n /= 1000
    i++
  }
  const s = n >= 100 ? n.toFixed(Math.max(0, digits - 2)) : n >= 10 ? n.toFixed(Math.max(0, digits - 1)) : n.toFixed(digits)
  return (neg ? '-' : '') + parseFloat(s).toString() + SUFFIX[i]
}
export const money = (n) => `$${fmt(n)}`
export const commas = (n) => `$${Math.floor(n).toLocaleString('en-US')}`

// Seeded random helpers for level dressing.
export function rng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  next.range = (lo, hi) => lo + next() * (hi - lo)
  next.pick = (arr) => arr[Math.floor(next() * arr.length)]
  next.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }
  return next
}
