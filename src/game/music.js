// Adaptive background music for Tiny Thieves: an original score synthesised live (no files) on the
// shared WebAudio context of sfx.js. Two 8-bar songs, each arranged in layers:
//   home  (F major, I-vi-ii-V turnaround):  lobby   - bouncy walking pizzicato, marimba tune, snaps, shaker
//                                           results - the same tune as a happy victory groove (funky
//                                                     bass, claps, glockenspiel, brass hits)
//   heist (D minor, Dm Dm Gm A7 Dm Bb Eb A7): sneak  - tiptoe pizzicato bass, soft brushes, celesta motif
//                                           suspicious - adds bowed strings with a creeping top line,
//                                                     a ticking low pulse and soft timpani
//                                           chase   - fast: bass runs, snare kit, brass stabs, xylophone
//                                           held    - slow wobbly tuba suspense over a ticking clock
// Inside a song, moods only move layer weights + tempo, which glide step by step: the score turns
// without restarting. Switching songs fades one out and starts the other on a fresh bar. Stingers
// play on their own bus over a short duck. A look-ahead scheduler (frame) books notes ~0.25 s ahead
// on ctx.currentTime. Levels / tempi / weights: MUSIC in audioConfig.js.
import { MUSIC } from './audioConfig.js'
import { audioCore } from './sfx.js'

const MOODS = ['lobby', 'sneak', 'suspicious', 'chase', 'held', 'results', 'off']
const GROUP_OF = { lobby: 'home', results: 'home', sneak: 'heist', suspicious: 'heist', chase: 'heist', held: 'heist' }
export const MUSIC_MOODS = Object.freeze(MOODS.slice())
export const MUSIC_STINGERS = Object.freeze(['start', 'spotted', 'lost', 'caught', 'escape', 'job'])

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12)

