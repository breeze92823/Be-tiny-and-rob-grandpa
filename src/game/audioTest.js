// Dev audition page for the procedural audio (served by Vite at /audio-test.html). A button per sound
// (2D plus 3D left / right / far), loops with a param slider and a position (incl. a moving orbit),
// the ambience env (zone / room / danger / indoorMix), every music mood + stinger, a master meter and
// an offline "measure all" table (peak / RMS / length of every sound, rendered silently).
import { PerspectiveCamera } from 'three'
import * as sfx from './sfx.js'
import * as music from './music.js'

const MATS = {
  step: ['wood', 'tile', 'carpet', 'grass', 'stone', 'metal'],
  land: ['wood', 'tile', 'carpet', 'grass', 'stone', 'metal'],
  impact: ['wood', 'metal', 'glass', 'plastic', 'soft', 'ceramic', 'paper', 'rubber'],
  shatter: ['glass', 'ceramic'],
}
// listener at the origin facing -Z
const POS = { L: { x: -8, y: 1.6, z: -3 }, R: { x: 8, y: 1.6, z: -3 }, Far: { x: 0, y: 1.6, z: -18 } }
const ZONES = ['none', 'lobby', 'yard', 'house']
const ROOMS = ['-', 'kitchen', 'bathroom', 'bedroom', 'hallway', 'living', 'garage', 'study']

const camera = new PerspectiveCamera(60, 1, 0.1, 1000)
camera.position.set(0, 1.6, 0)
camera.updateMatrixWorld()
const env = { zone: 'none', room: null, danger: 0, indoorMix: 0 }
const opts = { strength: 0.5, pitch: 1, vol: 1 }
const mats = {}

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else if (k === 'class') e.className = v
    else e.setAttribute(k, v)
  }
  for (const c of kids) if (c != null) e.append(c)
  return e
}
function slider(label, min, max, step, value, onInput) {
  const out = h('span', { class: 'stat' }, String(value))
  const inp = h('input', { type: 'range', min, max, step, value })
  inp.addEventListener('input', () => {
    out.textContent = inp.value
    onInput(Number(inp.value))
  })
  return h('label', {}, label, inp, out)
}
function select(options, value, onChange) {
  const s = h('select', {})
  for (const o of options) s.append(h('option', { value: o }, o))
  s.value = value
  s.addEventListener('change', () => onChange(s.value))
  return s
}
function check(label, value, onChange) {
  const c = h('input', { type: 'checkbox' })
  c.checked = value
  c.addEventListener('change', () => onChange(c.checked))
  return h('label', {}, c, label)
}

const app = document.getElementById('app')

// ---- top bar ----
const status = h('span', { class: 'stat' }, 'audio: locked (click anything)')
const meterFill = h('i')
const meterTxt = h('span', { class: 'stat' }, '-inf dB')
app.append(
  h(
    'div',
    { class: 'bar' },
    h('button', { class: 'main', onclick: () => sfx.unlock() }, 'Start audio'),
    status,
    slider('Volume', 0, 1, 0.01, 0.8, (v) => sfx.setVolume(v)),
    check('Mute', false, (v) => sfx.setMuted(v)),
    check('SFX', true, (v) => sfx.setSfxEnabled(v)),
    check('Music', true, (v) => music.setMusicEnabled(v)),
    h('span', {}, h('span', { class: 'meter' }, meterFill), ' ', meterTxt),
  ),
)
sfx.setVolume(0.8)

const grid = h('div', { class: 'grid' })
app.append(grid)

// ---- options + env ----
grid.append(
  h(
    'section',
    {},
    h('h2', {}, 'One-shot options'),
    h(
      'div',
      { class: 'controls' },
      slider('strength', 0, 1, 0.05, opts.strength, (v) => (opts.strength = v)),
      slider('pitch', 0.5, 2, 0.05, opts.pitch, (v) => (opts.pitch = v)),
      slider('vol', 0, 2, 0.05, opts.vol, (v) => (opts.vol = v)),
    ),
  ),
  h(
    'section',
    {},
    h('h2', {}, 'Ambience env'),
    h(
      'div',
      { class: 'controls' },
      h('label', {}, 'zone', select(ZONES, env.zone, (v) => (env.zone = v))),
      h('label', {}, 'room', select(ROOMS, '-', (v) => (env.room = v === '-' ? null : v))),
      slider('danger', 0, 1, 0.05, env.danger, (v) => (env.danger = v)),
      slider('indoorMix', 0, 1, 0.05, env.indoorMix, (v) => (env.indoorMix = v)),
    ),
  ),
)

// ---- music ----
const musicInfo = h('div', { class: 'stat' }, '')
grid.append(
  h(
    'section',
    {},
    h('h2', {}, 'Music'),
    h('div', { class: 'row' }, ...music.MUSIC_MOODS.map((m) => h('button', { onclick: () => (sfx.unlock(), music.setMood(m)) }, m))),
    h('div', { class: 'row' }, 'stingers:', ...music.MUSIC_STINGERS.map((s) => h('button', { onclick: () => (sfx.unlock(), music.stinger(s)) }, s))),
    musicInfo,
  ),
)

