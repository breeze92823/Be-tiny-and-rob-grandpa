// Procedural sound for Tiny Thieves (WebAudio, no audio files). Everything is synthesised: UI blips,
// tiny-thief footsteps and stretchy grabber arms, giant-scale impacts per material, glass / coin /
// marble debris, the house (doors, flush, secret door, clocks), gadgets, heist stingers, Grandpa's
// formant-synthesised gibberish voice and his earth-shaking steps, looping machines and ambience beds.
//
// Mix: sources -> ui / world / grandpa / ambience buses -> master -> glue compressor -> limiter, with
// a generated convolution reverb fed from the world + grandpa buses (send follows the zone / room).
// One-shots: play(name, { at, vol, pitch, mat, strength }) (3D with `at`). Loops: loop(name) handles.
// The context is created on the first user gesture (unlock); before that, or without WebAudio, every
// export is a silent no-op that never throws. Tunables live in audioConfig.js.
import { AUDIO } from './audioConfig.js'

const W = typeof window !== 'undefined' ? window : null
const DOC = typeof document !== 'undefined' ? document : null
const COARSE = !!(W && W.matchMedia && W.matchMedia('(pointer: coarse)').matches)
const CAP = COARSE ? AUDIO.voices.mobile : AUDIO.voices.desktop
const HARD = Math.round(CAP * AUDIO.voices.hard)
const LOW = Math.round(CAP * AUDIO.voices.lowPrio)
const HIGH = Math.round(CAP * AUDIO.voices.highPrio)
const PANNING = COARSE ? AUDIO.panning.mobile : AUDIO.panning.desktop
const BUS_LEVEL = { ui: AUDIO.bus.ui, world: AUDIO.bus.world, grandpa: AUDIO.bus.grandpa, amb: AUDIO.bus.ambience }
const NO = Object.freeze({})

const rnd = (a, b) => a + Math.random() * (b - a)
const rndInt = (n) => (Math.random() * n) | 0
const pick = (arr) => arr[(Math.random() * arr.length) | 0]
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)
const lerp = (a, b, k) => a + (b - a) * k
const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

// --- State ------------------------------------------------------------------------------------------
let ctx = null
let master = null
let bus = null // { ui, world, grandpa, amb, send, verb }
let noiseBuf = null
let brownBuf = null
let failed = false // no WebAudio (or it threw): stay silent for good
let primed = false
let NYQ = 20000
let volume = AUDIO.defaultVolume
let muted = false
let hidden = !!(DOC && DOC.hidden)
let fxOn = true
let voices = 0
let offline = false // renderOffline is building a graph: no voice accounting
// The shot being built: helpers write to OUT, start at T, scale frequencies by P.
let OUT = null
let T = 0
let P = 1
let SHOT = null
let IS3D = false

const ready = () => !!ctx && ctx.state === 'running'

// --- Context + mix ----------------------------------------------------------------------------------
function applyGain() {
  if (!master) return
  master.gain.setTargetAtTime(muted || hidden ? 0 : AUDIO.master * volume, ctx.currentTime, 0.04)
}
export function setVolume(v01) {
  try {
    volume = clamp01(num(Number(v01), 0))
    applyGain()
  } catch {}
}
// An ad break (or anything else) asks for silence; music is silenced too (it runs into the master).
export function setMuted(on) {
  try {
    muted = !!on
    applyGain()
  } catch {}
}
// The Settings switch for sound effects: every effect bus incl. ambience (music has its own switch).
export function setSfxEnabled(on) {
  try {
    fxOn = !!on
    if (!bus) return
    const t = ctx.currentTime
    for (const k of ['ui', 'world', 'grandpa', 'amb']) bus[k].gain.setTargetAtTime(fxOn ? BUS_LEVEL[k] : 0, t, 0.05)
  } catch {}
}
// The shared context for music.js: null until a gesture has started audio.
export function audioCore() {
  if (!ready()) return null
  return { ctx, master, verb: bus.verb, noise: noiseBuf }
}

function makeNoise(seconds, brown) {
  const sr = ctx.sampleRate
  const len = Math.floor(sr * seconds)
  const b = ctx.createBuffer(1, len, sr)
  const d = b.getChannelData(0)
  let last = 0
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1
    if (brown) {
      last = (last + 0.02 * w) / 1.02
      d[i] = last * 3.5
    } else d[i] = w
  }
  if (brown) {
    // remove the drift so the loop point is seamless
    const drift = d[len - 1] - d[0]
    for (let i = 0; i < len; i++) d[i] -= (drift * i) / len
  }
  return b
}
// A stereo room tail: decaying noise that darkens as it fades, plus a few early reflections.
function makeImpulse(seconds) {
  const sr = ctx.sampleRate
  const len = Math.floor(sr * seconds)
  const b = ctx.createBuffer(2, len, sr)
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c)
    let lp = 0
    const fadeIn = sr * 0.004
    for (let i = 0; i < len; i++) {
      const k = i / len
      lp += (Math.random() * 2 - 1 - lp) * (0.85 - 0.72 * k)
      d[i] = lp * Math.pow(1 - k, 2.2) * (i < fadeIn ? i / fadeIn : 1)
    }
    for (let r = 0; r < 8; r++) {
      const at = Math.floor(sr * rnd(0.006, 0.07))
      d[at] += rnd(-0.5, 0.5) * (1 - at / (sr * 0.08))
    }
  }
  return b
}

function build() {
  NYQ = ctx.sampleRate * 0.45
  const C = AUDIO.compressor
  const L = AUDIO.limiter
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = C.threshold
  comp.knee.value = C.knee
  comp.ratio.value = C.ratio
  comp.attack.value = C.attack
  comp.release.value = C.release
  const lim = ctx.createDynamicsCompressor()
  lim.threshold.value = L.threshold
  lim.knee.value = L.knee
  lim.ratio.value = L.ratio
  lim.attack.value = L.attack
  lim.release.value = L.release
  master = ctx.createGain()
  master.gain.value = 0
  master.connect(comp)
  comp.connect(lim)
  lim.connect(ctx.destination)
  const mk = (k) => {
    const g = ctx.createGain()
    g.gain.value = fxOn ? BUS_LEVEL[k] : 0
    g.connect(master)
    return g
  }
  bus = { ui: mk('ui'), world: mk('world'), grandpa: mk('grandpa'), amb: mk('amb') }
  if (!noiseBuf) noiseBuf = makeNoise(3, false)
  if (!brownBuf) brownBuf = makeNoise(4, true)
  const verb = ctx.createConvolver()
  verb.buffer = makeImpulse(AUDIO.reverb.seconds)
  const pre = ctx.createDelay(0.2)
  pre.delayTime.value = AUDIO.reverb.preDelay
  const send = ctx.createGain()
  send.gain.value = AUDIO.reverb.send.none
  bus.world.connect(send)
  bus.grandpa.connect(send)
  send.connect(pre)
  pre.connect(verb)
  verb.connect(master)
  bus.verb = verb
  bus.send = send
  applyGain()
  startAmbient()
}
function ensure() {
  if (ctx || failed) return ctx
  try {
    const AC = W && (W.AudioContext || W.webkitAudioContext)
    if (!AC) {
      failed = true
      return null
    }
    ctx = new AC({ latencyHint: 'interactive' })
    build()
  } catch {
    ctx = null
    master = null
    bus = null
    failed = true
  }
  return ctx
}
// Call from any user gesture: creates the context on the first one, resumes it afterwards.
export function unlock() {
  try {
    if (!ensure()) return
    if (ctx.state === 'suspended' && !hidden) ctx.resume().catch(() => {})
    if (!primed) {
      // iOS: a silent buffer inside the gesture finishes the unlock
      primed = true
      const s = ctx.createBufferSource()
      s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
      s.connect(ctx.destination)
      s.start(0)
    }
  } catch {}
}
if (W) {
  const opt = { capture: true, passive: true }
  W.addEventListener('pointerdown', unlock, opt)
  W.addEventListener('keydown', unlock, opt)
  W.addEventListener('touchend', unlock, opt)
}
if (DOC) {
  DOC.addEventListener('visibilitychange', () => {
    try {
      hidden = DOC.hidden
      if (!ctx) return
      applyGain()
      if (hidden) ctx.suspend().catch(() => {})
      else ctx.resume().catch(() => {})
    } catch {}
  })
}

// --- Pre-rendered samples ---------------------------------------------------------------------------
// Small struck objects (coin, glass shard, marble, ceramic chip, wood tick, spark, fire pop, water drop)
// are synthesised once into AudioBuffers (decaying partials + a contact click) and replayed with a
// random rate: one voice each. Debris "clouds" (coin cascades, glass tinkles, scattering marbles) are
// pre-mixed from those samples into one longer stereo buffer, so a shatter with 30 shards costs one
// voice instead of ninety. Three variants of each, rendered lazily on first use.
const SAMPLES = {
  coin: { len: 0.6, modal: () => [rnd(2700, 3300), [[1, 1, 0.42], [1.0055, 0.5, 0.5], [1.52, 0.55, 0.28], [2.31, 0.4, 0.18], [3.12, 0.22, 0.1]], 0.35, 0.0015] },
  shard: { len: 0.26, modal: () => [rnd(3600, 5600), [[1, 1, 0.1], [1.71, 0.7, 0.07], [2.63, 0.5, 0.05], [3.92, 0.3, 0.03]], 0.6, 0.001] },
  marble: { len: 0.1, modal: () => [rnd(2900, 3700), [[1, 1, 0.028], [2.15, 0.45, 0.016], [0.31, 0.5, 0.012]], 0.45, 0.0008] },
  chip: { len: 0.15, modal: () => [rnd(1900, 2600), [[1, 1, 0.05], [2.45, 0.6, 0.03], [4.1, 0.35, 0.02]], 0.7, 0.003] },
  tick: { len: 0.08, modal: () => [rnd(1500, 1800), [[1, 1, 0.022], [2.3, 0.5, 0.014], [0.52, 0.6, 0.02]], 0.5, 0.0012] },
  spark: { len: 0.035, modal: () => [rnd(4500, 6500), [[1, 0.4, 0.004]], 1, 0.0025, 0, true] },
  pop: { len: 0.05, modal: () => [rnd(900, 1500), [[1, 0.5, 0.006], [2.7, 0.3, 0.003]], 1, 0.004] },
  drop: { len: 0.09, modal: () => [rnd(800, 1300), [[1, 1, 0.03]], 0.05, 0.001, 1.9] },
  coinCascade: {
    len: 1.3,
    cloud(add) {
      for (let i = 0; i < 14; i++) {
        const t = Math.pow(Math.random(), 1.3) * 0.7
        const r = rnd(0.85, 1.25)
        const a = rnd(0.35, 1)
        const p = rnd(-0.6, 0.6)
        add('coin', t, r, a, p)
        if (Math.random() < 0.6) add('coin', t + rnd(0.07, 0.13), r, a * 0.4, p)
      }
    },
  },
  coinSpill: {
    len: 2.2,
    cloud(add) {
      for (let i = 0; i < 24; i++) {
        let t = Math.pow(Math.random(), 2) * 0.35
        let gap = rnd(0.12, 0.22)
        let a = rnd(0.4, 1)
        const r = rnd(0.8, 1.3)
        const p = rnd(-0.7, 0.7)
        for (let b = 0; b < 4 && t < 1.9; b++) {
          add('coin', t, r, a, p)
          t += gap
          gap *= rnd(0.5, 0.7)
          a *= 0.55
        }
      }
      // a few coins roll and rattle to a stop
      for (let i = 0; i < 3; i++) {
        let t = rnd(0.5, 0.9)
        let gap = 0.06
        const p = rnd(-0.5, 0.5)
        for (let k = 0; k < 8; k++) {
          add('coin', t, rnd(1.3, 1.6), 0.14 * (1 - k / 8), p)
          t += gap
          gap *= 0.85
        }
      }
    },
  },
  glassTinkle: {
    len: 1.3,
    cloud(add) {
      for (let i = 0; i < 30; i++) {
        const t = Math.pow(Math.random(), 1.8)
        add('shard', t, rnd(0.7, 1.4), rnd(0.2, 1) * (1 - t * 0.6), rnd(-0.8, 0.8))
      }
    },
  },
  ceramicBits: {
    len: 1.1,
    cloud(add) {
      for (let i = 0; i < 16; i++) {
        const t = Math.pow(Math.random(), 1.7) * 0.8
        add('chip', t, rnd(0.8, 1.3), rnd(0.25, 1) * (1 - t * 0.7), rnd(-0.7, 0.7))
      }
      for (let i = 0; i < 5; i++) add('chip', rnd(0, 0.3), rnd(0.45, 0.65), rnd(0.6, 1), rnd(-0.5, 0.5)) // bigger pieces
    },
  },
  marbles: {
    len: 1.8,
    cloud(add) {
      for (let i = 0; i < 12; i++) {
        let t = rnd(0, 0.12)
        let gap = rnd(0.16, 0.26)
        let a = rnd(0.5, 1)
        const r = rnd(0.85, 1.2)
        const p = rnd(-0.8, 0.8)
        for (let b = 0; b < 6 && t < 1.6; b++) {
          add('marble', t, r, a, p)
          t += gap
          gap *= rnd(0.55, 0.72)
          a *= 0.62
        }
      }
      for (let i = 0; i < 8; i++) add('marble', rnd(0.1, 1.2), rnd(1.1, 1.4), rnd(0.1, 0.3), rnd(-0.8, 0.8)) // marbles kissing
    },
  },
  sparks: {
    len: 0.9,
    cloud(add) {
      let t = 0
      while (t < 0.75) {
        const burst = 1 + rndInt(4)
        for (let k = 0; k < burst; k++) add('spark', t + k * rnd(0.005, 0.02), rnd(0.7, 1.4), rnd(0.3, 1) * (1 - t), rnd(-0.6, 0.6))
        t += rnd(0.03, 0.12)
      }
    },
  },
  fizz: {
    len: 1.3,
    cloud(add) {
      for (let i = 0; i < 70; i++) {
        const t = Math.random() * 1.15
        add(Math.random() < 0.6 ? 'drop' : 'spark', t, rnd(2.2, 3.6), rnd(0.05, 0.3) * (1 - t * 0.5), rnd(-0.7, 0.7))
      }
    },
  },
  crackle: {
    len: 0.55,
    cloud(add) {
      let t = 0
      const n = 5 + rndInt(6)
      for (let i = 0; i < n; i++) {
        add('pop', t, rnd(0.6, 1.5), rnd(0.3, 1), rnd(-0.4, 0.4))
        t += Math.random() < 0.4 ? rnd(0.008, 0.025) : rnd(0.03, 0.08)
      }
    },
  },
  rattle: {
    len: 1.0,
    cloud(add) {
      for (let i = 0; i < 18; i++) {
        const t = Math.pow(Math.random(), 1.4) * 0.75
        add(Math.random() < 0.5 ? 'chip' : 'tick', t, rnd(0.4, 0.9), rnd(0.2, 1) * (1 - t), rnd(-0.6, 0.6))
      }
    },
  },
}
const sampleCache = {}
function normalize(b, to) {
  let peak = 0
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c)
    for (let i = 0; i < d.length; i++) {
      const v = d[i] < 0 ? -d[i] : d[i]
      if (v > peak) peak = v
    }
  }
  if (peak < 1e-6) return
  const k = to / peak
  for (let c = 0; c < b.numberOfChannels; c++) {
    const d = b.getChannelData(c)
    for (let i = 0; i < d.length; i++) d[i] *= k
  }
}
function renderModal(len, spec) {
  const [f, parts, click, clickT, chirp, hp] = spec
  const sr = ctx.sampleRate
  const n = Math.ceil(len * sr)
  const b = ctx.createBuffer(1, n, sr)
  const d = b.getChannelData(0)
  const chirpN = 0.025 * sr
  for (const [ratio, amp, dec] of parts) {
    const k = Math.exp(-1 / (dec * sr))
    let a = amp
    let ph = Math.random() * 6.2832
    const f0 = f * ratio
    for (let i = 0; i < n && a > 1e-5; i++) {
      const fr = chirp ? f0 * (1 + (chirp - 1) * Math.min(1, i / chirpN)) : f0
      ph += (6.2832 * fr) / sr
      d[i] += a * Math.sin(ph)
      a *= k
    }
  }
  if (click) {
    const ct = clickT * sr
    const cn = Math.min(n, Math.ceil(ct * 6))
    let prev = 0
    for (let i = 0; i < cn; i++) {
      let w = Math.random() * 2 - 1
      if (hp) {
        const x = w
        w = x - prev
        prev = x
      }
      d[i] += w * click * Math.exp(-i / ct)
    }
  }
  const fa = Math.ceil(sr * 0.0005)
  for (let i = 0; i < fa && i < n; i++) d[i] *= i / fa
  const fe = Math.ceil(n * 0.1)
  for (let i = 0; i < fe; i++) d[n - 1 - i] *= i / fe
  normalize(b, 0.9)
  return b
}
function renderCloud(len, fill) {
  const sr = ctx.sampleRate
  const n = Math.ceil(len * sr)
  const b = ctx.createBuffer(2, n, sr)
  const L = b.getChannelData(0)
  const R = b.getChannelData(1)
  fill((kind, t, rate, amp, pan = 0) => {
    const sb = sample(kind)
    if (!sb) return
    const src = sb.getChannelData(0)
    const step = (rate * sb.sampleRate) / sr
    const start = Math.floor(t * sr)
    const gl = amp * Math.sqrt(0.5 * (1 - pan))
    const gr = amp * Math.sqrt(0.5 * (1 + pan))
    let pos = 0
    for (let i = start; i < n; i++, pos += step) {
      const j = pos | 0
      if (j + 1 >= src.length) break
      const v = src[j] + (src[j + 1] - src[j]) * (pos - j)
      L[i] += v * gl
      R[i] += v * gr
    }
  })
  normalize(b, 0.9)
  return b
}
function sample(kind) {
  let set = sampleCache[kind]
  if (!set) {
    const s = SAMPLES[kind]
    if (!s) return null
    set = sampleCache[kind] = []
    for (let v = 0; v < 3; v++) set.push(s.modal ? renderModal(s.len, s.modal()) : renderCloud(s.len, s.cloud))
  }
  return set[rndInt(set.length)]
}