// --- The tunes ----------------------------------------------------------------------------------------
// Patterns are lists per bar of [16th step, midi, length in 16ths]; dense() unrolls them into
// 128-step tables (looked up per step, no allocation while playing).
function dense(bars) {
  const a = new Array(128).fill(null)
  bars.forEach((notes, b) => {
    for (const n of notes) a[b * 16 + n[0]] = [n[1], n[2] ?? 1]
  })
  return a
}
const near = (from, to) => {
  let d = to - from
  while (d > 6) d -= 12
  while (d < -6) d += 12
  return d
}
// heist: D minor
const H_ROOT = [38, 38, 43, 45, 38, 46, 39, 45]
const H_MINOR = [1, 1, 1, 0, 1, 0, 0, 0]
const H_PAD = [[62, 65, 69], [62, 65, 69], [62, 67, 70], [61, 64, 67], [62, 65, 69], [62, 65, 70], [63, 67, 70], [61, 64, 67]]
const H_PAD_LOW = H_PAD.map((c) => c.map((m) => m - 12))
const H_CREEP = [[81, 82], [81, 82], [82, 81], [80, 81], [81, 82], [81, 82], [82, 80], [80, 81]]
const H_PIZZ = dense([
  [[0, 38], [4, 45], [8, 41], [12, 45]],
  [[0, 38], [4, 45], [8, 41], [10, 42], [12, 43]],
  [[0, 43], [4, 50], [8, 46], [12, 50]],
  [[0, 45], [4, 52], [8, 49], [12, 47], [14, 49]],
  [[0, 38], [4, 45], [8, 41], [12, 45]],
  [[0, 46], [4, 41], [8, 46], [12, 44]],
  [[0, 39], [4, 46], [8, 43], [12, 46]],
  [[0, 45], [4, 43], [8, 40], [12, 37]],
])
const H_CEL = dense([
  [[8, 69], [10, 70], [12, 69], [14, 65]],
  [[0, 62], [8, 64], [12, 65]],
  [[8, 70], [10, 72], [12, 70], [14, 67]],
  [[0, 69], [6, 73], [8, 76]],
  [[8, 69], [10, 70], [12, 69], [14, 65]],
  [[0, 62], [8, 65], [12, 70]],
  [[0, 67], [4, 70], [8, 75], [12, 74]],
  [[0, 73], [8, 69], [12, 64], [14, 61]],
])
// chase bass runs: up the chord, back down, a chromatic step into the next root (8ths)
const H_RUN = dense(
  H_ROOT.map((r, b) => {
    const third = H_MINOR[b] ? 3 : 4
    const d = near(r, H_ROOT[(b + 1) % 8])
    const appr = d >= 0 ? d - 1 : d + 1
    return [0, third, 7, 12, 10, 7, third, appr].map((x, i) => [i * 2, r + x])
  }),
)
// chase xylophone: a broken-chord run in the second half of every other bar (up, then down)
const H_XYLO = dense(
  H_PAD.map((c, b) => {
    if (!(b & 1)) return []
    const up = [c[0], c[1], c[2], c[0] + 12, c[1] + 12, c[2] + 12, c[0] + 24, c[1] + 24].map((m) => m + 12)
    const seq = b & 2 ? up.reverse() : up
    return seq.map((m, i) => [8 + i, m])
  }),
)
// held: an oom-pah tuba, root / root / fifth / step toward the next bar
const H_TUBA = dense(
  H_ROOT.map((r, b) => {
    const fifth = r + 7 > 47 ? r - 5 : r + 7
    const d = near(r, H_ROOT[(b + 1) % 8])
    return [[0, r, 3], [6, r, 1], [8, fifth, 3], [12, r + (d >= 0 ? d - 2 : d + 2), 2]]
  }),
)
// home: F major
const F_ROOT = [41, 38, 43, 36, 45, 38, 43, 36]
const F_THIRD = [4, 3, 3, 4, 3, 4, 3, 4]
const F_COMP = [[69, 72, 76], [65, 69, 72], [65, 70, 74], [64, 67, 70], [64, 67, 72], [66, 69, 72], [65, 70, 74], [64, 67, 70]]
const F_MEL = dense([
  [[0, 72], [4, 69], [6, 72], [10, 74], [12, 72]],
  [[0, 69], [2, 65], [4, 62], [8, 65], [10, 69], [12, 72]],
  [[0, 74], [4, 70], [6, 74], [10, 77], [12, 74]],
  [[0, 72], [2, 70], [4, 67], [8, 64], [12, 67], [14, 70]],
  [[0, 69], [4, 72], [6, 76], [10, 79], [12, 76]],
  [[0, 78], [4, 74], [6, 72], [8, 69], [12, 66]],
  [[0, 67], [2, 70], [4, 74], [6, 77], [8, 79], [12, 77], [14, 74]],
  [[0, 76], [4, 72], [8, 70], [10, 67], [12, 64]],
])
const F_WALK = dense(
  F_ROOT.map((r, b) => {
    const d = near(r, F_ROOT[(b + 1) % 8])
    return [[0, r], [4, r + F_THIRD[b]], [8, r + 7], [12, r + d + (b & 1 ? 1 : -1)]]
  }),
)
const F_FUNK = dense(F_ROOT.map((r) => [[0, r], [3, r + 12], [6, r], [8, r + 7], [10, r + 12], [11, r + 10], [14, r + 7]]))

// --- State --------------------------------------------------------------------------------------------
let A = null // { ctx, out, duck, sting, noise, nyq }
let enabled = true
let musicScale = 1 // the portal's music_volume setting (0..1) on top of master_volume
let target = 'off'
let stingAt = -10
function makeGroup(name, play) {
  return { name, play, out: null, active: false, stopAt: 0, step: 0, nextT: 0, bpm: 100, mood: null, want: null, w: {} }
}
const groups = { home: makeGroup('home', playHome), heist: makeGroup('heist', playHeist) }
const groupList = [groups.home, groups.heist]

