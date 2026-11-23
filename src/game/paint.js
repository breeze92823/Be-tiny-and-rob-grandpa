// Canvas painters for the house and the hideout: tileable surfaces (floors, walls, roof, lawn,
// fabrics) plus a matching grey "bump" canvas for each, so MeshStandardMaterial gets depth without
// normal-map maths. Every painter is cached by its arguments and returns { color, bump }.
import { mulberry32 } from '../textures.js'

const cache = new Map()
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make())
  return cache.get(key)
}
function canvas(w, h = w) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}
const hex = (h) => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const rgb = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`
export function shade(h, k) {
  const [r, g, b] = hex(h)
  return k >= 0 ? rgb(r + (255 - r) * k, g + (255 - g) * k, b + (255 - b) * k) : rgb(r * (1 + k), g * (1 + k), b * (1 + k))
}
// Grain noise sprinkled over a canvas (alpha speckles).
function speckle(ctx, w, h, rand, n, alpha, dark = true) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = dark ? `rgba(0,0,0,${alpha * rand()})` : `rgba(255,255,255,${alpha * rand()})`
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2)
  }
}

// --- Wood floor: planks with grain, staggered seams ---------------------------------------------
export function paintWoodFloor(base = '#b9824f', planks = 6, seed = 3) {
  return cached(`wood:${base}:${planks}:${seed}`, () => {
    const S = 512
    const color = canvas(S)
    const bump = canvas(S)
    const c = color.getContext('2d')
    const b = bump.getContext('2d')
    const rand = mulberry32(seed)
    const ph = S / planks
    b.fillStyle = '#808080'
    b.fillRect(0, 0, S, S)
    for (let row = 0; row < planks; row++) {
      const y = row * ph
      let x = -rand() * S * 0.5
      while (x < S) {
        const len = S * (0.45 + rand() * 0.5)
        const k = (rand() - 0.5) * 0.22
        c.fillStyle = shade(base, k)
        c.fillRect(x, y, len, ph)
        // grain lines
        for (let g = 0; g < 9; g++) {
          const gy = y + rand() * ph
          c.strokeStyle = `rgba(60,30,10,${0.06 + rand() * 0.1})`
          c.lineWidth = 0.6 + rand() * 1.4
          c.beginPath()
          c.moveTo(x, gy)
          for (let sx = 0; sx <= len; sx += 24) c.lineTo(x + sx, gy + Math.sin((sx + seed * 7) * 0.02 + g) * 2.5)
          c.stroke()
        }
        // a knot now and then
        if (rand() < 0.3) {
          const kx = x + rand() * len
          const ky = y + ph * (0.3 + rand() * 0.4)
          c.fillStyle = 'rgba(70,35,12,0.35)'
          c.beginPath()
          c.ellipse(kx, ky, 5 + rand() * 6, 2.5 + rand() * 2, 0, 0, Math.PI * 2)
          c.fill()
        }
        // seams
        c.fillStyle = 'rgba(40,20,8,0.55)'
        c.fillRect(x, y, 2, ph)
        b.fillStyle = '#3a3a3a'
        b.fillRect(x, y, 2, ph)
        x += len
      }
      c.fillStyle = 'rgba(40,20,8,0.6)'
      c.fillRect(0, y, S, 2)
      b.fillStyle = '#303030'
      b.fillRect(0, y, S, 2)
    }
    speckle(c, S, S, rand, 1800, 0.08)
    return { color, bump }
  })
}

// --- Tiles: square tiles with grout (checker optional) ---------------------------------------------
export function paintTiles(a = '#f4f1ea', bCol = '#dfe9ef', n = 4, grout = '#b8b2a6', seed = 5) {
  return cached(`tiles:${a}:${bCol}:${n}:${grout}`, () => {
    const S = 256
    const color = canvas(S)
    const bump = canvas(S)
    const c = color.getContext('2d')
    const b = bump.getContext('2d')
    const rand = mulberry32(seed)
    const t = S / n
    c.fillStyle = grout
    c.fillRect(0, 0, S, S)
    b.fillStyle = '#404040'
    b.fillRect(0, 0, S, S)
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const base = (i + j) % 2 ? bCol : a
        const g = c.createLinearGradient(i * t, j * t, i * t + t, j * t + t)
        g.addColorStop(0, shade(base, 0.06))
        g.addColorStop(1, shade(base, -0.05 + (rand() - 0.5) * 0.04))
        c.fillStyle = g
        c.fillRect(i * t + 2, j * t + 2, t - 4, t - 4)
        b.fillStyle = '#9a9a9a'
        b.fillRect(i * t + 3, j * t + 3, t - 6, t - 6)
        c.fillStyle = 'rgba(255,255,255,0.18)'
        c.fillRect(i * t + 4, j * t + 4, t * 0.5, 3)
      }
    speckle(c, S, S, rand, 400, 0.05)
    return { color, bump }
  })
}

// --- Carpet: soft fuzzy noise with a faint border-free pattern --------------------------------------
export function paintCarpet(base = '#8a5a8f', seed = 7) {
  return cached(`carpet:${base}`, () => {
    const S = 256
    const color = canvas(S)
    const bump = canvas(S)
    const c = color.getContext('2d')
    const b = bump.getContext('2d')
    const rand = mulberry32(seed)
    c.fillStyle = base
    c.fillRect(0, 0, S, S)
    b.fillStyle = '#808080'
    b.fillRect(0, 0, S, S)
    for (let i = 0; i < 9000; i++) {
      const x = rand() * S
      const y = rand() * S
      const k = (rand() - 0.5) * 0.35
      c.fillStyle = shade(base, k)
      c.fillRect(x, y, 1.5, 1.5)
      const v = 128 + k * 300
      b.fillStyle = rgb(v, v, v)
      b.fillRect(x, y, 1.5, 1.5)
    }
    return { color, bump }
  })
}

// --- Wallpaper: stripes / dots / damask-ish diamonds -------------------------------------------------
export function paintWallpaper(kind = 'stripes', base = '#f1e3c4', accent = '#e5cf9f', seed = 9) {
  return cached(`wp:${kind}:${base}:${accent}`, () => {
    const S = 256
    const color = canvas(S)
    const bump = canvas(S)
    const c = color.getContext('2d')
    const b = bump.getContext('2d')
    const rand = mulberry32(seed)
    c.fillStyle = base
    c.fillRect(0, 0, S, S)
    b.fillStyle = '#808080'
    b.fillRect(0, 0, S, S)
    c.fillStyle = accent
    if (kind === 'stripes') {
      for (let x = 0; x < S; x += 32) {
        c.fillRect(x, 0, 12, S)
        c.fillStyle = shade(accent, -0.1)
        c.fillRect(x + 16, 0, 3, S)
        c.fillStyle = accent
      }
    } else if (kind === 'dots') {
      for (let y = 0; y < S; y += 32)
        for (let x = (y / 32) % 2 ? 16 : 0; x < S + 16; x += 32) {
          c.beginPath()
          c.arc(x, y + 16, 5, 0, Math.PI * 2)
          c.fill()
        }
    } else if (kind === 'diamond') {
      c.lineWidth = 2
      c.strokeStyle = accent
      for (let y = -32; y < S + 32; y += 64)
        for (let x = -32; x < S + 32; x += 64) {
          c.beginPath()
          c.moveTo(x + 32, y)
          c.lineTo(x + 64, y + 32)
          c.lineTo(x + 32, y + 64)
          c.lineTo(x, y + 32)
          c.closePath()
          c.stroke()
          c.beginPath()
          c.arc(x + 32, y + 32, 7, 0, Math.PI * 2)
          c.fill()
          // little leaves
          for (let a = 0; a < 4; a++) {
            c.save()
            c.translate(x + 32, y + 32)
            c.rotate((a * Math.PI) / 2)
            c.beginPath()
            c.ellipse(0, -13, 3, 6, 0, 0, Math.PI * 2)
            c.fill()
            c.restore()
          }
        }
    } else if (kind === 'floral') {
      for (let i = 0; i < 26; i++) {
        const x = rand() * S
        const y = rand() * S
        for (const [dx, dy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
          c.fillStyle = accent
          for (let p = 0; p < 5; p++) {
            const a = (p / 5) * Math.PI * 2
            c.beginPath()
            c.arc(x + dx + Math.cos(a) * 5, y + dy + Math.sin(a) * 5, 4, 0, Math.PI * 2)
            c.fill()
          }
          c.fillStyle = shade(accent, -0.25)
          c.beginPath()
          c.arc(x + dx, y + dy, 2.5, 0, Math.PI * 2)
          c.fill()
        }
      }
    }
    speckle(c, S, S, rand, 500, 0.05)
    return { color, bump }
  })
}

// --- Exterior: clapboard siding, brick, roof shingles, concrete, lawn ---------------------------------
export function paintSiding(base = '#f2e6cf', seed = 11) {
  return cached(`siding:${base}`, () => {
    const S = 256
    const color = canvas(S)
    const bump = canvas(S)
    const c = color.getContext('2d')
    const b = bump.getContext('2d')
    const rand = mulberry32(seed)
    const n = 8
    const h = S / n
    for (let i = 0; i < n; i++) {
      const g = c.createLinearGradient(0, i * h, 0, i * h + h)
      g.addColorStop(0, shade(base, -0.12))
      g.addColorStop(0.15, shade(base, 0.04))
      g.addColorStop(1, shade(base, -0.02))
      c.fillStyle = g
      c.fillRect(0, i * h, S, h)
      const gb = b.createLinearGradient(0, i * h, 0, i * h + h)
      gb.addColorStop(0, '#303030')
      gb.addColorStop(0.2, '#c0c0c0')
      gb.addColorStop(1, '#808080')
      b.fillStyle = gb
      b.fillRect(0, i * h, S, h)
    }
    speckle(c, S, S, rand, 700, 0.06)
    return { color, bump }
  })
}
export function paintBrick(base = '#b5533c', mortar = '#d8cbb5', seed = 13) {
  return cached(`brick:${base}`, () => {
    const S = 256
    const color = canvas(S)
    const bump = canvas(S)
    const c = color.getContext('2d')
    const b = bump.getContext('2d')
    const rand = mulberry32(seed)
    c.fillStyle = mortar
    c.fillRect(0, 0, S, S)
    b.fillStyle = '#303030'
    b.fillRect(0, 0, S, S)
    const rows = 8
    const h = S / rows
    const w = S / 4
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? w / 2 : 0
      for (let x = -w; x < S + w; x += w) {
        c.fillStyle = shade(base, (rand() - 0.5) * 0.28)
        c.fillRect(x + off + 2, r * h + 2, w - 4, h - 4)
        b.fillStyle = '#a0a0a0'
        b.fillRect(x + off + 3, r * h + 3, w - 6, h - 6)
      }
    }
    speckle(c, S, S, rand, 900, 0.12)
    return { color, bump }
  })
}
export function paintShingles(base = '#8f3b3b', seed = 17) {
  return cached(`shingle:${base}`, () => {
    const S = 256
    const color = canvas(S)
    const bump = canvas(S)
    const c = color.getContext('2d')
    const b = bump.getContext('2d')
    const rand = mulberry32(seed)
    const rows = 8
    const h = S / rows
    const w = S / 6
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? w / 2 : 0
      for (let x = -w; x < S + w; x += w) {
        const g = c.createLinearGradient(0, r * h, 0, r * h + h)
        const k = (rand() - 0.5) * 0.25
        g.addColorStop(0, shade(base, k - 0.15))
        g.addColorStop(1, shade(base, k + 0.05))
        c.fillStyle = g
        c.beginPath()
        c.moveTo(x + off + 1, r * h)
        c.lineTo(x + off + w - 1, r * h)
        c.lineTo(x + off + w - 1, r * h + h - 3)
        c.quadraticCurveTo(x + off + w / 2, r * h + h + 3, x + off + 1, r * h + h - 3)
        c.closePath()
        c.fill()
        const gb = b.createLinearGradient(0, r * h, 0, r * h + h)
        gb.addColorStop(0, '#404040')
        gb.addColorStop(1, '#c8c8c8')
        b.fillStyle = gb
        b.fillRect(x + off + 1, r * h, w - 2, h)
      }
    }
    speckle(c, S, S, rand, 900, 0.1)
    return { color, bump }
  })
}
export function paintConcrete(base = '#b9b5ad', joints = true, seed = 19) {
  return cached(`concrete:${base}:${joints}`, () => {
    const S = 256
    const color = canvas(S)
    const bump = canvas(S)
    const c = color.getContext('2d')
    const b = bump.getContext('2d')
    const rand = mulberry32(seed)
    c.fillStyle = base
    c.fillRect(0, 0, S, S)
    b.fillStyle = '#808080'
    b.fillRect(0, 0, S, S)
    for (let i = 0; i < 260; i++) {
      c.fillStyle = `rgba(${rand() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + rand() * 0.05})`
      c.beginPath()
      c.arc(rand() * S, rand() * S, 4 + rand() * 18, 0, Math.PI * 2)
      c.fill()
    }
    speckle(c, S, S, rand, 2400, 0.12)
    if (joints) {
      c.fillStyle = 'rgba(60,55,50,0.45)'
      c.fillRect(0, 0, S, 2)
      c.fillRect(0, 0, 2, S)
      b.fillStyle = '#303030'
      b.fillRect(0, 0, S, 2)
      b.fillRect(0, 0, 2, S)
    }
    return { color, bump }
  })
}
export function paintLawn(seed = 23) {
  return cached('lawn', () => {
    const S = 512
    const color = canvas(S)
    const bump = canvas(S)
    const c = color.getContext('2d')
    const b = bump.getContext('2d')
    const rand = mulberry32(seed)
    c.fillStyle = '#5aa53c'
    c.fillRect(0, 0, S, S)
    b.fillStyle = '#808080'
    b.fillRect(0, 0, S, S)
    // mowing stripes
    for (let x = 0; x < S; x += 128) {
      c.fillStyle = 'rgba(255,255,160,0.05)'
      c.fillRect(x, 0, 64, S)
    }
    for (let i = 0; i < 16000; i++) {
      const x = rand() * S
      const y = rand() * S
      const g = 120 + rand() * 90
      c.strokeStyle = `rgba(${40 + rand() * 50},${g},${30 + rand() * 30},0.55)`
      c.lineWidth = 1
      c.beginPath()
      c.moveTo(x, y)
      c.lineTo(x + (rand() - 0.5) * 3, y - 3 - rand() * 4)
      c.stroke()
      const v = 90 + rand() * 120
      b.fillStyle = rgb(v, v, v)
      b.fillRect(x, y, 1, 2)
    }
    // clover + tiny flowers
    for (let i = 0; i < 40; i++) {
      c.fillStyle = rand() < 0.5 ? 'rgba(255,255,255,0.8)' : 'rgba(255,230,90,0.8)'
      c.beginPath()
      c.arc(rand() * S, rand() * S, 1.6, 0, Math.PI * 2)
      c.fill()
    }
    return { color, bump }
  })
}

// --- Furniture surfaces ---------------------------------------------------------------------------
export function paintWoodGrain(base = '#8a5a34', seed = 29) {
  return cached(`grain:${base}`, () => {
    const S = 256
    const color = canvas(S)
    const c = color.getContext('2d')
    const rand = mulberry32(seed)
    c.fillStyle = base
    c.fillRect(0, 0, S, S)
    for (let g = 0; g < 46; g++) {
      const y = rand() * S
      c.strokeStyle = `rgba(${rand() < 0.5 ? '50,25,8' : '255,220,170'},${0.05 + rand() * 0.1})`
      c.lineWidth = 0.8 + rand() * 2.2
      c.beginPath()
      c.moveTo(0, y)
      for (let x = 0; x <= S; x += 16) c.lineTo(x, y + Math.sin(x * 0.03 + g) * 3 + Math.sin(x * 0.011 + g * 2) * 4)
      c.stroke()
    }
    speckle(c, S, S, rand, 600, 0.08)
    return { color, bump: color }
  })
}
// Fabric: 'plaid' | 'knit' | 'weave' | 'velvet'
export function paintFabric(kind = 'weave', base = '#7d3f3f', accent = '#d9b26b', seed = 31) {
  return cached(`fabric:${kind}:${base}:${accent}`, () => {
    const S = 256
    const color = canvas(S)
    const bump = canvas(S)
    const c = color.getContext('2d')
    const b = bump.getContext('2d')
    const rand = mulberry32(seed)
    c.fillStyle = base
    c.fillRect(0, 0, S, S)
    b.fillStyle = '#808080'
    b.fillRect(0, 0, S, S)
    if (kind === 'plaid') {
      const bands = [[0, 40, shade(base, -0.3), 0.6], [64, 10, accent, 0.55], [100, 26, shade(base, 0.25), 0.4], [170, 6, '#ffffff', 0.35], [200, 34, shade(base, -0.3), 0.6]]
      for (const [o, w, col, a] of bands) {
        c.globalAlpha = a
        c.fillStyle = col
        c.fillRect(o, 0, w, S)
        c.fillRect(0, o, S, w)
      }
      c.globalAlpha = 1
    } else if (kind === 'knit') {
      const w = 16
      const h = 12
      for (let y = 0; y < S; y += h)
        for (let x = 0; x < S; x += w) {
          for (const side of [-1, 1]) {
            c.fillStyle = shade(base, 0.12 + (rand() - 0.5) * 0.08)
            c.beginPath()
            c.ellipse(x + w / 2 + side * 3.5, y + h / 2, 3.6, 6.5, side * 0.55, 0, Math.PI * 2)
            c.fill()
            b.fillStyle = '#c0c0c0'
            b.beginPath()
            b.ellipse(x + w / 2 + side * 3.5, y + h / 2, 3.6, 6.5, side * 0.55, 0, Math.PI * 2)
            b.fill()
          }
        }
      // a cable band of accent colour
      c.globalAlpha = 0.85
      c.fillStyle = accent
      c.fillRect(0, S * 0.45, S, 14)
      c.globalAlpha = 1
    } else if (kind === 'velvet') {
      const g = c.createLinearGradient(0, 0, S, S)
      g.addColorStop(0, shade(base, 0.1))
      g.addColorStop(1, shade(base, -0.15))
      c.fillStyle = g
      c.fillRect(0, 0, S, S)
    }
    // weave threads (all kinds)
    for (let y = 0; y < S; y += 3) {
      c.fillStyle = `rgba(0,0,0,${0.03 + rand() * 0.04})`
      c.fillRect(0, y, S, 1)
    }
    for (let x = 0; x < S; x += 3) {
      c.fillStyle = `rgba(255,255,255,${0.02 + rand() * 0.03})`
      c.fillRect(x, 0, 1, S)
    }
    return { color, bump }
  })
}
// A patterned rug: border bands + a central medallion, not tileable (one per rug).
export function paintRug(base = '#9c2f2f', accent = '#e9c46a', edge = '#2f3e6b', seed = 37) {
  return cached(`rug:${base}:${accent}:${edge}`, () => {
    const W = 512
    const H = 340
    const color = canvas(W, H)
    const c = color.getContext('2d')
    const rand = mulberry32(seed)
    c.fillStyle = edge
    c.fillRect(0, 0, W, H)
    c.fillStyle = accent
    c.fillRect(14, 14, W - 28, H - 28)
    c.fillStyle = base
    c.fillRect(26, 26, W - 52, H - 52)
    // border motifs
    c.fillStyle = edge
    for (let x = 40; x < W - 40; x += 26) {
      c.beginPath()
      c.arc(x, 20, 4, 0, Math.PI * 2)
      c.arc(x, H - 20, 4, 0, Math.PI * 2)
      c.fill()
    }
    // medallion
    c.save()
    c.translate(W / 2, H / 2)
    for (let r = 120; r > 10; r -= 22) {
      c.fillStyle = r % 44 ? accent : edge
      c.beginPath()
      for (let a = 0; a < 16; a++) {
        const ang = (a / 16) * Math.PI * 2
        const rr = r * (a % 2 ? 0.72 : 1)
        c.lineTo(Math.cos(ang) * rr * 1.4, Math.sin(ang) * rr * 0.9)
      }
      c.closePath()
      c.fill()
    }
    c.restore()
    speckle(c, W, H, rand, 4000, 0.1)
    return { color, bump: color }
  })
}