// --- Building blocks ----------------------------------------------------------------------------------
const fq = (f) => (f < 20 ? 20 : f > NYQ ? NYQ : f)
function gain(v) {
  const g = ctx.createGain()
  g.gain.value = v
  return g
}
function filter(type, f, q) {
  const b = ctx.createBiquadFilter()
  b.type = type
  b.frequency.value = fq(f)
  b.Q.value = q
  return b
}
// attack to `peak` (exponential), optional hold, exponential decay
function env(param, t0, a, peak, hold, d) {
  const p = Math.max(0.0002, peak)
  a = Math.max(0.001, a)
  param.setValueAtTime(0.0001, t0)
  param.exponentialRampToValueAtTime(p, t0 + a)
  if (hold > 0) param.setValueAtTime(p, t0 + a + hold)
  param.exponentialRampToValueAtTime(0.0001, t0 + a + hold + Math.max(0.005, d))
}
const freeVoice = () => {
  voices--
}
function endShot(s) {
  s.dead = true
  try {
    s.g.disconnect()
    if (s.p) {
      s.f.disconnect()
      s.p.disconnect()
    }
  } catch {}
}
// Count a source as a voice until it ends (and release its shot's nodes after the last one).
function track(src, end) {
  src.stop(end)
  if (offline) return
  voices++
  const shot = SHOT
  if (shot) {
    shot.n++
    src.onended = () => {
      voices--
      if (--shot.n <= 0) endShot(shot)
    }
  } else src.onended = freeVoice
}
const busy = () => !offline && voices >= HARD
function outFor(pan) {
  if (!pan || IS3D || !ctx.createStereoPanner) return OUT
  const sp = ctx.createStereoPanner()
  sp.pan.value = pan < -1 ? -1 : pan > 1 ? 1 : pan
  sp.connect(OUT)
  return sp
}
function vibrato(osc, t0, end, v) {
  const l = ctx.createOscillator()
  l.frequency.value = v[0]
  const g = gain(0)
  g.gain.setValueAtTime(v[1], t0)
  if (v[2] !== undefined) g.gain.linearRampToValueAtTime(v[2], end)
  l.connect(g)
  g.connect(osc.detune)
  l.start(t0)
  track(l, end + 0.03)
}
// AM: a node whose gain wobbles 1 +- depth/2 at `rate` Hz (rattles, grinding, laughing crowds)
function amNode(t0, end, rate, depth) {
  const g = gain(1 - depth / 2)
  const l = ctx.createOscillator()
  l.frequency.value = rate
  const lg = gain(depth / 2)
  l.connect(lg)
  lg.connect(g.gain)
  l.start(t0)
  track(l, end + 0.03)
  return g
}
// An oscillator note. o: at a hold d peak type slide slideT glide [[dt, ratio]] detune vib [rate, cents,
// endCents] lp bp [f, q] pan out
function tone(f, o = NO) {
  if (busy()) return null
  const t0 = T + (o.at || 0)
  const a = o.a ?? 0.004
  const hold = o.hold || 0
  const d = o.d ?? 0.2
  const end = t0 + a + hold + d
  const osc = ctx.createOscillator()
  osc.type = o.type || 'sine'
  const fp = osc.frequency
  fp.setValueAtTime(fq(f * P), t0)
  if (o.slide) fp.exponentialRampToValueAtTime(fq(o.slide * P), t0 + (o.slideT || a + hold + d))
  if (o.glide) for (const [dt, r] of o.glide) fp.exponentialRampToValueAtTime(fq(f * r * P), t0 + dt)
  if (o.detune) osc.detune.value = o.detune
  if (o.vib) vibrato(osc, t0, end, o.vib)
  const g = gain(0) // silent until the envelope starts (a source can begin a frame early)
  env(g.gain, t0, a, o.peak ?? 0.2, hold, d)
  let head = osc
  if (o.lp) {
    const fl = filter('lowpass', o.lp * P, 0.7)
    head.connect(fl)
    head = fl
  }
  if (o.bp) {
    const fl = filter('bandpass', o.bp[0] * P, o.bp[1])
    head.connect(fl)
    head = fl
  }
  head.connect(g)
  g.connect(o.out || outFor(o.pan))
  osc.start(t0)
  track(osc, end + 0.03)
  return osc
}
// Filtered noise. o: at a hold d peak type freq q sweep sweepT sweeps [[dt, f]] brown rate am [rate, depth] pan out
function noise(o = NO) {
  if (busy()) return null
  const t0 = T + (o.at || 0)
  const a = o.a ?? 0.002
  const hold = o.hold || 0
  const d = o.d ?? 0.2
  const end = t0 + a + hold + d
  const s = ctx.createBufferSource()
  s.buffer = o.brown ? brownBuf : noiseBuf
  s.loop = true
  if (o.rate) s.playbackRate.value = o.rate
  const f = ctx.createBiquadFilter()
  f.type = o.type || 'bandpass'
  f.frequency.setValueAtTime(fq((o.freq ?? 2000) * P), t0)
  if (o.sweep) f.frequency.exponentialRampToValueAtTime(fq(o.sweep * P), t0 + (o.sweepT || a + hold + d))
  if (o.sweeps) for (const [dt, v] of o.sweeps) f.frequency.linearRampToValueAtTime(fq(v * P), t0 + dt)
  f.Q.value = o.q ?? 0.8
  const g = gain(0)
  env(g.gain, t0, a, o.peak ?? 0.2, hold, d)
  s.connect(f)
  let head = f
  if (o.am) {
    const m = amNode(t0, end, o.am[0], o.am[1])
    head.connect(m)
    head = m
  }
  head.connect(g)
  g.connect(o.out || outFor(o.pan))
  s.start(t0, Math.random() * 2)
  track(s, end + 0.03)
  return s
}
// A pre-rendered sample (or debris cloud). o: at rate peak pan out
function grain(kind, o = NO) {
  if (busy()) return
  const buf = sample(kind)
  if (!buf) return
  const t0 = T + (o.at || 0)
  const s = ctx.createBufferSource()
  s.buffer = buf
  const rate = Math.max(0.1, (o.rate ?? 1) * P)
  s.playbackRate.value = rate
  const g = gain(o.peak ?? 0.3)
  s.connect(g)
  g.connect(o.out || outFor(o.pan))
  s.start(t0)
  track(s, t0 + buf.duration / rate + 0.02)
}
const cloud = grain
const METAL = [1, 2.76, 5.4, 8.93]
// A struck metal / glass body: inharmonic partials, each with its own (shorter) decay.
function metal(f, o = NO) {
  const r = o.ratios || METAL
  const d = o.d ?? 0.5
  const pk = o.peak ?? 0.1
  for (let i = 0; i < r.length; i++) tone(f * r[i], { at: o.at, a: 0.001, d: d / (1 + i * 0.6), peak: pk / (1 + i * 0.55), pan: o.pan, out: o.out })
}
// A sparkly bell / celesta note.
function bell(f, o = NO) {
  const d = o.d ?? 0.6
  const pk = o.peak ?? 0.06
  tone(f, { at: o.at, a: 0.002, d, peak: pk, pan: o.pan, out: o.out })
  tone(f * 2.76, { at: o.at, a: 0.001, d: d * 0.25, peak: pk * 0.35, pan: o.pan, out: o.out })
}
// A struck wooden / hollow body: damped modes plus the contact transient.
function knock(f, o = NO) {
  const at = o.at || 0
  const pk = o.peak ?? 0.2
  const d = o.d ?? 0.12
  tone(f * rnd(0.97, 1.03), { at, a: 0.001, d, peak: pk, type: 'triangle', out: o.out })
  tone(f * 2.31 * rnd(0.98, 1.02), { at, a: 0.001, d: d * 0.5, peak: pk * 0.45, out: o.out })
  tone(f * 3.87, { at, a: 0.001, d: d * 0.3, peak: pk * 0.2, out: o.out })
  noise({ at, d: 0.012, peak: pk * 0.5, type: 'bandpass', freq: f * 5, q: 1.2, out: o.out })
}
// A low body thump with a pitch drop (felt more than heard).
function thump(f, o = NO) {
  return tone(f, { at: o.at, a: o.a ?? 0.003, d: o.d ?? 0.25, peak: o.peak ?? 0.3, slide: o.to ?? f * 0.5, type: o.type || 'sine', out: o.out })
}
// A band of noise sweeping from -> to, swelling to its peak at `shape` of the way.
function whoosh(o = NO) {
  if (busy()) return
  const t0 = T + (o.at || 0)
  const d = o.d ?? 0.3
  const sh = o.shape ?? 0.55
  const s = ctx.createBufferSource()
  s.buffer = noiseBuf
  s.loop = true
  const f = filter(o.type || 'bandpass', (o.from ?? 400) * P, o.q ?? 1)
  f.frequency.setValueAtTime(fq((o.from ?? 400) * P), t0)
  f.frequency.exponentialRampToValueAtTime(fq((o.to ?? 2500) * P), t0 + d)
  const g = gain(0)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, o.peak ?? 0.2), t0 + d * sh)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d)
  s.connect(f)
  f.connect(g)
  g.connect(o.out || outFor(o.pan))
  s.start(t0, Math.random() * 2)
  track(s, t0 + d + 0.03)
}
// Stick-slip friction (creaky wood, hinges, rubber): a jittery low-rate sawtooth through resonances,
// its level stuttering. o: at d rate jitter rise f f2 q peak out
function creak(o = NO) {
  if (busy()) return
  const t0 = T + (o.at || 0)
  const d = o.d ?? 0.4
  const rate = o.rate ?? 40
  const j = o.jitter ?? 0.3
  const osc = ctx.createOscillator()
  osc.type = 'sawtooth'
  osc.frequency.setValueAtTime(rate, t0)
  for (let t = 0.03; t < d; t += rnd(0.025, 0.06)) osc.frequency.linearRampToValueAtTime(rate * (1 + rnd(-j, j)) * (1 + ((o.rise || 0) * t) / d), t0 + t)
  const f = (o.f ?? 700) * P
  const q = o.q ?? 8
  const b1 = filter('bandpass', f, q)
  const b2 = filter('bandpass', f * (o.f2 ?? 1.9), q * 1.3)
  const g2 = gain(0.5)
  const g = gain(0)
  const pk = (o.peak ?? 0.1) * 8 // makeup: narrow bands of a low sawtooth are quiet
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(pk, t0 + Math.min(0.04, d * 0.3))
  for (let t = 0.06; t < d - 0.06; t += rnd(0.04, 0.09)) g.gain.linearRampToValueAtTime(pk * rnd(0.45, 1), t0 + t)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d)
  osc.connect(b1)
  osc.connect(b2)
  b2.connect(g2)
  b1.connect(g)
  g2.connect(g)
  g.connect(o.out || OUT)
  osc.start(t0)
  track(osc, t0 + d + 0.03)
}
// A short brassy note / chord tone: two detuned saws through a filter that blooms then settles.
function brass(f, o = NO) {
  if (busy()) return
  const t0 = T + (o.at || 0)
  const d = o.d ?? 0.3
  const pk = o.peak ?? 0.06
  const lp = filter('lowpass', 600, 1.2)
  lp.frequency.setValueAtTime(fq(600 * P), t0)
  lp.frequency.exponentialRampToValueAtTime(fq(3200 * P), t0 + 0.03)
  lp.frequency.exponentialRampToValueAtTime(fq(1600 * P), t0 + Math.max(0.05, d))
  const g = gain(0)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(pk, t0 + 0.015)
  g.gain.setValueAtTime(pk, t0 + Math.max(0.02, d - 0.04))
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.12)
  for (const dt of [-7, 7]) {
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    osc.frequency.value = fq(f * P)
    osc.detune.value = dt
    osc.connect(lp)
    osc.start(t0)
    track(osc, t0 + d + 0.15)
  }
  lp.connect(g)
  g.connect(o.out || outFor(o.pan))
}
// Marimba-ish mallet note.
function mallet(f, o = NO) {
  const pk = o.peak ?? 0.1
  tone(f, { at: o.at, a: 0.002, d: o.d ?? 0.35, peak: pk, pan: o.pan })
  tone(f * 3.93, { at: o.at, a: 0.001, d: 0.05, peak: pk * 0.35, pan: o.pan })
  noise({ at: o.at, d: 0.006, peak: pk * 0.3, type: 'bandpass', freq: f * 2, q: 1, pan: o.pan })
}
const curves = new Map()
function driveCurve(k) {
  const key = Math.round(k * 10)
  let c = curves.get(key)
  if (!c) {
    c = new Float32Array(1024)
    for (let i = 0; i < c.length; i++) {
      const x = (i / (c.length - 1)) * 2 - 1
      c[i] = Math.tanh(x * k) / Math.tanh(k)
    }
    curves.set(key, c)
  }
  return c
}

// --- Grandpa's voice: formant synthesis ----------------------------------------------------------------
// A sawtooth "glottis" (+ a sub-octave for gravel) with vibrato and a slow brown-noise wobble, through
// three formant bandpasses + a chest lowpass. Each syllable moves the formants to a vowel (optionally
// gliding to a second one) and opens a voiced envelope; 'h' onsets are breath noise through the same
// tract, 'm' 'b' 'w' 'n' start from closed lips, 'k' 'g' 't' add a plosive tick. Gibberish only.
// Formants: [F1, F2, F3, F2 level, F3 level] (adult male, Hz; scaled down for a giant).
const VOW = {
  a: [730, 1090, 2440, 0.8, 0.35],
  o: [570, 840, 2410, 0.7, 0.25],
  u: [320, 870, 2240, 0.45, 0.15],
  U: [440, 1020, 2240, 0.6, 0.2],
  E: [520, 1190, 2390, 0.7, 0.3],
  e: [530, 1840, 2480, 0.75, 0.4],
  i: [290, 2250, 3000, 0.55, 0.4],
  ae: [660, 1720, 2410, 0.8, 0.4],
  m: [250, 1000, 2200, 0.08, 0.04],
  n: [270, 1500, 2500, 0.1, 0.05],
}
const FQ = [6, 9, 12]
const FG = [3.2, 4.5, 4]
function setFormants(F, V, t, tc, size) {
  for (let i = 0; i < 3; i++) {
    F[i * 2].frequency.setTargetAtTime(fq(V[i] * size), t, tc)
    // the source falls ~1/f, so a low F1 (m, u, i) catches strong low harmonics: level it out
    const lv = i === 0 ? Math.min(1.2, Math.max(0.4, V[0] / 600)) : V[2 + i]
    F[i * 2 + 1].gain.setTargetAtTime(FG[i] * lv, t, tc)
  }
}
function contour(param, pts, t0, mul) {
  param.setValueAtTime(fq(pts[0][1] * mul), t0 + pts[0][0])
  for (let i = 1; i < pts.length; i++) param.linearRampToValueAtTime(fq(pts[i][1] * mul), t0 + pts[i][0])
}
// syl: [[start, length, vowel, level, onset, endVowel], ...], f0: [[t, Hz], ...] (times from `at`)
// o: at size rasp breath level vib vibCents drive chest. Returns the line's length (s).
function say(syl, f0, o = NO) {
  if (!offline && voices + 6 > HARD) return 0
  const at = o.at || 0
  const t0 = T + at
  let len = 0
  for (const s of syl) len = Math.max(len, s[0] + s[1])
  const end = t0 + len + 0.2
  const size = (o.size ?? AUDIO.grandpa.formant) * Math.sqrt(P)
  const pitch = AUDIO.grandpa.pitch * P
  const rasp = o.rasp ?? 0.35
  const breath = o.breath ?? 0.05
  const g1 = ctx.createOscillator()
  g1.type = 'sawtooth'
  const g2 = ctx.createOscillator()
  g2.type = 'triangle'
  contour(g1.frequency, f0, t0, pitch)
  contour(g2.frequency, f0, t0, pitch * 0.5)
  const vib = ctx.createOscillator()
  vib.frequency.value = (o.vib ?? 5.2) * rnd(0.9, 1.1)
  const vg = gain(o.vibCents ?? 18)
  vib.connect(vg)
  vg.connect(g1.detune)
  vg.connect(g2.detune)
  // an old man's wobble: slow brown noise on the pitch, faster on the amplitude (roughness)
  const wob = ctx.createBufferSource()
  wob.buffer = brownBuf
  wob.loop = true
  wob.playbackRate.value = 0.5
  const wg = gain(150 * rasp)
  wob.connect(wg)
  wg.connect(g1.detune)
  wg.connect(g2.detune)
  const vca = gain(1)
  const rl = filter('bandpass', 30, 0.7)
  const rg = gain(rasp * 3)
  wob.connect(rl)
  rl.connect(rg)
  rg.connect(vca.gain)
  const sg = gain(0.2 + rasp * 0.5)
  g1.connect(vca)
  g2.connect(sg)
  sg.connect(vca)
  const voiced = gain(0)
  vca.connect(voiced)
  const br = ctx.createBufferSource()
  br.buffer = noiseBuf
  br.loop = true
  const breathG = gain(0)
  br.connect(breathG)
  const sum = gain(1)
  const F = []
  for (let i = 0; i < 3; i++) {
    const b = filter('bandpass', 500, FQ[i])
    const g = gain(0)
    voiced.connect(b)
    breathG.connect(b)
    b.connect(g)
    g.connect(sum)
    F.push(b, g)
  }
  const chest = filter('lowpass', 320 * size, 0.8)
  const cg = gain(o.chest ?? 0.35)
  voiced.connect(chest)
  chest.connect(cg)
  cg.connect(sum)
  let head = sum
  if (o.drive) {
    const pre = gain(1 + o.drive * 1.5)
    const sh = ctx.createWaveShaper()
    sh.curve = driveCurve(1 + o.drive * 3)
    sum.connect(pre)
    pre.connect(sh)
    head = sh
  }
  const out = gain((o.level ?? 0.5) * AUDIO.grandpa.voice)
  head.connect(out)
  out.connect(OUT)
  for (const s of syl) {
    const st = s[0]
    const ln = s[1]
    const lv = s[3] ?? 1
    const on = s[4] || ''
    const a = t0 + st
    const b = a + ln
    const A = VOW[s[2]] || VOW.E
    const closed = on === 'm' || on === 'b' || on === 'w' || on === 'n'
    setFormants(F, closed ? (on === 'n' ? VOW.n : VOW.m) : A, a - 0.005, 0.012, size)
    if (closed) setFormants(F, A, a + 0.045, 0.02, size)
    if (s[5]) setFormants(F, VOW[s[5]] || A, a + ln * 0.35, ln * 0.25, size)
    const vstart = on === 'h' ? a + 0.05 : a
    voiced.gain.setTargetAtTime(lv, vstart, on === 'b' ? 0.006 : 0.022)
    voiced.gain.setTargetAtTime(0, b - 0.04, 0.03)
    if (on === 'h') {
      breathG.gain.setTargetAtTime(0.9 * lv, a - 0.01, 0.012)
      breathG.gain.setTargetAtTime(breath * lv, a + 0.07, 0.03)
    } else breathG.gain.setTargetAtTime(breath * lv, a, 0.03)
    breathG.gain.setTargetAtTime(0, b - 0.04, 0.03)
    if (on === 'k' || on === 'g' || on === 't')
      noise({ at: Math.max(0, at + st - 0.015), d: 0.025, peak: 0.1 * lv * (o.level ?? 0.5), type: 'bandpass', freq: on === 't' ? 3500 : 2000, q: 1.2 })
  }
  g1.start(t0)
  g2.start(t0)
  vib.start(t0)
  wob.start(t0, Math.random() * 3)
  br.start(t0, Math.random() * 2)
  track(g1, end)
  track(g2, end)
  track(vib, end)
  track(wob, end)
  track(br, end)
  return at + len
}
const GIB_V = ['E', 'a', 'o', 'U', 'u', 'ae', 'e', 'm', 'E', 'o']
const GIB_ON = ['m', 'b', 'h', 'w', 'n', 'g', '', '', 'm', 'b', 'k']
// Random gibberish muttering: n syllables around `base` Hz, falling by `fall` over the phrase.
function gibberish(n, base, fall, lv) {
  const syl = []
  const f0 = [[0, base * rnd(0.95, 1.08)]]
  let t = 0
  for (let i = 0; i < n; i++) {
    const ln = rnd(0.08, 0.2)
    syl.push([t, ln, pick(GIB_V), lv * rnd(0.65, 1), pick(GIB_ON), Math.random() < 0.3 ? pick(GIB_V) : undefined])
    f0.push([t + ln * 0.5, base * rnd(0.88, 1.15) * (1 - (fall * i) / n)])
    t += ln + (Math.random() < 0.2 ? rnd(0.12, 0.25) : rnd(0.015, 0.06))
  }
  f0.push([t, base * (1 - fall) * 0.92])
  return { syl, f0, len: t }
}