function init() {
  const core = audioCore()
  if (!core) return null
  const { ctx } = core
  const out = ctx.createGain()
  out.gain.value = enabled ? MUSIC.level * musicScale : 0
  out.connect(core.master)
  const send = ctx.createGain()
  send.gain.value = MUSIC.reverb
  out.connect(send)
  send.connect(core.verb)
  const duck = ctx.createGain()
  duck.gain.value = 1
  duck.connect(out)
  const sting = ctx.createGain()
  sting.gain.value = MUSIC.stingLevel / MUSIC.level
  sting.connect(out)
  A = { ctx, out, duck, sting, noise: core.noise, nyq: ctx.sampleRate * 0.45 }
  for (const G of groupList) {
    G.out = ctx.createGain()
    G.out.gain.value = 0
    G.out.connect(duck)
    for (const m of MOODS) if (GROUP_OF[m] === G.name) for (const k in MUSIC.moods[m]) G.w[k] = 0
  }
  applyMood()
  return A
}
function fade(param, v, secs) {
  const t = A.ctx.currentTime
  param.cancelScheduledValues(t)
  param.setTargetAtTime(v, t, Math.max(0.01, secs / 3))
}
function applyMood() {
  const now = A.ctx.currentTime
  const gname = GROUP_OF[target]
  let otherPlaying = false
  for (const G of groupList) {
    if (G.name === gname || !G.active) continue
    if (!G.stopAt) {
      fade(G.out.gain, 0, MUSIC.fadeOut)
      G.stopAt = now + MUSIC.fadeOut * 1.2
    }
    otherPlaying = true
  }
  if (!gname) return // 'off'
  const G = groups[gname]
  G.want = target
  if (!G.active) {
    // a fresh start: on the first bar, already at the mood's mix and tempo
    const M = MUSIC.moods[target]
    G.active = true
    G.step = 0
    G.nextT = now + (otherPlaying ? MUSIC.gap : 0.08)
    G.mood = target
    for (const k in G.w) G.w[k] = M[k] ?? 0
    G.bpm = M.bpm
    G.w.swing = M.swing
    G.stopAt = 0
    G.out.gain.cancelScheduledValues(now)
    G.out.gain.setValueAtTime(0, now)
    G.out.gain.setTargetAtTime(1, G.nextT, MUSIC.fadeIn / 3)
  } else if (G.stopAt) {
    // it was fading out: carry on where it is and fade back in
    G.stopAt = 0
    fade(G.out.gain, 1, MUSIC.fadeIn * 0.5)
  }
}

