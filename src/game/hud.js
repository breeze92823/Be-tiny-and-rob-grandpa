// The DOM HUD (relative units, safe areas, touch-friendly, never inside Boxity's reserved top-left).
//   lobby: coins, Store / Upgrades buttons, the crew pad panel (LEAVE), the heist-starting overlay
//   heist: room tracker (top), jobs (right), gadget hotbar (left), cash-to-escape + stamina (bottom
//          left), control hints (bottom right), crosshair + hover label + Grandpa-awareness eye,
//          an edge arrow toward Grandpa, banners/tutorial, the caught / cage / out / results screens
//   panels: one window layout (accent border, title tab, red X) for the Store, Upgrades, Settings.
import './hud.css'
import * as bloxity from '../bloxity.js'
import { COARSE_POINTER, DIFFICULTY, GADGETS, PRICES, ROOMS, UPGRADES, UPGRADE_MAX, upgradePrice } from '../config.js'
import { fmt } from './kit.js'

const ICON = {
  coin: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ffd23f" stroke="#a86b00" stroke-width="2"/><circle cx="12" cy="12" r="6.4" fill="none" stroke="#e0a400" stroke-width="1.6"/><path d="M12 7.5v9M9.6 9.6h3.6a1.6 1.6 0 0 1 0 3.2h-2.4a1.6 1.6 0 0 0 0 3.2h3.6" fill="none" stroke="#a86b00" stroke-width="1.6" stroke-linecap="round"/></svg>',
  house: '<svg viewBox="0 0 24 24"><path d="M3 11 12 3l9 8v10H3z" fill="#ffcf5a" stroke="#4a2a10" stroke-width="1.6" stroke-linejoin="round"/><rect x="9.5" y="14" width="5" height="7" fill="#b5563c"/><path d="M2 11.5 12 3l10 8.5" fill="none" stroke="#c0392b" stroke-width="2.4" stroke-linecap="round"/></svg>',
  pan: '<svg viewBox="0 0 24 24"><circle cx="10" cy="13" r="6.5" fill="#3a3c44" stroke="#111" stroke-width="1.4"/><circle cx="10" cy="13" r="4" fill="#ffd35c"/><circle cx="10" cy="13" r="1.6" fill="#ff9d2e"/><path d="M16 9.5l6-4" stroke="#7a4a2a" stroke-width="2.6" stroke-linecap="round"/></svg>',
  tub: '<svg viewBox="0 0 24 24"><path d="M2 12h20v3a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5z" fill="#fff" stroke="#355" stroke-width="1.4"/><path d="M5 12V6a2 2 0 0 1 4 0" fill="none" stroke="#9aa" stroke-width="1.6"/><circle cx="14" cy="9" r="1.4" fill="#bfe9ff"/><circle cx="17" cy="7" r="1" fill="#bfe9ff"/></svg>',
  bed: '<svg viewBox="0 0 24 24"><rect x="2" y="12" width="20" height="5" rx="1.5" fill="#7d5ab0" stroke="#3a2a55" stroke-width="1.2"/><rect x="3" y="9" width="6" height="4" rx="1.5" fill="#fff"/><path d="M2 8v13M22 13v8" stroke="#5b3a22" stroke-width="2"/></svg>',
  door: '<svg viewBox="0 0 24 24"><rect x="6" y="2.5" width="12" height="19" rx="1" fill="#b5703c" stroke="#5b3a22" stroke-width="1.4"/><circle cx="15" cy="12.5" r="1.2" fill="#ffd23f"/></svg>',
  car: '<svg viewBox="0 0 24 24"><path d="M3 15l2-5h14l2 5v3H3z" fill="#e2453b" stroke="#5a1410" stroke-width="1.3"/><path d="M7 10l1.5-3h7L17 10z" fill="#bfe9ff" stroke="#5a1410" stroke-width="1.1"/><circle cx="7.5" cy="18" r="2" fill="#222"/><circle cx="16.5" cy="18" r="2" fill="#222"/></svg>',
  sofa: '<svg viewBox="0 0 24 24"><rect x="3" y="9" width="18" height="6" rx="2" fill="#5f7fa8" stroke="#24344a" stroke-width="1.2"/><rect x="1.5" y="11" width="4" height="7" rx="1.5" fill="#4d6b92"/><rect x="18.5" y="11" width="4" height="7" rx="1.5" fill="#4d6b92"/><rect x="4" y="14" width="16" height="4" rx="1" fill="#6f90ba"/></svg>',
  gem: '<svg viewBox="0 0 24 24"><path d="M6 4h12l4 6-10 11L2 10z" fill="#6fd3ff" stroke="#1f5a8a" stroke-width="1.3" stroke-linejoin="round"/><path d="M2 10h20M9 4l3 17 3-17" fill="none" stroke="#1f5a8a" stroke-width="1"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>',
  eye: '<svg viewBox="0 0 24 24"><path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z" fill="#fff" stroke="#120a2a" stroke-width="1.6"/><circle cx="12" cy="12" r="3.6" fill="#120a2a"/></svg>',
  store: '<svg viewBox="0 0 24 24"><path d="M3 9l1.5-5h15L21 9" fill="#ffd23f" stroke="#5a3a00" stroke-width="1.4" stroke-linejoin="round"/><path d="M4 9h16v11H4z" fill="#fff4d6" stroke="#5a3a00" stroke-width="1.4"/><rect x="9.5" y="13" width="5" height="7" fill="#e2453b"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M12 3l7 8h-4v9H9v-9H5z" fill="#4dff8a" stroke="#0d4a24" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  avatar: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4.5" fill="#ffcf9f" stroke="#4a2a10" stroke-width="1.4"/><path d="M3.5 21c0-5 3.8-8 8.5-8s8.5 3 8.5 8z" fill="#7cc4ff" stroke="#1b3a5a" stroke-width="1.4" stroke-linejoin="round"/></svg>',
  friends: '<svg viewBox="0 0 24 24"><circle cx="8.5" cy="8" r="3.4" fill="#ffcf9f" stroke="#4a2a10" stroke-width="1.3"/><circle cx="16.5" cy="9" r="3" fill="#f5b8d8" stroke="#4a2a10" stroke-width="1.3"/><path d="M2 20c0-4 3-6.5 6.5-6.5S15 16 15 20z" fill="#4dff8a" stroke="#0d4a24" stroke-width="1.3" stroke-linejoin="round"/><path d="M14 20c0-3 1.8-5 4.5-5S23 17 23 20z" fill="#ffd23f" stroke="#5a3a00" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  trophy: '<svg viewBox="0 0 24 24"><path d="M7 3h10v6a5 5 0 0 1-10 0z" fill="#ffd23f" stroke="#5a3a00" stroke-width="1.4" stroke-linejoin="round"/><path d="M7 5H3.5c0 4 1.5 5.5 4 6M17 5h3.5c0 4-1.5 5.5-4 6" fill="none" stroke="#5a3a00" stroke-width="1.4"/><path d="M12 14v4M8 21h8M9 18h6" stroke="#5a3a00" stroke-width="1.8" stroke-linecap="round" fill="none"/></svg>',
  play: '<svg viewBox="0 0 24 24"><rect x="2.5" y="4.5" width="19" height="15" rx="3" fill="#e2453b" stroke="#5a1410" stroke-width="1.5"/><path d="M10 9l5 3-5 3z" fill="#fff"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2" fill="none" stroke="#fff" stroke-width="2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M12 2l8 14h-5v6H9v-6H4z" fill="currentColor" stroke="#120a2a" stroke-width="1.5" stroke-linejoin="round"/></svg>',
}
const UPG_ICON = {
  arm: '💪', fist: '✊', lungs: '🫁', shoe: '👟', sock: '🧦', mask: '🥷',
}
// What the pad panel says while the server has not seated you on the pad (game.js `seat`).
const PAD_SEAT = { full: 'CREW FULL', joining: 'JOINING...' }

