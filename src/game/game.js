// Tiny Thieves: the game. Wires the world (house, yard, van, the Hideout lobby), Grandpa (model + brain),
// loot, the grabber arms, gadgets, jobs, the HUD, sound and music, the save, and the crew network.
//
// Flow: lobby (walk onto a crew pad) -> "YOUR HEIST IS STARTING" -> heist (break in, steal, throw loot
// out, dodge Grandpa, reach the cash target, escape in the van) -> results -> lobby.
// Authority: solo play or the crew's host simulates Grandpa + loot + doors and sends snapshots (hs) and
// events (hb); crew members send their actions (ha): holding loot, pulling doors, switches, gadgets.
import { BoxGeometry, EdgesGeometry, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, PointLight, Vector3, AdditiveBlending, Box3 } from 'three'
import {
  COARSE_POINTER, DIFFICULTY, FIRE, GADGETS, GADGET_BY_ID, GADGET_FX, GRANDPA, HEIST_SPAWN, HOUSE, IMPACT, LOBBY, LOOT, NET, NOISE, PHYSICS, PRICES, REWARDED_AD, REWARDS, ROOMS, SPAWN, SPAWN_FACING, STAMINA, UPGRADES,
} from '../config.js'
import { inputState, onKey, setLockBlocked } from '../input.js'
import { player, resetPlayer, setDriver, setSpawnPoint, onStep, onLand, onJump, crouchLocked, playerCollider, launch, currentDriver, isDriven } from '../player.js'
import { FAN, PHONE, TOASTER } from './furniture.js'
import { DARK, applyDarkMask, clearDarkness, darkMask, darknessAt, isRoomDark, patchDarkness, setRoomDark, updateDarkness } from './darkness.js'
import { syncYawToPlayer, setFollow, getYaw } from '../camera.js'
import { castRay, onTick, RAPIER, setOwner, world } from '../physics.js'
import * as sfx from './sfx.js'
import * as music from './music.js'
import { createHud } from './hud.js'
import { createState } from './state.js'
import { createFx } from './fx.js'
import { FRONT_DOOR, FRONT_PORCH_Y, buildHouse } from './house.js'
import { createFire } from './fire.js'
import { createRoomCull } from './roomCull.js'
import { buildLobby } from './lobby.js'
import { buildVan } from './van.js'
import { createProps } from './props.js'
import { createGrandpa } from './grandpa.js'
import { createBrain } from './brain.js'
import { createGrab, pullBody } from './grab.js'
import { createGadgets } from './gadgets.js'
import { createJobs } from './jobs.js'
import { applyBodyPose } from './bodyPose.js'
import { thumbnail, warmThumbnail } from './models/thumbs.js'
import { makeBananaPeel, makeFoamRocket, makeGadget, makeMarble } from './models/gadgets.js'
import { makeLoot } from './models/loot.js'
import { infoLabel, rng } from './kit.js'
import { net, onNet, readHeist, readPads, sendNet, serverNow, verifyAdReward } from '../net.js'
import * as bloxity from '../bloxity.js'

const FLOOR_SOUND = { tile: 'tile', wood: 'wood', carpet: 'carpet', stone: 'stone' }
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