// --- Sound definitions ------------------------------------------------------------------------------
// def(name, bus, distance class, priority 0 low / 1 normal / 2 high, fn(strength, opts), flags)
// flags: major (minor blips yield to it), minor, scale (range grows with strength), k (default
// strength), say (Grandpa voice rank: lines never overlap, a higher rank interrupts), len (offline s)
const DEFS = {}
const GROUPS = {}
let group = 'UI'
function def(name, busName, dist, prio, fn, flags = NO) {
  DEFS[name] = { name, bus: busName, dist, prio, fn, gap: AUDIO.gaps[name] ?? 0.05, k: flags.k ?? 0.5, ...flags }
  ;(GROUPS[group] ||= []).push(name)
}
const scale = (x) => {
  OUT.gain.value *= x
}

// ---- UI (2D) ----
group = 'UI'
def('click', 'ui', 'small', 1, () => {
  tone(rnd(1500, 1750), { a: 0.001, d: 0.028, peak: 0.13, type: 'triangle', slide: rnd(800, 950) })
  tone(rnd(380, 430), { a: 0.001, d: 0.045, peak: 0.16, slide: 260 })
  noise({ d: 0.01, peak: 0.1, type: 'bandpass', freq: 4200, q: 1.4 })
})
def('hover', 'ui', 'small', 0, () => {
  tone(rnd(2300, 2600), { a: 0.002, d: 0.025, peak: 0.035 })
  noise({ d: 0.008, peak: 0.03, type: 'bandpass', freq: 6000, q: 2 })
}, { minor: true })
def('open', 'ui', 'small', 1, () => {
  whoosh({ d: 0.2, from: 380, to: 2600, peak: 0.12, q: 0.9 })
  tone(440, { a: 0.006, d: 0.11, peak: 0.13, slide: 880 })
  tone(1320, { at: 0.07, a: 0.003, d: 0.16, peak: 0.05, type: 'triangle' })
  tone(1760, { at: 0.1, a: 0.003, d: 0.2, peak: 0.03 })
})
def('close', 'ui', 'small', 1, () => {
  whoosh({ d: 0.17, from: 2400, to: 420, peak: 0.1 })
  tone(820, { a: 0.004, d: 0.1, peak: 0.12, slide: 400 })
  tone(1100, { at: 0.03, d: 0.08, peak: 0.04, type: 'triangle', slide: 700 })
})
def('buy', 'ui', 'small', 1, () => {
  grain('coin', { peak: 0.22, rate: rnd(0.95, 1.1), pan: -0.2 })
  grain('coin', { at: 0.06, peak: 0.16, rate: rnd(1.1, 1.25), pan: 0.25 })
  const notes = [1047, 1319, 1568, 2093, 2637]
  for (let i = 0; i < notes.length; i++) bell(notes[i], { at: 0.04 + i * 0.045, d: 0.5, peak: 0.07 - i * 0.006, pan: (i - 2) * 0.2 })
  whoosh({ d: 0.35, from: 1500, to: 7000, peak: 0.05, q: 0.6 })
  noise({ at: 0.1, d: 0.4, peak: 0.03, type: 'highpass', freq: 7000 })
}, { major: true })
def('error', 'ui', 'small', 1, () => {
  for (let i = 0; i < 2; i++) tone(rnd(168, 178), { at: i * 0.13, a: 0.006, d: 0.1, peak: 0.12, type: 'square', lp: 900 })
  tone(240, { d: 0.25, peak: 0.06, slide: 170 })
})
def('toast', 'ui', 'small', 1, () => {
  scale(1.5)
  tone(784, { a: 0.004, d: 0.12, peak: 0.08, type: 'triangle' })
  tone(1175, { at: 0.08, a: 0.004, d: 0.22, peak: 0.07, type: 'triangle' })
  tone(2350, { at: 0.08, d: 0.15, peak: 0.015 })
}, { minor: true })
def('countdown', 'ui', 'small', 1, () => {
  grain('tick', { peak: 0.3, rate: 1.05 })
  tone(1250, { a: 0.001, d: 0.06, peak: 0.08 })
  tone(620, { a: 0.001, d: 0.05, peak: 0.06, type: 'triangle' })
})
def('go', 'ui', 'small', 2, () => {
  whoosh({ d: 0.5, from: 160, to: 3200, peak: 0.2, q: 0.8, shape: 0.9 })
  tone(220, { a: 0.3, d: 0.15, peak: 0.06, slide: 880, slideT: 0.45, type: 'sawtooth', lp: 1500 })
  const h = 0.46
  thump(130, { at: h, to: 42, d: 0.4, peak: 0.55 })
  noise({ at: h, d: 0.22, peak: 0.28, type: 'highpass', freq: 1500 })
  noise({ at: h, d: 0.9, peak: 0.08, type: 'highpass', freq: 5000 })
  for (const f of [523, 659, 784, 1047]) tone(f, { at: h, a: 0.005, d: 0.35, peak: 0.05, type: 'sawtooth', lp: 2600, detune: rnd(-8, 8) })
  bell(2093, { at: h, d: 0.7, peak: 0.05 })
}, { major: true, len: 1.6 })
def('jobDone', 'ui', 'small', 2, () => {
  const notes = [784, 1047, 1319]
  for (let i = 0; i < 3; i++) {
    const last = i === 2
    brass(notes[i], { at: i * 0.1, d: last ? 0.5 : 0.08, peak: 0.07 })
    bell(notes[i] * 2, { at: i * 0.1, d: last ? 0.8 : 0.3, peak: 0.045 })
  }
  const sparkle = [2637, 3136, 3520, 4186, 3136, 3951]
  for (let i = 0; i < sparkle.length; i++) bell(sparkle[i], { at: 0.32 + i * rnd(0.05, 0.08), d: 0.4, peak: 0.03, pan: rnd(-0.7, 0.7) })
  noise({ at: 0.25, a: 0.05, d: 0.6, peak: 0.03, type: 'highpass', freq: 7000 })
  grain('coin', { at: 0.2, peak: 0.12, rate: 1.2 })
}, { major: true, len: 1.6 })
def('coins', 'ui', 'small', 1, () => {
  cloud('coinCascade', { peak: 0.5 })
}, { major: true, len: 1.6 })
def('register', 'ui', 'small', 1, () => {
  knock(140, { peak: 0.22, d: 0.08 })
  noise({ d: 0.05, peak: 0.12, type: 'bandpass', freq: 1200, q: 1.2 })
  grain('tick', { at: 0.03, peak: 0.2, rate: 0.7 })
  metal(2150, { at: 0.08, d: 1.1, peak: 0.12, ratios: [1, 2.02, 2.94, 4.1] })
  metal(2710, { at: 0.085, d: 0.8, peak: 0.06, ratios: [1, 2.3] })
  noise({ at: 0.1, a: 0.03, d: 0.22, peak: 0.08, type: 'bandpass', freq: 700, q: 0.8, sweep: 1100 })
  knock(190, { at: 0.33, peak: 0.16, d: 0.1 })
  for (let i = 0; i < 3; i++) grain('coin', { at: 0.35 + i * rnd(0.03, 0.06), peak: 0.1, rate: rnd(0.9, 1.3), pan: rnd(-0.4, 0.4) })
}, { major: true, len: 1.6 })
def('levelUp', 'ui', 'small', 2, () => {
  const run = [523, 659, 784, 1047, 1319]
  for (let i = 0; i < run.length; i++) mallet(run[i], { at: i * 0.065, peak: 0.12, pan: (i - 2) * 0.15 })
  for (const f of [1047, 1319, 1568]) bell(f, { at: 0.33, d: 0.9, peak: 0.05 })
  brass(523, { at: 0.33, d: 0.4, peak: 0.04 })
  whoosh({ d: 0.6, from: 300, to: 5000, peak: 0.08, q: 0.7 })
  noise({ at: 0.33, a: 0.05, d: 0.7, peak: 0.03, type: 'highpass', freq: 7500 })
}, { major: true, len: 1.6 })
def('struggle', 'ui', 'small', 1, () => {
  scale(1.8)
  const f = rnd(520, 760)
  tone(f, { a: 0.008, d: 0.1, peak: 0.16, type: 'triangle', glide: [[0.04, 1.6], [0.1, 1.15]], bp: [1300, 1.5] })
  noise({ d: 0.04, peak: 0.03, type: 'bandpass', freq: 2500, q: 1.5 })
})
def('breakFree', 'ui', 'small', 2, () => {
  tone(700, { a: 0.001, d: 0.06, peak: 0.25, slide: 180 })
  noise({ d: 0.03, peak: 0.25, type: 'bandpass', freq: 1800, q: 0.8 })
  whoosh({ at: 0.03, d: 0.35, from: 300, to: 3500, peak: 0.16 })
  tone(392, { at: 0.05, d: 0.25, slide: 784, peak: 0.06, type: 'triangle' })
  for (let i = 0; i < 4; i++) bell([1568, 2093, 2637, 3136][i], { at: 0.12 + i * 0.05, d: 0.35, peak: 0.035, pan: rnd(-0.5, 0.5) })
}, { major: true })

// ---- Player (tiny thief) ----
group = 'Player'
let foot = false
const STEP = {
  wood() {
    knock(rnd(560, 700), { peak: 0.07, d: 0.045 })
    noise({ d: 0.012, peak: 0.04, type: 'bandpass', freq: 3000, q: 1 })
  },
  tile() {
    tone(rnd(1700, 2100), { a: 0.001, d: 0.02, peak: 0.04, type: 'triangle' })
    noise({ d: 0.014, peak: 0.07, type: 'highpass', freq: rnd(3500, 5000) })
  },
  carpet() {
    noise({ a: 0.004, d: 0.045, peak: 0.12, type: 'lowpass', freq: 1400 })
    noise({ d: 0.03, peak: 0.06, type: 'bandpass', freq: 2500, q: 0.7 })
  },
  grass() {
    noise({ a: 0.006, d: 0.07, peak: 0.085, type: 'bandpass', freq: rnd(2800, 4200), q: 0.7 })
    noise({ d: 0.04, peak: 0.055, type: 'lowpass', freq: 600, brown: true })
  },
  stone() {
    noise({ d: 0.025, peak: 0.07, type: 'bandpass', freq: rnd(1800, 2600), q: 1.1 })
    tone(rnd(300, 360), { a: 0.001, d: 0.03, peak: 0.05, type: 'triangle' })
  },
  metal() {
    metal(rnd(1900, 2300), { d: 0.12, peak: 0.025, ratios: [1, 2.6, 4.1] })
    noise({ d: 0.012, peak: 0.05, type: 'highpass', freq: 3000 })
  },
}
def('step', 'world', 'tiny', 0, (k, o) => {
  foot = !foot
  P *= foot ? 1.03 : 0.97
  scale(0.6 + 0.8 * k)
  ;(STEP[o.mat] || STEP.wood)()
}, { scale: true })
def('jump', 'world', 'tiny', 1, () => {
  scale(1.5)
  whoosh({ d: 0.13, from: 500, to: 1600, peak: 0.06 })
  tone(rnd(330, 380), { a: 0.004, d: 0.08, peak: 0.05, slide: 620 })
  noise({ d: 0.03, peak: 0.04, type: 'lowpass', freq: 900 })
})
def('land', 'world', 'small', 1, (k, o) => {
  thump(rnd(150, 170), { to: 70, d: 0.08 + 0.12 * k, peak: 0.08 + 0.3 * k })
  noise({ d: 0.05 + 0.08 * k, peak: 0.05 + 0.15 * k, type: 'lowpass', freq: 700 + 800 * k })
  ;(STEP[o.mat] || STEP.wood)()
  if (k > 0.6) cloud('rattle', { at: 0.01, peak: 0.1 * k, rate: 1.3 })
}, { scale: true })
def('grab', 'world', 'tiny', 1, () => {
  tone(rnd(260, 300), { a: 0.004, d: 0.09, peak: 0.14, type: 'triangle', glide: [[0.07, 6]], bp: [1400, 1.2] })
  noise({ d: 0.07, peak: 0.06, type: 'bandpass', freq: 1200, sweep: 5000, q: 1.5 })
  tone(220, { at: 0.075, a: 0.003, d: 0.07, peak: 0.12, slide: 95 })
  noise({ at: 0.075, d: 0.08, peak: 0.07, type: 'lowpass', freq: 1400, sweep: 250 })
})
def('release', 'world', 'tiny', 1, () => {
  tone(240, { a: 0.002, d: 0.05, peak: 0.12, slide: 560 })
  noise({ d: 0.035, peak: 0.08, type: 'bandpass', freq: 900, q: 1.2 })
  tone(1300, { at: 0.03, a: 0.003, d: 0.09, peak: 0.05, slide: 320, type: 'triangle' })
  whoosh({ at: 0.02, d: 0.1, from: 2500, to: 700, peak: 0.03 })
})
def('throw', 'world', 'small', 1, (k) => {
  whoosh({ d: 0.18 + 0.22 * k, from: 300 + 200 * k, to: 1800 + 1500 * k, peak: 0.08 + 0.22 * k, q: 0.9 })
  noise({ a: 0.01, d: 0.12 + 0.1 * k, peak: 0.05 + 0.1 * k, type: 'lowpass', freq: 500 })
})
def('stretch', 'world', 'tiny', 0, () => {
  creak({ d: 0.16, rate: rnd(70, 110), rise: 0.6, f: 900, q: 6, peak: 0.06 })
})
def('crouch', 'world', 'tiny', 0, () => {
  noise({ a: 0.01, d: 0.09, peak: 0.05, type: 'bandpass', freq: 1800, q: 0.6 })
  noise({ a: 0.01, d: 0.07, peak: 0.04, type: 'lowpass', freq: 400 })
})
def('pickup', 'world', 'small', 1, () => {
  tone(520, { a: 0.003, d: 0.08, peak: 0.12, slide: 1040 })
  bell(1568, { at: 0.06, d: 0.35, peak: 0.07 })
  bell(2093, { at: 0.11, d: 0.45, peak: 0.06 })
  noise({ at: 0.06, d: 0.2, peak: 0.02, type: 'highpass', freq: 7000 })
})
def('collect', 'world', 'medium', 2, (k) => {
  whoosh({ d: 0.45, from: 280, to: 4200, peak: 0.12, q: 0.7, shape: 0.6 })
  P *= Math.pow(2, (k * 7) / 12)
  grain('coin', { at: 0.12, peak: 0.28, rate: 1 + k * 0.2 })
  const notes = [1047, 1319, 1568, 2093, 2637, 3136]
  const n = 2 + Math.round(k * 4)
  for (let i = 0; i < n; i++) bell(notes[i], { at: 0.16 + i * 0.05, d: 0.4 + k * 0.3, peak: 0.06, pan: (i - n / 2) * 0.12 })
  if (k > 0.7) {
    cloud('coinCascade', { at: 0.2, peak: 0.2 })
    noise({ at: 0.2, a: 0.05, d: 0.8, peak: 0.03, type: 'highpass', freq: 7000 })
  }
}, { major: true, len: 1.8 })