// --- Instruments ------------------------------------------------------------------------------------
function osc(type, f, t, end, det = 0) {
  const x = A.ctx.createOscillator()
  x.type = type
  x.frequency.value = Math.min(f, A.nyq)
  if (det) x.detune.value = det
  x.start(t)
  x.stop(end)
  return x
}
function gn(v = 0) {
  const g = A.ctx.createGain()
  g.gain.value = v
  return g
}
function filt(type, f, q = 0.7) {
  const b = A.ctx.createBiquadFilter()
  b.type = type
  b.frequency.value = Math.min(f, A.nyq)
  b.Q.value = q
  return b
}
function hitEnv(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a)
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d)
}
function holdEnv(g, t, a, peak, len, r) {
  const h = t + Math.max(a, len)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(Math.max(0.0002, peak), t + a)
  g.gain.setValueAtTime(Math.max(0.0002, peak), h)
  g.gain.exponentialRampToValueAtTime(0.0001, h + r)
}
function nz(o, t, d, type, f, q, peak, a = 0.001) {
  const s = A.ctx.createBufferSource()
  s.buffer = A.noise
  s.loop = true
  const b = filt(type, f, q)
  const g = gn()
  hitEnv(g, t, a, peak, d)
  s.connect(b)
  b.connect(g)
  g.connect(o)
  s.start(t, Math.random() * 2)
  s.stop(t + a + d + 0.05)
}
// pizzicato string: a plucked triangle + a little saw bite through a closing lowpass
function pizz(o, t, m, vel) {
  const f = mtof(m)
  const d = Math.min(0.55, Math.max(0.16, 0.3 + (50 - m) * 0.012))
  const end = t + d + 0.05
  const lp = filt('lowpass', f * 8, 1.5)
  lp.frequency.setValueAtTime(Math.min(A.nyq, f * 8), t)
  lp.frequency.exponentialRampToValueAtTime(f * 2, t + 0.08)
  const g = gn()
  hitEnv(g, t, 0.003, 0.34 * vel, d)
  const o1 = osc('triangle', f, t, end)
  o1.frequency.setValueAtTime(f * 1.012, t)
  o1.frequency.exponentialRampToValueAtTime(f, t + 0.03)
  o1.connect(lp)
  const bite = gn(0.22)
  osc('sawtooth', f, t, end).connect(bite)
  bite.connect(lp)
  lp.connect(g)
  g.connect(o)
  nz(o, t, 0.012, 'bandpass', Math.min(f * 6, 5000), 1.2, 0.05 * vel)
}
// marimba: fundamental + the bar's 4th-ish partial, a soft mallet
function marimba(o, t, m, vel) {
  const f = mtof(m)
  const d = Math.min(0.8, Math.max(0.25, 0.9 - (m - 60) * 0.02))
  const g = gn()
  hitEnv(g, t, 0.002, 0.22 * vel, d)
  osc('sine', f, t, t + d + 0.05).connect(g)
  const p = gn()
  hitEnv(p, t, 0.001, 0.07 * vel, 0.05)
  osc('sine', f * 3.93, t, t + 0.1).connect(p)
  p.connect(g)
  g.connect(o)
  nz(o, t, 0.006, 'bandpass', Math.min(f * 3, 6000), 1, 0.03 * vel)
}
function xylo(o, t, m, vel) {
  const f = mtof(m)
  const g = gn()
  hitEnv(g, t, 0.001, 0.13 * vel, 0.16)
  osc('sine', f, t, t + 0.2).connect(g)
  const p = gn()
  hitEnv(p, t, 0.001, 0.06 * vel, 0.04)
  osc('sine', f * 3.93, t, t + 0.08).connect(p)
  p.connect(g)
  g.connect(o)
  nz(o, t, 0.008, 'highpass', 3000, 0.7, 0.05 * vel)
}
function celesta(o, t, m, vel) {
  const f = mtof(m)
  const g = gn()
  hitEnv(g, t, 0.002, 0.11 * vel, 1.1)
  osc('sine', f, t, t + 1.2).connect(g)
  const h2 = gn()
  hitEnv(h2, t, 0.001, 0.035 * vel, 0.4)
  osc('sine', f * 2, t, t + 0.45).connect(h2)
  h2.connect(g)
  const h3 = gn()
  hitEnv(h3, t, 0.001, 0.015 * vel, 0.18)
  osc('sine', f * 3.01, t, t + 0.25).connect(h3)
  h3.connect(g)
  g.connect(o)
}
function glock(o, t, m, vel) {
  const f = mtof(m)
  const g = gn()
  hitEnv(g, t, 0.001, 0.1 * vel, 0.9)
  osc('sine', f, t, t + 1).connect(g)
  const p = gn()
  hitEnv(p, t, 0.001, 0.035 * vel, 0.2)
  osc('sine', f * 2.76, t, t + 0.25).connect(p)
  p.connect(g)
  const q = gn()
  hitEnv(q, t, 0.001, 0.015 * vel, 0.08)
  osc('sine', f * 5.4, t, t + 0.12).connect(q)
  q.connect(g)
  g.connect(o)
}
// picked bass: saw + sine through a plucky resonant lowpass (chase runs, the results groove)
function bassPick(o, t, m, len, vel) {
  const f = mtof(m)
  const end = t + len + 0.1
  const lp = filt('lowpass', 1400, 2.5)
  lp.frequency.setValueAtTime(1400, t)
  lp.frequency.exponentialRampToValueAtTime(380, t + 0.18)
  const g = gn()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.3 * vel, t + 0.005)
  g.gain.exponentialRampToValueAtTime(0.12 * vel, t + len * 0.85)
  g.gain.exponentialRampToValueAtTime(0.0001, end)
  osc('sawtooth', f, t, end).connect(lp)
  osc('sine', f, t, end).connect(lp)
  lp.connect(g)
  g.connect(o)
}
// comic tuba: saw + square, a breathy swell, a scoop up into the note and a wide wobble
function tuba(o, t, m, len, vel, slideTo = 0) {
  const f = mtof(m)
  const end = t + len + 0.2
  const lp = filt('lowpass', 350, 1.2)
  lp.frequency.setValueAtTime(350, t)
  lp.frequency.linearRampToValueAtTime(700, t + 0.06)
  lp.frequency.linearRampToValueAtTime(480, t + len)
  const g = gn()
  holdEnv(g, t, 0.04, 0.24 * vel, len, 0.12)
  const o1 = osc('sawtooth', f, t, end)
  const o2 = osc('square', f, t, end)
  const sq = gn(0.35)
  for (const x of [o1, o2]) {
    x.detune.setValueAtTime(-60, t)
    x.detune.linearRampToValueAtTime(0, t + 0.07)
    if (slideTo) x.frequency.exponentialRampToValueAtTime(mtof(slideTo), t + len)
  }
  const lfo = osc('sine', 4.6, t, end)
  const depth = gn(0)
  depth.gain.setValueAtTime(0, t + 0.08)
  depth.gain.linearRampToValueAtTime(32, t + Math.min(len, 0.5))
  lfo.connect(depth)
  depth.connect(o1.detune)
  depth.connect(o2.detune)
  o1.connect(lp)
  o2.connect(sq)
  sq.connect(lp)
  lp.connect(g)
  g.connect(o)
}
// string section: detuned saw pairs; bowed swell or tremolo
function strings(o, t, notes, len, vel, trem) {
  const end = t + len + 0.7
  const lp = filt('lowpass', trem ? 2600 : 1800, 0.8)
  const g = gn()
  holdEnv(g, t, trem ? 0.08 : 0.4, 0.03 * vel, len, 0.55)
  for (const m of notes) {
    const f = mtof(m)
    osc('sawtooth', f, t, end, -9).connect(lp)
    osc('sawtooth', f, t, end, 9).connect(lp)
  }
  if (trem) {
    const tg = gn(0.6)
    const lfo = osc('sine', 11, t, end)
    const lg = gn(0.4)
    lfo.connect(lg)
    lg.connect(tg.gain)
    lp.connect(tg)
    tg.connect(g)
  } else lp.connect(g)
  g.connect(o)
}
// short staccato low strings (the "ticking" pulse)
function pulse(o, t, m, len, vel) {
  const f = mtof(m)
  const end = t + len + 0.08
  const lp = filt('lowpass', 900, 1)
  const g = gn()
  holdEnv(g, t, 0.012, 0.09 * vel, len * 0.6, 0.05)
  osc('sawtooth', f, t, end, -6).connect(lp)
  osc('sawtooth', f, t, end, 6).connect(lp)
  lp.connect(g)
  g.connect(o)
}
// brass section stab on a chord
function stab(o, t, notes, len, vel) {
  const end = t + len + 0.2
  const lp = filt('lowpass', 500, 1.2)
  lp.frequency.setValueAtTime(500, t)
  lp.frequency.exponentialRampToValueAtTime(3200, t + 0.03)
  lp.frequency.exponentialRampToValueAtTime(1200, t + len)
  const g = gn()
  holdEnv(g, t, 0.015, 0.055 * vel, len, 0.1)
  for (const m of notes) {
    const f = mtof(m)
    osc('sawtooth', f, t, end, -8).connect(lp)
    osc('sawtooth', f, t, end, 8).connect(lp)
  }
  lp.connect(g)
  g.connect(o)
}
// drums & percussion
function kick(o, t, vel) {
  const x = osc('sine', 130, t, t + 0.4)
  x.frequency.exponentialRampToValueAtTime(44, t + 0.11)
  const g = gn()
  hitEnv(g, t, 0.002, 0.6 * vel, 0.3)
  x.connect(g)
  g.connect(o)
  nz(o, t, 0.01, 'highpass', 3000, 0.7, 0.06 * vel)
}
function snare(o, t, vel) {
  nz(o, t, 0.14, 'highpass', 1700, 0.7, 0.26 * vel)
  nz(o, t, 0.07, 'bandpass', 4200, 1, 0.1 * vel)
  const x = osc('triangle', 210, t, t + 0.1)
  x.frequency.exponentialRampToValueAtTime(150, t + 0.07)
  const g = gn()
  hitEnv(g, t, 0.001, 0.18 * vel, 0.07)
  x.connect(g)
  g.connect(o)
}
const hat = (o, t, vel, open) => nz(o, t, open ? 0.22 : 0.03, 'highpass', 8000, 0.8, 0.1 * vel)
const shaker = (o, t, vel) => nz(o, t, 0.05, 'bandpass', 6500, 1.2, 0.06 * vel, 0.012)
const brushSwish = (o, t, vel) => nz(o, t, 0.24, 'bandpass', 3600, 0.5, 0.06 * vel, 0.04)
const brushTap = (o, t, vel) => nz(o, t, 0.04, 'bandpass', 3000, 0.8, 0.04 * vel, 0.004)
function snap(o, t, vel) {
  nz(o, t, 0.03, 'bandpass', 2200, 2.5, 0.22 * vel)
  nz(o, t, 0.012, 'highpass', 5000, 0.7, 0.08 * vel)
}
function clap(o, t, vel) {
  for (let i = 0; i < 3; i++) nz(o, t + i * 0.011, 0.012, 'bandpass', 1300, 1.2, 0.16 * vel)
  nz(o, t + 0.033, 0.12, 'bandpass', 1300, 1, 0.14 * vel)
}
function crash(o, t, vel) {
  nz(o, t, 1.5, 'highpass', 4500, 0.6, 0.16 * vel)
  nz(o, t, 0.5, 'bandpass', 7000, 0.8, 0.07 * vel)
}
function timpani(o, t, m, vel) {
  const f = mtof(m)
  const g = gn()
  hitEnv(g, t, 0.004, 0.42 * vel, 1.2)
  const x = osc('sine', f * 1.03, t, t + 1.4)
  x.frequency.exponentialRampToValueAtTime(f, t + 0.12)
  x.connect(g)
  const h = gn(0.3)
  osc('sine', f * 1.5, t, t + 1.4).connect(h)
  h.connect(g)
  g.connect(o)
  nz(o, t, 0.07, 'lowpass', 600, 0.7, 0.16 * vel)
}
// woodblock tick (hi) / tock (lo)
function wood(o, t, hi, vel) {
  const f = hi ? 1250 : 880
  const g = gn()
  hitEnv(g, t, 0.001, 0.12 * vel, 0.05)
  osc('sine', f, t, t + 0.08).connect(g)
  g.connect(o)
  nz(o, t, 0.008, 'bandpass', f * 2, 2, 0.05 * vel)
}