// ---- sounds ----
function fire(name, where) {
  sfx.unlock()
  const o = { strength: opts.strength, pitch: opts.pitch, vol: opts.vol }
  if (mats[name]) o.mat = mats[name]
  if (where) o.at = POS[where]
  sfx.play(name, o)
}
for (const [group, names] of Object.entries(sfx.SOUND_GROUPS)) {
  const sec = h('section', {}, h('h2', {}, group))
  for (const name of names) {
    const row = h('div', { class: 'row' }, h('span', { class: 'name' }, name))
    if (MATS[name]) {
      mats[name] = MATS[name][0]
      row.append(select(MATS[name], mats[name], (v) => (mats[name] = v)))
    }
    row.append(
      h('button', { class: 'main', onclick: () => fire(name) }, '2D'),
      h('button', { onclick: () => fire(name, 'L') }, 'L'),
      h('button', { onclick: () => fire(name, 'R') }, 'R'),
      h('button', { onclick: () => fire(name, 'Far') }, 'Far'),
    )
    sec.append(row)
  }
  grid.append(sec)
}

// ---- loops ----
const live = new Map() // name -> { handle, where }
const loopSec = h('section', {}, h('h2', {}, 'Loops'))
for (const name of sfx.LOOP_NAMES) {
  const st = { where: '2D', param: 0.5, vol: 1 }
  const btn = h('button', {}, 'start')
  btn.addEventListener('click', () => {
    sfx.unlock()
    const cur = live.get(name)
    if (cur) {
      cur.handle.stop()
      live.delete(name)
      btn.textContent = 'start'
      btn.classList.remove('on')
      return
    }
    const o = { param: st.param, vol: st.vol }
    if (POS[st.where]) o.at = POS[st.where]
    const handle = sfx.loop(name, o)
    if (st.where === 'Orbit') handle.setPos(8, 1.6, 0)
    live.set(name, { handle, st })
    btn.textContent = 'stop'
    btn.classList.add('on')
  })
  loopSec.append(
    h(
      'div',
      { class: 'row' },
      h('span', { class: 'name' }, name),
      btn,
      select(['2D', 'L', 'R', 'Far', 'Orbit'], '2D', (v) => (st.where = v)),
      slider('param', 0, 1, 0.05, st.param, (v) => {
        st.param = v
        live.get(name)?.handle.setParam(v)
      }),
      slider('vol', 0, 1.5, 0.05, st.vol, (v) => {
        st.vol = v
        live.get(name)?.handle.setVol(v)
      }),
    ),
  )
}
grid.append(loopSec)

// ---- offline measurement ----
const table = h('table', {}, h('tr', {}, h('th', {}, 'sound'), h('th', {}, 'peak dB'), h('th', {}, 'rms dB'), h('th', {}, 'len s')))
async function measureAll() {
  while (table.rows.length > 1) table.deleteRow(1)
  const results = []
  for (const name of sfx.SOUND_NAMES) {
    const variants = MATS[name] ? MATS[name].map((m) => ({ mat: m })) : [{}]
    for (const v of variants) {
      const r = await sfx.renderOffline(name, { ...v, strength: name === 'impact' || name === 'land' ? 1 : undefined })
      if (!r) continue
      r.label = v.mat ? `${name}:${v.mat}` : name
      results.push(r)
      const bad = !(r.peak > 0.01) || r.peak > 0.98 || !Number.isFinite(r.peak)
      table.append(
        h('tr', {}, h('td', {}, r.label), h('td', bad ? { class: 'bad' } : {}, String(r.peakDb)), h('td', {}, String(r.rmsDb)), h('td', {}, String(r.length))),
      )
    }
  }
  return results
}
grid.append(h('section', {}, h('h2', {}, 'Measure (offline, dry, strength 1 for impacts)'), h('button', { class: 'main', onclick: () => measureAll() }, 'Measure all'), table))

// ---- loop ----
let analyser = null
let abuf = null
let last = performance.now()
let infoT = 0
let orbit = 0
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000)
  last = now
  orbit += dt * 0.8
  for (const { handle, st } of live.values()) if (st.where === 'Orbit') handle.setPos(Math.cos(orbit) * 8, 1.6, Math.sin(orbit) * 8)
  sfx.frame(dt, camera, env)
  music.frame(dt)
  const core = sfx.audioCore()
  if (core && !analyser) {
    analyser = core.ctx.createAnalyser()
    analyser.fftSize = 1024
    abuf = new Float32Array(analyser.fftSize)
    core.master.connect(analyser)
  }
  if (analyser) {
    analyser.getFloatTimeDomainData(abuf)
    let peak = 0
    for (let i = 0; i < abuf.length; i++) peak = Math.max(peak, Math.abs(abuf[i]))
    const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity
    meterFill.style.width = `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%`
    meterTxt.textContent = `${Number.isFinite(db) ? db.toFixed(1) : '-inf'} dB`
  }
  infoT -= dt
  if (infoT <= 0) {
    infoT = 0.25
    const s = sfx.stats()
    status.textContent = `audio: ${s.state} | voices ${s.voices}/${s.cap} | loops ${s.builtLoops}/${s.loops}`
    const m = music.musicStats()
    musicInfo.textContent = `target ${m.target} | ${m.groups.map((g) => `${g.name}: ${g.active ? `${g.mood} ${g.bpm} bpm` : 'idle'}`).join(' | ')}`
  }
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

// for automated checks from the console
window.__audioTest = { sfx, music, measureAll, env, opts }