// ---- Impacts (3D) ----
group = 'Impacts'
const IMPACT = {
  wood(k) {
    const f = lerp(380, 130, k)
    knock(f, { peak: 0.18 + 0.3 * k, d: 0.07 + 0.16 * k })
    thump(f * 0.5, { to: f * 0.35, d: 0.1 + 0.2 * k, peak: 0.1 + 0.35 * k })
    noise({ d: 0.02, peak: 0.1 + 0.15 * k, type: 'bandpass', freq: 2500, q: 0.8 })
  },
  metal(k) {
    const f = lerp(1500, 380, k)
    metal(f, { d: 0.35 + 0.9 * k, peak: 0.07 + 0.12 * k })
    metal(f * 1.41, { d: 0.25 + 0.5 * k, peak: 0.04 + 0.06 * k, ratios: [1, 2.3] })
    noise({ d: 0.015, peak: 0.12 + 0.15 * k, type: 'highpass', freq: 2500 })
    if (k > 0.3) thump(lerp(200, 90, k), { d: 0.15, peak: 0.25 * k })
  },
  glass(k) {
    const f = lerp(3400, 1700, k)
    metal(f, { d: 0.12 + 0.35 * k, peak: 0.06 + 0.08 * k, ratios: [1, 2.32, 4.25] })
    noise({ d: 0.01, peak: 0.1 + 0.1 * k, type: 'highpass', freq: 4000 })
    knock(f * 0.18, { peak: 0.06 + 0.1 * k, d: 0.04 })
  },
  plastic(k) {
    const f = lerp(820, 280, k)
    tone(f, { type: 'triangle', a: 0.001, d: 0.04 + 0.06 * k, peak: 0.14 + 0.2 * k, slide: f * 0.8 })
    tone(f * 2.3, { a: 0.001, d: 0.03, peak: 0.06 + 0.06 * k })
    noise({ d: 0.025 + 0.03 * k, peak: 0.1 + 0.15 * k, type: 'bandpass', freq: 1600, q: 1.2 })
    if (k > 0.4) for (let i = 0; i < 2; i++) grain('tick', { at: rnd(0.04, 0.12), peak: 0.05 * k, rate: rnd(0.55, 0.7) })
  },
  soft(k) {
    thump(lerp(170, 75, k), { d: 0.12 + 0.12 * k, peak: 0.12 + 0.35 * k })
    noise({ a: 0.004, d: 0.08 + 0.1 * k, peak: 0.1 + 0.2 * k, type: 'lowpass', freq: 600 + 400 * k })
  },
  ceramic(k) {
    const f = lerp(2600, 1250, k)
    metal(f, { d: 0.08 + 0.18 * k, peak: 0.07 + 0.08 * k, ratios: [1, 2.13, 3.65, 5.3] })
    knock(lerp(900, 420, k), { peak: 0.1 + 0.15 * k, d: 0.04 })
    noise({ d: 0.01, peak: 0.08 + 0.1 * k, type: 'highpass', freq: 3000 })
  },
  paper(k) {
    noise({ a: 0.003, d: 0.05 + 0.06 * k, peak: 0.12 + 0.18 * k, type: 'bandpass', freq: 1700, q: 0.6 })
    noise({ d: 0.04, peak: 0.08 + 0.15 * k, type: 'lowpass', freq: 500, brown: true })
    noise({ at: 0.03, d: 0.02, peak: 0.05 + 0.05 * k, type: 'bandpass', freq: 3000, q: 1 })
    noise({ at: 0.06, d: 0.02, peak: 0.03 + 0.04 * k, type: 'bandpass', freq: 2600, q: 1 })
  },
  rubber(k) {
    const f = lerp(260, 120, k)
    tone(f, { a: 0.002, d: 0.14 + 0.1 * k, peak: 0.14 + 0.25 * k, glide: [[0.03, 1.5], [0.15, 0.9]] })
    thump(f * 0.6, { d: 0.08, peak: 0.1 + 0.2 * k })
    noise({ d: 0.03, peak: 0.05 + 0.08 * k, type: 'lowpass', freq: 900 })
  },
}
def('impact', 'world', 'small', 1, (k, o) => {
  scale(0.8)
  ;(IMPACT[o.mat] || IMPACT.wood)(k)
  if (k > 0.65) {
    // a big crash: the floor booms and the room rattles
    const c = (k - 0.65) / 0.35
    thump(70, { to: 34, d: 0.5, peak: 0.25 + 0.3 * c })
    noise({ a: 0.003, d: 0.4, peak: 0.15 + 0.15 * c, type: 'lowpass', freq: 1500, sweep: 300 })
    cloud('rattle', { at: 0.02, peak: 0.1 + 0.2 * c, rate: o.mat === 'metal' ? 1.2 : 0.9 })
  }
}, { scale: true })
def('shatter', 'world', 'medium', 2, (k, o) => {
  if (o.mat === 'ceramic') {
    knock(lerp(700, 450, k), { peak: 0.3, d: 0.06 })
    thump(140, { to: 60, d: 0.15, peak: 0.25 + 0.2 * k })
    noise({ d: 0.06, peak: 0.35, type: 'bandpass', freq: 2400, q: 0.7 })
    noise({ d: 0.35, peak: 0.12, type: 'highpass', freq: 3000, sweep: 5000 })
    cloud('ceramicBits', { at: 0.01, peak: 0.45 + 0.2 * k })
  } else {
    thump(120, { to: 50, d: 0.12, peak: 0.25 })
    noise({ d: 0.04, peak: 0.45, type: 'highpass', freq: 1400 })
    noise({ d: 0.45, peak: 0.22, type: 'highpass', freq: 4500, sweep: 8000 })
    metal(rnd(2500, 3200), { d: 0.25, peak: 0.07, ratios: [1, 2.32, 4.25] })
    cloud('glassTinkle', { at: 0.01, peak: 0.5 + 0.2 * k })
  }
}, { major: true, scale: true, k: 0.7, len: 1.8 })
def('squeak', 'world', 'small', 1, () => {
  scale(2.5)
  const f = rnd(1050, 1250)
  tone(f, { type: 'sawtooth', a: 0.015, hold: 0.1, d: 0.08, peak: 0.12, glide: [[0.06, 1.18], [0.2, 0.92]], bp: [2200, 3], vib: [24, 35] })
  noise({ a: 0.02, d: 0.15, peak: 0.04, type: 'bandpass', freq: 3000, q: 1 })
  if (Math.random() < 0.5) tone(f * 0.85, { at: 0.24, type: 'sawtooth', a: 0.01, d: 0.07, peak: 0.07, glide: [[0.07, 0.9]], bp: [2000, 3] })
})
def('coinBurst', 'world', 'medium', 2, () => {
  knock(520, { peak: 0.28, d: 0.06 })
  thump(130, { to: 60, d: 0.18, peak: 0.3 })
  noise({ d: 0.07, peak: 0.3, type: 'bandpass', freq: 2200, q: 0.7 })
  cloud('ceramicBits', { peak: 0.25, rate: 0.9 })
  cloud('coinSpill', { at: 0.02, peak: 0.6 })
}, { major: true, len: 2.6 })
def('tvBreak', 'world', 'medium', 2, () => {
  thump(95, { to: 38, d: 0.35, peak: 0.45 })
  noise({ a: 0.003, d: 0.25, peak: 0.25, type: 'lowpass', freq: 900, sweep: 200 })
  noise({ d: 0.05, peak: 0.3, type: 'highpass', freq: 2000 })
  cloud('glassTinkle', { at: 0.02, peak: 0.22, rate: 1.1 })
  cloud('sparks', { at: 0.05, peak: 0.4 })
  noise({ at: 0.08, a: 0.02, d: 1.3, peak: 0.12, type: 'bandpass', freq: 3500, sweep: 500, q: 0.6 })
  tone(120, { at: 0.06, a: 0.01, d: 0.6, peak: 0.05, type: 'sawtooth', slide: 50, bp: [800, 1.5] })
}, { major: true, len: 2 })

// ---- Grandpa (3D, giant) ----
group = 'Grandpa'
def('gpStep', 'grandpa', 'big', 2, (k) => {
  const s = 0.5 + k * 0.7
  thump(rnd(52, 60), { to: 28, d: 0.4 + 0.2 * k, peak: 0.45 * s })
  tone(rnd(105, 120), { type: 'triangle', a: 0.004, d: 0.14, peak: 0.22 * s, slide: 55 })
  noise({ a: 0.004, d: 0.22 + 0.1 * k, peak: 0.3 * s, type: 'lowpass', freq: 260, brown: true })
  noise({ a: 0.01, d: 0.12, peak: 0.06 * s, type: 'bandpass', freq: rnd(700, 1000), q: 0.6 })
  if (Math.random() < 0.3) creak({ at: rnd(0.04, 0.12), d: rnd(0.25, 0.45), rate: rnd(18, 32), f: rnd(380, 520), q: 9, peak: 0.07 * s })
  if (k > 0.55) cloud('rattle', { at: 0.03, peak: 0.12 * k })
}, { scale: true, len: 1.2 })
def('gpCaneTap', 'grandpa', 'medium', 1, () => {
  knock(rnd(240, 280), { peak: 0.28, d: 0.09 })
  noise({ d: 0.025, peak: 0.12, type: 'lowpass', freq: 1400 })
  thump(95, { to: 60, d: 0.1, peak: 0.15 })
})
def('gpMumble', 'grandpa', 'big', 2, () => {
  const g = gibberish(4 + rndInt(4), 98, 0.18, 0.75)
  return say(g.syl, g.f0, { rasp: 0.35, breath: 0.06, level: 0.8, vibCents: 12 })
}, { say: 1, len: 2.2 })
def('gpGrumble', 'grandpa', 'big', 2, () => {
  const g = gibberish(4 + rndInt(3), 86, 0.15, 0.85)
  const t = g.len + 0.12
  g.syl.push([t, 0.2, 'm', 1, 'h'])
  g.f0.push([t, 120], [t + 0.2, 78])
  const len = say(g.syl, g.f0, { rasp: 0.6, breath: 0.08, level: 0.85, vibCents: 10, chest: 0.45 })
  noise({ at: t + 0.16, d: 0.08, peak: 0.08, type: 'bandpass', freq: 900, q: 1 })
  return len
}, { say: 1, len: 2.6 })
def('gpHmm', 'grandpa', 'big', 2, () =>
  say([[0, 0.16, 'm', 0.7, 'h'], [0.26, 0.46, 'm', 0.9, '', 'U']], [[0, 104], [0.16, 98], [0.26, 92], [0.5, 96], [0.72, 132]], { rasp: 0.3, breath: 0.04, level: 0.85, chest: 0.5 }),
{ say: 2, len: 1.2 })
def('gpHuh', 'grandpa', 'big', 2, () =>
  say([[0.02, 0.34, 'E', 1, 'h', 'a']], [[0, 118], [0.12, 124], [0.36, 190]], { rasp: 0.3, breath: 0.08, level: 0.75 }),
{ say: 3, len: 0.9 })
def('gpShout', 'grandpa', 'huge', 2, () =>
  say([[0.02, 0.5, 'ae', 1, 'h', 'i']], [[0, 150], [0.1, 182], [0.35, 172], [0.52, 128]], { rasp: 0.55, breath: 0.06, level: 0.6, drive: 0.8, vibCents: 30, vib: 6.5 }),
{ say: 4, major: true, len: 1.1 })
def('gpGotcha', 'grandpa', 'big', 2, () =>
  say(
    [[0, 0.13, 'a', 0.75], [0.17, 0.28, 'a', 1, 'h'], [0.6, 0.09, 'e', 0.7, 'h'], [0.74, 0.09, 'e', 0.65, 'h'], [0.88, 0.09, 'E', 0.6, 'h'], [1.03, 0.32, 'o', 0.85, 'h', 'u']],
    [[0, 112], [0.13, 108], [0.17, 128], [0.45, 168], [0.6, 140], [0.69, 136], [0.74, 132], [0.83, 128], [0.88, 124], [0.97, 120], [1.03, 150], [1.35, 102]],
    { rasp: 0.4, breath: 0.07, level: 0.7 },
  ),
{ say: 3, major: true, len: 1.8 })
def('gpOuch', 'grandpa', 'big', 2, () => {
  const len = say([[0, 0.24, 'o', 1, '', 'u']], [[0, 170], [0.24, 102]], { rasp: 0.5, breath: 0.08, level: 0.6, drive: 0.3 })
  noise({ at: 0.2, d: 0.16, peak: 0.07, type: 'highpass', freq: 2200 })
  return len + 0.1
}, { say: 5, len: 0.8 })
def('gpSlip', 'grandpa', 'huge', 2, () => {
  say([[0, 0.92, 'u', 1, 'w', 'a']], [[0, 140], [0.15, 195], [0.3, 160], [0.45, 205], [0.6, 165], [0.75, 215], [0.92, 150]], { rasp: 0.45, breath: 0.06, level: 0.6, vibCents: 25 })
  const c = 0.98
  thump(52, { at: c, to: 26, d: 0.8, peak: 0.7 })
  tone(105, { at: c, type: 'triangle', a: 0.003, d: 0.25, peak: 0.3, slide: 50 })
  noise({ at: c, a: 0.004, d: 0.6, peak: 0.45, type: 'lowpass', freq: 900, sweep: 150 })
  noise({ at: c, d: 0.08, peak: 0.25, type: 'bandpass', freq: 1500, q: 0.7 })
  knock(130, { at: c + 0.02, peak: 0.25, d: 0.25 })
  cloud('rattle', { at: c + 0.02, peak: 0.4 })
  cloud('rattle', { at: c + 0.3, peak: 0.2, rate: 0.8 })
  return say([[0, 0.22, 'U', 0.7, '', 'm']], [[0, 110], [0.22, 88]], { at: c + 0.55, rasp: 0.6, breath: 0.1, level: 0.4 })
}, { say: 5, major: true, len: 2.4 })
def('gpGrunt', 'grandpa', 'big', 2, () =>
  say([[0, 0.42, 'E', 0.85, 'n'], [0.62, 0.55, 'E', 1, 'h', 'U']], [[0, 108], [0.42, 122], [0.62, 115], [1.17, 135]], { rasp: 0.85, breath: 0.1, level: 0.45, vib: 9, vibCents: 35, drive: 0.4 }),
{ say: 2, len: 1.6 })
def('gpYawn', 'grandpa', 'big', 2, () => {
  const len = say([[0, 1.55, 'a', 1, 'h', 'o'], [1.65, 0.45, 'm', 0.6]], [[0, 96], [0.3, 150], [0.75, 178], [1.25, 112], [1.55, 84], [1.65, 92], [2.1, 76]], { rasp: 0.4, breath: 0.16, level: 0.5, vibCents: 20 })
  noise({ at: 2.18, d: 0.02, peak: 0.08, type: 'bandpass', freq: 1500, q: 1.5 })
  noise({ at: 2.25, d: 0.015, peak: 0.06, type: 'bandpass', freq: 1800, q: 1.5 })
  return len + 0.2
}, { say: 1, len: 2.8 })
function snoreCycle() {
  // inhale: the soft palate flutters (a ~35 Hz buzz through an open "o") as the breath rushes in;
  // exhale: a breathy puff with a little whistle
  say([[0, 1.15, 'o', 1, '', 'a']], [[0, 30], [0.5, 38], [1.15, 33]], { rasp: 0.7, breath: 0.3, level: 0.6, vibCents: 0, chest: 0.3 })
  noise({ at: 1.45, a: 0.12, hold: 0.25, d: 0.45, peak: 0.08, type: 'bandpass', freq: 600, q: 0.9, sweep: 350 })
  tone(1180, { at: 1.5, a: 0.08, hold: 0.25, d: 0.35, peak: 0.03, glide: [[0.6, 0.82]], vib: [6, 25, 25] })
  return 2.4
}
def('gpSnore', 'grandpa', 'big', 2, snoreCycle, { say: 1, len: 2.8 })