function h(tag, cls = '', html = '') {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html) e.innerHTML = html
  return e
}
// A pointerdown button (no click delay on touch).
function button(cls, html, fn, sfx) {
  const b = h('button', `hud-btn ${cls}`, html)
  b.type = 'button'
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (b.disabled) {
      sfx?.('error')
      return
    }
    sfx?.('click')
    fn(b, e)
  })
  return b
}
const keyCap = (k) => (COARSE_POINTER ? '' : `<span class="kcap">${k}</span>`)

export function createHud(actions = {}) {
  const sfx = (n) => actions.sound?.(n)
  const root = h('div', 'hud')
  document.body.appendChild(root)
  bloxity.onReservedAreas((areas) => {
    let bottom = 0
    let right = 0
    for (const a of areas) {
      if (a.left < window.innerWidth * 0.3) {
        bottom = Math.max(bottom, a.top + a.height)
        right = Math.max(right, a.left + a.width)
      }
    }
    root.style.setProperty('--reserved-top', `${bottom}px`)
    root.style.setProperty('--reserved-right', `${right}px`)
    const toolbar = areas.find((a) => a.id === 'toolbar')
    root.style.setProperty('--toolbar-bottom', `${toolbar ? toolbar.top + toolbar.height : 0}px`)
    root.style.setProperty('--toolbar-right', `${toolbar ? toolbar.left + toolbar.width : 0}px`)
  })

  // ================================ HEIST ================================
  const heist = h('div', 'hud-heist hidden')
  root.appendChild(heist)
  // Room tracker
  const top = h('div', 'room-bar')
  const pct = h('div', 'room-pct', `${ICON.house}<b>0%</b>`)
  const chips = h('div', 'room-chips')
  const chipEls = {}
  for (const r of ROOMS) {
    const c = h('div', 'room-chip', `${ICON[r.icon] ?? ''}<i></i>`)
    c.title = r.name
    chips.appendChild(c)
    chipEls[r.id] = c
  }
  const roomName = h('div', 'room-name', '<b></b> <span></span>')
  top.append(pct, chips, roomName)
  heist.appendChild(top)
  // Jobs
  const jobs = h('div', 'jobs')
  const jobsHead = h('div', 'jobs-head', `<b>JOBS 0/6</b>${keyCap('J')}`)
  const jobsList = h('div', 'jobs-list')
  jobs.append(jobsHead, jobsList)
  heist.appendChild(jobs)
  if (window.innerWidth < 640 || window.innerHeight < 500) jobs.classList.add('collapsed') // phones: tap JOBS to open
  jobsHead.addEventListener('pointerdown', (e) => {
    e.preventDefault()
    jobs.classList.toggle('collapsed')
  })
  // Hotbar
  const hotbar = h('div', 'hotbar')
  heist.appendChild(hotbar)
  const slots = GADGETS.map((g, i) => {
    const s = button('slot', `<span class="slot-key">${(i + 1) % 10}</span><img alt=""><span class="slot-count"></span><span class="slot-price">${ICON.coin}${fmt(g.price)}</span><span class="slot-timer"></span>`, () => actions.useSlot?.(i), sfx)
    s.title = `${g.name}: ${g.desc}`
    hotbar.appendChild(s)
    return s
  })
  // Money + stamina
  const money = h('div', 'money-box')
  const cash = h('div', 'cash outline', '$0')
  const escape = h('div', 'escape-bar', '<i></i><b>$1,000 TO ESCAPE</b>')
  const stamina = h('div', 'stamina-bar', '<i></i><b>STAMINA</b>')
  money.append(cash, escape, stamina)
  heist.appendChild(money)
  // Control hints
  const hints = h('div', 'hints')
  hints.innerHTML = COARSE_POINTER
    ? ''
    : ['<span class="kcap">LMB</span> Grab', '<span class="kcap">RMB</span> Throw', '<span class="kcap">Wheel</span> Distance', '<span class="kcap">Shift</span> Sprint', '<span class="kcap">C</span> Crouch', '<span class="kcap">V</span> Camera'].map((t) => `<div>${t}</div>`).join('')
  heist.appendChild(hints)
  // Crosshair + hover + awareness
  const cross = h('div', 'crosshair', '<i></i>')
  const hover = h('div', 'hover-label hidden', '<b></b><span></span>')
  const aware = h('div', 'aware hidden', `${ICON.eye}<i></i>`)
  heist.append(cross, hover, aware)
  const arrow = h('div', 'gp-arrow hidden', ICON.arrow)
  heist.appendChild(arrow)
  const boosts = h('div', 'boosts')
  heist.appendChild(boosts)
  const hideTag = h('div', 'hide-tag hidden', 'HIDDEN')
  heist.appendChild(hideTag)
  // Tutorial / banner
  const banner = h('div', 'banner hidden')
  heist.appendChild(banner)
  const tut = h('div', 'tutorial hidden')
  const tutTitle = h('div', 'tut-title', 'TUTORIAL')
  const tutSkip = button('tut-skip', `SKIP TUTORIAL ${keyCap('K')}`, () => actions.skipTutorial?.(), sfx)
  const tutText = h('div', 'tut-text')
  tut.append(tutTitle, tutSkip, tutText)
  heist.appendChild(tut)
  // Caught panel (held / cage / out)
  const caught = h('div', 'caught hidden')
  const caughtTitle = h('div', 'caught-title outline')
  const caughtSub = h('div', 'caught-sub')
  const struggle = h('div', 'struggle', '<i></i><b>MASH JUMP TO WRIGGLE FREE!</b>')
  const caughtBtns = h('div', 'caught-btns')
  const breakBtn = button('big break', `<b>BREAK FREE</b><span>${ICON.coin}${fmt(PRICES.breakFree)}</span>`, () => actions.breakFree?.(), sfx)
  const spectBtn = button('big spect', `<b>SPECTATE</b>${keyCap('E')}`, () => actions.spectate?.(), sfx)
  const lobbyBtn = button('big lobby', `<b>LOBBY</b>${keyCap('L')}`, () => actions.toLobby?.(), sfx)
  const reviveBtn = button('big revive', `<b>REVIVE</b><span>${ICON.coin}${fmt(PRICES.revive)}</span>`, () => actions.revive?.(), sfx)
  caughtBtns.append(breakBtn, reviveBtn, spectBtn, lobbyBtn)
  caught.append(caughtTitle, caughtSub, struggle, caughtBtns)
  heist.appendChild(caught)

  // ================================ LOBBY ================================
  const lobby = h('div', 'hud-lobby hidden')
  root.appendChild(lobby)
  const coinBox = h('div', 'coin-box', `${ICON.coin}<b>0</b>`)
  const lobbyBtns = h('div', 'lobby-btns')
  const storeBtn = button('side store', `${ICON.store}<b>STORE</b>${keyCap('B')}`, () => actions.openStore?.(), sfx)
  const upBtn = button('side upg', `${ICON.up}<b>UPGRADES</b>${keyCap('U')}`, () => actions.openUpgrades?.(), sfx)
  const setBtn = button('side settings', `${ICON.gear}<b>SETTINGS</b>`, () => actions.openSettings?.(), sfx)
  // Bloxity features (each shows only when the portal supports it): the avatar editor, friends + invites, ranks.
  const avatarBtn = button('side avatar hidden', `${ICON.avatar}<b>AVATAR</b>`, () => actions.openAvatar?.(), sfx)
  const friendsBtn = button('side friends hidden', `${ICON.friends}<b>FRIENDS</b>`, () => actions.openFriends?.(), sfx)
  const ranksBtn = button('side ranks hidden', `${ICON.trophy}<b>RANKS</b>`, () => actions.openRanks?.(), sfx)
  lobbyBtns.append(storeBtn, upBtn, avatarBtn, friendsBtn, ranksBtn, setBtn)
  const padPanel = h('div', 'pad-panel hidden')
  const padInfo = h('div', 'pad-info')
  const leaveBtn = button('big leave', `<b>LEAVE</b>`, () => actions.leavePad?.(), sfx)
  padPanel.append(padInfo, leaveBtn)
  const lobbyHint = h('div', 'lobby-hint outline', COARSE_POINTER ? 'Walk onto a glowing bottle cap to join a crew!' : 'Walk onto a glowing bottle cap to join a crew! &nbsp;<span class="kcap">B</span> Store &nbsp;<span class="kcap">U</span> Upgrades')
  lobby.append(coinBox, lobbyBtns, padPanel, lobbyHint)
  // Coins also show in the heist (small, top right under the jobs when needed): reuse the lobby box.

  // ================================ OVERLAYS ================================
  const loading = h('div', 'heist-loading hidden', '<div class="hl-title outline">YOUR HEIST IS STARTING</div><div class="hl-sub">Getting Grandpa\'s house ready.</div>')
  root.appendChild(loading)
  const toasts = h('div', 'toasts')
  root.appendChild(toasts)
  const results = h('div', 'results hidden')
  root.appendChild(results)

  // ================================ PANELS ================================
  const shade = h('div', 'panel-shade hidden')
  const panel = h('div', 'panel')
  const pTitle = h('div', 'panel-title')
  const pClose = button('panel-x', ICON.cross, () => closePanel(), sfx)
  const pBody = h('div', 'panel-body')
  panel.append(pTitle, pClose, pBody)
  shade.appendChild(panel)
  root.appendChild(shade)
  let panelOpen = false
  let onClose = null
  shade.addEventListener('pointerdown', (e) => {
    if (e.target === shade) closePanel()
  })
  function openPanel({ title, icon = '', color = '#ffd23f', body, wide = false, close }) {
    pTitle.innerHTML = `${icon}<b>${title}</b>`
    panel.style.setProperty('--accent', color)
    panel.classList.toggle('wide', wide)
    pBody.innerHTML = ''
    pBody.appendChild(body)
    shade.classList.remove('hidden')
    panelOpen = true
    onClose = close ?? null
    sfx('open')
    actions.panelChanged?.(true)
  }
  function closePanel() {
    if (!panelOpen) return
    shade.classList.add('hidden')
    panelOpen = false
    sfx('close')
    onClose?.()
    onClose = null
    actions.panelChanged?.(false)
  }

  // --- cache to avoid DOM churn ---
  const last = {}
  const changed = (k, v) => {
    if (last[k] === v) return false
    last[k] = v
    return true
  }

  const api = {
    root,
    get panelOpen() {
      return panelOpen
    },
    openPanel,
    closePanel,
    setMode(mode) {
      heist.classList.toggle('hidden', mode !== 'heist')
      lobby.classList.toggle('hidden', mode !== 'lobby')
      root.dataset.mode = mode
      document.body.dataset.hudMode = mode
      if (mode !== 'heist') {
        caught.classList.add('hidden')
        tut.classList.add('hidden')
      }
    },
    loading(on) {
      loading.classList.toggle('hidden', !on)
    },
    // --- lobby ---
    // Which Bloxity buttons the portal supports right now: { avatar, friends, ranks }.
    setPortalButtons(v) {
      avatarBtn.classList.toggle('hidden', !v.avatar)
      friendsBtn.classList.toggle('hidden', !v.friends)
      ranksBtn.classList.toggle('hidden', !v.ranks)
    },
    setCoins(n) {
      if (!changed('coins', n)) return
      coinBox.querySelector('b').textContent = fmt(n)
      coinBox.classList.remove('bump')
      void coinBox.offsetWidth
      coinBox.classList.add('bump')
      for (const [i, g] of GADGETS.entries()) slots[i].classList.toggle('afford', n >= g.price)
    },
    // pad = null | { difficulty, members: [names], size, seconds, full }
    setPad(pad) {
      const key = pad ? JSON.stringify(pad) : ''
      if (!changed('pad', key)) return
      padPanel.classList.toggle('hidden', !pad)
      lobbyHint.classList.toggle('hidden', !!pad)
      if (!pad) return
      const d = DIFFICULTY[pad.difficulty]
      padInfo.innerHTML = `<div class="pad-diff" style="--c:${d.color}">${d.label} CREW <span>${pad.members.length}/${pad.size}</span></div>
        <div class="pad-names">${pad.members.map((n) => `<span>${escapeHtml(n)}</span>`).join('')}</div>
        <div class="pad-timer">${PAD_SEAT[pad.seat] ?? (pad.seconds > 0 ? `SETTING UP: <b>${pad.seconds}s</b>` : 'STARTING...')}</div>
        <div class="pad-goal">Steal <b>$${fmt(d.target)}</b> &middot; Coins x${d.coinMult}</div>`
    },
    // --- heist ---
    setRooms(stats, current) {
      const p = Math.floor(stats.percent * 100)
      if (changed('pct', p)) pct.querySelector('b').textContent = `${p}%`
      for (const r of ROOMS) {
        const s = stats.rooms[r.id] ?? { total: 0, stolen: 0 }
        const k = `${r.id}:${s.stolen}:${current === r.id}`
        if (!changed(`chip:${r.id}`, k)) continue
        const el = chipEls[r.id]
        el.classList.toggle('on', current === r.id)
        el.classList.toggle('done', s.total > 0 && s.stolen >= s.total)
        el.querySelector('i').style.width = `${s.total ? (s.stolen / s.total) * 100 : 0}%`
      }
      const r = ROOMS.find((q) => q.id === current)
      const s = r && stats.rooms[r.id]
      const label = r ? `${r.name}|${s?.stolen ?? 0}/${s?.total ?? 0}` : 'OUTSIDE|'
      if (changed('roomName', label)) {
        const [n, c] = label.split('|')
        roomName.querySelector('b').textContent = n
        roomName.querySelector('span').textContent = c
      }
    },
    // list: [{ text, progress: '0/3' | '3:21' | '', done, failed }]
    setJobs(list) {
      const key = JSON.stringify(list)
      if (!changed('jobs', key)) return
      const done = list.filter((j) => j.done).length
      jobsHead.querySelector('b').textContent = `JOBS ${done}/${list.length}`
      jobsList.innerHTML = list
        .map((j) => `<div class="job ${j.done ? 'done' : ''} ${j.failed ? 'failed' : ''}"><span class="tick">${j.done ? ICON.check : j.failed ? ICON.cross : ''}</span><span class="jt">${escapeHtml(j.text)}</span><span class="jp">${j.failed ? "TIME'S UP" : j.progress ?? ''}</span></div>`)
        .join('')
    },
    setMoney(m, target) {
      const k = `${m}:${target}`
      if (!changed('money', k)) return
      cash.textContent = `$${fmt(m)}`
      cash.classList.remove('bump')
      void cash.offsetWidth
      cash.classList.add('bump')
      const left = Math.max(0, target - m)
      escape.classList.toggle('ready', left <= 0)
      escape.querySelector('i').style.width = `${Math.min(100, (m / Math.max(1, target)) * 100)}%`
      escape.querySelector('b').textContent = left > 0 ? `$${fmt(left)} TO ESCAPE` : 'ESCAPE IN THE VAN!'
    },
    setStamina(k, endless) {
      const v = Math.round(k * 100)
      if (!changed('stam', `${v}:${endless}`)) return
      stamina.querySelector('i').style.width = `${v}%`
      stamina.classList.toggle('low', k < 0.2)
      stamina.classList.toggle('endless', !!endless)
    },
    // items: [{ id, count, thumb, timer }]
    setHotbar(items) {
      items.forEach((it, i) => {
        const s = slots[i]
        const k = `${it.count}:${it.thumb ? 1 : 0}:${it.timer ?? ''}:${it.active ? 1 : 0}`
        if (!changed(`slot${i}`, k)) return
        const img = s.querySelector('img')
        if (it.thumb && img.src !== it.thumb) img.src = it.thumb
        s.querySelector('.slot-count').textContent = it.count > 0 ? `x${it.count}` : ''
        s.classList.toggle('empty', it.count <= 0)
        s.classList.toggle('active', !!it.active)
        s.querySelector('.slot-timer').textContent = it.timer ? `${Math.ceil(it.timer)}` : ''
      })
    },
    // info = null | { name, value, action, far, color }
    setHover(info) {
      const k = info ? `${info.name}|${info.value}|${info.action}|${info.far}` : ''
      if (!changed('hover', k)) return
      hover.classList.toggle('hidden', !info)
      cross.classList.toggle('grab', !!info && !info.far)
      if (!info) return
      hover.classList.toggle('far', !!info.far)
      hover.querySelector('b').textContent = info.name
      hover.querySelector('span').textContent = info.far ? 'Too far' : info.value ? `$${fmt(info.value)}` : info.action ?? ''
    },
    setHolding(on) {
      if (changed('holding', on)) cross.classList.toggle('holding', on)
    },
    // k = detection meter 0..1 (0 hides), level 'calm' | 'sus' | 'alert'
    setAwareness(k, level) {
      const v = Math.round(k * 50) / 50
      if (!changed('aware', `${v}:${level}`)) return
      aware.classList.toggle('hidden', v <= 0.02 && level !== 'alert')
      aware.dataset.level = level
      aware.querySelector('i').style.height = `${v * 100}%`
    },
    // angle (radians, 0 = up on screen) or null; color
    setArrow(angle, color = '#ff4a4a') {
      if (angle === null) {
        if (changed('arrow', 'off')) arrow.classList.add('hidden')
        return
      }
      last.arrow = 'on'
      arrow.classList.remove('hidden')
      arrow.style.color = color
      const r = 38
      arrow.style.transform = `translate(-50%, -50%) translate(${Math.sin(angle) * r}vmin, ${-Math.cos(angle) * r}vmin) rotate(${angle}rad)`
    },
    setHidden(on, label = 'HIDDEN') {
      if (!changed('hiddenTag', `${on}:${label}`)) return
      hideTag.classList.toggle('hidden', !on)
      hideTag.textContent = label
    },
    // boosts: [{ id, label, time, color }]
    setBoosts(list) {
      // time null = a state with no countdown (heat, a dark room)
      const k = list.map((b) => `${b.id}:${b.time == null ? '-' : Math.ceil(b.time)}`).join(',')
      if (!changed('boosts', k)) return
      boosts.innerHTML = list.map((b) => `<div class="boost" style="--c:${b.color}">${escapeHtml(b.label)}${b.time == null ? '' : ` <b>${Math.ceil(b.time)}s</b>`}</div>`).join('')
    },
    banner(html, seconds = 3, cls = '') {
      banner.innerHTML = html
      banner.className = `banner ${cls}`
      banner.classList.remove('hidden')
      clearTimeout(banner._t)
      banner._t = setTimeout(() => banner.classList.add('hidden'), seconds * 1000)
    },
    tutorial(html) {
      tut.classList.toggle('hidden', !html)
      if (html && changed('tut', html)) tutText.innerHTML = html
    },
    toast(text, color = '#ffffff') {
      const t = h('div', 'toast outline', escapeHtml(text))
      t.style.color = color
      toasts.appendChild(t)
      sfx('toast')
      setTimeout(() => t.classList.add('out'), 2200)
      setTimeout(() => t.remove(), 2700)
      while (toasts.children.length > 4) toasts.firstChild.remove()
    },
    // view = null | { kind: 'held' | 'cage' | 'out', progress, seconds, canPay, canRevive, friends }
    setCaught(view) {
      const key = view ? JSON.stringify(view) : ''
      if (!changed('caught', key)) return
      caught.classList.toggle('hidden', !view)
      if (!view) return
      caught.dataset.kind = view.kind
      if (view.kind === 'held') {
        caughtTitle.textContent = 'GRANDPA GOT YOU!'
        caughtSub.textContent = view.friends ? 'Wriggle free, or a friend can hit him with loot!' : 'Wriggle free before he locks you up!'
        struggle.classList.remove('hidden')
        struggle.querySelector('i').style.width = `${Math.min(100, view.progress * 100)}%`
        struggle.querySelector('b').textContent = COARSE_POINTER ? 'TAP JUMP TO WRIGGLE FREE!' : 'MASH SPACE TO WRIGGLE FREE!'
      } else if (view.kind === 'cage') {
        caughtTitle.textContent = 'LOCKED IN THE CAGE!'
        caughtSub.textContent = view.friends ? `A friend can open the cage door! ${Math.ceil(view.seconds)}s` : `${Math.ceil(view.seconds)}s left...`
        struggle.classList.add('hidden')
      } else {
        caughtTitle.textContent = "YOU'RE OUT!"
        caughtSub.textContent = view.friends ? 'Watch your crew, or head back to the hideout.' : 'Grandpa caught the whole crew.'
        struggle.classList.add('hidden')
      }
      breakBtn.classList.toggle('hidden', view.kind === 'out')
      breakBtn.disabled = !view.canPay
      reviveBtn.classList.toggle('hidden', view.kind !== 'out' || !view.friends)
      reviveBtn.disabled = !view.canRevive
      spectBtn.classList.toggle('hidden', view.kind !== 'out' || !view.friends)
      lobbyBtn.classList.toggle('hidden', view.kind !== 'out')
    },
    // data = { escaped, haul, coins, jobs, items, difficulty, best } | null
    showResults(data) {
      results.classList.toggle('hidden', !data)
      if (!data) return
      const d = DIFFICULTY[data.difficulty] ?? DIFFICULTY.normal
      results.innerHTML = ''
      const card = h('div', `res-card ${data.escaped ? 'win' : 'lose'}`)
      card.innerHTML = `<div class="res-title outline">${data.escaped ? 'YOU ESCAPED!' : 'CAUGHT!'}</div>
        <div class="res-diff" style="--c:${d.color}">${d.label}</div>
        <div class="res-rows">
          <div><span>Crew haul</span><b>$${fmt(data.haul)}</b></div>
          <div><span>Items stolen</span><b>${data.items}</b></div>
          <div><span>Jobs done</span><b>${data.jobs}</b></div>
          ${data.best ? '<div class="best"><span>NEW BEST HAUL!</span><b>★</b></div>' : ''}
        </div>
        <div class="res-coins">${ICON.coin}<b>+${fmt(data.coins)}</b></div>`
      const back = button('big lobby res-back', '<b>BACK TO HIDEOUT</b>', () => actions.resultsDone?.(), sfx)
      card.appendChild(back)
      results.appendChild(card)
    },
    // --- Store / Upgrades panels ---
    // ad = { available(), ready() (cooldown over), coins, watch() -> Promise } | null: a free-coins card
    openStore(state, ad = null) {
      const body = h('div', 'shop-grid')
      const render = () => {
        body.innerHTML = ''
        if (ad?.available()) {
          const card = h('div', 'shop-card ad-card')
          card.style.setProperty('--c', '#e2453b')
          card.innerHTML = `${ICON.play}<div class="sc-name">FREE COINS</div><div class="sc-desc">Watch a short video for ${fmt(ad.coins)} coins.</div>`
          const watch = button('buy', `${ICON.coin}<b>+${fmt(ad.coins)}</b>`, async (b) => {
            b.disabled = true
            await ad.watch()
            render()
          }, sfx)
          watch.disabled = !ad.ready()
          card.appendChild(watch)
          body.appendChild(card)
        }
        for (const g of GADGETS) {
          const have = state.gadgets[g.id] ?? 0
          const card = h('div', 'shop-card')
          card.style.setProperty('--c', g.color)
          card.innerHTML = `<img alt="" src="${actions.thumb?.('gadget', g.id) ?? ''}"><div class="sc-name">${g.name}</div><div class="sc-desc">${g.desc}</div><div class="sc-have">Owned: <b>${have}</b></div>`
          const buy = button('buy', `${ICON.coin}<b>${fmt(g.price)}</b>`, () => {
            if (actions.buyGadget?.(g.id)) render()
          }, sfx)
          buy.disabled = state.coins < g.price || have >= 99
          card.appendChild(buy)
          body.appendChild(card)
        }
      }
      render()
      openPanel({ title: 'GADGET STORE', icon: ICON.store, color: '#ffd23f', body, wide: true })
      return render
    },
    openUpgrades(state) {
      const body = h('div', 'upg-list')
      const render = () => {
        body.innerHTML = ''
        for (const u of UPGRADES) {
          const lvl = state.upgrades[u.id] ?? 0
          const row = h('div', 'upg-row')
          const pips = Array.from({ length: UPGRADE_MAX }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')
          row.innerHTML = `<div class="ur-icon">${UPG_ICON[u.icon] ?? '⭐'}</div><div class="ur-mid"><div class="ur-name">${u.name}</div><div class="ur-desc">${u.desc}</div><div class="ur-pips">${pips}</div></div>`
          const price = upgradePrice(u, lvl)
          const buy = button('buy', lvl >= UPGRADE_MAX ? '<b>MAX</b>' : `${ICON.coin}<b>${fmt(price)}</b>`, () => {
            if (actions.buyUpgrade?.(u.id)) render()
          }, sfx)
          buy.disabled = lvl >= UPGRADE_MAX || state.coins < price
          row.appendChild(buy)
          body.appendChild(row)
        }
      }
      render()
      openPanel({ title: 'UPGRADES', icon: ICON.up, color: '#4dff8a', body })
      return render
    },
    // friends = [{ id, name, status }]; invite(id) -> Promise<boolean>; copyLink() -> Promise<boolean>
    openFriends(friends, { invite, copyLink }) {
      const body = h('div', 'friends')
      const top = h('div', 'fr-top')
      const link = button('toggle on', '<b>COPY INVITE LINK</b>', async (b) => {
        const ok = await copyLink()
        b.querySelector('b').textContent = ok ? 'LINK COPIED!' : 'LINK UNAVAILABLE'
      }, sfx)
      top.appendChild(link)
      body.appendChild(top)
      const order = { 'in-game': 0, online: 1, away: 2, offline: 3 }
      const sorted = [...friends].sort((a, b) => (order[a.status] ?? 4) - (order[b.status] ?? 4) || a.name.localeCompare(b.name))
      if (!sorted.length) body.appendChild(h('div', 'fr-empty', 'No friends yet. Add friends on Boxity, then invite them here!'))
      for (const f of sorted) {
        const row = h('div', `fr-row ${f.status}`)
        row.innerHTML = `<i class="dot"></i><span class="fr-name">${escapeHtml(f.name)}</span><span class="fr-st">${escapeHtml(f.status === 'in-game' ? 'in a game' : f.status)}</span>`
        const inv = button('toggle on', '<b>INVITE</b>', async (b) => {
          b.disabled = true
          const ok = await invite(f.id)
          b.querySelector('b').textContent = ok ? 'SENT!' : 'FAILED'
          setTimeout(() => {
            b.querySelector('b').textContent = 'INVITE'
            b.disabled = f.status === 'offline'
          }, 2500)
        }, sfx)
        inv.disabled = f.status === 'offline'
        row.appendChild(inv)
        body.appendChild(row)
      }
      openPanel({ title: 'FRIENDS', icon: ICON.friends, color: '#f5b8d8', body })
    },
    openSettings(prefs) {
      const body = h('div', 'settings')
      const row = (label, key) => {
        const r = h('div', 'set-row', `<span>${label}</span>`)
        const b = button(`toggle ${prefs[key] ? 'on' : ''}`, `<b>${prefs[key] ? 'ON' : 'OFF'}</b>`, () => {
          actions.setPref?.(key, !prefs[key])
          b.classList.toggle('on', prefs[key])
          b.querySelector('b').textContent = prefs[key] ? 'ON' : 'OFF'
        }, sfx)
        r.appendChild(b)
        body.appendChild(r)
      }
      row('Music', 'music')
      row('Sound Effects', 'sfx')
      row('Light Effects', 'lights')
      openPanel({ title: 'SETTINGS', icon: ICON.gear, color: '#7cc4ff', body })
    },
    icons: ICON,
  }
  return api
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}