// --- Arrangements -----------------------------------------------------------------------------------
function playHeist(G, st, t) {
  const w = G.w
  const o = G.out
  const mood = G.mood
  const bar = (st >> 4) & 7
  const s = st & 15
  const sd = 60 / G.bpm / 4
  const T = (s & 3) === 2 ? t + w.swing * sd : t
  const root = H_ROOT[bar]
  let e
  if (w.pizz > 0.02 && (e = H_PIZZ[st])) pizz(o, T, e[0], w.pizz * (s === 0 ? 1 : 0.8))
  if (w.brush > 0.02) {
    if (s === 4 || s === 12) brushSwish(o, T, w.brush)
    else if ((s & 1) === 0) brushTap(o, T, w.brush * (s % 8 === 0 ? 0.6 : 0.35))
  }
  if (w.celesta > 0.02 && (e = H_CEL[st])) celesta(o, T, e[0] + 12, w.celesta)
  if (w.strings > 0.02) {
    if (s === 0) {
      if (mood === 'chase') strings(o, t, H_PAD[bar], sd * 16, w.strings, true)
      else if (mood === 'held') strings(o, t, H_PAD_LOW[bar], sd * 16, w.strings * 0.8, false)
      else strings(o, t, H_PAD[bar], sd * 16, w.strings, false)
    }
    if (mood === 'suspicious' && (s === 0 || s === 8)) strings(o, t, H_CREEP[bar].slice(s >> 3, (s >> 3) + 1), sd * 8, w.strings * 0.55, true)
  }
  if (w.pulse > 0.02 && (s & 1) === 0) pulse(o, t, root + (s === 6 || s === 14 ? 12 : 0), sd * 1.6, w.pulse * (s % 8 === 0 ? 1 : 0.6))
  if (w.timp > 0.02 && s === 0 && (bar & 1) === 0) timpani(o, t, root, w.timp)
  if (w.run > 0.02 && (e = H_RUN[st])) bassPick(o, t, e[0], sd * 1.6, w.run * (s % 8 === 0 ? 1 : 0.8))
  if (w.drums > 0.02) {
    const D = w.drums
    if (s === 0 || s === 8 || (s === 10 && bar & 1)) kick(o, t, D)
    if (s === 4 || s === 12) snare(o, t, D)
    else if (bar === 7 && s >= 8) snare(o, t, D * (0.3 + (s - 8) * 0.08))
    else if (s & 1) snare(o, t, D * 0.12)
    hat(o, t, D * ((s & 1) ? 0.3 : 0.6), false)
    if (bar === 0 && s === 0) crash(o, t, D * 0.7)
  }
  if (w.stabs > 0.02 && (s === 4 || s === 12 || ((bar === 3 || bar === 7) && s === 14))) stab(o, t, H_PAD[bar], sd * 1.2, w.stabs)
  if (w.xylo > 0.02 && (e = H_XYLO[st])) xylo(o, t, e[0], w.xylo)
  if (w.tuba > 0.02 && (e = H_TUBA[st])) tuba(o, T, e[0], sd * e[1], w.tuba)
  if (w.tick > 0.02 && (s & 3) === 0) wood(o, t, (s & 4) === 0, w.tick)
}
function playHome(G, st, t) {
  const w = G.w
  const o = G.out
  const results = G.mood === 'results'
  const bar = (st >> 4) & 7
  const s = st & 15
  const sd = 60 / G.bpm / 4
  const T = (s & 3) === 2 ? t + w.swing * sd : t
  let e
  if (w.walk > 0.02 && (e = F_WALK[st])) pizz(o, T, e[0], w.walk * (s === 0 ? 1 : 0.85))
  if (w.marimba > 0.02 && (e = F_MEL[st])) marimba(o, T, e[0], w.marimba)
  if (w.comp > 0.02 && (s === 6 || s === 14 || (s === 10 && bar & 1))) for (const m of F_COMP[bar]) marimba(o, T, m, w.comp * 0.4)
  if (w.snaps > 0.02 && (s === 4 || s === 12)) snap(o, T, w.snaps)
  if (w.shaker > 0.02 && (s & 1) === 0) shaker(o, T, w.shaker * ((s & 3) === 2 ? 0.9 : 0.5))
  if (w.kick > 0.02 && (s === 0 || s === 8 || (results && (s === 7 || (s === 14 && bar === 7))))) kick(o, t, w.kick * (s === 0 ? 1 : 0.8))
  if (w.funk > 0.02 && (e = F_FUNK[st])) bassPick(o, t, e[0], sd * 1.5, w.funk)
  if (w.claps > 0.02 && (s === 4 || s === 12)) clap(o, t, w.claps)
  if (w.hats > 0.02) hat(o, t, w.hats * ((s & 1) ? 0.3 : (s & 3) === 2 ? 0.7 : 0.5), s === 14 && (bar & 1) === 1)
  if (w.glock > 0.02 && (e = F_MEL[st])) glock(o, t, e[0] + 12, w.glock * 0.7)
  if (w.brass > 0.02) {
    const hit = bar === 7 ? s === 0 || s === 6 || s === 12 : (bar & 1) === 0 && (s === 0 || s === 10)
    if (hit) stab(o, t, F_COMP[bar], sd * (s === 0 ? 2 : 1.2), w.brass)
  }
}