// ---- House (3D) ----
group = 'House'
def('doorSlam', 'world', 'big', 2, () => {
  thump(rnd(68, 76), { to: 36, d: 0.45, peak: 0.55 })
  knock(rnd(115, 130), { peak: 0.45, d: 0.3 })
  noise({ a: 0.002, d: 0.18, peak: 0.35, type: 'lowpass', freq: 1600, sweep: 300 })
  noise({ d: 0.02, peak: 0.2, type: 'bandpass', freq: 2500, q: 0.8 })
  metal(rnd(1800, 2100), { at: 0.01, d: 0.12, peak: 0.05, ratios: [1, 2.4] })
  for (let i = 0; i < 4; i++) knock(rnd(250, 420), { at: 0.06 + i * rnd(0.03, 0.06), peak: rnd(0.03, 0.07), d: 0.05 })
}, { major: true, len: 1.4 })
def('doorClick', 'world', 'small', 1, () => {
  grain('tick', { peak: 0.18, rate: 1.4 })
  metal(rnd(2600, 3000), { at: 0.05, d: 0.06, peak: 0.07, ratios: [1, 1.7] })
  noise({ at: 0.05, d: 0.012, peak: 0.12, type: 'highpass', freq: 3500 })
  knock(480, { at: 0.055, peak: 0.08, d: 0.04 })
})
def('garageClunk', 'world', 'big', 2, () => {
  thump(64, { to: 34, d: 0.5, peak: 0.5 })
  metal(rnd(190, 230), { d: 0.9, peak: 0.12, ratios: [1, 2.32, 3.9, 6.1] })
  metal(rnd(520, 600), { d: 0.5, peak: 0.06, ratios: [1, 2.7] })
  noise({ d: 0.3, peak: 0.25, type: 'bandpass', freq: 1200, q: 0.6, sweep: 400 })
  cloud('rattle', { at: 0.05, peak: 0.15, rate: 0.7 })
}, { major: true, len: 1.6 })
def('windowThud', 'world', 'medium', 1, () => {
  knock(rnd(170, 200), { peak: 0.35, d: 0.14 })
  thump(90, { to: 50, d: 0.2, peak: 0.25 })
  noise({ d: 0.08, peak: 0.12, type: 'lowpass', freq: 1200 })
  for (let i = 0; i < 3; i++) grain('shard', { at: 0.01 + i * rnd(0.02, 0.05), peak: 0.06, rate: rnd(0.7, 0.9) })
})
def('flush', 'world', 'medium', 1, () => {
  knock(300, { peak: 0.18, d: 0.06 })
  metal(1500, { d: 0.1, peak: 0.04, ratios: [1, 2.5] })
  noise({ at: 0.15, a: 0.15, hold: 1.3, d: 1.1, peak: 0.28, type: 'bandpass', freq: 600, q: 0.8, sweeps: [[0.6, 1400], [1.2, 800], [1.8, 1200], [2.5, 500]] })
  noise({ at: 0.15, a: 0.2, hold: 1.2, d: 1, peak: 0.25, type: 'lowpass', freq: 300, brown: true })
  for (let i = 0; i < 12; i++) grain('drop', { at: 1.4 + Math.random() * 1.2, peak: rnd(0.05, 0.12), rate: rnd(0.4, 0.8) + i * 0.04 })
  noise({ at: 2.3, a: 0.3, hold: 0.6, d: 0.8, peak: 0.04, type: 'highpass', freq: 2500 })
}, { len: 4.4 })
def('thermostat', 'world', 'small', 1, () => {
  grain('tick', { peak: 0.22, rate: 1.6 })
  tone(3200, { d: 0.02, peak: 0.05 })
  for (let i = 0; i < 3; i++) grain('tick', { at: 0.06 + i * 0.05, peak: 0.08, rate: 2 })
  tone(40, { at: 0.25, type: 'sawtooth', a: 0.5, hold: 0.9, d: 0.7, peak: 0.06, glide: [[0.6, 2.8]], lp: 400 })
  noise({ at: 0.25, a: 0.5, hold: 0.9, d: 0.7, peak: 0.12, type: 'lowpass', freq: 250, sweeps: [[0.6, 800]] })
  noise({ at: 0.3, a: 0.05, d: 0.4, peak: 0.08, type: 'lowpass', freq: 400 })
}, { len: 2.8 })
// the toaster lever: a short ratchet, then the clunk of it catching
def('toasterArm', 'world', 'small', 1, () => {
  for (let i = 0; i < 4; i++) grain('tick', { at: i * 0.03, peak: 0.1, rate: rnd(1.2, 1.5) })
  knock(260, { at: 0.12, peak: 0.25, d: 0.08 })
  metal(900, { at: 0.12, d: 0.25, peak: 0.05, ratios: [1, 2.7, 4.1] })
  tone(600, { at: 0.12, d: 0.18, peak: 0.04, type: 'triangle', slide: 300 })
}, { len: 0.6 })
// POP: spring release, a boing, and the ding
def('toasterPop', 'world', 'medium', 2, () => {
  knock(320, { peak: 0.35, d: 0.08 })
  thump(140, { to: 70, d: 0.15, peak: 0.25 })
  tone(160, { a: 0.003, d: 0.45, peak: 0.16, type: 'triangle', slide: 620, vib: [22, 30, 0] })
  metal(1200, { d: 0.35, peak: 0.06, ratios: [1, 2.4, 3.8] })
  bell(1760, { at: 0.18, d: 1.2, peak: 0.12 })
  bell(2637, { at: 0.18, d: 0.8, peak: 0.04 })
}, { major: true, len: 1.6 })
// the telephone: a rotary dial winding round and clicking back, five digits
def('phoneDial', 'world', 'small', 1, () => {
  let at = 0
  for (let d = 0; d < 5; d++) {
    const n = 2 + Math.floor(Math.random() * 6)
    noise({ at, a: 0.02, hold: 0.12, d: 0.05, peak: 0.05, type: 'bandpass', freq: 2400, q: 3 })
    at += 0.2
    for (let i = 0; i < n; i++) grain('tick', { at: at + i * 0.065, peak: 0.13, rate: 1.7 })
    at += n * 0.065 + 0.12
  }
}, { len: 4 })
// picking the handset up / putting it down
def('phonePickup', 'world', 'small', 1, () => {
  knock(240, { peak: 0.3, d: 0.08 })
  metal(1900, { at: 0.01, d: 0.12, peak: 0.04, ratios: [1, 2.2] })
  grain('tick', { at: 0.03, peak: 0.12, rate: 1.1 })
}, { len: 0.5 })
// a wall light switch: a snappy click
def('lightSwitch', 'world', 'small', 1, () => {
  grain('tick', { peak: 0.26, rate: 0.9 })
  knock(950, { at: 0.005, peak: 0.1, d: 0.03 })
  tone(3600, { d: 0.015, peak: 0.03 })
}, { len: 0.3 })
// the ceiling fan's pull cord: chain click
def('fanCord', 'world', 'small', 1, () => {
  grain('tick', { peak: 0.2, rate: 1.1 })
  knock(700, { at: 0.02, peak: 0.08, d: 0.04 })
  tone(2400, { at: 0.02, d: 0.03, peak: 0.03 })
}, { len: 0.4 })
def('secretDoor', 'world', 'medium', 2, () => {
  noise({ a: 0.15, hold: 1.2, d: 0.35, peak: 0.3, type: 'bandpass', freq: 320, q: 1.1, brown: true, am: [9, 0.6] })
  creak({ d: 1.5, rate: 22, f: 520, q: 7, peak: 0.08, jitter: 0.35 })
  noise({ a: 0.2, hold: 1, d: 0.4, peak: 0.06, type: 'bandpass', freq: 1800, q: 0.8 })
  thump(70, { at: 1.6, to: 38, d: 0.4, peak: 0.4 })
  knock(140, { at: 1.6, peak: 0.25, d: 0.15 })
  const notes = [1175, 1480, 1760, 2349, 2960]
  for (let i = 0; i < notes.length; i++) bell(notes[i], { at: 1.75 + i * 0.07, d: 1.0, peak: 0.07 })
  noise({ at: 1.75, a: 0.1, d: 1.1, peak: 0.03, type: 'highpass', freq: 7000 })
}, { major: true, len: 3.4 })
def('safeOpen', 'world', 'small', 2, () => {
  for (let i = 0; i < 6; i++) grain('tick', { at: i * rnd(0.07, 0.1), peak: 0.12, rate: rnd(1.6, 1.9) })
  for (let i = 0; i < 4; i++) grain('tick', { at: 0.65 + i * 0.03, peak: 0.1, rate: 1.2 })
  thump(85, { at: 0.8, to: 45, d: 0.25, peak: 0.3 })
  metal(330, { at: 0.8, d: 0.5, peak: 0.1, ratios: [1, 2.6, 4.3] })
  knock(160, { at: 0.8, peak: 0.2, d: 0.1 })
  creak({ at: 0.95, d: 0.9, rate: 16, f: 420, q: 9, peak: 0.07 })
  for (let i = 0; i < 3; i++) bell([1568, 1976, 2349][i], { at: 1.2 + i * 0.08, d: 0.8, peak: 0.05 })
}, { major: true, len: 2.6 })
def('cageClose', 'world', 'medium', 1, () => {
  for (let i = 0; i < 3; i++) metal(rnd(560, 720) * (1 + i * 0.13), { at: i * 0.006, d: 0.7, peak: 0.07, ratios: [1, 2.4, 3.9, 5.6] })
  thump(110, { to: 60, d: 0.15, peak: 0.25 })
  noise({ d: 0.03, peak: 0.2, type: 'highpass', freq: 2500 })
  metal(2400, { at: 0.12, d: 0.12, peak: 0.06, ratios: [1, 1.7] })
  grain('tick', { at: 0.12, peak: 0.15, rate: 1.3 })
}, { len: 1.4 })
def('cageOpen', 'world', 'medium', 1, () => {
  grain('tick', { peak: 0.15, rate: 1.4 })
  metal(2300, { d: 0.08, peak: 0.05, ratios: [1, 1.6] })
  creak({ at: 0.06, d: 0.5, rate: 70, f: 1600, q: 12, peak: 0.06, f2: 1.6 })
  metal(640, { at: 0.5, d: 0.4, peak: 0.04, ratios: [1, 2.4, 3.9] })
}, { len: 1.2 })
def('fireCrackle', 'world', 'small', 0, () => {
  cloud('crackle', { peak: 0.4 })
  if (Math.random() < 0.35) knock(rnd(300, 600), { at: rnd(0.05, 0.25), peak: 0.06, d: 0.04 })
  noise({ a: 0.02, d: 0.25, peak: 0.04, type: 'bandpass', freq: 2500, q: 0.6 })
})
// loot catching fire: a breathy WHOOMPH + crackle
def('ignite', 'world', 'medium', 1, () => {
  whoosh({ d: 0.5, from: 200, to: 2200, peak: 0.24, q: 0.7 })
  thump(120, { to: 60, d: 0.25, peak: 0.18, a: 0.02 })
  noise({ a: 0.03, d: 0.6, peak: 0.16, type: 'lowpass', freq: 900, sweep: 2400 })
  cloud('crackle', { at: 0.15, peak: 0.4 })
}, { len: 1.2 })
// a bucket of water hitting a fire: slosh, drips, steam hiss
def('splash', 'world', 'medium', 1, () => {
  noise({ a: 0.005, d: 0.4, peak: 0.45, type: 'bandpass', freq: 1300, q: 0.5, sweep: 500 })
  thump(90, { to: 50, d: 0.2, peak: 0.2 })
  for (let i = 0; i < 6; i++) grain('drop', { at: 0.12 + i * rnd(0.04, 0.09), peak: 0.18, rate: rnd(0.8, 1.4) })
  noise({ at: 0.2, a: 0.12, hold: 0.3, d: 1.1, peak: 0.1, type: 'bandpass', freq: 3600, q: 0.6 })
}, { len: 1.9 })
// a burning gas can going up
def('gasBoom', 'world', 'huge', 2, () => {
  thump(80, { to: 30, d: 0.9, peak: 0.8 })
  noise({ d: 0.6, peak: 0.5, type: 'lowpass', freq: 1800, sweep: 200 })
  whoosh({ at: 0.04, d: 0.8, from: 3000, to: 200, peak: 0.22 })
  cloud('crackle', { at: 0.3, peak: 0.6 })
}, { len: 2.4 })
function tubeBell(f, at, d, pk) {
  for (const [r, a, dd] of [[0.5, 0.35, 1], [1, 1, 0.9], [2.01, 0.45, 0.55], [3.02, 0.25, 0.35], [4.2, 0.12, 0.2]]) tone(f * r, { at, a: 0.002, d: d * dd, peak: pk * a })
  noise({ at, d: 0.01, peak: pk * 0.4, type: 'bandpass', freq: f * 3, q: 1 })
}
def('clockChime', 'world', 'medium', 1, () => {
  const notes = [440, 523, 698, 659]
  for (let i = 0; i < notes.length; i++) tubeBell(notes[i], i * 0.55, 2.2, 0.08)
  tubeBell(174.6, 2.5, 3.2, 0.16)
}, { len: 6 })

// ---- Gadgets (3D unless noted) ----
group = 'Gadgets'
def('marbles', 'world', 'medium', 1, () => {
  cloud('marbles', { peak: 0.55 })
  noise({ a: 0.08, hold: 0.4, d: 0.5, peak: 0.04, type: 'bandpass', freq: 2600, q: 2, am: [28, 0.8] })
  knock(900, { peak: 0.06, d: 0.03 })
}, { len: 2.2 })
def('glue', 'world', 'medium', 1, () => {
  noise({ a: 0.004, d: 0.22, peak: 0.3, type: 'lowpass', freq: 2200, sweep: 300 })
  tone(260, { a: 0.006, d: 0.18, peak: 0.18, glide: [[0.05, 0.55], [0.18, 0.8]] })
  for (let i = 0; i < 5; i++) grain('drop', { at: 0.12 + i * rnd(0.06, 0.12), peak: rnd(0.08, 0.16), rate: rnd(0.35, 0.55) })
  noise({ at: 0.05, a: 0.05, d: 0.4, peak: 0.05, type: 'bandpass', freq: 600, q: 2, am: [14, 0.7] })
}, { len: 1.2 })
def('banana', 'world', 'small', 1, () => {
  noise({ a: 0.002, d: 0.06, peak: 0.25, type: 'bandpass', freq: 1100, q: 0.7 })
  noise({ d: 0.09, peak: 0.12, type: 'lowpass', freq: 500 })
  tone(230, { a: 0.003, d: 0.08, peak: 0.08, slide: 160 })
  noise({ at: 0.05, d: 0.05, peak: 0.05, type: 'bandpass', freq: 2200, q: 1.5 })
})
def('alarmSmash', 'world', 'big', 2, () => {
  thump(110, { to: 50, d: 0.25, peak: 0.45 })
  metal(rnd(380, 430), { d: 0.35, peak: 0.12, ratios: [1, 2.5, 4.2] })
  metal(2300, { d: 0.25, peak: 0.08, ratios: [1, 2.32, 4.08] })
  metal(2600, { d: 0.2, peak: 0.06, ratios: [1, 2.32] })
  noise({ d: 0.05, peak: 0.3, type: 'highpass', freq: 1800 })
  tone(320, { at: 0.06, a: 0.005, d: 0.7, peak: 0.08, type: 'triangle', vib: [16, 120, 10], glide: [[0.7, 0.8]] })
  cloud('rattle', { at: 0.03, peak: 0.25, rate: 1.3 })
}, { major: true, len: 1.4 })
// the fire extinguisher's foam blast: a pressurised WHOOSH
def('spray', 'world', 'medium', 1, () => {
  thump(110, { to: 60, d: 0.15, peak: 0.22 })
  noise({ a: 0.02, hold: 0.7, d: 0.4, peak: 0.32, type: 'bandpass', freq: 2600, q: 0.5 })
  noise({ a: 0.01, hold: 0.6, d: 0.3, peak: 0.2, type: 'lowpass', freq: 600 })
}, { len: 1.6 })
def('smoke', 'world', 'medium', 1, () => {
  thump(95, { to: 45, d: 0.3, peak: 0.3, a: 0.01 })
  noise({ a: 0.02, d: 0.45, peak: 0.35, type: 'lowpass', freq: 1200, sweep: 300 })
  noise({ at: 0.08, a: 0.15, hold: 0.5, d: 0.8, peak: 0.08, type: 'bandpass', freq: 3800, q: 0.6 })
}, { len: 1.8 })
def('potion', 'world', 'medium', 1, () => {
  noise({ d: 0.03, peak: 0.35, type: 'highpass', freq: 1800 })
  metal(rnd(2900, 3400), { d: 0.2, peak: 0.06, ratios: [1, 2.32, 4.25] })
  cloud('glassTinkle', { peak: 0.3, rate: 1.15 })
  cloud('fizz', { at: 0.1, peak: 0.25 })
  tone(520, { at: 0.12, a: 0.25, d: 0.7, peak: 0.05, glide: [[0.9, 3]], vib: [7, 30, 30] })
  const notes = [1319, 1760, 2093, 2637]
  for (let i = 0; i < notes.length; i++) bell(notes[i], { at: 0.25 + i * 0.08, d: 0.6, peak: 0.035 })
}, { len: 1.8 })
def('sleepZ', 'world', 'medium', 1, () => {
  const notes = [1175, 988, 784]
  for (let i = 0; i < 3; i++) bell(notes[i], { at: i * 0.18, d: 0.9, peak: 0.06 })
  tone(150, { at: 0.15, a: 0.15, hold: 0.25, d: 0.3, peak: 0.035, type: 'sawtooth', lp: 900, vib: [30, 40, 40], glide: [[0.7, 0.85]] })
}, { len: 1.6 })
def('xrayOn', 'ui', 'small', 1, () => {
  scale(1.4)
  tone(300, { a: 0.01, d: 0.4, peak: 0.08, glide: [[0.35, 8]], vib: [40, 300, 0] })
  whoosh({ d: 0.4, from: 600, to: 6000, peak: 0.07, q: 2 })
  metal(2637, { at: 0.35, d: 0.7, peak: 0.05, ratios: [1, 1.5, 2.01] })
  tone(1760, { at: 0.42, d: 0.04, peak: 0.05, type: 'square', lp: 4000 })
  tone(2350, { at: 0.5, d: 0.04, peak: 0.04, type: 'square', lp: 4000 })
}, { len: 1.4 })
def('drink', 'ui', 'small', 1, () => {
  grain('tick', { peak: 0.15, rate: 2.2 })
  noise({ at: 0.01, a: 0.004, d: 0.28, peak: 0.25, type: 'highpass', freq: 3000, sweep: 5000 })
  cloud('fizz', { at: 0.05, peak: 0.2 })
  for (let i = 0; i < 3; i++) {
    const at = 0.55 + i * 0.32
    tone(rnd(170, 200), { at, a: 0.01, d: 0.07, peak: 0.16, glide: [[0.06, 0.6]] })
    noise({ at, d: 0.05, peak: 0.08, type: 'bandpass', freq: 700, q: 2 })
    grain('drop', { at: at + 0.04, peak: 0.08, rate: 0.5 })
  }
}, { len: 1.8 })
def('bazookaFire', 'world', 'huge', 2, () => {
  thump(150, { to: 40, d: 0.3, peak: 0.6 })
  noise({ d: 0.08, peak: 0.4, type: 'lowpass', freq: 2400 })
  whoosh({ d: 0.6, from: 2400, to: 500, peak: 0.25, q: 0.7, shape: 0.2 })
  tone(210, { a: 0.01, d: 0.3, peak: 0.12, slide: 80, type: 'triangle' })
  noise({ a: 0.002, d: 0.06, peak: 0.25, type: 'bandpass', freq: 1500, q: 1 })
}, { major: true, len: 1.2 })
def('foamBoom', 'world', 'huge', 2, () => {
  thump(85, { to: 34, d: 0.75, peak: 0.6, a: 0.01 })
  noise({ a: 0.01, d: 0.7, peak: 0.35, type: 'lowpass', freq: 900, sweep: 160 })
  noise({ d: 0.12, peak: 0.25, type: 'bandpass', freq: 1300, q: 0.7 })
  for (let i = 0; i < 8; i++) grain('drop', { at: 0.1 + Math.random() * 0.6, peak: rnd(0.05, 0.12), rate: rnd(0.6, 1.4) })
}, { major: true, len: 1.4 })
def('stars', 'world', 'small', 1, () => {
  scale(1.4)
  const notes = [2093, 2637, 3136, 2637, 2349, 2794, 3520, 2794]
  for (let i = 0; i < notes.length; i++) bell(notes[i], { at: i * 0.085, d: 0.35, peak: 0.045 * (i % 2 ? 0.8 : 1), pan: Math.sin(i * 0.785) * 0.7 })
  tone(1400, { a: 0.1, hold: 0.4, d: 0.3, peak: 0.02, vib: [6, 200, 200] })
}, { len: 1.4 })