export function createGame({ scene, camera, renderer, preset, setLightEffects }) {
  // --- Core pieces ---------------------------------------------------------------------------------
  const state = createState()
  const fx = createFx(scene, camera, renderer)
  fx.setDensity(preset.particles)
  const sound = (name, at = null, opts = {}) => sfx.play(name, at ? { at, ...opts } : opts)
  const loops = new Map() // key -> loop handle
  const loop = (name, at) => {
    const h = sfx.loop(name)
    if (at) h.setPos(at.x, at.y, at.z)
    return h
  }

  const hud = createHud({
    sound: (n) => sfx.play(n),
    useSlot: (i) => useSlot(i),
    skipTutorial: () => skipTutorial(),
    breakFree: () => breakFree(),
    revive: () => revive(),
    spectate: () => spectateNext(),
    toLobby: () => leaveToLobby(),
    resultsDone: () => requestLobby(),
    openAvatar: () => bloxity.toggleCustomizer(),
    openFriends: () => openFriends(),
    openRanks: () => bloxity.openLeaderboard('escapes'),
    openStore: () => openStore(),
    openUpgrades: () => openUpgrades(),
    openSettings: () => hud.openSettings(state.data.prefs),
    leavePad: () => leavePad(),
    buyGadget: (id) => {
      const ok = state.buyGadget(id)
      if (ok) sound('buy')
      return ok
    },
    buyUpgrade: (id) => {
      const ok = state.buyUpgrade(id)
      if (ok) sound('levelUp')
      return ok
    },
    setPref: (k, v) => {
      state.setPref(k, v)
      applyPrefs()
    },
    thumb: (kind, id) => safeThumb(kind, id),
    panelChanged: (open) => {
      setLockBlocked(open)
      // Boxity's banner ads around a HUD window (never over the 3D world).
      if (open) bloxity.showAdScreen('panel')
      else if (H.mode === 'results') bloxity.showAdScreen('results')
      else bloxity.hideAdScreen()
    },
  })
  const safeThumb = (kind, id) => {
    try {
      return thumbnail(kind, id, 128)
    } catch {
      return ''
    }
  }
  const applyPrefs = () => {
    sfx.setSfxEnabled(state.data.prefs.sfx)
    music.setMusicEnabled(state.data.prefs.music)
    setLightEffects?.(state.data.prefs.lights)
  }
  state.onChange(() => {
    hud.setCoins(state.data.coins)
    applyPrefs()
  })
  hud.setCoins(0)

  // World.
  const house = buildHouse(scene)
  // Rooms behind walls are not drawn (roomCull.js): per-room scenery here, loot + Grandpa per frame.
  const roomCull = createRoomCull()
  for (const [region, list] of house.regions) for (const o of list) roomCull.addStatic(region, o)
  function cullRooms() {
    roomCull.update(camera, H.mode !== 'lobby')
    for (const p of props.props) {
      const m = p.mesh
      roomCull.dynamic(m, m.position.x, m.position.z, Math.max(p.half.x, p.half.y, p.half.z) + 0.6)
    }
    // Grandpa reaches ~4 m around his feet; the x-ray specs show him through walls
    const gp = grandpa.root.position
    roomCull.dynamic(grandpa.root, gp.x, gp.z, H.boosts.xray > 0 ? Infinity : 5)
  }
  const lobby = buildLobby(scene)
  const van = buildVan(scene)
  const grandpa = createGrandpa(scene)
  const ctxHouse = {
    time: 0,
    grandpa: null, // { x, z } while a heist runs (doors swing out of his way)
    event: (kind, pos, strength = 1, data = {}) => houseEvent(kind, pos, strength, data),
    creak: (mover, speed, name, pos) => creak(mover, speed, name, pos),
    sparks: (pos, n) => fx.burst(pos, { count: n, color: ['#fff6a8', '#8fd8ff', '#ffffff'], speed: 8, up: 3, size: 0.4, life: 0.5, gravity: -16 }),
    authority: true, // (set per frame) the flaps only ride their open doors on the authority
  }

  // --- Lights: a small pool of point lights moved to the nearest lamps --------------------------------
  const lampSpots = [...house.lamps, ...lobby.lamps]
  const pool = Array.from({ length: 3 }, () => {
    const l = new PointLight('#ffd9a0', 0, 60, 1.4)
    scene.add(l)
    return l
  })
  const camPos = new Vector3()
  function updateLights() {
    camera.getWorldPosition(camPos)
    const sorted = lampSpots.filter((l) => !isRoomDark(l.room)).map((l) => ({ l, d: (l.x - camPos.x) ** 2 + (l.y - camPos.y) ** 2 + (l.z - camPos.z) ** 2 }))
    // a fire nearby glows (and wins a light over a lamp at the same distance)
    if (H.mode === 'heist') for (const l of fire.glowSpots(camera)) sorted.push({ l, d: ((l.x - camPos.x) ** 2 + (l.y - camPos.y) ** 2 + (l.z - camPos.z) ** 2) * 0.3 })
    sorted.sort((a, b) => a.d - b.d)
    pool.forEach((pl, i) => {
      const s = sorted[i]
      if (!s || s.d > 120 * 120) {
        pl.intensity = 0
        return
      }
      pl.position.set(s.l.x, s.l.y - 1.2, s.l.z)
      pl.intensity = 140 * (s.l.power ?? 1)
      pl.color.set(s.l.color ?? '#ffd9a0')
    })
  }

  // --- Heist state ---------------------------------------------------------------------------------
  const H = {
    mode: 'lobby', // lobby | loading | heist | results
    heistId: '', // the running heist's server id (its zone is `h<heistId>`); '' = none / offline solo
    difficulty: 'normal',
    target: 1000,
    money: 0, // offline / solo bank
    seed: 0,
    host: 'me',
    crew: [],
    solo: true,
    authority: true,
    status: 'active', // active | held | caged | out | escaped
    struggle: 0,
    cageT: 0,
    safeT: 0, // seconds of "just escaped" invisibility
    boosts: { xray: 0, energy: 0 },
    stolenCount: 0,
    tutorial: -1,
    spectate: null,
    startedAt: 0,
    heat: false,
    relight: new Map(), // (host) dark room -> time Grandpa next tries to switch its lights back on
    caged: new Set(), // (host) crew sids in the cage
    caughtSids: new Set(), // (host) crew sids in Grandpa's hand
    remotePulls: new Map(), // (host) mover idx -> { body, anchor, target, until }
    remoteHolds: new Map(), // (host) prop netId -> sid
    lastSnap: 0,
    lastFull: 0,
    lastHold: 0,
    puppet: { x: -40, z: -22, yaw: 0, pose: 'idle', speed: 0, state: 'patrol', target: '', tx: -40, tz: -22, tyaw: 0, meters: {} },
  }
  const myId = () => (net.connected && net.sessionId) || 'me'
  const isOnline = () => net.connected && !H.solo
  const crewMoney = () => {
    if (H.solo || !net.connected) return H.money
    return readHeist(H.heistId)?.money ?? H.money
  }

  // --- Props / brain / grab / gadgets / jobs -----------------------------------------------------------
  const props = createProps(scene, house, {
    impact: (p, pos, strength) => onImpact(p, pos, strength),
    stolen: (p, from) => onStolen(p, from),
    broken: (p, pos) => onBroken(p, pos),
    landed: (p, to) => {
      fx.burst(to, { count: 10, color: ['#ffd23f', '#ffffff'], speed: 4, up: 3, size: 0.5, life: 0.6 })
    },
    burnt: (p, pos) => onBurnt(p, pos),
  })
  // Fire (fire.js): the grid + burning loot run on the authority; side effects come back here.
  const fire = createFire({
    scene,
    house,
    fx,
    sound,
    loop,
    hooks: {
      ignite: (p) => ctxHouse.event('ignite', p.mesh.position, 1, { id: p.netId }),
      burnUp: (p) => props.burn(p),
      boom: (p) => gasBoom(p),
      started: (c) => ctxHouse.event('fireStart', new Vector3(c.cx, 1, c.cz), 1, { room: c.room }),
    },
  })
  const brain = createBrain({
    grandpa,
    house,
    hooks: {
      fire,
      splash: (x, z) => fireSplash(x, z),
      fireState: (k) => fireMsg(k),
      say: (text, color) => H.authority && isOnline() && sendNet('hb', { t: 'say', x: text, c: color }),
      voice: (name, pos) => {
        sound(name, pos)
        if (isOnline()) sendNet('hb', { t: 'v', n: name })
      },
      spotted: (th) => onSpotted(th.id),
      suspicious: () => {},
      lost: (th) => {
        if (th.id === myId()) {
          sound('lost')
          music.stinger('lost')
        } else if (isOnline()) sendNet('hb', { t: 'lost', sid: th.id })
      },
      caught: (th) => onCaught(th.id),
      caged: (th) => onCaged(th.id),
      dropped: (th) => onDropped(th.id),
      carryPoint: () => {},
      zzz: (pos) => fx.floatText(new Vector3(pos.x, GRANDPA.height + 1, pos.z), 'Z', { color: '#c9b6ff', size: 1.4, life: 2, rise: 4 }),
      openFridge: () => {},
      // a thief in a room with its lights off is hard to make out
      lightAt: (p) => 1 - darknessAt(p) * (1 - DARK.sight),
      thermostatOff: () => {
        H.heat = false
        house.thermostat?.reset?.()
      },
      slipped: (pos) => {
        fx.shake(0.6)
        fx.puff(new Vector3(pos.x, 1, pos.z), { count: 20, color: '#d9cbb5', size: [2, 6], life: 1.5, speed: 6, up: 1 })
        sound('gpSlip', pos)
      },
    },
  })
  const grab = createGrab(scene, camera, {
    upgrades: () => state.data.upgrades,
    blocked: () => hud.panelOpen || H.mode === 'loading' || H.mode === 'results' || (H.mode === 'heist' && H.status !== 'active'),
    canGrab: (o) => {
      if (o.kind === 'cage' && house.cage.locked) {
        if (house.cage.inside(player.position)) return false
        if (H.authority) house.cage.unlock()
        else sendNet('ha', { t: 'unlockCage' })
        sound('cageOpen', o.mesh.position)
      }
      if (o.kind === 'loot' && o.heldBy && o.heldBy !== 'me') return false
      return true
    },
    isRemote: (o) => !H.authority && o.kind !== 'loot',
    grabbed: (o) => {
      sound('grab', o.mesh?.position)
      if (o.kind === 'loot') {
        o.heldBy = 'me'
        if (!H.authority) {
          props.setLocalMode(o, 'dynamic')
          sendNet('ha', { t: 'grab', id: o.netId })
        }
        tutorialEvent('grabLoot')
      }
      if (o.kind === 'garage') tutorialEvent('grabGarage')
    },
    released: (o, thrown) => {
      if (o.kind === 'ride') return endRide(true)
      sound(thrown ? 'throw' : 'release', o.mesh?.position, { strength: thrown ? 1 : 0.4 })
      if (o.kind === 'loot') {
        o.heldBy = null
        o.thrownBy = myId()
        o.thrownAt = ctxHouse.time
        if (!H.authority && o.body) {
          const t = o.body.translation()
          const r = o.body.rotation()
          const v = o.body.linvel()
          const w = o.body.angvel()
          sendNet('ha', { t: 'drop', id: o.netId, p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w], v: [v.x, v.y, v.z], w: [w.x, w.y, w.z] })
          props.setLocalMode(o, 'kinematic')
        }
      } else if (!H.authority) sendNet('ha', { t: 'unpull', m: house.movers.indexOf(o) })
    },
    remotePull: (o, anchor, target) => {
      const now = performance.now()
      if (now - H.lastHold < 1000 / NET.holdHz) return
      H.lastHold = now
      sendNet('ha', { t: 'pull', m: house.movers.indexOf(o), a: [anchor.x, anchor.y, anchor.z], g: [target.x, target.y, target.z] })
    },
    useSwitch: (sw) => {
      if (H.authority) sw.onUse(ctxHouse)
      else sendNet('ha', { t: 'switch', id: sw.id })
    },
    pickup: (o) => takePickup(o),
    ride: (o, point) => startRide(o, point),
    rideAnchor: (o, out) => house.fan.anchor(out),
  })

  // --- Rides: the ceiling fan (hang on to a spinning blade, let go to fly) + the toaster launcher ------
  let ride = null // { fan } while hanging on
  const rideTmp = new Vector3()
  const rideVel = new Vector3()
  function rideDriver() {
    if (!ride) return null
    const fan = house.fan
    fan.anchor(rideTmp)
    fan.velocity(rideVel)
    return { x: rideTmp.x, y: rideTmp.y - FAN.hang, z: rideTmp.z, facing: Math.atan2(rideVel.x, rideVel.z) }
  }
  function startRide(o, point) {
    const fan = house.fan
    if (H.mode !== 'heist' || H.status !== 'active' || isDriven()) return false
    if (!fan.spinning()) {
      hud.toast('Pull the cord to switch the fan on first!', '#ffd23f')
      return false
    }
    fan.attach(point)
    ride = { fan }
    setDriver(rideDriver)
    sound('grab', point)
    hud.toast('Hang on! Let go to fly!', '#8fd8ff')
    if (H.authority) jobs.onEvent('fanRide')
    else sendNet('ha', { t: 'ride' })
    return true
  }
  // Let go: flung off at the blade's speed (cancelled = Grandpa / a reset took over, no fling).
  function endRide(fling) {
    if (!ride) return
    const fan = house.fan
    const mine = currentDriver() === rideDriver
    fan.velocity(rideVel)
    ride = null
    fan.detach()
    if (!mine) return
    setDriver(null)
    if (!fling) return
    const k = FAN.fling
    launch(rideVel.x * k.speed, k.up, rideVel.z * k.speed, k.carry)
    sound('throw', player.position, { strength: 1 })
    fx.puff(new Vector3(player.position.x, player.position.y + 1, player.position.z), { count: 10, color: '#ffffff', size: [0.5, 1.5], life: 0.6, speed: 3, up: 0.5, alpha: 0.5 })
  }
  function updateRides() {
    // someone else took the thief (Grandpa's hand, a respawn): let go without a fling
    if (ride && currentDriver() !== rideDriver) {
      ride = null
      house.fan.detach()
      if (grab.holding?.kind === 'ride') grab.release()
    }
    // the fan slowed down under you: drop off
    if (ride && !house.fan.spinning() && grab.holding?.kind === 'ride') grab.release()
    // fan hum
    const spin = house.fan.spin
    let h = loops.get('fan')
    if (spin > 0.05 && !h) loops.set('fan', (h = loop('fanWhir', house.fan.center)))
    if (h) {
      h.setParam(Math.min(1, spin / FAN.maxSpin))
      if (spin <= 0.05) {
        h.stop()
        loops.delete('fan')
      }
    }
    // first time in a toaster slot: say what to do
    if (!H.toasterHint && house.toaster.contains(player.position) && H.status === 'active') {
      H.toasterHint = true
      hud.toast(COARSE_POINTER ? 'In the toaster! GRAB the lever to launch!' : 'In the toaster! Grab the lever to launch!', '#ffd23f')
    }
  }
  // (host) Dark rooms: once he's calm (not chasing, carrying, stunned...), Grandpa walks to the switch.
  function updateRelight() {
    const now = ctxHouse.time
    for (const [room, at] of H.relight) {
      if (now < at) continue
      const ls = house.lightSwitches.find((l) => l.room === room)
      if (!ls || ls.on) {
        H.relight.delete(room)
        continue
      }
      const calm = brain.state === 'patrol' || brain.state === 'activity' || brain.state === 'search' || brain.state === 'grumble'
      const going = calm && brain.distract('lights', ls.switch.pos, {
        stand: ls.stand,
        onArrive: () => !ls.on && ctxHouse.event('lights', ls.switch.pos, 1, { room, on: true }),
      })
      H.relight.set(room, now + (going ? DARK.relightRetry : 3))
      break
    }
  }
  function toasterPop(p) {
    const t = house.toaster
    if (ctxHouse.time < t.coolUntil) return false // already popped (the crew's fallback + the host's event)
    t.pop(ctxHouse.time)
    sound('toasterPop', p)
    fx.burst(new Vector3(p.x, TOASTER.top + 0.5, p.z), { count: 26, color: ['#ffd9a0', '#ffffff', '#ff9a3c'], speed: 6, up: 7, size: 0.5, life: 0.7 })
    fx.puff(new Vector3(p.x, TOASTER.top + 0.4, p.z), { count: 12, color: '#efe6da', size: [1, 3], life: 1.4, speed: 2, up: 3, spread: 1.6, alpha: 0.5 })
    // the local thief in a slot flies
    if (t.contains(player.position) && !isDriven() && H.status === 'active') {
      const L = TOASTER.launch
      launch(L.vx, L.vy, 0, L.carry)
      fx.shake(0.35)
      sound('jump', player.position)
      hud.toast('TOASTED!', '#ff9a3c')
      if (H.authority) jobs.onEvent('toaster')
      else sendNet('ha', { t: 'toasted' })
    }
    // loot in a slot flies too (host)
    if (H.authority) {
      for (const pr of props.props) {
        if (!pr.body || pr.state !== 'home' || pr.heldBy || pr.mode !== 'dynamic') continue
        const q = pr.body.translation()
        if (!t.contains({ x: q.x, y: q.y - pr.half.y, z: q.z })) continue
        pr.body.setLinvel({ x: TOASTER.launch.vx * 0.6, y: TOASTER.launch.vy * 0.9, z: 0 }, true)
        pr.body.setAngvel({ x: (Math.random() - 0.5) * 8, y: 0, z: (Math.random() - 0.5) * 8 }, true)
        pr.thrownBy = myId()
        pr.thrownAt = ctxHouse.time
      }
    }
    return true
  }
  const gadgets = createGadgets({
    scene,
    fx,
    sound,
    hooks: {
      noise: (p, r) => noise(p, r),
      loop: (name, p) => loop(name, p),
      shake: (p, k) => shakeFrom(p, k, 40),
      playerCollider: () => playerCollider(),
      trip: (kind) => {
        const ok = brain.trip(kind)
        if (ok) jobs.onTrap(kind)
        return ok
      },
      gas: (p, r) => {
        if (Math.hypot(brain.pos.x - p.x, brain.pos.z - p.z) < r + GRANDPA.radius) {
          if (brain.sleep()) jobs.onTrap('sleep')
        }
      },
      smoked: (p) => {
        if (brain.state === 'chase' || brain.state === 'grab') {
          const near = Math.hypot(brain.pos.x - p.x, brain.pos.z - p.z) < 60
          if (near) {
            jobs.onTrap('smokeChase')
            // he loses whoever is in the smoke
            for (const [, a] of brain.awareness) a.sinceSeen = Math.max(a.sinceSeen, GRANDPA.loseSightAfter - 0.5)
          }
        }
      },
      alarm: (p, onSmash) => {
        brain.distract('alarm', p, { onArrive: onSmash })
      },
      jobTrap: (k) => jobs.onTrap(k),
      rocketHit: (p) => {
        if (Math.hypot(brain.pos.x - p.x, brain.pos.z - p.z) < GADGET_FX.rocketBlast + GRANDPA.radius) brain.knock()
      },
      blast: (p, r) => blastLoot(p, r),
      spray: (o, dir, authority) => fireSpray(o, dir, authority),
    },
  })
  function blastLoot(p, r) {
    for (const pr of props.props) {
      if (!pr.body || pr.state !== 'home' || pr.mode !== 'dynamic') continue
      const t = pr.body.translation()
      const d = Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z)
      if (d > r) continue
      const k = (1 - d / r) * 14 * pr.body.mass()
      pr.body.applyImpulse({ x: ((t.x - p.x) / (d || 1)) * k, y: k * 0.6, z: ((t.z - p.z) / (d || 1)) * k }, true)
    }
  }
  const jobs = createJobs({
    done: (j, mirrored) => {
      sound('jobDone')
      music.stinger('job')
      hud.toast(`JOB DONE: ${j.text}  +$${j.def.bonus}`, '#4dff8a')
      fx.burst(new Vector3(player.position.x, player.position.y + 2, player.position.z), { count: 30, color: ['#4dff8a', '#ffd23f', '#ffffff'], speed: 6, up: 5, size: 0.6, life: 1 })
      if (!mirrored && H.authority) addMoney(j.def.bonus)
    },
    failed: (j) => hud.toast(`TIME'S UP: ${j.text}`, '#ff8a8a'),
  })

  // --- Pickups (free gadgets lying around: the lawn bazooka, the kitchen banana) ------------------------
  const pickups = []
  function addPickup(gadget, x, y, z, label) {
    const mesh = makeGadget(gadget)
    mesh.position.set(x, y, z)
    scene.add(mesh)
    const tag = infoLabel([{ text: label, size: 56, color: '#ffd23f' }], 0.022)
    tag.position.set(x, y + 1.6, z)
    scene.add(tag)
    const collider = world.createCollider(RAPIER.ColliderDesc.cuboid(0.8, 0.6, 1.2).setTranslation(x, y, z).setSensor(false))
    const o = { kind: 'pickup', gadget, name: label, mesh, tag, collider, grabbable: true, taken: false, base: y }
    setOwner(collider, o)
    pickups.push(o)
    return o
  }
  addPickup('bazooka', -12, 0.9, 72, 'BAZOOKA!')
  addPickup('banana', -33.6, 5.6, -24.4, 'Banana')
  addPickup('extinguisher', -46, 0.9, 1, 'Extinguisher') // hallway, by the kitchen
  addPickup('extinguisher', -26, 0.9, 8, 'Extinguisher') // garage, inside its hallway door
  function takePickup(o) {
    if (o.taken) return
    o.taken = true
    o.mesh.visible = false
    o.tag.visible = false
    o.collider.setEnabled(false)
    state.addGadget(o.gadget)
    sound('pickup', o.mesh.position)
    fx.burst(o.mesh.position, { count: 24, color: ['#ffd23f', '#ffffff'], speed: 5, up: 4, size: 0.6, life: 0.8 })
    hud.toast(`+1 ${GADGET_BY_ID[o.gadget].name}!`, '#ffd23f')
  }
  function resetPickups() {
    for (const o of pickups) {
      o.taken = false
      o.mesh.visible = true
      o.tag.visible = true
      o.collider.setEnabled(true)
    }
  }

  // --- Fire: burning loot, the extinguisher, Grandpa's buckets, the heat (grid + sim: fire.js) ------------
  const FIRE_MSG = {
    notice: ['Grandpa spotted the fire! He\'s getting water!', '#ffb36b'],
    cant: ['Grandpa can\'t reach the fire!', '#ff8a5a'],
    flee: ['The fire is too big! Grandpa ran outside!', '#ff6a2a'],
    out: ['Grandpa put the fire out!', '#9fd8ff'],
    back: ['The fire is out. Grandpa is coming back in!', '#ffe08a'],
    retry: ['Grandpa is going back in to fight the fire!', '#ffb36b'],
  }
  // (authority: brain) Grandpa's fire-fighting news for the whole crew
  function fireMsg(k) {
    const m = FIRE_MSG[k]
    if (m) hud.toast(m[0], m[1])
    if (!H.authority) return
    if (k === 'notice') jobs.onEvent('firefight')
    if (isOnline()) sendNet('hb', { t: 'fireMsg', k })
  }
  function putOutLoot(pr) {
    if (pr.fire) ctxHouse.event('lootOut', pr.mesh.position, 1, { id: pr.netId })
  }
  // (authority: brain) a bucket of water lands at (x, z)
  function fireSplash(x, z) {
    fire.douse(x, z, FIRE.bucket.radius, FIRE.bucket.power, true)
    for (const pr of props.props) {
      if (!pr.fire || !pr.body) continue
      const t = pr.body.translation()
      if (Math.hypot(t.x - x, t.z - z) < FIRE.bucket.radius && t.y < FIRE.highY) putOutLoot(pr)
    }
    ctxHouse.event('splash', new Vector3(x, 1, z), 1)
  }
  // (every client: gadgets.use) the extinguisher's foam blast; the authority puts things out
  const sprayV = new Vector3()
  function fireSpray(o, dir, authority) {
    const E = FIRE.extinguisher
    const hit = castRay(o.x, o.y, o.z, dir.x, dir.y, dir.z, E.range, { staticOnly: true })
    const range = hit ? Math.max(2.5, hit.toi + 1.5) : E.range
    fire.sprayFx(o, dir, range)
    if (!authority) return
    fire.douseCone(o, dir, range)
    for (const pr of props.props) {
      if (!pr.fire || !pr.body) continue
      const t = pr.body.translation()
      sprayV.set(t.x - o.x, t.y - o.y, t.z - o.z)
      const d = sprayV.length()
      if (d < range + 1.5 && (d < 2 || sprayV.dot(dir) / d > E.cone)) putOutLoot(pr)
    }
  }
  function onBurnt(p, pos) {
    if (grab.holding === p) grab.release()
    sound('fireCrackle', pos)
    fx.puff(pos, { count: 10, color: '#2e2a28', size: [1, 3], life: 2, speed: 2, up: 2, spread: 0.6, alpha: 0.55 })
    fx.burst(pos, { count: 14, color: ['#ff7a1a', '#ffb347', '#3a3a3a'], speed: 4, up: 4, size: 0.35, life: 0.9 })
    if (Math.hypot(pos.x - player.position.x, pos.z - player.position.z) < 60) hud.toast(`${p.name} burned to ash! -$${p.value}`, '#ff9a6a')
    if (H.authority && isOnline()) sendNet('hb', { t: 'burnt', id: p.netId })
  }
  // (authority) a burning gas can goes up: fire all round, loot flung, Grandpa knocked down
  function gasBoom(p) {
    const t = p.body.translation()
    const pos = new Vector3(t.x, t.y, t.z)
    props.burn(p)
    fire.burst(pos.x, pos.z, FIRE.gasRadius, 0.55)
    blastLoot(pos, FIRE.gasRadius)
    if (Math.hypot(brain.pos.x - pos.x, brain.pos.z - pos.z) < FIRE.gasRadius * 0.6 + GRANDPA.radius) brain.knock()
    noise(pos, NOISE.gasBoom)
    ctxHouse.event('boom', pos, 1)
  }
  // (every client) standing in the flames: after a moment you're thrown clear
  let hotT = 0
  function updateHeat(dt) {
    const pp = player.position
    if (H.status !== 'active' || isDriven()) {
      hotT = 0
      return
    }
    const h = fire.heatAt(pp.x, pp.y + 0.5, pp.z)
    if (h < FIRE.hurtHeat) {
      hotT = Math.max(0, hotT - dt)
      return
    }
    hotT += dt * (0.5 + h)
    if (Math.random() < dt * 8) fx.burst(new Vector3(pp.x, pp.y + 1, pp.z), { count: 3, color: ['#ffb347', '#ff7a1a'], speed: 2, up: 3, size: 0.25, life: 0.5, gravity: 2 })
    if (hotT < FIRE.hurtTime) return
    hotT = 0
    const c = fire.cellAt(pp.x, pp.z)
    let dx = c ? pp.x - c.cx : 0
    let dz = c ? pp.z - c.cz : 0
    const l = Math.hypot(dx, dz)
    if (l < 0.5) {
      dx = -Math.sin(player.facing)
      dz = -Math.cos(player.facing)
    } else {
      dx /= l
      dz /= l
    }
    grab.release()
    launch(dx * 15, 10, dz * 15, 0.9)
    sound('fireCrackle', pp)
    sound('jump', pp)
    fx.flash('#ff6a1a', 0.22)
    fx.shake(0.35)
    hud.toast('OUCH! TOO HOT!', '#ff6a2a')
  }

  // --- Climbing through windows (and up onto the porch from the hallway) ------------------------------
  // The sills are 5-8 m up and a jump is ~1.9 m: a jump right in front of an OPEN window (facing it, on
  // either side) or the open front door (from the hallway, up to the porch) pulls you up onto the sill
  // with the grabber arms. A low gap (the bathroom's) makes you duck through.
  let vaultHint = false
  let vaultLook = 0
  function vaultTarget(p) {
    camera.getWorldDirection(viewDir)
    const flat = Math.hypot(viewDir.x, viewDir.z) || 1
    const list = []
    for (const w of Object.values(house.windows)) if (!w.latched && w.open >= 1.1) list.push({ wall: w.wall, line: w.wallLine, a: w.def.a, b: w.def.b, sill: w.def.y0, gap: w.open, both: true })
    if (house.outerDoors.front.amount() > 0.45) list.push({ wall: 'east', line: HOUSE.maxX - HOUSE.wallThick / 2, a: FRONT_DOOR.a, b: FRONT_DOOR.b, sill: FRONT_PORCH_Y, gap: 8, both: false })
    for (const o of list) {
      const alongX = o.wall === 'front' || o.wall === 'back'
      const along = alongX ? p.x : p.z
      const across = (alongX ? p.z : p.x) - o.line
      if (along < o.a + 0.8 || along > o.b - 0.8) continue
      const dist = Math.abs(across)
      if (dist > 6 || dist < 0.2) continue
      const inside = Math.sign(-o.line) === Math.sign(across)
      if (!o.both && !inside) continue
      const rise = o.sill - p.y
      if (rise < 1.2 || rise > 9) continue
      const nx = alongX ? 0 : -Math.sign(across)
      const nz = alongX ? -Math.sign(across) : 0
      if ((viewDir.x * nx + viewDir.z * nz) / flat < 0.45) continue
      return { o, nx, nz, dist, rise }
    }
    return null
  }
  function tryVault(p) {
    if (H.mode !== 'heist' || H.status !== 'active' || isDriven() || ride) return
    const v = vaultTarget(p)
    if (!v) return
    const g = -PHYSICS.gravity
    const apex = v.rise + Math.max(0.25, Math.min(0.6, v.o.gap - 1.2))
    const vy = Math.sqrt(2 * g * apex)
    const tUp = vy / g
    const hs = (v.dist + 0.9) / (tUp * 1.05)
    launch(v.nx * hs, vy, v.nz * hs, tUp + 0.6)
    if (v.o.gap < 2.5) inputState.crouch = true // a low gap: duck through
    sound('stretch', player.position)
    fx.puff(new Vector3(player.position.x, player.position.y + 0.2, player.position.z), { count: 6, color: '#e0d6c4', size: [0.5, 1.4], life: 0.6, speed: 2, up: 0.5, spread: 0.3, alpha: 0.5 })
  }
  onJump((p) => tryVault(p))
  function vaultHintCheck(dt) {
    vaultLook -= dt
    if (vaultHint || vaultLook > 0 || H.status !== 'active') return
    vaultLook = 0.5
    if (!vaultTarget(player.position)) return
    vaultHint = true
    hud.toast(COARSE_POINTER ? 'Tap JUMP at the open window to climb through!' : 'Press SPACE at the open window to climb through!', '#8fd8ff')
  }

  // --- Tutorial highlight (yellow outline box) -------------------------------------------------------
  const outline = new Group()
  scene.add(outline)
  const outlineMat = new LineBasicMaterial({ color: '#ffe14d', transparent: true, opacity: 0.95, depthTest: false })
  const outlineFill = new MeshBasicMaterial({ color: '#ffe14d', transparent: true, opacity: 0.08, depthWrite: false, blending: AdditiveBlending })
  function highlight(obj) {
    outline.clear()
    if (!obj) return
    const box = new Box3().setFromObject(obj)
    const size = new Vector3()
    const c = new Vector3()
    box.getSize(size)
    box.getCenter(c)
    const g = new BoxGeometry(size.x + 0.4, size.y + 0.4, size.z + 0.4)
    const lines = new LineSegments(new EdgesGeometry(g), outlineMat)
    lines.renderOrder = 30
    const fill = new Mesh(g, outlineFill)
    lines.position.copy(c)
    fill.position.copy(c)
    outline.add(lines, fill)
  }

  // --- Sounds of the house (creaks / events) -----------------------------------------------------------
  const creakCool = new Map()
  function creak(mover, speed, name, pos) {
    let h = loops.get(mover)
    const on = speed > 0.25
    if (on && !h) {
      h = loop(name, pos)
      loops.set(mover, h)
    }
    if (h) {
      h.setPos(pos.x, pos.y, pos.z)
      h.setParam(Math.min(1, speed / 2.2))
      if (!on) {
        h.stop()
        loops.delete(mover)
      }
    }
    // fast = loud enough for Grandpa
    const t = creakCool.get(mover) ?? 0
    const nearGp = ctxHouse.grandpa && Math.hypot(ctxHouse.grandpa.x - pos.x, ctxHouse.grandpa.z - pos.z) < 12
    if (H.mode === 'heist' && H.authority && speed > 1.1 && ctxHouse.time > t && !nearGp) {
      creakCool.set(mover, ctxHouse.time + 0.6)
      const r = mover.kind === 'garage' ? NOISE.garage * Math.min(1, speed / 1.6) : mover.kind === 'window' ? NOISE.window * Math.min(1, speed / 3) : NOISE.doorCreak
      noise(pos, r)
    }
  }
  function houseEvent(kind, pos, strength, data) {
    const p = pos.clone ? pos.clone() : new Vector3(pos.x, pos.y, pos.z)
    if (H.mode !== 'heist') return
    switch (kind) {
      case 'doorSlam':
        sound('doorSlam', p)
        fx.puff(p, { count: 8, color: '#e8dcc8', size: [1, 3], life: 1, speed: 3, up: 0.5, spread: 2 })
        if (H.authority) noise(p, NOISE.doorSlam)
        break
      case 'garageClunk':
        sound('garageClunk', p)
        if (H.authority) noise(p, NOISE.garage * 0.8)
        break
      case 'windowThud':
        sound('windowThud', p)
        if (H.authority) noise(p, NOISE.window)
        break
      case 'flap':
        sound('impact', p, { mat: 'plastic', strength: strength * 0.4 })
        if (H.authority) noise(p, NOISE.flap * strength)
        break
      case 'flush':
        sound('flush', p)
        if (H.authority) {
          noise(p, NOISE.flush * 0.3)
          brain.distract('flush', p, { stand: { x: 0, z: -29 } })
          jobs.onEvent('flush')
        }
        break
      case 'thermostat':
        sound('thermostat', p)
        if (H.authority) {
          H.heat = !!data.hot
          brain.setHeat(H.heat)
          if (H.heat) {
            jobs.onEvent('thermostat')
            brain.distract('thermostat', p, { stand: { x: 10, z: -6.2 }, onArrive: () => {
              H.heat = false
              brain.setHeat(false)
              house.thermostat?.reset?.()
            } })
          }
        }
        if (data.hot) hud.toast('The house is heating up... Grandpa is getting sleepy!', '#ffb36b')
        break
      case 'tv':
        sound('tvBreak', p)
        fx.burst(p, { count: 50, color: ['#fff6a8', '#8fd8ff', '#ffffff'], speed: 10, up: 4, size: 0.5, life: 0.7, gravity: -18 })
        fx.chunks(p, { count: 16, glass: true, size: [0.2, 0.6], speed: 6, up: 3, floor: 0 })
        if (!loops.has('tv')) loops.set('tv', loop('tvStatic', p))
        if (H.authority) {
          noise(p, NOISE.tv)
          jobs.onEvent('tv')
          brain.distract('tv', p, { stand: { x: -8, z: 22 } })
        }
        break
      case 'toasterArm':
        if (house.toaster.armed) return
        house.toaster.arm(ctxHouse.time, H.authority)
        sound('toasterArm', p)
        if (loops.has('toaster')) loops.get('toaster').stop()
        loops.set('toaster', loop('toasterTick', p))
        if (H.authority) noise(p, NOISE.toasterLever)
        break
      case 'toasterPop':
        loops.get('toaster')?.stop()
        loops.delete('toaster')
        if (!toasterPop(p)) return
        if (H.authority) {
          noise(p, NOISE.toaster)
          // "Is my toast ready?" He comes over to the counter.
          brain.distract('toast', p, { stand: { x: -25, z: -34.2 } })
        }
        break
      case 'fan':
        house.fan.setOn(data.on)
        sound('fanCord', p)
        if (H.authority) {
          noise(p, NOISE.fanCord)
          // He wanders over and switches it back off (lures him into the bedroom).
          if (data.on) {
            brain.distract('fan', p, { stand: { x: 31.5, z: -23 }, onArrive: () => {
              if (house.fan.on) ctxHouse.event('fan', house.fan.switch.pos, 1, { on: false })
            } })
          }
        }
        break
      case 'phone': {
        const ph = house.phone
        if (data.s === 'dial' && ph.state !== 'idle') return
        if (data.s === 'answer' && ph.state !== 'ringing') return // it stopped before he got there
        ph.set(data.s, ctxHouse.time, H.authority)
        if (data.s === 'dial') sound('phoneDial', p)
        else if (data.s === 'ring') {
          loops.get('phone')?.stop()
          loops.set('phone', loop('phoneRing', p))
          if (H.authority) {
            noise(p, NOISE.phone)
            // he hurries over, answers, and chats for ages with his back to the room; it keeps ringing
            // while he's on his way (from the garage that takes a while)
            const coming = brain.distract('phone', p, {
              stand: PHONE.stand,
              onArrive: () => ctxHouse.event('phone', ph.pos, 1, { s: 'answer' }),
              onDone: () => house.phone.state === 'answered' && ctxHouse.event('phone', ph.pos, 1, { s: 'hangup' }),
            })
            if (coming && ph.pending) ph.pending.at = ctxHouse.time + PHONE.ringComing
          }
        } else {
          loops.get('phone')?.stop()
          loops.delete('phone')
          if (data.s !== 'stop') sound('phonePickup', p)
          if (data.s === 'answer') {
            fx.floatText(new Vector3(p.x, 9, p.z), 'Hello?', { color: '#ffffff', size: 1.2, life: 1.6, rise: 2 })
            if (H.authority) jobs.onEvent('phone')
          }
        }
        break
      }
      case 'lights': {
        const ls = house.lightSwitches.find((l) => l.room === data.room)
        if (!ls || ls.on === !!data.on) return
        ls.setOn(data.on)
        setRoomDark(data.room, !data.on)
        sound('lightSwitch', p)
        if (H.authority) {
          noise(p, NOISE.lightSwitch)
          if (!data.on) {
            jobs.onEvent('lights')
            H.relight.set(data.room, ctxHouse.time + DARK.relightDelay)
          } else H.relight.delete(data.room)
        }
        break
      }
      case 'secret':
        sound('secretDoor', p)
        house.nav.flags.secret = true
        house.windows.study?.setLatched(false) // its window unlatches from the inside
        hud.toast('A SECRET DOOR! The study is open!', '#ffd23f')
        if (H.authority) {
          noise(p, NOISE.secret)
          jobs.onEvent('secret')
        }
        break
      // --- fire ---
      case 'ignite': {
        const pr = props.byNet(data.id)
        if (!pr || pr.state !== 'home' || pr.fire) return
        fire.setLootFire(pr, true)
        sound('ignite', p)
        fx.burst(p, { count: 24, color: ['#ffb347', '#ff7a1a', '#fff1a0'], speed: 5, up: 6, size: 0.5, life: 0.8, gravity: 2 })
        if (H.authority) noise(p, NOISE.ignite)
        if (!H.fireHint && Math.hypot(p.x - player.position.x, p.z - player.position.z) < 25) {
          H.fireHint = true
          hud.toast(`The ${pr.name} is ON FIRE! Leave it somewhere in the house...`, '#ff8a3a')
        }
        break
      }
      case 'lootOut': {
        const pr = props.byNet(data.id)
        if (pr) fire.setLootFire(pr, false)
        sound('smoke', p)
        fx.puff(p, { count: 8, color: '#eef2f4', size: [1, 3], life: 1.6, speed: 2, up: 2, spread: 0.6, alpha: 0.5 })
        break
      }
      case 'splash':
        fire.splashFx(p.x, p.z)
        break
      case 'boom': {
        sound('gasBoom', p)
        fx.burst(p, { count: 70, color: ['#ffd23f', '#ff7a1a', '#ff3b1a', '#ffffff'], speed: 18, up: 8, size: 0.9, life: 1.2, gravity: -10 })
        fx.puff(p, { count: 20, color: '#3a3533', size: [3, 8], life: 3, speed: 6, up: 4, spread: 2, alpha: 0.6 })
        fx.ring(p, '#ff7a1a', FIRE.gasRadius, 0.6)
        fx.flash('#ff8a2a', 0.25)
        shakeFrom(p, 1, 70)
        // the local thief close by is blown clear
        const dx = player.position.x - p.x
        const dz = player.position.z - p.z
        const d = Math.hypot(dx, dz)
        if (d < FIRE.gasRadius && H.status === 'active' && !isDriven()) {
          grab.release()
          launch((dx / (d || 1)) * 18, 12, (dz / (d || 1)) * 18, 1)
          hud.toast('KA-BOOM! The gas can blew up!', '#ff6a2a')
        }
        break
      }
      case 'fireStart': {
        const room = ROOMS.find((r) => r.id === data.room)?.name ?? 'HOUSE'
        hud.toast(`FIRE! The ${room} is burning!`, '#ff6a2a')
        if (H.authority) jobs.onEvent('fire')
        break
      }
      default:
        break
    }
    if (H.authority && isOnline()) sendNet('hb', { t: 'ev', k: kind, p: [p.x, p.y, p.z], s: strength, d: data })
  }

  // --- Noise -> Grandpa ------------------------------------------------------------------------------
  let lastNoiseSent = 0
  function noise(p, r) {
    if (H.mode !== 'heist' || r <= 0) return
    if (H.authority) brain.hear(p, r)
    else if (performance.now() - lastNoiseSent > 150 && r > 4) {
      lastNoiseSent = performance.now()
      sendNet('ha', { t: 'noise', p: [p.x, p.y, p.z], r })
    }
  }

  // --- Loot events -----------------------------------------------------------------------------------
  const impactCool = new Map()
  function onImpact(p, pos, strength) {
    if (H.mode !== 'heist' && H.mode !== 'lobby') return
    sound('impact', pos, { mat: p.mat, strength })
    if (p.def.squeak) sound('squeak', pos, { strength })
    if (strength > 0.35) fx.puff(pos, { count: 4, color: '#e6dccb', size: [0.6, 2], life: 0.8, speed: 2, up: 0.4, spread: 0.3, alpha: 0.5 })
    if (!H.authority || H.mode !== 'heist') return
    noise(pos, (IMPACT.noise[p.mat] ?? 20) * (0.25 + strength * 0.75) + (p.def.squeak ? IMPACT.squeakNoise * strength : 0))
    // TV screen
    if (pos.distanceTo(house.tv.screenPos) < 4) house.tv.hit(strength, ctxHouse)
    // Grandpa hit by THROWN loot (rescues a held friend); loot he just brushes past does nothing
    const dx = pos.x - brain.pos.x
    const dz = pos.z - brain.pos.z
    const thrown = p.thrownBy && ctxHouse.time - (p.thrownAt ?? -99) < 3
    if (thrown && Math.hypot(dx, dz) < GRANDPA.radius + 1.6 + Math.max(p.half.x, p.half.z) && pos.y < GRANDPA.height + 1) {
      const v = p.body?.linvel()
      const sp = v ? Math.hypot(v.x, v.y, v.z) : 0
      if (strength > 0.25 || sp > GRANDPA.hitImpulse * 0.6) {
        fx.burst(pos, { count: 16, color: ['#ffffff', '#ffd23f'], speed: 6, up: 4, size: 0.6, life: 0.6 })
        brain.hit(strength, p.thrownBy)
      }
    }
    if (isOnline()) {
      const t = impactCool.get(p) ?? 0
      if (ctxHouse.time > t) {
        impactCool.set(p, ctxHouse.time + 0.12)
        sendNet('hb', { t: 'imp', p: [pos.x, pos.y, pos.z], m: p.mat, s: Math.round(strength * 100) / 100, q: p.def.squeak ? 1 : 0 })
      }
    }
  }
  function addMoney(v) {
    H.money += v
    if (isOnline()) sendNet('steal', { value: v })
  }
  function onStolen(p, from) {
    H.stolenCount++
    sound('collect', from, { strength: Math.min(1, p.value / 250) })
    sound('register')
    fx.burst(from, { count: 26, color: ['#ffd23f', '#fff6a8', '#4dff8a'], speed: 6, up: 6, size: 0.7, life: 1 })
    fx.ring(from, '#ffd23f', 4, 0.6)
    fx.floatText(from, `+$${p.value}`, { color: '#7dff6a', size: 1.3, life: 1.6, rise: 3 })
    if (H.authority) {
      addMoney(p.value)
      jobs.onSteal(p)
      if (isOnline()) sendNet('hb', { t: 'stolen', id: p.netId })
    }
    tutorialEvent('stolen')
    if (p.def.treasure) hud.toast(`THE ${p.name.toUpperCase()}! +$${p.value}`, '#ffd23f')
  }
  function onBroken(p, pos) {
    const glassy = p.mat === 'glass'
    sound('shatter', pos, { mat: glassy ? 'glass' : 'ceramic' })
    fx.chunks(pos, { count: 22, glass: glassy, color: ['#ffffff', '#e9e2d0', '#7fb3d5'], size: [0.15, 0.5], speed: 7, up: 4, floor: Math.max(0, pos.y - p.half.y) })
    if (p.def.coins) {
      sound('coinBurst', pos)
      fx.chunks(pos, { count: 26, color: ['#ffd23f', '#e0a400'], size: [0.25, 0.4], flat: 0.12, speed: 7, up: 6, floor: Math.max(0, pos.y - p.half.y) })
    }
    hud.toast(`${p.name} smashed! -$${p.value}`, '#ff9a8a')
    if (H.authority) {
      noise(pos, IMPACT.shatterNoise)
      if (isOnline()) sendNet('hb', { t: 'broken', id: p.netId })
    }
  }

  // --- Grandpa events (authority) -> local or crew ---------------------------------------------------
  function onSpotted(id) {
    if (id === myId()) localSpotted()
    else if (isOnline()) sendNet('hb', { t: 'spot', sid: id })
  }
  function localSpotted() {
    sound('spotted')
    music.stinger('spotted')
    hud.banner('<em>GRANDPA SPOTTED YOU!</em><br>RUN!', 2, 'danger')
    fx.flash('#ff2a2a', 0.18)
  }
  function onCaught(id) {
    if (id === myId()) localHeld()
    else {
      H.caughtSids.add(id)
      if (isOnline()) sendNet('hb', { t: 'caught', sid: id })
    }
  }
  function onCaged(id) {
    house.cage.lock()
    sound('cageClose', house.cage.center)
    if (id === myId()) localCaged()
    else {
      H.caughtSids.delete(id)
      H.caged.add(id)
      if (isOnline()) sendNet('hb', { t: 'caged', sid: id })
    }
  }
  function onDropped(id) {
    if (id === myId()) localFree('wriggle')
    else {
      H.caughtSids.delete(id)
      if (isOnline()) sendNet('hb', { t: 'dropped', sid: id })
    }
  }

  // --- The local thief's fate ---------------------------------------------------------------------------
  function localHeld() {
    if (H.status !== 'active') return
    H.status = 'held'
    playerCollider()?.setEnabled(false) // dangling: don't shove loot around
    H.struggle = 0
    inputState.struggle = 0
    inputState.crouch = false
    grab.release()
    sound('caught')
    music.stinger('caught')
    music.setMood('held')
    fx.flash('#ff2a2a', 0.3)
    fx.shake(0.6)
    setDriver(() => ({ x: grandpa.handWorld.x, y: grandpa.handWorld.y - 1.1, z: grandpa.handWorld.z, facing: brain.yaw + Math.PI }))
  }
  function localCaged() {
    setDriver(null)
    playerCollider()?.setEnabled(true)
    H.status = 'caged'
    H.cageT = GRANDPA.cageTime
    const c = house.cage.center
    resetPlayer({ x: c.x - 1, y: c.y + 0.05, z: c.z }, Math.PI / 2)
    syncYawToPlayer()
    hud.banner('Locked in the <em>CAGE</em>!', 2.2, 'danger')
  }
  function localFree(how) {
    setDriver(null)
    playerCollider()?.setEnabled(true)
    if (H.status === 'held') {
      // drop in front of him and run
      const p = grandpa.handWorld
      resetPlayer({ x: p.x, y: Math.max(0.1, p.y - 2), z: p.z }, player.facing)
    }
    H.status = 'active'
    H.safeT = 2.5
    player.frozen = false
    sound('breakFree')
    music.setMood('chase')
    hud.banner(how === 'paid' ? 'BROKE FREE! <em>RUN!</em>' : how === 'friend' ? 'A friend freed you! <em>RUN!</em>' : 'You wriggled free! <em>RUN!</em>', 2)
    fx.burst(new Vector3(player.position.x, player.position.y + 1, player.position.z), { count: 30, color: ['#4dff8a', '#ffffff'], speed: 6, up: 4, size: 0.6, life: 0.8 })
  }
  function localOut() {
    H.status = 'out'
    setDriver(null)
    playerCollider()?.setEnabled(true)
    player.frozen = true
    resetPlayer({ x: 0, y: 0.05, z: 160 }, Math.PI) // parked out of sight across the street
    sound('caught')
    const friends = activeCrewIds().length > 0
    if (!friends) return finish(false)
    spectateNext()
  }
  function breakFree() {
    if (H.status !== 'held' && H.status !== 'caged') return
    if (!state.spend(PRICES.breakFree)) {
      sound('error')
      hud.toast('Not enough coins', '#ff8a8a')
      return
    }
    if (H.status === 'held') {
      if (H.authority) brain.releaseCarried()
      else sendNet('ha', { t: 'free', paid: 1 })
      if (H.authority && H.status === 'held') localFree('paid')
    } else {
      // out of the cage, next to it
      const c = house.cage.center
      resetPlayer({ x: c.x + 6, y: 0.1, z: c.z }, Math.PI / 2)
      syncYawToPlayer()
      localFree('paid')
    }
  }
  function revive() {
    if (H.status !== 'out') return
    if (!state.spend(PRICES.revive)) {
      sound('error')
      hud.toast('Not enough coins', '#ff8a8a')
      return
    }
    const mate = activeCrewIds()[0]
    const pos = mate && net.players?.get(mate)
    resetPlayer(pos ? { x: pos.x + 1.5, y: pos.y + 0.2, z: pos.z } : HEIST_SPAWN, player.facing)
    syncYawToPlayer()
    setFollow(null)
    H.spectate = null
    H.status = 'active'
    H.safeT = 3
    player.frozen = false
    sound('breakFree')
    hud.banner('REVIVED! <em>Back to work!</em>', 2)
  }
  const activeCrewIds = () => {
    if (!isOnline()) return []
    const out = []
    net.players?.forEach((p, id) => {
      if (id !== net.sessionId && p.zone === `h${H.heistId}` && !p.out) out.push(id)
    })
    return out
  }
  function spectateNext() {
    const ids = activeCrewIds()
    if (!ids.length) {
      H.spectate = 'grandpa'
      setFollow(() => brain.pos)
      return
    }
    const i = (ids.indexOf(H.spectate) + 1) % ids.length
    H.spectate = ids[i]
    setFollow(() => {
      const p = net.players?.get(H.spectate)
      return p ? { x: p.x, y: p.y, z: p.z } : null
    })
  }

  // --- Heist lifecycle ----------------------------------------------------------------------------------
  // info = { pad, seed, difficulty, target, host, crew: [sid], solo }
  // Background prewarm while in the lobby: the 62 procedural loot models take ~1 s to build and their
  // shaders a few hundred ms to compile, which used to land as one long freeze the moment the first heist
  // began. Here each model is built, given its dark-room patch and handed to the GPU's background shader
  // compiler (KHR_parallel_shader_compile) one at a time in idle moments, so it is all ready by then.
  // Starting a heist sooner is fine: whatever is left builds at spawn exactly as before.
  const warmList = [...LOOT.map((l) => () => makeLoot(l.id)), ...GADGETS.map((g) => () => makeGadget(g.id)), () => makeMarble(), () => makeBananaPeel(), () => makeFoamRocket()]
  const warm = { i: 0, busy: false }
  const whenIdle = (fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 500 }) : setTimeout(fn, 40))
  function prewarmStep() {
    if (warm.busy || warm.i >= warmList.length) return
    warm.busy = true
    whenIdle(() => {
      try {
        if (H.mode !== 'lobby') return // the heist builds the rest itself
        const obj = warmList[warm.i++]()
        patchDarkness(obj)
        renderer.compileAsync(obj, camera, scene).catch(() => {})
      } catch {
        // warm-up only: anything missed builds / compiles on first use
      } finally {
        warm.busy = false
      }
    })
  }
  function beginHeist(info) {
    hud.closePanel()
    H.mode = 'loading'
    hud.loading(true)
    sound('go')
    music.stinger('start')
    setTimeout(() => startHeist(info), 1700)
  }
  function startHeist(info) {
    hud.loading(false)
    H.mode = 'heist'
    H.heistId = info.heistId ?? ''
    H.seed = info.seed >>> 0
    H.difficulty = info.difficulty ?? 'normal'
    H.target = info.target ?? DIFFICULTY[H.difficulty].target
    H.solo = !!info.solo
    H.host = info.host
    H.crew = info.crew ?? []
    H.authority = H.solo || info.host === myId()
    H.money = 0
    H.status = 'active'
    H.stolenCount = 0
    H.boosts.xray = H.boosts.energy = 0
    H.heat = false
    H.caged.clear()
    H.caughtSids.clear()
    H.remotePulls.clear()
    H.remoteHolds.clear()
    for (const mv of house.movers) mv.netPose = null
    H.startedAt = performance.now()
    H.spectate = null
    setFollow(null)
    house.reset()
    ride = null
    clearDarkness()
    H.relight.clear()
    house.nav.flags.secret = false
    house.nav.flags.outside = false
    fire.reset()
    H.fireHint = false
    H.fireWas = 0
    vaultHint = false
    for (const [, h] of loops) h.stop?.()
    loops.clear()
    props.spawn(H.seed)
    patchDarkness(scene) // new loot gets its final (dark-room) shader before its first frame
    props.setAuthority(H.authority)
    setMoversAuthority(H.authority)
    gadgets.clear()
    jobs.roll(H.seed, Math.max(1, H.crew.length))
    resetPickups()
    if (H.authority) brain.reset(H.difficulty)
    else brain.disable()
    grandpa.root.visible = true
    grandpa.setXray(false)
    const idx = Math.max(0, H.crew.indexOf(myId()))
    const spawn = { x: HEIST_SPAWN.x + (idx % 2 ? 2.5 : -2.5) * Math.ceil(idx / 2), y: HEIST_SPAWN.y, z: HEIST_SPAWN.z }
    setSpawnPoint(spawn, HEIST_SPAWN.facing)
    resetPlayer(spawn, HEIST_SPAWN.facing)
    syncYawToPlayer()
    player.frozen = false
    inputState.crouch = false
    hud.setMode('heist')
    hud.showResults(null)
    hud.setCaught(null)
    music.setMood('sneak')
    H.tutorial = state.data.tutorialDone ? -1 : 0
    if (H.tutorial < 0) hud.banner(`Steal <em>$${H.target.toLocaleString('en-US')}</em> and escape in the van<br>before <span style="color:#ff5a5a">GRANDPA</span> catches you!`, 4)
    updateTutorial()
  }
  // Results + back to the lobby.
  function finish(escaped) {
    if (H.mode !== 'heist') return
    H.mode = 'results'
    grab.release()
    setDriver(null)
    player.frozen = true
    const haul = crewMoney()
    const d = DIFFICULTY[H.difficulty]
    const jobsDone = jobs.doneCount()
    let coins = Math.round(haul * d.coinMult) + jobsDone * REWARDS.jobCoins
    if (!escaped) coins = Math.round(coins * REWARDS.caughtShare)
    state.earn(coins)
    const { best } = state.recordHeist({ escaped, haul, items: H.stolenCount, jobs: jobsDone })
    if (H.tutorial >= 0) skipTutorial()
    if (escaped) {
      sound('escape')
      music.stinger('escape')
      sound('vanDoor', van.door)
      if (isOnline()) sendNet('escaped')
    } else {
      music.stinger('caught')
      if (isOnline()) sendNet('leaveHeist')
    }
    music.setMood('results')
    bloxity.gameplayEnd()
    if (!escaped) bloxity.showDeathScreen()
    else bloxity.showAdScreen('results')
    hud.showResults({ escaped, haul, coins, jobs: jobsDone, items: H.stolenCount, difficulty: H.difficulty, best })
    setLockBlocked(true)
    fx.burst(new Vector3(player.position.x, player.position.y + 2, player.position.z), { count: 80, color: ['#ffd23f', '#4dff8a', '#ff6fa8', '#3fb7ff'], speed: 12, up: 8, size: 0.8, life: 1.6 })
  }
  function leaveToLobby() {
    if (H.mode === 'heist' && isOnline()) sendNet('leaveHeist')
    bloxity.hideDeathScreen()
    bloxity.hideAdScreen()
    if (H.mode === 'results') bloxity.gameplayStart()
    H.mode = 'lobby'
    H.status = 'active'
    hud.showResults(null)
    hud.setCaught(null)
    hud.tutorial(null)
    highlight(null)
    setLockBlocked(false)
    setFollow(null)
    setDriver(null)
    playerCollider()?.setEnabled(true)
    grab.release()
    props.clear()
    fire.reset()
    gadgets.clear()
    brain.disable()
    for (const [, h] of loops) h.stop?.()
    loops.clear()
    grandpa.setXray(false)
    player.frozen = false
    player.mods.endless = false
    player.mods.speed = 1
    clearDarkness()
    setSpawnPoint(SPAWN, SPAWN_FACING)
    resetPlayer(SPAWN, SPAWN_FACING)
    syncYawToPlayer()
    hud.setMode('lobby')
    music.setMood('lobby')
    H.heistId = ''
    lobbyPad = -1
    offline.pad = -1
  }

  // --- Movers in crew mode (kinematic puppets of the host) ------------------------------------------------
  function setMoversAuthority(on) {
    for (const mv of house.movers) {
      if (!mv.body) continue
      const type = on ? RAPIER.RigidBodyType.Dynamic : RAPIER.RigidBodyType.KinematicPositionBased
      if (mv.body.bodyType() !== type) mv.body.setBodyType(type, true)
    }
  }

  // --- Gadgets / hotbar ------------------------------------------------------------------------------
  const viewDir = new Vector3()
  function useSlot(i) {
    const g = GADGETS[i]
    if (!g) return
    if (H.mode !== 'heist' || H.status !== 'active') {
      if (H.mode === 'lobby') openStore()
      return
    }
    if ((state.data.gadgets[g.id] ?? 0) <= 0) {
      // buy on the spot (Coins)
      if (state.buyGadget(g.id)) {
        sound('buy')
        hud.toast(`Bought ${g.name}!`, '#ffd23f')
      } else {
        sound('error')
        hud.toast(`${g.name}: ${g.price} coins`, '#ff8a8a')
        return
      }
    }
    if (g.id === 'xray' && H.boosts.xray > 0) return
    if (g.id === 'energy' && H.boosts.energy > 0) return
    state.useGadget(g.id)
    camera.getWorldDirection(viewDir)
    const origin = { x: player.position.x, y: player.position.y, z: player.position.z }
    const chest = new Vector3(player.position.x, player.position.y + player.dims.height * 0.75, player.position.z)
    if (g.id === 'xray') {
      H.boosts.xray = GADGET_FX.xrayTime
      sound('xrayOn')
      return
    }
    if (g.id === 'energy') {
      H.boosts.energy = GADGET_FX.energyTime
      sound('drink')
      return
    }
    gadgets.use(g.id, { origin, dir: viewDir.clone(), chest, authority: H.authority })
    if (isOnline()) {
      const msg = { t: 'gadget', g: g.id, o: [origin.x, origin.y, origin.z], d: [viewDir.x, viewDir.y, viewDir.z], c: [chest.x, chest.y, chest.z], from: myId() }
      sendNet(H.authority ? 'hb' : 'ha', msg)
    }
  }

  // --- Bloxity: rewarded ad, friends, portal buttons ---------------------------------------------------
  // Rewarded ad (Store card): the coins are granted only after the SERVER confirmed the reward token with
  // Bloxity (net.verifyAdReward); skipped / failed / unverifiable ads pay nothing.
  let adBusy = false
  let adReadyAt = 0
  const AD_MESSAGES = { skipped: 'Ad skipped - no reward', 'no-fill': 'No ad available right now', blocked: 'Ads are blocked', disabled: 'Ads are off right now', denied: 'Ad not available' }
  const rewardedAd = {
    coins: REWARDED_AD.coins,
    available: () => bloxity.adsAvailable() && net.connected,
    ready: () => !adBusy && performance.now() >= adReadyAt,
    async watch() {
      if (adBusy) return
      adBusy = true
      try {
        const res = await bloxity.showRewardedAd(REWARDED_AD.placement)
        if (res.status !== 'completed') return hud.toast(AD_MESSAGES[res.status] ?? 'Ad failed - try again later', '#ffb36b')
        if (!(await verifyAdReward(res.rewardToken, REWARDED_AD.placement))) return hud.toast("Couldn't verify the ad reward", '#ff8a8a')
        state.grant(REWARDED_AD.coins)
        sound('buy')
        hud.toast(`+${REWARDED_AD.coins} coins - thanks for watching!`, '#ffd23f')
        adReadyAt = performance.now() + REWARDED_AD.cooldown * 1000
      } finally {
        adBusy = false
      }
    },
  }
  async function openFriends() {
    if (H.mode !== 'lobby' || hud.panelOpen) return
    const list = (await bloxity.getFriends()).map((f) => ({ id: f._id, name: f.displayName || f.username || 'Friend', status: f.presence?.status ?? 'offline' }))
    if (H.mode !== 'lobby' || hud.panelOpen) return
    hud.openFriends(list, {
      invite: (id) => bloxity.inviteFriend(id),
      copyLink: async () => {
        const link = bloxity.inviteLink()
        if (!link) return false
        try {
          await navigator.clipboard.writeText(link)
          return true
        } catch {
          return false
        }
      },
    })
  }
  // The avatar / friends / ranks buttons only show where the portal supports them (and friends need an account).
  const refreshPortalButtons = () => hud.setPortalButtons({ avatar: bloxity.canCustomize(), friends: bloxity.canSocial(), ranks: bloxity.canOpenLeaderboard() })
  refreshPortalButtons()
  setInterval(refreshPortalButtons, 2000)
  // Boxity's death screen holds the Respawn button until its countdown ran out.
  function requestLobby() {
    if (!bloxity.deathScreenRespawn()) return hud.toast('Hold on a second...', '#ffb36b')
    leaveToLobby()
  }

  // --- Store / upgrades ------------------------------------------------------------------------------
  let storeRender = null
  function openStore() {
    if (H.mode !== 'lobby') return
    storeRender = hud.openStore(state.data, rewardedAd)
  }
  function openUpgrades() {
    if (H.mode !== 'lobby') return
    storeRender = hud.openUpgrades(state.data)
  }
  onKey('KeyB', () => (hud.panelOpen ? hud.closePanel() : openStore()))
  onKey('KeyU', () => (hud.panelOpen ? hud.closePanel() : openUpgrades()))
  onKey('KeyK', () => skipTutorial())
  onKey('KeyE', () => H.status === 'out' && spectateNext())
  onKey('KeyL', () => (H.status === 'out' || H.mode === 'results') && requestLobby())
  onKey('KeyJ', () => document.querySelector('.jobs')?.classList.toggle('collapsed'))

  // --- Tutorial ---------------------------------------------------------------------------------------
  const TUT = [
    { id: 'walk', text: () => 'Alright, time to rob Grandpa! First things first, <em>WALK</em> up to the <em>GARAGE DOOR</em>.', target: () => house.movers.find((m) => m.kind === 'garage')?.mesh },
    { id: 'lift', text: () => (COARSE_POINTER ? 'Hold <em>GRAB</em> on the <em>BOTTOM</em> of the garage door and look <em>UP</em> to lift it!' : 'Hold <em>LEFT CLICK</em> to <em>GRAB</em> the bottom of the garage door and <em>DRAG UP</em> to lift it!'), target: () => house.movers.find((m) => m.kind === 'garage')?.mesh },
    { id: 'loot', text: () => 'Sneak inside and <em>GRAB</em> some loot. Don\'t let <span class="red">GRANDPA</span> see you!', target: () => null },
    { id: 'throw', text: () => (COARSE_POINTER ? 'Now <em>THROW</em> it out of the house (THROW button), or carry it outside!' : 'Now <em>THROW</em> it out of the house (<em>RIGHT CLICK</em>), or carry it outside!'), target: () => null },
    { id: 'done', text: () => `Nice! You got paid!<br>Rob <span class="green">$${H.target.toLocaleString('en-US')}</span> and escape before <span class="red">GRANDPA</span> catches you! <span class="green">Good luck!</span>`, target: () => null },
  ]
  let tutDoneT = 0
  function updateTutorial() {
    if (H.tutorial < 0 || H.mode !== 'heist') {
      hud.tutorial(null)
      highlight(null)
      return
    }
    const step = TUT[H.tutorial]
    hud.tutorial(step.text())
    highlight(step.target())
  }
  function tutorialEvent(kind) {
    if (H.tutorial < 0) return
    const id = TUT[H.tutorial].id
    if ((id === 'lift' && kind === 'lifted') || (id === 'loot' && kind === 'grabLoot') || (id === 'throw' && kind === 'stolen') || (id === 'walk' && kind === 'nearGarage')) {
      H.tutorial++
      sound('jobDone')
      if (TUT[H.tutorial]?.id === 'done') tutDoneT = 5
      updateTutorial()
    }
    void kind
  }
  function skipTutorial() {
    if (H.tutorial < 0) return
    H.tutorial = -1
    state.finishTutorial()
    hud.tutorial(null)
    highlight(null)
  }

  // --- Lobby pads ---------------------------------------------------------------------------------------
  let lobbyPad = -1
  const offline = { pad: -1, startsAt: 0 }
  function leavePad() {
    if (net.connected) sendNet('leavePad')
    offline.pad = -1
    // step off the cap
    const p = LOBBY.pads[lobbyPad]
    if (p) {
      resetPlayer({ x: p.x, y: 0.1, z: p.z + LOBBY.padRadius + LOBBY.padExit }, Math.PI)
      syncYawToPlayer()
    }
    lobbyPad = -1
  }
  // `mine` = the server lists this player on the pad, `full` = no seat left. The server answers a
  // joinPad onto a full pad with nothing at all, so the pad state is the only answer. A pad is free again
  // the moment its crew launches (the heist is its own server object), so there is no 'heist in progress'.
  function padViews() {
    const pads = readPads()
    if (pads) {
      return pads.map((p) => ({
        count: p.members.length,
        names: p.members.map((m) => m.name),
        seconds: p.startsAt ? Math.max(0, Math.ceil((p.startsAt - serverNow()) / 1000)) : 0,
        mine: p.members.some((m) => m.id === net.sessionId),
        full: p.members.length >= LOBBY.padSize,
      }))
    }
    return LOBBY.pads.map((_, i) => ({
      count: offline.pad === i ? 1 : 0,
      names: offline.pad === i ? ['You'] : [],
      seconds: offline.pad === i ? Math.max(0, Math.ceil((offline.startsAt - Date.now()) / 1000)) : 0,
      mine: offline.pad === i,
      full: false,
    }))
  }
  let lastJoinTry = 0
  let inStore = false
  let inUpg = false
  function updateLobby(dt) {
    const here = lobby.padAt(player.position)
    if (here !== lobbyPad) {
      lobbyPad = here
      if (here >= 0) sound('countdown')
      if (net.connected) {
        sendNet(here >= 0 ? 'joinPad' : 'leavePad', here >= 0 ? { pad: here } : {})
        lastJoinTry = performance.now()
      } else {
        offline.pad = here
        offline.startsAt = here >= 0 ? Date.now() + LOBBY.fullCountdown * 1000 : 0
      }
    }
    const views = padViews()
    lobby.update(dt, views, lobbyPad)
    if (lobbyPad >= 0) {
      const v = views[lobbyPad]
      // Standing on a pad the server has not seated us on: say why ('full', else 'joining'),
      // and ask again as soon as it has room (someone stepped off or the crew launched), at most once a second.
      const seat = net.connected && !v.mine ? (v.full ? 'full' : 'joining') : ''
      if (seat === 'joining' && performance.now() - lastJoinTry > 1000) {
        lastJoinTry = performance.now()
        sendNet('joinPad', { pad: lobbyPad })
      }
      hud.setPad({ difficulty: LOBBY.pads[lobbyPad].difficulty, members: v.names, size: LOBBY.padSize, seconds: v.seconds, seat })
      if (!seat && v.seconds !== lastTick && v.seconds > 0 && v.seconds <= 5) sound('countdown')
      lastTick = v.seconds
    } else hud.setPad(null)
    // offline launch
    if (!net.connected && offline.pad >= 0 && Date.now() >= offline.startsAt) {
      const pad = offline.pad
      offline.pad = -1
      const d = LOBBY.pads[pad].difficulty
      beginHeist({ pad, seed: (Math.random() * 2 ** 32) >>> 0, difficulty: d, target: DIFFICULTY[d].target, host: 'me', crew: ['me'], solo: true })
    }
    // stalls
    const pz = player.position
    const s = Math.hypot(pz.x - lobby.storeZone.pos.x, pz.z - lobby.storeZone.pos.z) < lobby.storeZone.radius
    const u = Math.hypot(pz.x - lobby.upgradeZone.pos.x, pz.z - lobby.upgradeZone.pos.z) < lobby.upgradeZone.radius
    if (s && !inStore && !hud.panelOpen) openStore()
    if (u && !inUpg && !hud.panelOpen) openUpgrades()
    inStore = s
    inUpg = u
  }
  let lastTick = 0

  // --- Network: heist messages ---------------------------------------------------------------------------
  onNet('heistStart', (m) => {
    if (H.mode !== 'lobby') return
    lobbyPad = -1
    beginHeist({ heistId: m.heistId, seed: m.seed, difficulty: m.difficulty, target: m.target, host: m.host, crew: m.crew, solo: false })
  })
  onNet('hostChanged', (m) => {
    if (H.mode !== 'heist' || m.heistId !== H.heistId) return
    H.host = m.host
    const mine = m.host === myId()
    if (mine && !H.authority) {
      H.authority = true
      props.setAuthority(true)
      setMoversAuthority(true)
      brain.takeOver(H.difficulty, H.puppet.x, H.puppet.z, H.puppet.yaw)
      hud.toast('You are now running the heist', '#7cc4ff')
    }
  })
  onNet('leaderboard', (m) => {
    const rows = m?.boards?.escapes ?? []
    lobby.drawBoard(rows.map((r) => ({ name: r.name, value: r.value })), 'TOP ESCAPES')
  })
  // Host snapshot (crew side).
  onNet('hs', (m) => {
    if (H.mode !== 'heist' || H.authority) return
    if (m.g) {
      const [x, z, yaw, pose, speed, st, tgt] = m.g
      Object.assign(H.puppet, { tx: x, tz: z, tyaw: yaw, pose, speed, state: st, target: tgt })
    }
    if (m.a) H.puppet.meters = m.a
    if (m.p) props.applySnapshot(m.p)
    if (m.m) {
      // eased toward every tick (easeMovers): snapping to each 12/s snapshot made doors step visibly
      for (const [i, x, y, z, qx, qy, qz, qw] of m.m) {
        const mv = house.movers[i]
        if (!mv?.body) continue
        mv.netPose = [x, y, z, qx, qy, qz, qw]
      }
    }
    if (m.j) jobs.unpack(m.j)
    // the fire grid + which loot is burning
    if (m.x) fire.unpack(m.x)
    if (m.lf) for (const p of props.props) if (p.state === 'home') fire.setLootFire(p, m.lf.includes(p.netId))
    if (m.n) {
      // led by a typical one-way delay (the clients' server-clock estimates are too rough to time it)
      const [angle, spin, on] = m.n
      house.fan.sync(angle + spin * FAN.netLead, spin, on)
    }
    if (m.f) {
      if (m.f.s && !house.secret.open) house.secret.forceOpen()
      if (m.f.s && house.windows.study?.latched) house.windows.study.setLatched(false)
      if (m.f.s) house.nav.flags.secret = true
      H.heat = !!m.f.h
      // dark rooms (a missed event, joining late): rooms + switch nubs follow the host
      if (Number.isFinite(m.f.l) && m.f.l !== darkMask()) {
        applyDarkMask(m.f.l)
        for (const ls of house.lightSwitches) ls.setOn(!isRoomDark(ls.room))
      }
    }
  })
  // Host events (crew side).
  onNet('hb', (m) => {
    if (H.mode !== 'heist' || H.authority || !m) return
    const v3 = (a) => new Vector3(a[0], a[1], a[2])
    switch (m.t) {
      case 'say':
        grandpa.say(m.x, m.c, String(m.x).length <= 3 ? 96 : 56)
        setTimeout(() => grandpa.say(''), 2400)
        break
      case 'v':
        sound(m.n, brain.pos)
        break
      case 'imp':
        sound('impact', v3(m.p), { mat: m.m, strength: m.s })
        if (m.q) sound('squeak', v3(m.p), { strength: m.s })
        break
      case 'stolen': {
        const p = props.byNet(m.id)
        if (p && p.state === 'home') props.steal(p)
        break
      }
      case 'broken': {
        const p = props.byNet(m.id)
        if (p && p.state === 'home') props.shatter(p)
        break
      }
      case 'burnt': {
        const p = props.byNet(m.id)
        if (p && p.state === 'home') props.burn(p)
        break
      }
      case 'fireMsg':
        if (FIRE_MSG[m.k]) hud.toast(FIRE_MSG[m.k][0], FIRE_MSG[m.k][1])
        break
      case 'ev':
        houseEvent(m.k, v3(m.p), m.s, m.d ?? {})
        if (m.k === 'secret') house.secret.forceOpen()
        if (m.k === 'tv') house.tv.hit(1, { event: () => {} })
        break
      case 'gadget':
        if (m.from !== myId()) gadgets.use(m.g, { origin: { x: m.o[0], y: m.o[1], z: m.o[2] }, dir: v3(m.d), chest: v3(m.c), authority: false })
        break
      case 'spot':
        if (m.sid === myId()) localSpotted()
        break
      case 'lost':
        if (m.sid === myId()) {
          sound('lost')
          music.stinger('lost')
        }
        break
      case 'caught':
        if (m.sid === myId()) localHeld()
        break
      case 'caged':
        if (m.sid === myId()) localCaged()
        sound('cageClose', house.cage.center)
        break
      case 'dropped':
        if (m.sid === myId() && H.status === 'held') localFree('wriggle')
        break
      default:
        break
    }
  })
  // Crew actions (host side).
  onNet('ha', (m) => {
    if (H.mode !== 'heist' || !H.authority || !m) return
    const from = m.from
    const v3 = (a) => new Vector3(a[0], a[1], a[2])
    switch (m.t) {
      case 'grab': {
        const p = props.byNet(m.id)
        if (!p?.body) break
        p.heldBy = from
        H.remoteHolds.set(m.id, from)
        props.setLocalMode(p, 'kinematic')
        break
      }
      case 'hold': {
        const p = props.byNet(m.id)
        if (!p?.body || p.heldBy !== from) break
        p.body.setNextKinematicTranslation({ x: m.p[0], y: m.p[1], z: m.p[2] })
        p.body.setNextKinematicRotation({ x: m.q[0], y: m.q[1], z: m.q[2], w: m.q[3] })
        p.dirty = true
        break
      }
      case 'drop': {
        const p = props.byNet(m.id)
        if (!p?.body) break
        p.heldBy = null
        p.thrownBy = from
        H.remoteHolds.delete(m.id)
        props.setLocalMode(p, 'dynamic')
        p.body.setTranslation({ x: m.p[0], y: m.p[1], z: m.p[2] }, true)
        p.body.setRotation({ x: m.q[0], y: m.q[1], z: m.q[2], w: m.q[3] }, true)
        p.body.setLinvel({ x: m.v[0], y: m.v[1], z: m.v[2] }, true)
        p.body.setAngvel({ x: m.w[0], y: m.w[1], z: m.w[2] }, true)
        break
      }
      case 'pull': {
        const mv = house.movers[m.m]
        if (!mv?.body) break
        H.remotePulls.set(`${from}:${m.m}`, { body: mv.body, anchor: v3(m.a), target: v3(m.g), until: performance.now() + 350, mover: mv })
        if (mv.kind === 'garage') tutorialEvent('lifted')
        break
      }
      case 'unpull':
        H.remotePulls.delete(`${from}:${m.m}`)
        break
      case 'switch': {
        const sw = house.switches.find((s) => s.id === m.id)
        sw?.onUse(ctxHouse)
        break
      }
      case 'toasted':
        jobs.onEvent('toaster')
        break
      case 'ride':
        jobs.onEvent('fanRide')
        break
      case 'gadget':
        gadgets.use(m.g, { origin: { x: m.o[0], y: m.o[1], z: m.o[2] }, dir: v3(m.d), chest: v3(m.c), authority: true })
        sendNet('hb', { ...m })
        break
      case 'noise':
        brain.hear(v3(m.p), Math.min(120, m.r))
        break
      case 'free':
        if (brain.carrying?.id === from) brain.releaseCarried()
        break
      case 'freed':
        H.caged.delete(from)
        jobs.onEvent('rescue')
        break
      case 'unlockCage':
        house.cage.unlock()
        break
      default:
        break
    }
  })
  // Host: apply crewmates' door/window pulls every tick.
  onTick((dt) => {
    if (!H.authority || H.mode !== 'heist' || !H.remotePulls.size) return
    const now = performance.now()
    for (const [k, pl] of H.remotePulls) {
      if (now > pl.until) {
        H.remotePulls.delete(k)
        continue
      }
      pullBody(pl.body, pl.anchor, pl.target, 30, dt)
    }
  })
  // Crew: doors / windows / the garage door ease toward the host's last pose every tick (a big jump,
  // a reset or a late join, snaps). Normalised lerp on the shorter arc of the quaternion.
  onTick(function easeMovers(dt) {
    if (H.authority || H.mode !== 'heist') return
    const k = 1 - Math.exp(-dt * 14)
    for (const mv of house.movers) {
      const np = mv.netPose
      if (!np || !mv.body || mv.body.bodyType() !== RAPIER.RigidBodyType.KinematicPositionBased) continue
      const t = mv.body.translation()
      const r = mv.body.rotation()
      const snap = Math.hypot(np[0] - t.x, np[1] - t.y, np[2] - t.z) > 4
      const f = snap ? 1 : k
      const s = r.x * np[3] + r.y * np[4] + r.z * np[5] + r.w * np[6] < 0 ? -1 : 1
      const qx = r.x + (s * np[3] - r.x) * f
      const qy = r.y + (s * np[4] - r.y) * f
      const qz = r.z + (s * np[5] - r.z) * f
      const qw = r.w + (s * np[6] - r.w) * f
      const ql = Math.hypot(qx, qy, qz, qw) || 1
      mv.body.setNextKinematicTranslation({ x: t.x + (np[0] - t.x) * f, y: t.y + (np[1] - t.y) * f, z: t.z + (np[2] - t.z) * f })
      mv.body.setNextKinematicRotation({ x: qx / ql, y: qy / ql, z: qz / ql, w: qw / ql })
    }
  })
  function sendSnapshot(time) {
    const now = performance.now()
    if (now - H.lastSnap < 1000 / NET.snapshotHz) return
    H.lastSnap = now
    const full = now - H.lastFull > 2000
    if (full) H.lastFull = now
    const R = (n) => Math.round(n * 100) / 100
    const movers = []
    house.movers.forEach((mv, i) => {
      if (!mv.body) return
      if (!full && mv.body.isSleeping()) return
      const t = mv.body.translation()
      const r = mv.body.rotation()
      movers.push([i, R(t.x), R(t.y), R(t.z), R(r.x), R(r.y), R(r.z), R(r.w)])
    })
    const meters = {}
    for (const [id, a] of brain.awareness) if (a.meter > 0.01) meters[id] = Math.round(a.meter * 100) / 100
    // the ceiling fan's blades (so a rider hangs on the same blade on every screen)
    const fan = house.fan
    const fanSnap = fan.spin > 0 || fan.on || full ? [Math.round(fan.angle * 1000) / 1000, Math.round(fan.spin * 1000) / 1000, fan.on ? 1 : 0] : undefined
    // the fire grid (~4/s while anything burns, and once more after it all went out) + burning loot
    const burningLoot = props.props.filter((p) => p.fire && p.state === 'home').map((p) => p.netId)
    let fireSnap
    if (full || ((fire.count() || H.fireWas) && now - (H.fireSent ?? 0) > 240)) {
      fireSnap = fire.pack()
      H.fireSent = now
      H.fireWas = fire.count()
    }
    sendNet('hs', {
      x: fireSnap,
      lf: burningLoot.length || full || H.lootFireWas ? burningLoot : undefined,
      n: fanSnap,
      g: [...brain.snapshot(), brain.targetId()],
      a: meters,
      p: props.snapshot(full),
      m: movers,
      j: jobs.pack(),
      f: { s: house.secret.open ? 1 : 0, h: H.heat ? 1 : 0, l: darkMask() },
    })
    H.lootFireWas = burningLoot.length
    void time
  }

  // --- Footsteps, landings, Grandpa's steps -------------------------------------------------------------
  const floorAt = (p) => {
    if (H.mode !== 'heist') return 'wood'
    const room = house.roomAt(p.x, p.z)
    if (room) return FLOOR_SOUND[ROOMS.find((r) => r.id === room).floor] ?? 'wood'
    if (p.x > -52 && p.x < -20 && p.z > 42) return 'stone'
    if (p.y > 0.5) return 'wood'
    return 'grass'
  }
  const softK = () => 1 - (state.data.upgrades.soft ?? 0) * 0.12
  onStep((s) => {
    if (H.mode !== 'heist' && H.mode !== 'lobby') return
    sound('step', s, { mat: floorAt(s), vol: s.crouch ? 0.35 : s.sprint ? 1 : 0.7 })
    if (s.sprint) fx.puff(new Vector3(s.x, s.y + 0.1, s.z), { count: 2, color: '#e0d6c4', size: [0.4, 1.2], life: 0.6, speed: 1, up: 0.3, spread: 0.2, alpha: 0.45 })
    if (H.mode === 'heist' && house.insideFootprint(s.x, s.z)) noise(s, (s.crouch ? 0 : s.sprint ? NOISE.stepSprint : NOISE.stepWalk) * softK())
  })
  onLand((s) => {
    sound('land', s, { strength: Math.min(1, s.speed / 16) })
    fx.puff(new Vector3(s.x, s.y + 0.1, s.z), { count: 6, color: '#e0d6c4', size: [0.5, 1.6], life: 0.7, speed: 2.5, up: 0.4, spread: 0.3, alpha: 0.5 })
    if (H.mode === 'heist' && house.insideFootprint(s.x, s.z)) noise(s, NOISE.land * Math.min(1, s.speed / 14) * softK())
  })
  onJump((p) => sound('jump', p))
  grandpa.onStep = (side, strength) => {
    if (H.mode !== 'heist') return
    const foot = new Vector3(brain.pos.x + Math.cos(brain.yaw) * (side === 'L' ? -0.9 : 0.9), 0.3, brain.pos.z - Math.sin(brain.yaw) * (side === 'L' ? -0.9 : 0.9))
    sound('gpStep', foot, { strength })
    shakeFrom(foot, strength * 0.35, 40)
    if (strength > 0.6) fx.puff(foot, { count: 3, color: '#d9cbb5', size: [1, 2.5], life: 0.8, speed: 2, up: 0.3, spread: 0.6, alpha: 0.4 })
  }
  function shakeFrom(p, k, range) {
    const d = Math.hypot(p.x - player.position.x, p.z - player.position.z)
    if (d < range) fx.shake(k * (1 - d / range))
  }

  // --- Thieves Grandpa can see (authority) ---------------------------------------------------------------
  const localThief = { id: 'me', pos: new Vector3(), height: 1.8, crouch: false, moving: false, sprint: false, hidden: false, stealth: 1, caught: false, out: false, held: false, visible: true }
  const remoteThieves = new Map()
  const hiddenAt = (x, y, z, crouch) => crouch && house.hideSpots.some((h) => x > h.x0 && x < h.x1 && z > h.z0 && z < h.z1 && y < h.y1)
  function thieves() {
    const list = []
    const p = player.position
    localThief.id = myId()
    localThief.pos.set(p.x, p.y, p.z)
    localThief.height = player.dims.height
    localThief.crouch = player.crouching
    localThief.moving = Math.hypot(player.velocity.x, player.velocity.z) > 0.6
    localThief.sprint = player.sprinting
    localThief.hidden = hiddenAt(p.x, p.y, p.z, player.crouching)
    localThief.stealth = 1 - (state.data.upgrades.ninja ?? 0) * 0.08
    localThief.held = H.status === 'held'
    localThief.caught = H.status === 'caged'
    localThief.out = H.status === 'out' || H.status === 'escaped' || !house.insideFootprint(p.x, p.z, 0.3)
    localThief.visible = H.safeT <= 0
    list.push(localThief)
    if (isOnline()) {
      net.players?.forEach((rp, id) => {
        if (id === net.sessionId || rp.zone !== `h${H.heistId}`) return
        let t = remoteThieves.get(id)
        if (!t) remoteThieves.set(id, (t = { id, pos: new Vector3(), height: 1.8, stealth: 1, visible: true }))
        t.pos.set(rp.x, rp.y, rp.z)
        t.crouch = rp.crouch
        t.height = rp.crouch ? 1.05 : 1.8
        t.moving = rp.speed > 0.6
        t.sprint = rp.speed > 10
        t.hidden = hiddenAt(rp.x, rp.y, rp.z, rp.crouch)
        t.held = rp.held || H.caughtSids.has(id)
        t.caught = H.caged.has(id) && house.cage.inside(t.pos)
        if (H.caged.has(id) && !house.cage.inside(t.pos)) H.caged.delete(id)
        t.out = rp.out || !house.insideFootprint(rp.x, rp.z, 0.3)
        list.push(t)
      })
    }
    return list
  }

  // --- Per-frame heist update ------------------------------------------------------------------------------
  const tmp = new Vector3()
  const proj = new Vector3()
  let musicMood = ''
  function setMood(m) {
    if (m === musicMood) return
    musicMood = m
    music.setMood(m)
  }
  function updateHeist(dt, time) {
    // hotbar keys
    if (inputState.slot >= 0) {
      useSlot(inputState.slot)
      inputState.slot = -1
    }
    // boosts
    H.boosts.xray = Math.max(0, H.boosts.xray - dt)
    H.boosts.energy = Math.max(0, H.boosts.energy - dt)
    grandpa.setXray(H.boosts.xray > 0)
    if (H.boosts.xray > 0) grandpa.setCone(GRANDPA.sightRange * DIFFICULTY[H.difficulty].sight)
    player.mods.endless = H.boosts.energy > 0
    player.mods.speed = (1 + (state.data.upgrades.feet ?? 0) * 0.04) * (H.boosts.energy > 0 ? GADGET_FX.energySpeed : 1)
    player.mods.staminaMax = STAMINA.max * (1 + (state.data.upgrades.lungs ?? 0) * 0.2)
    H.safeT = Math.max(0, H.safeT - dt)

    // Grandpa: brain (authority) or puppet (crew)
    if (H.authority) {
      brain.update(dt, thieves(), time)
      updateRelight()
      jobs.update(dt)
      if (isOnline()) sendSnapshot(time)
    } else {
      const pp = H.puppet
      const k = 1 - Math.exp(-10 * dt)
      pp.x += (pp.tx - pp.x) * k
      pp.z += (pp.tz - pp.z) * k
      pp.yaw += wrap(pp.tyaw - pp.yaw) * k
      brain.puppet(pp.x, pp.z, pp.yaw)
      grandpa.root.position.set(pp.x, 0, pp.z)
      grandpa.root.rotation.y = pp.yaw
      grandpa.setPose(pp.pose)
      grandpa.animate(dt, pp.speed, time)
      // the local held thief's hold (send the held loot's pose to the host)
      const held = grab.holding
      if (held?.kind === 'loot' && held.body && performance.now() - H.lastHold > 1000 / NET.holdHz) {
        H.lastHold = performance.now()
        const t = held.body.translation()
        const r = held.body.rotation()
        sendNet('ha', { t: 'hold', id: held.netId, p: [t.x, t.y, t.z], q: [r.x, r.y, r.z, r.w] })
      }
    }
    H.puppet.x = H.authority ? brain.pos.x : H.puppet.x
    H.puppet.z = H.authority ? brain.pos.z : H.puppet.z
    H.puppet.yaw = H.authority ? brain.yaw : H.puppet.yaw

    const gpPos = H.authority ? brain.pos : tmp.set(H.puppet.x, 0, H.puppet.z)
    gadgets.update(dt, H.authority ? { pos: brain.pos, moving: brain.speed > 0.8, down: brain.isDown() } : null, H.authority)
    props.update(dt)
    // fire: the grid + burning loot (authority) and its visuals, the flames' heat, Grandpa's bucket
    const fr = fire.update(dt, { authority: H.authority, camera, props: props.props, active: true })
    if (fr.inferno) {
      hud.banner('<em>THE WHOLE HOUSE IS ON FIRE!</em>', 3, 'danger')
      fx.shake(0.4)
    }
    updateHeat(dt)
    fire.setBucket((H.authority ? brain.state : H.puppet.state) === 'fire' ? grandpa.handWorld : null)
    vaultHintCheck(dt)
    // pickups bob
    for (const o of pickups) if (!o.taken) o.mesh.rotation.y += dt * 1.5
    updateRides()

    // local status
    if (H.status === 'held') {
      if (inputState.struggle > 0) {
        H.struggle += inputState.struggle
        for (let i = 0; i < Math.min(3, inputState.struggle); i++) sound('struggle')
        inputState.struggle = 0
        fx.shake(0.15)
        if (H.struggle >= GRANDPA.struggleToEscape) {
          H.struggle = 0
          if (H.authority) brain.releaseCarried()
          else sendNet('ha', { t: 'free' })
        }
      }
      H.struggle = Math.max(0, H.struggle - dt * 1.6) // slowly slips back
    } else inputState.struggle = 0
    if (H.status === 'caged') {
      H.cageT -= dt
      if (!house.cage.inside(player.position) && player.position.y < 9) {
        H.status = 'active'
        H.safeT = 2
        if (H.authority) jobs.onEvent('rescue')
        else sendNet('ha', { t: 'freed' })
        localFree('friend')
      } else if (H.cageT <= 0) localOut()
    }
    // escape
    const money = crewMoney()
    van.setMoney(money, H.target)
    if (H.status === 'active' && van.ready && van.near(player.position)) finish(true)
    // solo: caught for good
    if (H.solo && H.status === 'out') finish(false)

    // tutorial
    if (H.tutorial >= 0) {
      const id = TUT[H.tutorial].id
      const g = house.movers.find((m) => m.kind === 'garage')
      if (id === 'walk' && g && Math.hypot(player.position.x - g.mesh.position.x, player.position.z - g.mesh.position.z) < 16) tutorialEvent('nearGarage')
      if (id === 'lift' && g && g.amount() > 0.35) tutorialEvent('lifted')
      if (id === 'done') {
        tutDoneT -= dt
        if (tutDoneT <= 0) skipTutorial()
      }
    }

    // --- HUD ---
    const here = house.roomAt(player.position.x, player.position.z)
    hud.setRooms(props.roomStats(), here)
    hud.setJobs(jobs.view())
    hud.setMoney(money, H.target)
    hud.setStamina(player.stamina / player.mods.staminaMax, player.mods.endless)
    hud.setHotbar(GADGETS.map((g) => ({ id: g.id, count: state.data.gadgets[g.id] ?? 0, thumb: safeThumb('gadget', g.id), timer: g.id === 'xray' ? H.boosts.xray : g.id === 'energy' ? H.boosts.energy : 0, active: (g.id === 'xray' && H.boosts.xray > 0) || (g.id === 'energy' && H.boosts.energy > 0) })))
    const hv = grab.hover
    hud.setHover(hv && H.status === 'active' ? { name: hv.owner.name ?? 'Thing', value: hv.owner.kind === 'loot' ? hv.owner.value : 0, action: hv.owner.action ?? (hv.owner.kind === 'switch' ? 'Use' : hv.owner.kind === 'pickup' ? 'Pick up' : 'Grab'), far: hv.far } : null)
    hud.setHolding(!!grab.holding)
    const myMeter = H.authority ? brain.awareness.get(myId())?.meter ?? 0 : H.puppet.meters?.[myId()] ?? 0
    const gpState = H.authority ? brain.state : H.puppet.state
    const targetMe = (H.authority ? brain.targetId() : H.puppet.target) === myId()
    const chasingMe = targetMe && (gpState === 'chase' || gpState === 'alert' || gpState === 'grab')
    hud.setAwareness(chasingMe ? 1 : myMeter, chasingMe || myMeter >= 1 ? 'alert' : myMeter > GRANDPA.suspicious ? 'sus' : 'calm')
    const hidden = hiddenAt(player.position.x, player.position.y, player.position.z, player.crouching)
    hud.setHidden(hidden || crouchLocked(), hidden ? 'HIDDEN' : 'CRAWL OUT TO STAND')
    hud.setBoosts([
      ...(fire.count() > 0 ? [{ id: `fire${fire.count()}${fire.inferno ? '!' : ''}`, label: fire.inferno ? 'THE HOUSE IS ON FIRE!' : `FIRE: ${fire.count()} spot${fire.count() > 1 ? 's' : ''} burning`, time: null, color: '#ff6a2a' }] : []),
      ...(H.boosts.xray > 0 ? [{ id: 'xray', label: 'X-RAY', time: H.boosts.xray, color: '#4dff8a' }] : []),
      ...(H.boosts.energy > 0 ? [{ id: 'energy', label: 'ENERGY', time: H.boosts.energy, color: '#a8ff3e' }] : []),
      ...(H.heat ? [{ id: 'heat', label: 'HEAT: Grandpa is slow', time: null, color: '#ffb36b' }] : []),
      ...(darknessAt(player.position) > 0.5 ? [{ id: 'dark', label: 'DARK: hard to spot', time: null, color: '#8fa8ff' }] : []),
    ])
    // edge arrow toward Grandpa when he's onto me (or with x-ray)
    if ((chasingMe || myMeter > GRANDPA.suspicious || H.boosts.xray > 0) && H.status === 'active') {
      proj.set(gpPos.x, GRANDPA.height * 0.6, gpPos.z).project(camera)
      const onScreen = proj.z < 1 && Math.abs(proj.x) < 0.9 && Math.abs(proj.y) < 0.9
      if (onScreen) hud.setArrow(null)
      else {
        const ang = wrap(Math.atan2(gpPos.x - player.position.x, gpPos.z - player.position.z) - (getYaw() + Math.PI))
        hud.setArrow(-ang, chasingMe ? '#ff4a4a' : H.boosts.xray > 0 && myMeter < 0.3 ? '#4dff8a' : '#ffd23f')
      }
    } else hud.setArrow(null)
    // caught panels
    const friends = activeCrewIds().length > 0
    if (H.status === 'held') hud.setCaught({ kind: 'held', progress: H.struggle / GRANDPA.struggleToEscape, canPay: state.data.coins >= PRICES.breakFree, friends })
    else if (H.status === 'caged') hud.setCaught({ kind: 'cage', seconds: Math.max(0, H.cageT), canPay: state.data.coins >= PRICES.breakFree, friends })
    else if (H.status === 'out') hud.setCaught({ kind: 'out', canRevive: state.data.coins >= PRICES.revive, friends })
    else hud.setCaught(null)

    // music + ambience
    if (H.status === 'held') setMood('held')
    else if (chasingMe) setMood('chase')
    else if (myMeter > GRANDPA.suspicious || gpState === 'investigate' || gpState === 'search') setMood('suspicious')
    else setMood('sneak')
    const dGp = Math.hypot(gpPos.x - player.position.x, gpPos.z - player.position.z)
    sfxEnv.zone = house.insideFootprint(player.position.x, player.position.z) ? 'house' : 'yard'
    sfxEnv.room = here
    sfxEnv.danger = chasingMe ? 1 : Math.max(myMeter, H.status === 'held' ? 1 : 0, dGp < 30 ? (1 - dGp / 30) * 0.45 : 0)
    sfxEnv.indoorMix = sfxEnv.zone === 'house' ? 1 : 0
  }
  const sfxEnv = { zone: 'lobby', room: null, danger: 0, indoorMix: 1 }
  let warmThumbs = 0
  let warmingThumb = false

  // --- Public API (main.js) ------------------------------------------------------------------------------
  hud.setMode('lobby')
  music.setMood('lobby')
  applyPrefs()
  // dark rooms: patch the materials there are now (before the first render), then sweep for new ones
  patchDarkness(scene)
  let darkSweep = 0
  const darkSee = new Vector3()
  return {
    hud,
    fx,
    state,
    // save API for net.js
    snapshot: () => state.snapshot(),
    hydrate: (doc) => {
      state.hydrate(doc)
      hud.setCoins(state.data.coins)
    },
    onSave: (fn) => state.onSave(fn),
    toast: (t, c) => hud.toast(t, c),
    get panelOpen() {
      return hud.panelOpen
    },
    get zone() {
      return H.mode === 'heist' || H.mode === 'results' ? `h${H.heistId}` : 'lobby'
    },
    get inHeist() {
      return H.mode === 'heist'
    },
    setDensity: (k) => fx.setDensity(k),
    canRespawn: () => H.mode === 'lobby',
    // The portal's death screen / pause-menu Respawn: out of the heist and back to the hideout.
    portalRespawn() {
      if (H.mode === 'results' || H.status === 'out') requestLobby()
    },
    // What the others draw of this player.
    bodyState() {
      const g = grab.netPoint()
      return {
        crouch: player.crouching,
        grab: !!g,
        gx: g ? Math.round(g.x * 100) / 100 : 0,
        gy: g ? Math.round(g.y * 100) / 100 : 0,
        gz: g ? Math.round(g.z * 100) / 100 : 0,
        held: H.status === 'held',
        out: H.status === 'out' || H.mode === 'results',
      }
    },
    // After the animator: arms out when grabbing, the crouch, dangling when held.
    animate(animator, avatar, emoting, time) {
      if (emoting) return
      applyBodyPose(animator?.rig, avatar, { grab: !!grab.holding, crouch: player.crouching, held: H.status === 'held', t: time })
    },
    // Per frame, after the camera.
    update(dt, time) {
      ctxHouse.time = time
      // warm the hotbar / store thumbnails one at a time, shaders compiled in the background first
      if (!warmingThumb && warmThumbs < GADGETS.length && time > 1.5) {
        warmingThumb = true
        warmThumbnail('gadget', GADGETS[warmThumbs++].id, 128)
          .catch(() => {})
          .finally(() => (warmingThumb = false))
      }
      grab.update(dt, time)
      if (H.mode === 'lobby') {
        updateLobby(dt)
        if (time > 3) prewarmStep()
        sfxEnv.zone = 'lobby'
        sfxEnv.room = null
        sfxEnv.danger = 0
        sfxEnv.indoorMix = 1
        setMood('lobby')
        if (inputState.slot >= 0) {
          inputState.slot = -1
          openStore()
        }
      } else if (H.mode === 'heist') {
        updateHeist(dt, time)
      } else {
        props.update(dt)
      }
      ctxHouse.grandpa = H.mode === 'heist' ? (H.authority ? brain.pos : { x: H.puppet.x, z: H.puppet.z }) : null
      ctxHouse.authority = H.mode !== 'heist' || H.authority
      house.update(dt, ctxHouse)
      darkSweep -= dt
      if (darkSweep <= 0) {
        darkSweep = 2
        patchDarkness(scene)
      }
      const pr = player.renderPosition
      updateDarkness(dt, H.mode === 'heist' ? darkSee.set(pr.x, pr.y + 1.2, pr.z) : null)
      van.update(dt)
      fx.update(dt)
      updateLights()
      cullRooms()
      sfx.frame(dt, camera, sfxEnv)
      music.frame(dt)
    },
    // Dev helpers.
    debug: {
      roomCull,
      fire,
      start: (difficulty = 'normal', tutorial = false) => {
        if (!tutorial) state.data.tutorialDone = true
        beginHeist({ seed: (Math.random() * 2 ** 32) >>> 0, difficulty, target: DIFFICULTY[difficulty].target, host: 'me', crew: ['me'], solo: true })
      },
      money: (n) => addMoney(n),
      coins: (n) => state.earn(n),
      H,
      ctx: ctxHouse,
      brain,
      house,
      props,
      grab,
      jobs,
      gadgets,
      grandpa,
      lobby,
      van,
    },
  }
}
void UPGRADES
void HOUSE
void rng