// --- Stingers -------------------------------------------------------------------------------------------
const STING = {
  // the heist begins: a snare roll into a D minor hit, then a sneaky pizzicato "tip-tip"
  start(o, t) {
    for (let i = 0; i < 16; i++) snare(o, t + i * 0.034, 0.15 + i * 0.04)
    const h = t + 0.56
    stab(o, h, [50, 57, 62, 65], 0.45, 1.2)
    timpani(o, h, 38, 1)
    crash(o, h, 0.8)
    kick(o, h, 0.8)
    pizz(o, h + 0.6, 45, 0.9)
    pizz(o, h + 0.78, 38, 1)
  },
  // alert: a xylophone flick up into a clashing brass sforzando
  spotted(o, t) {
    const run = [62, 65, 69, 74, 77, 81]
    for (let i = 0; i < run.length; i++) xylo(o, t + i * 0.025, run[i], 0.9)
    const h = t + 0.17
    stab(o, h, [62, 63, 69, 74], 0.35, 1.3)
    timpani(o, h, 38, 1)
    crash(o, h, 0.7)
  },
  // relief: a celesta tumbling down and a soft F major chord
  lost(o, t) {
    const notes = [81, 77, 74, 69]
    for (let i = 0; i < notes.length; i++) celesta(o, t + i * 0.13, notes[i], 1.6)
    strings(o, t + 0.3, [65, 69, 72], 0.9, 1.6, false)
    pizz(o, t + 0.55, 41, 1)
  },
  // dun... dun... DUNNN! (stepping down by semitones) and a wobbly tuba slide to the floor
  caught(o, t) {
    const chords = [[50, 53, 57, 62], [49, 52, 56, 61], [48, 51, 55, 60]]
    for (let i = 0; i < 3; i++) {
      const at = t + i * 0.3
      stab(o, at, chords[i], i === 2 ? 0.9 : 0.16, 1.2)
      timpani(o, at, 38 - i, 1)
    }
    crash(o, t + 0.6, 0.8)
    tuba(o, t + 1.55, 43, 0.9, 1, 31)
  },
  // heroic cadence: Bb, C, F (big), a glockenspiel run and timpani
  escape(o, t) {
    const chords = [[58, 62, 65], [60, 64, 67], [65, 69, 72, 77]]
    for (let i = 0; i < 3; i++) stab(o, t + i * 0.2, chords[i], i === 2 ? 1.1 : 0.12, 1.2)
    const run = [77, 81, 84, 89]
    for (let i = 0; i < run.length; i++) glock(o, t + 0.4 + i * 0.07, run[i], 1)
    timpani(o, t + 0.4, 41, 1)
    crash(o, t + 0.4, 0.9)
    kick(o, t + 0.4, 0.8)
  },
  // a job done: a bright glockenspiel arpeggio and a little brass "ta-da"
  job(o, t) {
    const run = [72, 76, 79, 84]
    for (let i = 0; i < run.length; i++) glock(o, t + i * 0.07, run[i], 1.5)
    stab(o, t + 0.28, [65, 69, 72], 0.25, 1.3)
    shaker(o, t + 0.28, 1.2)
  },
}
function duck(level, len, t) {
  const p = A.duck.gain
  p.cancelScheduledValues(t)
  p.setTargetAtTime(level, t, 0.04)
  p.setTargetAtTime(1, t + len, 0.35)
}