// ---- Heist stingers (2D) ----
group = 'Heist'
def('spotted', 'ui', 'small', 2, () => {
  tone(392, { type: 'sawtooth', a: 0.005, d: 0.16, peak: 0.08, slide: 1175, lp: 3000 })
  const h = 0.12
  for (const f of [294, 415, 587, 831]) tone(f, { at: h, type: 'sawtooth', a: 0.004, d: 0.4, peak: 0.045, lp: 2800, detune: rnd(-10, 10) })
  thump(110, { at: h, to: 45, d: 0.3, peak: 0.45 })
  noise({ at: h, d: 0.3, peak: 0.2, type: 'highpass', freq: 2500 })
  metal(2793, { at: h, d: 0.6, peak: 0.06, ratios: [1, 2.01, 3.0] })
}, { major: true, len: 1.2 })
def('lost', 'ui', 'small', 2, () => {
  scale(1.8)
  tone(1046, { a: 0.02, d: 0.6, peak: 0.06, slide: 523, type: 'triangle' })
  noise({ a: 0.05, d: 0.5, peak: 0.05, type: 'bandpass', freq: 1800, sweep: 500, q: 0.8 })
  const chord = [349, 440, 523, 659]
  for (let i = 0; i < chord.length; i++) tone(chord[i], { at: 0.35 + i * 0.02, a: 0.08, hold: 0.3, d: 0.7, peak: 0.03, type: 'triangle' })
  bell(1319, { at: 0.4, d: 0.9, peak: 0.035 })
}, { major: true, len: 1.8 })
def('caught', 'ui', 'small', 2, () => {
  const hits = [[0, 147, 0.14], [0.22, 139, 0.14], [0.44, 131, 0.7]]
  for (const [at, f, len] of hits) {
    for (const r of [1, 1.19, 1.5, 2]) brass(f * r, { at, d: len, peak: 0.05 })
    thump(f * 0.5, { at, to: f * 0.3, d: 0.3, peak: 0.35 })
  }
  noise({ at: 0.44, d: 0.9, peak: 0.12, type: 'highpass', freq: 3500 })
  tone(262, { at: 1.15, type: 'sawtooth', a: 0.03, d: 0.6, peak: 0.06, glide: [[0.6, 0.5]], lp: 900, vib: [5, 60, 60] })
}, { major: true, len: 2.2 })
def('escape', 'ui', 'small', 2, () => {
  whoosh({ d: 0.5, from: 200, to: 4500, peak: 0.15, shape: 0.8 })
  const h = 0.35
  for (const f of [523, 659, 784, 1047]) brass(f, { at: h, d: 0.7, peak: 0.045 })
  const run = [1047, 1319, 1568, 2093, 2637]
  for (let i = 0; i < run.length; i++) bell(run[i], { at: h + i * 0.06, d: 0.9, peak: 0.05, pan: (i - 2) * 0.2 })
  thump(120, { at: h, to: 50, d: 0.3, peak: 0.35 })
  noise({ at: h, d: 0.8, peak: 0.08, type: 'highpass', freq: 4500 })
}, { major: true, len: 2 })
def('vanDoor', 'world', 'medium', 1, () => {
  noise({ a: 0.03, hold: 0.32, d: 0.1, peak: 0.2, type: 'bandpass', freq: 900, q: 0.9, am: [26, 0.7], sweeps: [[0.4, 1300]] })
  noise({ a: 0.05, hold: 0.3, d: 0.1, peak: 0.12, type: 'lowpass', freq: 220, brown: true })
  thump(80, { at: 0.45, to: 45, d: 0.3, peak: 0.45 })
  knock(150, { at: 0.45, peak: 0.3, d: 0.12 })
  metal(1100, { at: 0.46, d: 0.2, peak: 0.06, ratios: [1, 2.3, 3.7] })
}, { len: 1.2 })
function heartbeat(k) {
  thump(62, { to: 42, d: 0.12, peak: 0.25 + 0.4 * k, a: 0.006 })
  noise({ a: 0.004, d: 0.08, peak: 0.08 + 0.15 * k, type: 'lowpass', freq: 160 + 120 * k, brown: true })
  thump(70, { at: 0.24 - 0.06 * k, to: 46, d: 0.1, peak: 0.16 + 0.3 * k, a: 0.006 })
}
def('heartbeat', 'ui', 'small', 1, heartbeat, { k: 0.6 })

// --- play(): one-shots, 2D or 3D ----------------------------------------------------------------------
const lis = { x: 0, y: 0, z: 0 } // listener position (from frame)
const lastAt = new Map()
let lastMajor = -10
let gpUntil = 0
let gpRank = 0
let gpShot = null
function makePanner(D) {
  const p = ctx.createPanner()
  p.panningModel = PANNING
  p.distanceModel = 'inverse'
  p.refDistance = D.ref
  p.rolloffFactor = AUDIO.rolloff
  p.maxDistance = 10000
  return p
}
function placePanner(p, x, y, z, smooth) {
  if (p.positionX) {
    if (smooth) {
      const t = ctx.currentTime
      p.positionX.setTargetAtTime(x, t, 0.03)
      p.positionY.setTargetAtTime(y, t, 0.03)
      p.positionZ.setTargetAtTime(z, t, 0.03)
    } else {
      p.positionX.value = x
      p.positionY.value = y
      p.positionZ.value = z
    }
  } else p.setPosition(x, y, z)
}
const airCut = (d, range) => Math.min(NYQ, Math.max(300, 20000 * Math.pow(AUDIO.airAtRange / 20000, d / range)))

export function play(name, opts = {}) {
  try {
    if (!ready()) return false
    const d = DEFS[name]
    if (!d) return false
    return fire(d, opts || NO)
  } catch {
    OUT = null
    SHOT = null
    return false
  }
}
function fire(d, o) {
  const now = ctx.currentTime
  const mat = typeof o.mat === 'string' ? o.mat : ''
  const key = mat ? d.name + ':' + mat : d.name
  const last = lastAt.get(key)
  if (last !== undefined && now - last < d.gap) return false
  if (d.minor && now - lastMajor < AUDIO.minorYield) return false
  if (voices >= (d.prio === 0 ? LOW : d.prio === 2 ? HIGH : CAP)) return false
  if (d.say && now < gpUntil && d.say <= gpRank) return false
  const k = clamp01(num(o.strength, d.k))
  let vol = Math.min(4, Math.max(0, num(o.vol, 1)))
  const g = ctx.createGain()
  const shot = { n: 0, g, f: null, p: null, dead: false }
  const at = o.at
  if (at && typeof at === 'object') {
    const D = AUDIO.dist[d.dist] || AUDIO.dist.medium
    const range = D.range * (d.scale ? AUDIO.strengthRange.base + AUDIO.strengthRange.span * k : 1)
    const x = num(at.x, 0)
    const y = num(at.y, 0)
    const z = num(at.z, 0)
    const dist = Math.hypot(x - lis.x, y - lis.y, z - lis.z)
    if (dist >= range) return false
    vol *= clamp01((range - dist) / (range * AUDIO.fadeFrac))
    const f = filter('lowpass', airCut(dist, range), 0.5)
    const p = makePanner(D)
    placePanner(p, x, y, z, false)
    g.connect(f)
    f.connect(p)
    p.connect(bus[d.bus])
    shot.f = f
    shot.p = p
    IS3D = true
  } else {
    g.connect(bus[d.bus])
    IS3D = false
  }
  g.gain.value = vol
  OUT = g
  T = now + 0.01
  P = Math.min(4, Math.max(0.25, num(o.pitch, 1))) * (1 + rnd(-AUDIO.pitchJitter, AUDIO.pitchJitter))
  SHOT = shot
  let len = 0
  try {
    len = d.fn(k, o) || 0
  } finally {
    OUT = null
    SHOT = null
    IS3D = false
  }
  if (shot.n === 0) endShot(shot)
  lastAt.set(key, now)
  if (d.major) lastMajor = now
  if (d.say && len > 0) {
    // a new line interrupts a lower-ranked one that is still talking
    if (gpShot && !gpShot.dead && now < gpUntil) gpShot.g.gain.setTargetAtTime(0, now, 0.04)
    gpUntil = now + len
    gpRank = d.say
    gpShot = shot
  }
  return true
}

// --- Loops --------------------------------------------------------------------------------------------
// loop(name, { at, param, vol }) -> handle { setPos, setParam, setVol, stop }. Handles made before
// unlock stay dormant and are built on the first frame after it; over AUDIO.maxLoops they wait.
function lsrc(buf, rate = 1, offset = -1) {
  const s = ctx.createBufferSource()
  s.buffer = buf
  s.loop = true
  s.playbackRate.value = rate
  s.start(0, offset >= 0 ? offset : Math.random() * buf.duration * 0.9)
  return s
}
function losc(type, f) {
  const o = ctx.createOscillator()
  o.type = type
  o.frequency.value = f
  o.start()
  return o
}
// one period of an alarm-clock hammer: a 0.6 ms attack, then a fast exponential decay
let alarmEnvBuf = null
function alarmEnv() {
  if (alarmEnvBuf && alarmEnvBuf.sampleRate === ctx.sampleRate) return alarmEnvBuf
  const sr = ctx.sampleRate
  const n = Math.round(sr / 17)
  const b = ctx.createBuffer(1, n, sr)
  const d = b.getChannelData(0)
  const atk = sr * 0.0006
  for (let i = 0; i < n; i++) d[i] = (i < atk ? i / atk : 1) * Math.exp(-i / (sr * 0.012))
  alarmEnvBuf = b
  return b
}
// Each spec: bus, dist, param (default), build(h) -> { sources, param(v, t), tick?(now, h) }.
// Nodes connect to h.out; tick() may schedule one-shot events (the helpers write to h.out).
const LOOPS = {
  doorCreak: {
    bus: 'world', dist: 'medium', param: 0.5,
    build(h) {
      const saw = losc('sawtooth', 30)
      const jit = lsrc(brownBuf)
      const jl = filter('lowpass', 12, 0.7)
      const jg = gain(10)
      jit.connect(jl)
      jl.connect(jg)
      jg.connect(saw.frequency)
      const b1 = filter('bandpass', 480, 9)
      const b2 = filter('bandpass', 1150, 12)
      const b3 = filter('bandpass', 2500, 10)
      const g2 = gain(0.55)
      const g3 = gain(0.25)
      const lvl = gain(0)
      saw.connect(b1)
      saw.connect(b2)
      saw.connect(b3)
      b1.connect(lvl)
      b2.connect(g2)
      g2.connect(lvl)
      b3.connect(g3)
      g3.connect(lvl)
      lvl.connect(h.out)
      let cur = 0
      let next = 0
      return {
        sources: [saw, jit],
        param(v, t) {
          const k = v < 0.03 ? 0 : v
          cur = k > 0 ? (0.3 + 0.7 * k) * 5 : 0
          saw.frequency.setTargetAtTime(14 + k * 60, t, 0.06)
          jg.gain.setTargetAtTime(6 + k * 25, t, 0.1)
          b1.frequency.setTargetAtTime(440 + k * 120, t, 0.1)
          lvl.gain.setTargetAtTime(cur, t, 0.05)
        },
        tick(now) {
          if (now < next || cur <= 0) return
          next = now + rnd(0.04, 0.11)
          lvl.gain.setTargetAtTime(cur * rnd(0.5, 1.1), now, 0.015)
        },
      }
    },
  },
  garageRattle: {
    bus: 'world', dist: 'big', param: 0.5,
    build(h) {
      const n = lsrc(noiseBuf)
      const br = lsrc(brownBuf)
      const bp = filter('bandpass', 1800, 1.4)
      const bp2 = filter('bandpass', 3400, 6)
      const g2 = gain(1.5)
      const gate = gain(0.5)
      const lfo = losc('square', 8)
      const lf = filter('lowpass', 70, 0.7)
      const lg = gain(0.5)
      lfo.connect(lf)
      lf.connect(lg)
      lg.connect(gate.gain)
      n.connect(bp)
      n.connect(bp2)
      bp2.connect(g2)
      bp.connect(gate)
      g2.connect(gate)
      const rl = filter('lowpass', 150, 0.8)
      const rg = gain(0.8)
      br.connect(rl)
      rl.connect(rg)
      const lvl = gain(0)
      gate.connect(lvl)
      rg.connect(lvl)
      lvl.connect(h.out)
      return {
        sources: [n, br, lfo],
        param(v, t) {
          lfo.frequency.setTargetAtTime(5 + v * 22, t, 0.1)
          lvl.gain.setTargetAtTime(v < 0.03 ? 0 : 0.15 + v * 0.45, t, 0.08)
        },
      }
    },
  },
  windowSlide: {
    bus: 'world', dist: 'medium', param: 0.5,
    build(h) {
      const n = lsrc(noiseBuf)
      const bp = filter('bandpass', 700, 1.1)
      const ng = gain(1)
      n.connect(bp)
      bp.connect(ng)
      const saw = losc('sawtooth', 120)
      const sq = filter('bandpass', 1900, 14)
      const sg = gain(1.2)
      saw.connect(sq)
      sq.connect(sg)
      const lvl = gain(0)
      ng.connect(lvl)
      sg.connect(lvl)
      lvl.connect(h.out)
      let next = 0
      let base = 120
      return {
        sources: [n, saw],
        param(v, t) {
          base = 80 + v * 160
          saw.frequency.setTargetAtTime(base, t, 0.05)
          bp.frequency.setTargetAtTime(600 + v * 500, t, 0.08)
          lvl.gain.setTargetAtTime(v < 0.03 ? 0 : 0.1 + 0.5 * v, t, 0.06)
        },
        tick(now) {
          if (now < next) return
          next = now + rnd(0.05, 0.12)
          saw.frequency.setTargetAtTime(base * rnd(0.85, 1.15), now, 0.03)
        },
      }
    },
  },
  alarmRing: {
    bus: 'world', dist: 'huge', param: 1,
    build(h) {
      const envB = alarmEnv()
      const eA = lsrc(envB, 1, 0)
      const eB = lsrc(envB, 1, envB.duration / 2)
      const gA = gain(0)
      const gB = gain(0)
      eA.connect(gA.gain)
      eB.connect(gB.gain)
      const fA = 2350 * rnd(0.97, 1.03)
      const fB = fA * 1.13
      const srcs = [eA, eB]
      for (const [r, a] of [[1, 0.5], [2.32, 0.25], [4.08, 0.12]]) {
        const oa = losc('sine', fA * r)
        const ga = gain(a)
        oa.connect(ga)
        ga.connect(gA)
        const ob = losc('sine', fB * r)
        const gb = gain(a)
        ob.connect(gb)
        gb.connect(gB)
        srcs.push(oa, ob)
      }
      const n = lsrc(noiseBuf)
      const hf = filter('bandpass', 4200, 1)
      const gH = gain(0)
      const hl = gain(0.25)
      n.connect(hf)
      hf.connect(gH)
      eA.connect(hl)
      hl.connect(gH.gain)
      const mix = gain(1)
      gA.connect(mix)
      gB.connect(mix)
      gH.connect(mix)
      const wob = losc('sine', 0.8)
      const wg = gain(0.12)
      const lvl = gain(0.5)
      wob.connect(wg)
      wg.connect(lvl.gain)
      mix.connect(lvl)
      lvl.connect(h.out)
      srcs.push(n, wob)
      return {
        sources: srcs,
        param(v, t) {
          lvl.gain.setTargetAtTime(0.15 + 0.35 * v, t, 0.05)
        },
      }
    },
  },
  tvStatic: {
    bus: 'world', dist: 'medium', param: 0.6,
    build(h) {
      const n = lsrc(noiseBuf)
      const hp = filter('highpass', 1200, 0.7)
      const pk = filter('peaking', 4500, 1)
      pk.gain.value = 6
      const ng = gain(0.35)
      n.connect(hp)
      hp.connect(pk)
      pk.connect(ng)
      const buzz = losc('sawtooth', 60)
      const bf = filter('bandpass', 180, 1)
      const bg = gain(0.12)
      buzz.connect(bf)
      bf.connect(bg)
      const lvl = gain(0)
      ng.connect(lvl)
      bg.connect(lvl)
      lvl.connect(h.out)
      let next = 0
      let level = 0
      return {
        sources: [n, buzz],
        param(v, t) {
          level = 0.2 + 0.8 * v
          lvl.gain.setTargetAtTime(level * 0.5, t, 0.05)
        },
        tick(now) {
          if (now < next) return
          next = now + rnd(0.08, 0.4)
          grain('spark', { peak: rnd(0.05, 0.2) * level, rate: rnd(0.7, 1.3) })
        },
      }
    },
  },
  // an old telephone bell: hammer trill between two bells, 1.4 s on / 1 s off (the handset rattles along)
  phoneRing: {
    bus: 'world', dist: 'big', param: 1,
    build() {
      let t0 = -1
      let next = 0
      let n = 0
      let lvl = 1
      return {
        sources: [],
        param(v) {
          lvl = v
        },
        tick(now) {
          if (t0 < 0) t0 = now
          if ((now - t0) % 2.4 > 1.4 || now < next) return
          next = now + 0.045
          n++
          bell(n % 2 ? 1320 : 1490, { d: 0.22, peak: 0.075 * lvl })
          if (n % 2) knock(1900, { d: 0.02, peak: 0.035 * lvl })
        },
      }
    },
  },
  // the toaster's timer while it heats: ticking + a faint element hum
  toasterTick: {
    bus: 'world', dist: 'small', param: 1,
    build(h) {
      const hum = losc('sawtooth', 100)
      const hf = filter('lowpass', 300, 0.7)
      const hg = gain(0.03)
      hum.connect(hf)
      hf.connect(hg)
      const lvl = gain(0)
      hg.connect(lvl)
      lvl.connect(h.out)
      let next = 0
      return {
        sources: [hum],
        param(v, t) {
          lvl.gain.setTargetAtTime(v, t, 0.05)
        },
        tick(now) {
          if (now < next) return
          next = now + 0.14
          grain('tick', { peak: 0.14, rate: rnd(1.9, 2.1) })
        },
      }
    },
  },
  // the ceiling fan: an airy whoosh pulsing at the blade-pass rate + motor hum (param = spin 0..1)
  fanWhir: {
    bus: 'world', dist: 'medium', param: 0.5,
    build(h) {
      const n = lsrc(brownBuf)
      const bp = filter('bandpass', 500, 0.6)
      const am = gain(0.5)
      n.connect(bp)
      bp.connect(am)
      const lfo = losc('sine', 1.5)
      const lg = gain(0.4)
      lfo.connect(lg)
      lg.connect(am.gain)
      const hum = losc('sine', 120)
      const hg = gain(0.02)
      hum.connect(hg)
      const lvl = gain(0)
      am.connect(lvl)
      hg.connect(lvl)
      lvl.connect(h.out)
      return {
        sources: [n, lfo, hum],
        param(v, t) {
          lfo.frequency.setTargetAtTime(0.3 + v * 1.3, t, 0.2)
          bp.frequency.setTargetAtTime(300 + v * 500, t, 0.2)
          lvl.gain.setTargetAtTime(v * 0.6, t, 0.2)
        },
      }
    },
  },
  fireplace: {
    bus: 'world', dist: 'medium', param: 0.6,
    build(h) {
      const br = lsrc(brownBuf)
      const rl = filter('lowpass', 450, 0.7)
      const roar = gain(0.6)
      br.connect(rl)
      rl.connect(roar)
      const n = lsrc(noiseBuf)
      const hb = filter('bandpass', 2800, 0.7)
      const hiss = gain(0.04)
      n.connect(hb)
      hb.connect(hiss)
      const fl = filter('lowpass', 6, 0.7)
      const fg = gain(0.15)
      br.connect(fl)
      fl.connect(fg)
      fg.connect(hiss.gain)
      const lvl = gain(0)
      roar.connect(lvl)
      hiss.connect(lvl)
      lvl.connect(h.out)
      let next = 0
      let k = 0.6
      return {
        sources: [br, n],
        param(v, t) {
          k = v
          lvl.gain.setTargetAtTime(0.25 + 0.75 * v, t, 0.2)
        },
        tick(now) {
          if (now < next) return
          next = now + rnd(0.05, 0.3) / (0.4 + k)
          const r = Math.random()
          if (r < 0.15) cloud('crackle', { peak: 0.25 + 0.25 * k })
          else if (r < 0.18) knock(rnd(300, 600), { peak: 0.05, d: 0.04 })
          else grain('pop', { peak: rnd(0.08, 0.35) * (0.5 + k), rate: rnd(0.6, 1.6) })
        },
      }
    },
  },
  fridgeHum: {
    bus: 'world', dist: 'small', param: 1,
    build(h) {
      const o1 = losc('sine', 50)
      const o2 = losc('triangle', 100.35)
      const o3 = losc('sine', 150.2)
      const br = lsrc(brownBuf)
      const nl = filter('lowpass', 300, 0.7)
      const g1 = gain(0.5)
      const g2 = gain(0.14)
      const g3 = gain(0.05)
      const gn = gain(0.3)
      const lp = filter('lowpass', 600, 0.7)
      o1.connect(g1)
      o2.connect(g2)
      o3.connect(g3)
      br.connect(nl)
      nl.connect(gn)
      g1.connect(lp)
      g2.connect(lp)
      g3.connect(lp)
      gn.connect(lp)
      const lvl = gain(0)
      lp.connect(lvl)
      lvl.connect(h.out)
      return {
        sources: [o1, o2, o3, br],
        param(v, t) {
          lvl.gain.setTargetAtTime(0.35 * v, t, 0.3)
        },
      }
    },
  },
  clockTick: {
    bus: 'world', dist: 'medium', param: 0.5,
    build(h) {
      let next = 0
      let tick = true
      let period = 1
      return {
        sources: [],
        param(v) {
          period = 1.15 - v * 0.3
        },
        tick(now) {
          if (next < now) next = now + 0.02
          if (next > now + 0.15) return
          const at = next - T
          grain('tick', { at, peak: 0.25, rate: tick ? 1 : 0.82 })
          knock(tick ? 900 : 760, { at, peak: 0.04, d: 0.05 })
          grain('tick', { at: at + 0.012, peak: 0.06, rate: 1.6 })
          tick = !tick
          next += period
        },
      }
    },
  },
  snore: {
    bus: 'grandpa', dist: 'big', param: 0.5,
    build() {
      let next = 0
      return {
        sources: [],
        param() {},
        tick(now) {
          if (next < now) next = now + 0.05
          if (next > now + 0.15) return
          const keep = T
          T = next
          snoreCycle()
          T = keep
          next += 2.4 + rnd(0.3, 0.9)
        },
      }
    },
  },
  rainOnRoof: {
    bus: 'world', dist: 'huge', param: 0.5,
    build(h) {
      const n = lsrc(noiseBuf)
      const b = filter('bandpass', 2500, 0.5)
      const bg = gain(0.1)
      const l = filter('lowpass', 900, 0.7)
      const lg = gain(0.08)
      n.connect(b)
      b.connect(bg)
      n.connect(l)
      l.connect(lg)
      const br = lsrc(brownBuf)
      const rl = filter('lowpass', 200, 0.7)
      const rg = gain(0.15)
      br.connect(rl)
      rl.connect(rg)
      const lvl = gain(0)
      bg.connect(lvl)
      lg.connect(lvl)
      rg.connect(lvl)
      lvl.connect(h.out)
      let next = 0
      let k = 0.5
      return {
        sources: [n, br],
        param(v, t) {
          k = v
          lvl.gain.setTargetAtTime(0.2 + 0.8 * v, t, 0.3)
        },
        tick(now) {
          if (now < next) return
          next = now + rnd(0.02, 0.12) / (0.3 + k)
          grain('drop', { peak: rnd(0.02, 0.08), rate: rnd(1, 2.4), pan: rnd(-0.8, 0.8) })
        },
      }
    },
  },
  // the hallway smoke alarm: three shrill beeps, a pause, again
  smokeAlarm: {
    bus: 'world', dist: 'huge', param: 1,
    build(h) {
      const o = losc('square', 3150)
      const bp = filter('bandpass', 3150, 3)
      const gate = gain(0)
      o.connect(bp)
      bp.connect(gate)
      const lvl = gain(0.4)
      gate.connect(lvl)
      lvl.connect(h.out)
      let next = 0
      return {
        sources: [o],
        param(v, t) {
          lvl.gain.setTargetAtTime(0.15 + 0.3 * v, t, 0.05)
        },
        tick(now) {
          if (now < next) return
          next = now + 1.6
          for (let i = 0; i < 3; i++) {
            gate.gain.setValueAtTime(0.7, now + i * 0.32)
            gate.gain.setValueAtTime(0, now + i * 0.32 + 0.19)
          }
        },
      }
    },
  },
  smokeHiss: {
    bus: 'world', dist: 'medium', param: 0.6,
    build(h) {
      const n = lsrc(noiseBuf)
      const b = filter('bandpass', 3200, 0.6)
      const am = gain(0.7)
      n.connect(b)
      b.connect(am)
      const br = lsrc(brownBuf)
      const fl = filter('lowpass', 4, 0.7)
      const fg = gain(0.6)
      br.connect(fl)
      fl.connect(fg)
      fg.connect(am.gain)
      const l = filter('lowpass', 600, 0.7)
      const lg = gain(0.5)
      n.connect(l)
      l.connect(lg)
      const lvl = gain(0)
      am.connect(lvl)
      lg.connect(lvl)
      lvl.connect(h.out)
      return {
        sources: [n, br],
        param(v, t) {
          lvl.gain.setTargetAtTime(0.25 * v, t, 0.15)
          b.frequency.setTargetAtTime(2400 + v * 1600, t, 0.2)
        },
      }
    },
  },
  grabHum: {
    bus: 'world', dist: 'tiny', param: 0.3,
    build(h) {
      const o1 = losc('sine', 110)
      const o2 = losc('sine', 165.5)
      const lp = filter('lowpass', 900, 0.7)
      const trem = gain(0.75)
      const lfo = losc('sine', 5)
      const lg = gain(0.25)
      lfo.connect(lg)
      lg.connect(trem.gain)
      const g2 = gain(0.5)
      o1.connect(lp)
      o2.connect(g2)
      g2.connect(lp)
      lp.connect(trem)
      const saw = losc('sawtooth', 30)
      const rb = filter('bandpass', 900, 7)
      const rg = gain(0)
      saw.connect(rb)
      rb.connect(rg)
      const lvl = gain(0)
      trem.connect(lvl)
      rg.connect(lvl)
      lvl.connect(h.out)
      return {
        sources: [o1, o2, lfo, saw],
        param(v, t) {
          const f = 90 + v * 150
          o1.frequency.setTargetAtTime(f, t, 0.08)
          o2.frequency.setTargetAtTime(f * 1.5 * 1.004, t, 0.08)
          lfo.frequency.setTargetAtTime(4 + v * 7, t, 0.1)
          saw.frequency.setTargetAtTime(22 + v * 50, t, 0.08)
          rg.gain.setTargetAtTime(v * v * 2.5, t, 0.08)
          lvl.gain.setTargetAtTime(0.05 + v * 0.1, t, 0.08)
        },
      }
    },
  },
}
const loops = [] // live handles (dormant, built, or fading out)
let built = 0
const noop = () => {}
const DUMMY = Object.freeze({ setPos: noop, setParam: noop, setVol: noop, stop: noop, dummy: true })
class LoopHandle {
  constructor(name, spec, o) {
    this.name = name
    this.spec = spec
    const at = o.at
    this.pos = at && typeof at === 'object' ? { x: num(at.x, 0), y: num(at.y, 0), z: num(at.z, 0) } : null
    this.param = clamp01(num(o.param, spec.param))
    this.vol = Math.max(0, num(o.vol, 1))
    this.n = null
    this.out = null
    this.air = null
    this.panner = null
    this.dirty = false
    this.dead = false
    this.lastGain = -1
    this.lastAir = -1
  }
  setPos(x, y, z) {
    try {
      if (x && typeof x === 'object') {
        z = x.z
        y = x.y
        x = x.x
      }
      if (!this.pos) this.pos = { x: 0, y: 0, z: 0 }
      this.pos.x = num(x, 0)
      this.pos.y = num(y, 0)
      this.pos.z = num(z, 0)
      this.dirty = true
      if (this.n && !this.panner) attachPanner(this)
    } catch {}
    return this
  }
  setParam(v) {
    try {
      this.param = clamp01(num(v, 0))
      if (this.n) this.n.param(this.param, ctx.currentTime)
    } catch {}
    return this
  }
  setVol(v) {
    try {
      this.vol = Math.max(0, num(v, 1))
    } catch {}
    return this
  }
  stop() {
    try {
      if (this.dead) return
      this.dead = true
      if (!this.n) return
      built--
      const t = ctx.currentTime
      this.out.gain.cancelScheduledValues(t)
      this.out.gain.setTargetAtTime(0, t, 0.08)
      const nodes = [this.out, this.air, this.panner]
      for (const s of this.n.sources) {
        try {
          s.stop(t + 0.5)
        } catch {}
      }
      // release the graph once the fade is over
      setTimeout(() => {
        for (const nd of nodes) {
          try {
            nd?.disconnect()
          } catch {}
        }
      }, 700)
    } catch {}
  }
}
function attachPanner(h) {
  const D = AUDIO.dist[h.spec.dist] || AUDIO.dist.medium
  const f = filter('lowpass', 20000, 0.5)
  const p = makePanner(D)
  placePanner(p, h.pos.x, h.pos.y, h.pos.z, false)
  try {
    h.out.disconnect()
  } catch {}
  h.out.connect(f)
  f.connect(p)
  p.connect(bus[h.spec.bus])
  h.air = f
  h.panner = p
  h.dirty = false
}
function buildLoop(h) {
  h.out = gain(0)
  if (h.pos) attachPanner(h)
  else h.out.connect(bus[h.spec.bus])
  const keepOut = OUT
  const keepT = T
  OUT = h.out
  T = ctx.currentTime
  try {
    h.n = h.spec.build(h)
  } finally {
    OUT = keepOut
    T = keepT
  }
  h.n.param(h.param, ctx.currentTime)
  built++
}
export function loop(name, opts = {}) {
  try {
    const spec = LOOPS[name]
    if (!spec || failed) return DUMMY
    const h = new LoopHandle(name, spec, opts || NO)
    loops.push(h)
    return h
  } catch {
    return DUMMY
  }
}
function updateLoops(now) {
  for (let i = loops.length - 1; i >= 0; i--) {
    const h = loops[i]
    if (h.dead) {
      loops.splice(i, 1)
      continue
    }
    if (!h.n) {
      if (built >= AUDIO.maxLoops) continue
      buildLoop(h)
    }
    let g = h.vol
    if (h.panner) {
      const D = AUDIO.dist[h.spec.dist] || AUDIO.dist.medium
      const dist = Math.hypot(h.pos.x - lis.x, h.pos.y - lis.y, h.pos.z - lis.z)
      g *= clamp01((D.range - dist) / (D.range * AUDIO.fadeFrac))
      const air = airCut(dist, D.range)
      if (Math.abs(air - h.lastAir) > 40) {
        h.air.frequency.setTargetAtTime(air, now, 0.1)
        h.lastAir = air
      }
      if (h.dirty) {
        placePanner(h.panner, h.pos.x, h.pos.y, h.pos.z, true)
        h.dirty = false
      }
    }
    if (Math.abs(g - h.lastGain) > 0.002) {
      h.out.gain.setTargetAtTime(g, now, h.lastGain < 0 ? 0.08 : 0.05)
      h.lastGain = g
    }
    if (h.n.tick && g > 0.001 && voices < LOW) withOut(h.out, now + 0.02, !!h.panner, h.n.tick, now)
  }
}
// run fn with the helpers writing to `node` at time t (ambience / loop events)
function withOut(node, t, is3d, fn, arg) {
  const o = OUT
  const tt = T
  const pp = P
  const s = SHOT
  const i3 = IS3D
  OUT = node
  T = t
  P = 1
  SHOT = null
  IS3D = is3d
  try {
    fn(arg)
  } catch {}
  OUT = o
  T = tt
  P = pp
  SHOT = s
  IS3D = i3
}