// --- API ------------------------------------------------------------------------------------------------
// The Settings switch for music.
export function setMusicEnabled(on) {
  try {
    enabled = !!on
    if (A) fade(A.out.gain, enabled ? MUSIC.level * musicScale : 0, enabled ? 1.2 : 0.4)
  } catch {}
}
// The portal's music_volume setting (0..1): music only, on top of the master volume.
export function setMusicVolume(v01) {
  try {
    musicScale = Math.min(1, Math.max(0, Number(v01) || 0))
    if (A && enabled) fade(A.out.gain, MUSIC.level * musicScale, 0.3)
  } catch {}
}
// 'lobby' | 'sneak' | 'suspicious' | 'chase' | 'held' | 'results' | 'off': crossfades, never restarts
// the song that is already playing.
export function setMood(mood) {
  try {
    if (!MOODS.includes(mood) || mood === target) return
    target = mood
    if (A) applyMood()
  } catch {}
}
// 'start' | 'spotted' | 'lost' | 'caught' | 'escape' | 'job'
export function stinger(name) {
  try {
    if (!A && !init()) return
    const fn = STING[name]
    if (!enabled || !fn || A.ctx.state !== 'running') return
    const now = A.ctx.currentTime
    if (now - stingAt < MUSIC.stingGap) return
    stingAt = now
    const t = now + 0.03
    fn(A.sting, t)
    const dk = MUSIC.duck[name]
    if (dk) duck(dk[0], dk[1], t)
  } catch {}
}
// Once per frame: books the next notes of every playing group (look-ahead on the audio clock).
export function frame() {
  try {
    if (!A && !init()) return
    const ctx = A.ctx
    if (ctx.state !== 'running') return
    const now = ctx.currentTime
    for (const G of groupList) {
      if (!G.active) continue
      if (G.stopAt && now >= G.stopAt) {
        G.active = false
        G.stopAt = 0
        continue
      }
      if (G.nextT < now - 0.1) G.nextT = now + 0.05 // behind (long frame / resumed tab): resync
      if (!enabled) continue
      while (G.nextT < now + MUSIC.lookahead) {
        const s = G.step & 15
        // a new mood lands on a beat; the chase also gets a crash + timpani
        if ((s & 3) === 0 && G.want && G.want !== G.mood) {
          if (G.want === 'chase') {
            crash(G.out, G.nextT, 0.8)
            timpani(G.out, G.nextT, H_ROOT[(G.step >> 4) & 7], 0.9)
          }
          G.mood = G.want
        }
        const M = MUSIC.moods[G.mood]
        for (const k in G.w) G.w[k] += ((M[k] ?? 0) - G.w[k]) * MUSIC.glide
        G.bpm += (M.bpm - G.bpm) * MUSIC.tempoGlide
        G.play(G, G.step, G.nextT)
        G.nextT += 60 / G.bpm / 4
        G.step = (G.step + 1) & 127
      }
    }
  } catch {}
}
// dev: what is playing
export function musicStats() {
  return {
    ready: !!A,
    enabled,
    target,
    groups: groupList.map((G) => ({ name: G.name, active: G.active, mood: G.mood, bpm: Math.round(G.bpm), step: G.step })),
  }
}