// --- Ambience beds -------------------------------------------------------------------------------------
// One white + one brown noise loop feed every bed (each through its own filter). Yard: breeze with
// gusts, leaves, a distant suburban hum, birds and the odd far-away car (muffled through the walls as
// indoorMix rises). House: room tone, mains hum, a grandfather clock ticking down the hall, the fridge in
// the kitchen. Lobby (the mouse-hole hideout): room tone, a candle's soft hiss, wall creaks and the
// neighbours' TV babbling through the wall (with a muffled laugh track). Danger: heartbeat + drone.
let A = null
function startAmbient() {
  const C = AUDIO.ambience
  const wn = lsrc(noiseBuf)
  const bn = lsrc(brownBuf)
  const yard = gain(0)
  const yardLp = filter('lowpass', 16000, 0.5)
  yard.connect(yardLp)
  yardLp.connect(bus.amb)
  const breezeF = filter('bandpass', 520, 0.6)
  const breeze = gain(0)
  wn.connect(breezeF)
  breezeF.connect(breeze)
  breeze.connect(yard)
  const leavesF = filter('highpass', 3800, 0.5)
  const leaves = gain(0)
  wn.connect(leavesF)
  leavesF.connect(leaves)
  leaves.connect(yard)
  const humF = filter('lowpass', 170, 0.7)
  const hum = gain(C.yard.hum)
  bn.connect(humF)
  humF.connect(hum)
  hum.connect(yard)
  const yardEv = gain(1)
  yardEv.connect(yard)

  const house = gain(0)
  house.connect(bus.amb)
  const roomF = filter('lowpass', 240, 0.7)
  const room = gain(C.house.tone)
  bn.connect(roomF)
  roomF.connect(room)
  room.connect(house)
  const mains = losc('sine', 60)
  const mg = gain(C.house.mains)
  mains.connect(mg)
  mg.connect(house)
  const fridge = gain(0)
  fridge.connect(house)
  const fr1 = losc('sine', 50)
  const fr2 = losc('triangle', 100.35)
  const frN = filter('lowpass', 320, 0.7)
  const frg1 = gain(0.5)
  const frg2 = gain(0.12)
  const frgN = gain(0.35)
  fr1.connect(frg1)
  fr2.connect(frg2)
  bn.connect(frN)
  frN.connect(frgN)
  const frLp = filter('lowpass', 700, 0.7)
  frg1.connect(frLp)
  frg2.connect(frLp)
  frgN.connect(frLp)
  frLp.connect(fridge)
  const houseEv = filter('lowpass', 3000, 0.6)
  houseEv.connect(house)

  const lobby = gain(0)
  lobby.connect(bus.amb)
  const lroomF = filter('lowpass', 300, 0.7)
  const lroom = gain(C.lobby.tone)
  bn.connect(lroomF)
  lroomF.connect(lroom)
  lroom.connect(lobby)
  const candleF = filter('bandpass', 2600, 0.5)
  const candle = gain(0)
  wn.connect(candleF)
  candleF.connect(candle)
  candle.connect(lobby)
  const wall = filter('lowpass', C.lobby.wall, 0.7)
  wall.connect(lobby)
  const tv = losc('sawtooth', 150)
  const tf1 = filter('bandpass', 600, 5)
  const tf2 = filter('bandpass', 1400, 7)
  const tvGate = gain(0)
  const tvLvl = gain(C.lobby.tv * 3)
  tv.connect(tf1)
  tv.connect(tf2)
  tf1.connect(tvGate)
  tf2.connect(tvGate)
  tvGate.connect(tvLvl)
  tvLvl.connect(wall)
  const lobbyEv = filter('lowpass', 1400, 0.6)
  lobbyEv.connect(lobby)

  const danger = gain(1)
  danger.connect(bus.amb)
  const dF = filter('lowpass', 200, 1.2)
  for (const f of [55, 55.45, 82.5]) losc('sawtooth', f).connect(dF)
  const drone = gain(0)
  dF.connect(drone)
  drone.connect(danger)
  const heart = gain(0)
  heart.connect(danger)

  A = {
    yard, yardLp, breeze, breezeF, leaves, yardEv, house, fridge, houseEv, lobby, candle, wall, tv, tf1, tf2, tvGate, lobbyEv, drone, dF, heart,
    last: {},
    gustT: 0,
    birdT: rnd(1, 3),
    carT: rnd(C.yard.cars[0], C.yard.cars[1]),
    clockT: 0,
    tick: true,
    candleT: 0,
    creakT: rnd(C.lobby.creaks[0], C.lobby.creaks[1]),
    tvT: 0,
    laughT: rnd(C.lobby.laughs[0], C.lobby.laughs[1]),
    heartT: 0,
  }
}
function glide(param, v, tc, key) {
  const last = A.last[key]
  if (last !== undefined && Math.abs(last - v) <= 1e-3 * Math.max(1, Math.abs(v))) return
  A.last[key] = v
  param.setTargetAtTime(v, ctx.currentTime, tc)
}
function bird(lv) {
  const pan = rnd(-0.85, 0.85)
  const kind = Math.random()
  const base = rnd(2400, 4200)
  if (kind < 0.45) {
    const n = 2 + rndInt(4)
    const up = Math.random() < 0.5
    const gap = rnd(0.08, 0.14)
    for (let i = 0; i < n; i++) tone(base * rnd(0.94, 1.06), { at: i * gap, a: 0.006, d: 0.06, peak: 0.05 * lv, glide: [[0.06, up ? 1.35 : 0.7]], pan })
  } else if (kind < 0.75) {
    tone(base, { a: 0.02, hold: rnd(0.2, 0.45), d: 0.08, peak: 0.035 * lv, vib: [rnd(28, 45), rnd(120, 260)], glide: [[0.4, rnd(0.85, 1.15)]], pan })
  } else {
    const f = rnd(2600, 3400)
    tone(f, { a: 0.02, hold: 0.12, d: 0.08, peak: 0.04 * lv, pan, vib: [8, 15] })
    tone(f * 0.84, { at: 0.26, a: 0.02, hold: 0.2, d: 0.12, peak: 0.035 * lv, pan, glide: [[0.3, 0.97]], vib: [8, 15] })
  }
}
function carPass(lv) {
  // a car going by a few streets away: tyre roar swelling and fading while it pans across
  const dur = rnd(4, 6.5)
  let out = OUT
  if (ctx.createStereoPanner) {
    const sp = ctx.createStereoPanner()
    const dir = Math.random() < 0.5 ? -1 : 1
    sp.pan.setValueAtTime(-0.8 * dir, T)
    sp.pan.linearRampToValueAtTime(0.8 * dir, T + dur)
    sp.connect(OUT)
    out = sp
  }
  noise({ a: dur * 0.45, d: dur * 0.55, peak: lv, type: 'lowpass', freq: 350, q: 0.6, sweeps: [[dur * 0.45, 900], [dur, 300]], out })
  tone(rnd(65, 80), { a: dur * 0.45, d: dur * 0.55, peak: lv * 0.25, type: 'triangle', glide: [[dur * 0.45, 1.15], [dur, 0.9]], out })
}
function laugh(lv) {
  // a muffled studio audience: a band of noise pulsing at laughing speed, swelling and dying away
  noise({ a: 0.15, hold: rnd(0.6, 1.2), d: 0.7, peak: lv, type: 'bandpass', freq: 1000, q: 0.8, am: [rnd(5, 6.5), 0.85] })
}
const TV_V = ['a', 'e', 'i', 'o', 'E', 'ae', 'U']
function ambience(dt, now, env) {
  const C = AUDIO.ambience
  const zone = (env && env.zone) || 'none'
  const room = (env && env.room) || null
  const outside = zone === 'yard' || zone === 'house'
  const indoor = clamp01(num(env && env.indoorMix, zone === 'house' ? 1 : 0))
  const danger = clamp01(num(env && env.danger, 0))
  const yardL = outside ? lerp(1, 0.3, indoor) * (C.yard.level ?? 1) : 0
  const houseL = outside ? indoor : 0
  const lobbyL = zone === 'lobby' ? (C.lobby.level ?? 1) : 0
  glide(A.yard.gain, yardL, C.fade, 'yard')
  glide(A.yardLp.frequency, lerp(16000, C.yard.muffled, Math.min(1, indoor * 1.3)), 0.3, 'yardLp')
  glide(A.house.gain, houseL, C.fade, 'house')
  glide(A.fridge.gain, room === 'kitchen' ? C.house.fridge : 0, 0.8, 'fridge')
  glide(A.lobby.gain, lobbyL, C.fade, 'lobby')
  const S = AUDIO.reverb.send
  const send = zone === 'lobby' ? S.lobby : outside ? lerp(S.yard, S.house * (AUDIO.reverb.room[room] ?? 1), indoor) : S.none
  glide(bus.send.gain, send, AUDIO.reverb.glide, 'send')
  const room4events = voices < LOW

  // yard: gusts, birds, cars
  if (yardL > 0.02) {
    A.gustT -= dt
    if (A.gustT <= 0) {
      A.gustT = rnd(2, 6)
      const gust = rnd(0.2, 1)
      glide(A.breeze.gain, C.yard.breeze * (0.35 + 0.65 * gust), 1.2, 'breeze')
      glide(A.breezeF.frequency, 380 + gust * 450, 1.5, 'breezeF')
      glide(A.leaves.gain, C.yard.leaves * gust * gust, 0.8, 'leaves')
    }
    A.birdT -= dt
    if (A.birdT <= 0) {
      A.birdT = rnd(C.yard.birds[0], C.yard.birds[1])
      if (room4events) withOut(A.yardEv, now + 0.02, false, bird, C.yard.birdLevel)
    }
    A.carT -= dt
    if (A.carT <= 0) {
      A.carT = rnd(C.yard.cars[0], C.yard.cars[1])
      if (room4events) withOut(A.yardEv, now + 0.02, false, carPass, C.yard.carLevel)
    }
  }
  // house: the grandfather clock down the hall
  if (houseL > 0.02) {
    A.clockT -= dt
    if (A.clockT <= 0) {
      A.clockT += C.house.clockPeriod
      if (A.clockT < 0) A.clockT = C.house.clockPeriod
      const tk = A.tick
      A.tick = !A.tick
      if (room4events) withOut(A.houseEv, now + 0.02, false, () => grain('tick', { peak: C.house.clock * (tk ? 1 : 0.8), rate: tk ? 0.9 : 0.74 }))
    }
  }
  // lobby: candle flicker, TV babble + laughs through the wall, creaks
  if (lobbyL > 0.02) {
    A.candleT -= dt
    if (A.candleT <= 0) {
      A.candleT = rnd(0.08, 0.3)
      A.candle.gain.setTargetAtTime(C.lobby.candle * rnd(0.3, 1), now, 0.04)
    }
    if (now >= A.tvT - 0.05) {
      const t = Math.max(now + 0.02, A.tvT)
      if (Math.random() < 0.12) A.tvT = t + rnd(0.4, 1.1)
      else {
        const ln = rnd(0.08, 0.2)
        const v = VOW[pick(TV_V)]
        A.tv.frequency.setTargetAtTime(rnd(120, 230), t, 0.04)
        A.tf1.frequency.setTargetAtTime(v[0] * 1.15, t, 0.02)
        A.tf2.frequency.setTargetAtTime(v[1] * 1.15, t, 0.02)
        A.tvGate.gain.setTargetAtTime(rnd(0.5, 1), t, 0.015)
        A.tvGate.gain.setTargetAtTime(0, t + ln, 0.03)
        A.tvT = t + ln + rnd(0.03, 0.09)
      }
    }
    A.laughT -= dt
    if (A.laughT <= 0) {
      A.laughT = rnd(C.lobby.laughs[0], C.lobby.laughs[1])
      if (room4events) withOut(A.wall, now + 0.02, false, laugh, C.lobby.laughLevel)
    }
    A.creakT -= dt
    if (A.creakT <= 0) {
      A.creakT = rnd(C.lobby.creaks[0], C.lobby.creaks[1])
      if (room4events)
        withOut(A.lobbyEv, now + 0.02, false, () => creak({ d: rnd(0.3, 0.8), rate: rnd(12, 28), f: rnd(300, 500), q: 8, peak: C.lobby.creakLevel * 0.1 }))
    }
  }
  // danger: a heartbeat that quickens + a low drone that opens up
  const D = C.danger
  const on = danger > D.threshold
  glide(A.drone.gain, on ? D.drone * Math.pow(danger, 1.5) : 0, 0.5, 'drone')
  glide(A.dF.frequency, 160 + danger * 520, 0.5, 'dF')
  if (on) {
    glide(A.heart.gain, D.heart * (0.4 + 0.6 * danger), 0.2, 'heart')
    A.heartT -= dt
    if (A.heartT <= 0) {
      A.heartT = 60 / lerp(D.minBpm, D.maxBpm, danger)
      withOut(A.heart, now + 0.02, false, heartbeat, danger)
    }
  } else A.heartT = 0
}

// --- Per frame ------------------------------------------------------------------------------------------
// camera: the listener pose (THREE camera: matrixWorld). env: { zone, room, danger, indoorMix }.
export function frame(dt, camera, env) {
  try {
    if (!ready()) return
    const now = ctx.currentTime
    dt = Math.min(0.1, Math.max(0, num(dt, 0.016)))
    const L = ctx.listener
    const e = camera && camera.matrixWorld && camera.matrixWorld.elements
    let px = 0
    let py = 0
    let pz = 0
    let fx = 0
    let fy = 0
    let fz = -1
    let ux = 0
    let uy = 1
    let uz = 0
    if (e) {
      px = e[12]
      py = e[13]
      pz = e[14]
      fx = -e[8]
      fy = -e[9]
      fz = -e[10]
      ux = e[4]
      uy = e[5]
      uz = e[6]
      const fl = Math.hypot(fx, fy, fz) || 1
      fx /= fl
      fy /= fl
      fz /= fl
      const ul = Math.hypot(ux, uy, uz) || 1
      ux /= ul
      uy /= ul
      uz /= ul
    } else if (camera && camera.position) {
      px = num(camera.position.x, 0)
      py = num(camera.position.y, 0)
      pz = num(camera.position.z, 0)
    }
    lis.x = px
    lis.y = py
    lis.z = pz
    if (L.positionX) {
      L.positionX.value = px
      L.positionY.value = py
      L.positionZ.value = pz
      L.forwardX.value = fx
      L.forwardY.value = fy
      L.forwardZ.value = fz
      L.upX.value = ux
      L.upY.value = uy
      L.upZ.value = uz
    } else {
      L.setPosition(px, py, pz)
      L.setOrientation(fx, fy, fz, ux, uy, uz)
    }
    if (A) ambience(dt, now, env)
    updateLoops(now)
  } catch {
    OUT = null
    SHOT = null
  }
}

// --- Dev / test helpers ----------------------------------------------------------------------------
export const SOUND_NAMES = Object.freeze(Object.keys(DEFS))
export const SOUND_GROUPS = Object.freeze(GROUPS)
export const LOOP_NAMES = Object.freeze(Object.keys(LOOPS))
export function stats() {
  return { state: ctx ? ctx.state : failed ? 'unavailable' : 'locked', voices, cap: CAP, loops: loops.length, builtLoops: built, sampleRate: ctx ? ctx.sampleRate : 0 }
}
// Render one sound into an OfflineAudioContext (no gesture needed) and measure it: dry, before the
// buses / reverb / compressor. Returns { name, peak, peakDb, rmsDb, length } or null.
export async function renderOffline(name, opts = {}, seconds = 0) {
  const d = DEFS[name]
  const OAC = W && (W.OfflineAudioContext || W.webkitOfflineAudioContext)
  if (!d || !OAC) return null
  const sr = ctx ? ctx.sampleRate : 48000
  const len = seconds || d.len || 1.5
  const off = new OAC(2, Math.ceil(sr * len), sr)
  const keep = ctx
  const keepNyq = NYQ
  ctx = off
  NYQ = sr * 0.45
  offline = true
  try {
    if (!noiseBuf) noiseBuf = makeNoise(3, false)
    if (!brownBuf) brownBuf = makeNoise(4, true)
    const g = off.createGain()
    g.connect(off.destination)
    OUT = g
    T = 0.01
    P = num(opts.pitch, 1)
    SHOT = null
    IS3D = false
    d.fn(clamp01(num(opts.strength, d.k)), opts)
  } finally {
    ctx = keep
    NYQ = keepNyq
    offline = false
    OUT = null
  }
  const buf = await off.startRendering()
  let peak = 0
  let sum = 0
  let last = 0
  let at = 0
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const x = buf.getChannelData(c)
    for (let i = 0; i < x.length; i++) {
      const v = x[i] < 0 ? -x[i] : x[i]
      if (v > peak) {
        peak = v
        at = i
      }
      if (v > 0.002 && i > last) last = i
      sum += x[i] * x[i]
    }
  }
  const active = Math.max(1, last) * buf.numberOfChannels
  const db = (v) => (v > 0 ? Math.round(200 * Math.log10(v)) / 10 : -Infinity)
  const r2 = (v) => Math.round(v * 1000) / 1000
  return { name, peak, peakDb: db(peak), peakAt: r2(at / sr), rmsDb: db(Math.sqrt(sum / active)), length: r2(last / sr) }
}
