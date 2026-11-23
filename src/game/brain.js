// Grandpa's brain: routines (activities around the house), senses (a vision cone with line of sight
// and a detection meter per thief; hearing noise events, muffled through walls), and reactions
// (investigate, suspicious, chase, search, stare at a hiding spot, grab, carry to the cage, slip on
// marbles / a banana, stuck in glue, asleep from a potion, knocked down by a foam rocket, distracted by
// an alarm clock / the toilet / the thermostat / a broken TV / the open secret door).
//
// Runs only on the authority (solo player or the crew's host). He moves as a kinematic capsule along
// paths on the house's nav graph (house.nav), taking straight lines when the way is clear.
import { Vector3 } from 'three'
import { DIFFICULTY, FIRE, GRANDPA, NOISE } from '../config.js'
import { GRANDPA_GROUPS, RAPIER, castRay, onTick, segmentClear, world } from '../physics.js'

const LINES = {
  idle: ['Hmm hm hmm~', 'Where are my glasses...', 'Back in my day...', 'Time for a cuppa.', 'Lovely evening.', 'Hm? ... nah.'],
  suspicious: ['Hm? Who\'s there?', 'What was that?', 'Hmmm...?'],
  spotted: ['HEY! You little rascal!', 'THIEVES!', 'Get out of my house!'],
  chase: ['Come back here!', 'Rascals!', 'I\'ll get you!', 'Stop right there!'],
  search: ['Where did you go...?', 'I know you\'re here...', 'Come out, come out...'],
  giveup: ['Bah! Rascals...', 'Kids these days.', 'Hmph.'],
  hide: ['I know you\'re under there!', 'Come out of there!'],
  noise: ['What was that noise?', 'Who\'s making that racket?', 'Hm? A noise?'],
  caught: ['GOTCHA!', 'Got you now!', 'Off to the cage with you!'],
  slip: ['WHOAAA!', 'MARBLES?!', 'My back!'],
  stuck: ['Ugh! Sticky!', 'I\'m stuck!', 'GLUE?!'],
  ouch: ['OUCH!', 'Oof!', 'Hey!'],
  alarm: ['Who set that clock?!', 'Quiet, you!'],
  flush: ['Who\'s in my bathroom?!'],
  tv: ['MY SHOWS!', 'My TV!'],
  heat: ['Phew, it\'s hot...', 'Who touched my thermostat?'],
  secret: ['My secret room!', 'Who found my study?!'],
  toast: ['Is my toast ready?', 'Who made toast?!', 'Ooh, toast!'],
  fan: ['Who turned the fan on?', 'Brrr! Who did that?', 'Wasting electricity...'],
  phoneRing: ['Coming, coming!', 'The phone!', 'Hold your horses!'],
  phoneChat: ['Hello? Mildred!', 'Yes... yes...', 'Oh, the grandkids? Fine!', 'My hip? Don\'t ask.', 'Uh-huh... uh-huh...', 'You won\'t BELIEVE my week!', 'Speak up, dear!', 'Bingo on Tuesday?'],
  lights: ['Who turned off my lights?', 'Can\'t see a thing!', 'Hey! The lights!'],
  rescued: ['Hey! Come back!'],
  fire: ['FIRE!! FIRE!!', 'Is something BURNING?!', 'My house is on fire!'],
  fireReach: ['I can\'t reach it!', 'It\'s too high up!', 'I can\'t get in there!'],
  fireFlee: ['It\'s too big! RUN!', 'Everybody OUT!', 'Call the fire brigade!'],
  fireWatch: ['My house...!', 'Oh, my poor house!', 'All my things!', 'Somebody DO something!'],
  fireOut: ['Phew... it\'s out.', 'Got it! Hmph.', 'That was close!', 'Who lit that?!'],
  fireBack: ['Is it out...?', 'Right. Who did this?!'],
}
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a))

export function createBrain({ grandpa, house, hooks }) {
  // Kinematic capsule (pushes doors, loot and the player aside).
  const R = GRANDPA.radius
  const halfH = GRANDPA.height / 2 - R
  const body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, GRANDPA.height / 2, 0))
  const collider = world.createCollider(RAPIER.ColliderDesc.capsule(halfH, R).setFriction(0.2).setCollisionGroups(GRANDPA_GROUPS), body)

  const pos = new Vector3(-40, 0, -22)
  const prevPos = new Vector3().copy(pos)
  let yaw = 0
  let speed = 0 // current m/s
  let wantSpeed = 0
  let path = [] // [{x,z}]
  let goal = null
  let state = 'patrol'
  let stateT = 0
  let sub = null // state data
  let activity = null
  let lastActivity = ''
  let diff = DIFFICULTY.normal
  let heat = false
  let sayT = 0
  let chatT = 8
  let enabled = false
  const awareness = new Map() // thiefId -> { meter, seen, lastSeen: Vector3, sinceSeen }
  let target = null // thief being chased / carried
  let carrying = null
  let sightMult = 1

  const B = {
    get pos() {
      return pos
    },
    get yaw() {
      return yaw
    },
    get state() {
      return state
    },
    get speed() {
      return speed
    },
    get target() {
      return target
    },
    get carrying() {
      return carrying
    },
    get heat() {
      return heat
    },
    collider,
    body,
    awareness,
  }

  // --- Speech --------------------------------------------------------------------------------------
  function say(kind, color = '#ffffff', hold = 2.6) {
    const text = typeof kind === 'string' && LINES[kind] ? pick(LINES[kind]) : kind
    grandpa.say(text, color, text.length <= 3 ? 96 : 56)
    sayT = hold
    hooks.say?.(text, color)
  }
  function voice(name) {
    hooks.voice?.(name, pos)
  }

  // --- Movement --------------------------------------------------------------------------------------
  const clearLine = (ax, az, bx, bz) => {
    const dx = bx - ax
    const dz = bz - az
    const len = Math.hypot(dx, dz)
    if (len < 0.5) return true
    const nx = -dz / len
    const nz = dx / len
    for (const off of [0, R * 0.85, -R * 0.85]) {
      const ox = ax + nx * off
      const oz = az + nz * off
      if (segmentClear(ox, 1.6, oz, ox + dx, 1.6, oz + dz) < 0.999) return false
    }
    return true
  }
  function nearestVisibleNode(x, z) {
    const nav = house.nav
    const cands = nav.nodes
      .filter((n) => (nav.flags.secret || !(n.id === 'dS' || n.id[0] === 's')) && (nav.flags.outside || !n.out))
      .map((n) => ({ n, d: (n.x - x) ** 2 + (n.z - z) ** 2 }))
      .sort((a, b) => a.d - b.d)
    for (let i = 0; i < Math.min(6, cands.length); i++) if (clearLine(x, z, cands[i].n.x, cands[i].n.z)) return cands[i].n
    return cands[0]?.n ?? null
  }
  function goTo(x, z, spd) {
    goal = { x, z }
    wantSpeed = spd
    if (clearLine(pos.x, pos.z, x, z)) {
      path = [{ x, z }]
      return
    }
    const a = nearestVisibleNode(pos.x, pos.z)
    const b = nearestVisibleNode(x, z)
    const nodes = house.nav.path(a, b)
    path = nodes.map((n) => ({ x: n.x, z: n.z }))
    path.push({ x, z })
    // string pulling: drop leading nodes we can already skip
    while (path.length > 1 && clearLine(pos.x, pos.z, path[1].x, path[1].z)) path.shift()
  }
  const arrived = (d = 1.4) => !path.length || (path.length === 1 && Math.hypot(path[0].x - pos.x, path[0].z - pos.z) < d)
  function stop() {
    path = []
    wantSpeed = 0
  }
  const speedOf = (base) => base * diff.speed * (heat ? 0.85 : 1)

  // Physics tick: move along the path.
  onTick((dt) => {
    if (!enabled) return
    prevPos.copy(pos)
    if (path.length && wantSpeed > 0) {
      const p = path[0]
      const dx = p.x - pos.x
      const dz = p.z - pos.z
      const d = Math.hypot(dx, dz)
      if (d < (path.length > 1 ? 2.2 : 0.4)) {
        path.shift()
      } else {
        const want = Math.atan2(dx, dz)
        const diffA = wrap(want - yaw)
        yaw = wrap(yaw + Math.sign(diffA) * Math.min(Math.abs(diffA), GRANDPA.turnRate * dt * (state === 'chase' ? 1.6 : 1)))
        const align = Math.max(0, Math.cos(diffA))
        const target = wantSpeed * (0.25 + 0.75 * align) * Math.min(1, d / 1.2 + 0.4)
        speed += (target - speed) * Math.min(1, dt * 4)
        const step = Math.min(d, speed * dt)
        pos.x += Math.sin(yaw) * step
        pos.z += Math.cos(yaw) * step
      }
    } else speed += (0 - speed) * Math.min(1, dt * 6)
    body.setNextKinematicTranslation({ x: pos.x, y: GRANDPA.height / 2, z: pos.z })
  })

  function faceToward(x, z, dt, rate = GRANDPA.turnRate) {
    const want = Math.atan2(x - pos.x, z - pos.z)
    const d = wrap(want - yaw)
    yaw = wrap(yaw + Math.sign(d) * Math.min(Math.abs(d), rate * dt))
    return Math.abs(d)
  }

  // --- States ---------------------------------------------------------------------------------------------
  function enter(next, data = null) {
    state = next
    stateT = 0
    sub = data
    hooks.state?.(next, data)
  }
  function choosePatrol() {
    const acts = house.activities.filter((a) => a.id !== lastActivity)
    const w = GRANDPA.activityWeights
    const options = [...acts.map((a) => ({ a, w: w[a.id] ?? 1 })), { a: null, w: w.wander ?? 2 }]
    let total = options.reduce((s, o) => s + o.w, 0)
    let r = Math.random() * total
    let chosen = options[0]
    for (const o of options) {
      r -= o.w
      if (r <= 0) {
        chosen = o
        break
      }
    }
    activity = chosen.a
    if (activity) {
      lastActivity = activity.id
      goTo(activity.approach[0], activity.approach[1], speedOf(GRANDPA.walkSpeed))
      enter('patrol', { leg: 'approach' })
    } else {
      const nodes = house.nav.nodes.filter((n) => n.id[0] !== 'd' && n.id[0] !== 's' && !n.out)
      const n = nodes[Math.floor(Math.random() * nodes.length)]
      lastActivity = 'wander'
      goTo(n.x + (Math.random() - 0.5) * 3, n.z + (Math.random() - 0.5) * 3, speedOf(GRANDPA.walkSpeed))
      enter('patrol', { leg: 'wander' })
    }
  }
  function startActivity() {
    const a = activity
    grandpa.setPose(a.pose)
    stop()
    enter('activity', { dur: a.dur[0] + Math.random() * (a.dur[1] - a.dur[0]) })
    if (a.id === 'nap') {
      say('Zzz', '#b9d3ff', 4)
      hooks.voice?.('gpYawn', pos)
    } else if (a.opens === 'fridge') hooks.openFridge?.()
  }

  // Investigate a point (a noise, a glimpse).
  function investigate(x, z, line = 'noise', hurry = true) {
    if (state === 'chase' || state === 'grab' || state === 'carry' || isDown()) return
    activity = null
    grandpa.setPose('idle')
    say(line, '#ffe08a')
    voice('gpHmm')
    goTo(x, z, speedOf(hurry ? GRANDPA.hurrySpeed : GRANDPA.walkSpeed))
    enter('investigate', { x, z })
  }
  const isDown = () => ['stunned', 'asleep', 'stuck', 'slip', 'getUp'].includes(state)

  function startChase(thief) {
    target = thief
    activity = null
    grandpa.setPose('alert')
    say('!', '#ff4a4a', 0.9)
    voice('gpShout')
    stop()
    enter('alert', { thief })
    hooks.spotted?.(thief)
  }

  // --- Perception ------------------------------------------------------------------------------------
  const eye = new Vector3()
  const tmp = new Vector3()
  function visibility(th) {
    if (!th.visible) return 0
    eye.set(pos.x, GRANDPA.eyeHeight + (grandpa.root.position.y || 0), pos.z)
    if (grandpa.pose === 'read' || grandpa.pose === 'sit') eye.y = 7.2
    const dx = th.pos.x - pos.x
    const dz = th.pos.z - pos.z
    const d = Math.hypot(dx, dz, th.pos.y - eye.y)
    const range = GRANDPA.sightRange * diff.sight
    if (d > range) return 0
    const headYaw = yaw + (grandpa.head ? grandpa.head.parent.rotation.y : 0)
    const ang = Math.abs(wrap(Math.atan2(dx, dz) - headYaw)) * (180 / Math.PI)
    if (ang > GRANDPA.peripheral) return 0
    // line of sight to the chest or the head (walls + furniture), and not through smoke
    let seen = false
    for (const hy of [th.height * 0.55, th.height * 0.95]) {
      tmp.set(th.pos.x, th.pos.y + hy, th.pos.z)
      if (segmentClear(eye.x, eye.y, eye.z, tmp.x, tmp.y, tmp.z) >= 0.999 && !hooks.smokeBlocks?.(eye, tmp)) {
        seen = true
        break
      }
    }
    if (!seen) return 0
    let v = Math.min(1, Math.max(0.12, 1.25 - d / range))
    if (ang > GRANDPA.fov) v *= 0.35
    if (th.crouch) v *= 0.5
    v *= th.moving ? (th.sprint ? 1.3 : 1) : 0.55
    if (th.hidden) v *= 0.12
    v *= hooks.lightAt?.(th.pos) ?? 1 // a room with its lights off: he can barely make you out
    v *= th.stealth ?? 1
    v *= sightMult
    return v
  }
  function perceive(dt, thieves) {
    sightMult = state === 'distract' && sub?.doing && sub.sight != null ? sub.sight : state === 'activity' && activity ? activity.sight : state === 'asleep' || state === 'slip' ? 0 : state === 'stuck' || state === 'stunned' ? 0.5 : state === 'fire' ? 0.55 : state === 'flee' ? 0.25 : 1
    let best = null
    let bestMeter = 0
    for (const th of thieves) {
      let a = awareness.get(th.id)
      if (!a) awareness.set(th.id, (a = { meter: 0, seen: false, lastSeen: new Vector3(), sinceSeen: 99 }))
      if (th.caught || th.out || th.held) {
        a.meter = 0
        a.seen = false
        continue
      }
      const v = visibility(th)
      a.seen = v > 0
      if (a.seen) {
        a.meter = Math.min(1, a.meter + v * GRANDPA.detectRate * dt)
        a.lastSeen.set(th.pos.x, th.pos.y, th.pos.z)
        a.sinceSeen = 0
      } else {
        a.sinceSeen += dt
        a.meter = Math.max(0, a.meter - GRANDPA.forgetRate * dt * (state === 'chase' && target?.id === th.id ? 0.3 : 1))
      }
      if (a.meter > bestMeter) {
        bestMeter = a.meter
        best = th
      }
    }
    return { best, bestMeter }
  }

  // --- Fire (hooks.fire = the fire grid, game/fire.js) -------------------------------------------------------
  // He notices a fire he can see (or the smoke alarm, from anywhere), fetches a bucket of water from the
  // nearest sink and throws it on the nearest burning spot he can reach, again and again. Whether he wins
  // depends on where it started: far from the sinks the fire outgrows his trips; behind the (closed)
  // secret door or high up he can't reach it at all; past FIRE.giveUp burning spots he runs outside.
  let fireLook = 0
  function fireCheck(dt) {
    const F = hooks.fire
    house.nav.flags.outside = state === 'flee' || !house.insideFootprint(pos.x, pos.z, -0.5)
    if (!F || state === 'fire' || state === 'flee') return
    const n = F.count()
    if (!n) return
    if (state === 'carry' || state === 'caging' || state === 'grab' || isDown()) return
    const alarm = n >= FIRE.alarmCells
    const napping = state === 'activity' && activity?.id === 'nap'
    if ((state === 'chase' || state === 'alert' || state === 'hideStare' || napping) && !alarm) return
    let noticed = alarm
    if (!noticed) {
      fireLook -= dt
      if (fireLook > 0) return
      fireLook = 0.3
      eye.set(pos.x, GRANDPA.eyeHeight, pos.z)
      noticed = F.canSee(eye, GRANDPA.sightRange * 1.3 * diff.sight)
    }
    if (noticed) startFireFight()
  }
  function startFireFight() {
    if (state === 'activity' && (activity?.pose === 'read' || activity?.pose === 'sit' || activity?.id === 'nap')) grandpa.setPose('getUp')
    target = null
    activity = null
    say('fire', '#ff8a5a', 2.4)
    voice('gpShout')
    hooks.fireState?.('notice')
    if (hooks.fire.count() >= FIRE.giveUp) return startFlee()
    goWater()
  }
  function goWater() {
    // the nearest sink by path length (the hallway detour counts)
    let best = null
    let bd = Infinity
    for (const w of FIRE.water) {
      goTo(w.x, w.z, 1)
      let d = 0
      let px = pos.x
      let pz = pos.z
      for (const p of path) {
        d += Math.hypot(p.x - px, p.z - pz)
        px = p.x
        pz = p.z
      }
      if (d < bd) {
        bd = d
        best = w
      }
    }
    grandpa.setPose('idle')
    goTo(best.x, best.z, speedOf(GRANDPA.hurrySpeed))
    enter('fire', { phase: 'toWater', water: best, t: 0 })
  }
  // Pick the nearest burning spot he can reach and head for it (false: none).
  function aimFire() {
    const c = hooks.fire.nearestReachable(pos.x, pos.z)
    if (!c) {
      if (sub.phase !== 'cant') {
        say('fireReach', '#ffb36b', 2.4)
        voice('gpGrumble')
        hooks.fireState?.('cant')
        stop()
      }
      sub.phase = 'cant'
      sub.t = 0
      return false
    }
    sub.cell = c
    sub.retarget = 1.2
    sub.thrown = false
    goTo(c.cx, c.cz, speedOf(GRANDPA.hurrySpeed))
    sub.phase = 'toFire'
    return true
  }
  function startFlee() {
    target = null
    activity = null
    house.nav.flags.outside = true
    say('fireFlee', '#ff6a4a', 2.6)
    voice('gpShout')
    grandpa.setPose('chase')
    goTo(FIRE.safeSpot.x, FIRE.safeSpot.z, speedOf(GRANDPA.chaseSpeed) * 0.8)
    enter('flee', { chat: 4 })
    hooks.fireState?.('flee')
  }
  function updateFire(dt) {
    const F = hooks.fire
    const n = F.count()
    if (!n) {
      say('fireOut', '#bfffc0', 2.4)
      voice('gpGrumble')
      grandpa.setPose('idle')
      hooks.fireState?.('out')
      choosePatrol()
      return
    }
    if (n >= FIRE.giveUp) return startFlee()
    sub.t += dt
    switch (sub.phase) {
      case 'toWater':
        grandpa.setPose('idle')
        if (arrived(1.6)) {
          stop()
          if (faceToward(sub.water.fx, sub.water.fz, dt, 5) < 0.3) {
            sub.phase = 'fill'
            sub.t = 0
            grandpa.setPose('wash')
            hooks.voice?.('gpHmm', pos)
          }
        }
        break
      case 'fill':
        if (sub.t > FIRE.bucket.fill) aimFire()
        break
      case 'toFire': {
        grandpa.setPose('carry')
        sub.retarget -= dt
        if (sub.retarget <= 0 || !(sub.cell.heat > 0)) {
          if (!aimFire()) break
        }
        const c = sub.cell
        const d = Math.hypot(c.cx - pos.x, c.cz - pos.z)
        const inReach = d < FIRE.bucket.reach + FIRE.cell * 0.5 && segmentClear(pos.x, 2.5, pos.z, c.cx, 2.5, c.cz) >= 0.999
        if (inReach || arrived(1.5)) {
          stop()
          sub.phase = 'throw'
          sub.t = 0
          sub.thrown = false
          grandpa.setPose('smash')
        }
        break
      }
      case 'throw': {
        const c = sub.cell
        faceToward(c.cx, c.cz, dt, 6)
        if (!sub.thrown && sub.t >= FIRE.bucket.throwAt) {
          sub.thrown = true
          // the splash lands a little in front of him, toward the fire
          const d = Math.hypot(c.cx - pos.x, c.cz - pos.z) || 1
          const k = Math.min(1, (FIRE.bucket.reach + 1) / d)
          hooks.splash?.(pos.x + (c.cx - pos.x) * k, pos.z + (c.cz - pos.z) * k)
        }
        if (sub.t >= FIRE.bucket.throwDur) goWater()
        break
      }
      case 'cant':
        grandpa.setPose(sub.t % 3 < 1.5 ? 'angry' : 'lookAround')
        if (sub.t > 2.5) {
          sub.t = 0
          aimFire()
        }
        break
    }
  }
  function updateFlee(dt) {
    const n = hooks.fire?.count() ?? 0
    if (arrived(2.5)) {
      stop()
      grandpa.setPose(stateT % 5 < 2.5 ? 'angry' : 'lookAround')
      faceToward(-38, -20, dt)
      sub.chat -= dt
      if (sub.chat <= 0) {
        sub.chat = 6 + Math.random() * 3
        say('fireWatch', '#ffb36b', 2.6)
        if (Math.random() < 0.5) voice('gpGrumble')
      }
    } else grandpa.setPose('chase')
    if (n === 0 && stateT > 3) {
      say('fireBack', '#ffe08a', 2.4)
      hooks.fireState?.('back')
      grandpa.setPose('idle')
      choosePatrol()
    } else if (n > 0 && n <= Math.floor(FIRE.giveUp * 0.4) && stateT > 8 && arrived(2.5)) {
      // the thieves knocked it down a lot: he dares to go back in and finish it
      hooks.fireState?.('retry')
      goWater()
    }
  }

  // --- Update (per frame) --------------------------------------------------------------------------------
  function update(dt, thieves, time) {
    if (!enabled) return
    stateT += dt
    if (sayT > 0) {
      sayT -= dt
      if (sayT <= 0) grandpa.say('')
    }
    const { best, bestMeter } = perceive(dt, thieves)
    const findThief = (id) => thieves.find((t) => t.id === id) ?? null

    // Reactions to being seen (not while busy / down / already chasing).
    const calm = state === 'patrol' || state === 'activity' || state === 'investigate' || state === 'search' || state === 'suspicious'
    if (calm && best) {
      if (bestMeter >= 1) startChase(best)
      else if (bestMeter > GRANDPA.suspicious && state !== 'suspicious') {
        if (state === 'activity' && activity?.pose !== 'look') grandpa.setPose('idle')
        stop()
        say('?', '#ffe08a', 1.5)
        voice('gpHuh')
        enter('suspicious', { thief: best })
        hooks.suspicious?.(best)
      }
    }

    fireCheck(dt)

    switch (state) {
      case 'idle':
        break
      case 'fire':
        updateFire(dt)
        break
      case 'flee':
        updateFlee(dt)
        break
      case 'patrol': {
        grandpa.setPose(speed > 0.5 ? 'idle' : 'idle')
        chatT -= dt
        if (chatT <= 0) {
          chatT = 10 + Math.random() * 14
          say('idle', '#ffffff', 2.4)
          voice('gpMumble')
        }
        if (arrived()) {
          if (sub?.leg === 'approach' && activity) {
            goTo(activity.stand[0], activity.stand[1], speedOf(GRANDPA.walkSpeed) * 0.7)
            sub.leg = 'stand'
          } else if (sub?.leg === 'stand' && activity) {
            if (faceToward(Math.sin(activity.yaw) * 10 + pos.x, Math.cos(activity.yaw) * 10 + pos.z, dt) < 0.1) startActivity()
          } else {
            grandpa.setPose('lookAround')
            stop()
            enter('activity', { dur: 3 + Math.random() * 3 })
            activity = null
          }
        }
        break
      }
      case 'activity': {
        if (activity) {
          faceToward(Math.sin(activity.yaw) * 10 + pos.x, Math.cos(activity.yaw) * 10 + pos.z, dt)
          if (activity.id === 'nap' && Math.floor(stateT * 0.7) !== Math.floor((stateT - dt) * 0.7)) {
            hooks.voice?.('gpSnore', pos)
            hooks.zzz?.(pos)
          }
          if (activity.id === 'thermostat' && heat && stateT > 2) {
            heat = false
            hooks.thermostatOff?.()
          }
        }
        if (stateT > (sub?.dur ?? 4)) {
          if (activity?.id === 'nap' || activity?.pose === 'read' || activity?.pose === 'sit') {
            grandpa.setPose('getUp')
            enter('getUp', { next: 'patrol' })
          } else {
            grandpa.setPose('idle')
            choosePatrol()
          }
        }
        break
      }
      case 'investigate': {
        if (arrived(2.5)) {
          grandpa.setPose('lookAround')
          stop()
          enter('search', { dur: 4 + Math.random() * 2 })
        }
        break
      }
      case 'suspicious': {
        const th = sub?.thief && findThief(sub.thief.id)
        const a = th && awareness.get(th.id)
        grandpa.setPose('suspicious')
        if (a) {
          faceToward(a.lastSeen.x, a.lastSeen.z, dt, 2)
          // creep closer to have a better look
          if (stateT > 1.2 && a.seen) goTo(a.lastSeen.x, a.lastSeen.z, speedOf(GRANDPA.walkSpeed) * 0.55)
        }
        if (!a || a.meter < 0.12) {
          say('giveup', '#ffffff', 1.8)
          grandpa.setPose('idle')
          choosePatrol()
        } else if (a.sinceSeen > 2.5 && a.meter < 0.6) {
          investigate(a.lastSeen.x, a.lastSeen.z, 'suspicious', false)
        }
        break
      }
      case 'alert': {
        if (stateT > 0.65) {
          say('chase', '#ff8a8a', 2)
          grandpa.setPose('chase')
          enter('chase', { thief: sub.thief, chatT: 3 })
        }
        break
      }
      case 'chase': {
        const th = target && findThief(target.id)
        const a = th && awareness.get(th.id)
        if (!th || th.caught || th.out || th.held) {
          target = null
          grandpa.setPose('idle')
          choosePatrol()
          break
        }
        grandpa.setPose('chase')
        sub.chatT -= dt
        if (sub.chatT <= 0) {
          sub.chatT = 3 + Math.random() * 3
          say('chase', '#ff8a8a', 1.8)
          voice('gpShout')
        }
        // Hiding under furniture right under his nose: stand there and glare.
        if (th.hidden && a.sinceSeen > 0.3) {
          goTo(th.pos.x, th.pos.z, speedOf(GRANDPA.hurrySpeed))
          enter('hideStare', { thief: th, x: th.pos.x, z: th.pos.z })
          say('hide', '#ffb36b', 2.5)
          break
        }
        const tgt = a.seen ? th.pos : a.lastSeen
        if (Math.floor(stateT * 4) !== Math.floor((stateT - dt) * 4) || !path.length) goTo(tgt.x, tgt.z, speedOf(GRANDPA.chaseSpeed))
        const dh = Math.hypot(th.pos.x - pos.x, th.pos.z - pos.z)
        if (a.seen && dh < GRANDPA.reach + 0.9 && th.pos.y < GRANDPA.reachHeight && !th.hidden) {
          grandpa.setPose('grab')
          enter('grab', { thief: th })
          break
        }
        if (a.sinceSeen > GRANDPA.loseSightAfter) {
          say('search', '#ffe08a')
          grandpa.setPose('lookAround')
          goTo(a.lastSeen.x, a.lastSeen.z, speedOf(GRANDPA.hurrySpeed))
          enter('search', { dur: GRANDPA.searchTime, moving: true })
          target = null
          hooks.lost?.(th)
        }
        break
      }
      case 'grab': {
        const th = findThief(sub.thief.id)
        if (th) {
          faceToward(th.pos.x, th.pos.z, dt, 6)
          // keep lunging toward them while the hand comes down
          goTo(th.pos.x, th.pos.z, speedOf(GRANDPA.chaseSpeed) * 0.7)
        }
        if (stateT >= GRANDPA.grabTime) {
          const dh = th ? Math.hypot(th.pos.x - pos.x, th.pos.z - pos.z) : 99
          if (th && !th.hidden && !th.caught && dh < GRANDPA.reach + 0.8 && th.pos.y < GRANDPA.reachHeight) {
            stop()
            carrying = th
            target = null
            grandpa.setPose('carry')
            say('caught', '#ff8a8a', 2.2)
            voice('gpGotcha')
            hooks.caught?.(th)
            const drop = house.cage.dropSpot
            goTo(drop.x, drop.z, speedOf(GRANDPA.carrySpeed))
            enter('carry', { thief: th })
          } else {
            grandpa.setPose('chase')
            enter('chase', { thief: sub.thief, chatT: 2 })
          }
        }
        break
      }
      case 'carry': {
        grandpa.setPose('carry')
        if (arrived(1)) {
          const drop = house.cage.dropSpot
          if (faceToward(pos.x + Math.sin(drop.yaw), pos.z + Math.cos(drop.yaw), dt, 4) < 0.15) {
            grandpa.setPose('drop')
            stop()
            enter('caging', { thief: sub.thief })
          }
        }
        break
      }
      case 'caging': {
        if (stateT > 0.8 && carrying) {
          hooks.caged?.(carrying)
          carrying = null
          say('giveup', '#ffffff', 2)
        }
        if (stateT > 1.6) {
          grandpa.setPose('idle')
          choosePatrol()
        }
        break
      }
      case 'search': {
        grandpa.setPose(speed > 0.5 ? 'idle' : 'lookAround')
        if (sub?.moving && arrived(2)) {
          stop()
          sub.moving = false
          stateT = 0
        }
        if (!sub?.moving && stateT > (sub?.dur ?? GRANDPA.searchTime)) {
          say('giveup', '#ffffff', 2)
          voice('gpGrumble')
          grandpa.setPose('angry')
          enter('grumble', {})
        }
        break
      }
      case 'grumble':
        if (stateT > 1.6) {
          grandpa.setPose('idle')
          choosePatrol()
        }
        break
      case 'hideStare': {
        const th = findThief(sub.thief.id)
        if (arrived(GRANDPA.radius + 3.5)) stop()
        grandpa.setPose(stateT % 4 < 2 ? 'suspicious' : 'angry')
        if (th) faceToward(th.pos.x, th.pos.z, dt)
        if (th && !th.hidden && !th.caught) {
          const a = awareness.get(th.id)
          if (a?.seen) {
            a.meter = 1
            grandpa.setPose('chase')
            enter('chase', { thief: th, chatT: 1 })
            target = th
            break
          }
        }
        if (stateT > GRANDPA.hideGiveUp) {
          if (th) awareness.get(th.id).meter = 0.2
          target = null
          say('giveup', '#ffffff', 2)
          voice('gpGrumble')
          grandpa.setPose('angry')
          enter('grumble', {})
        }
        break
      }
      case 'distract': {
        // going to something that made a racket (alarm clock, toilet, TV, thermostat, secret door)
        if (arrived(sub.near ?? 2.5)) {
          stop()
          if (faceToward(sub.x, sub.z, dt) < 0.2 && !sub.doing) {
            sub.doing = true
            stateT = 0
            grandpa.setPose(sub.pose ?? 'look')
            sub.onArrive?.()
          }
          // chatting (the phone): a line every few seconds
          if (sub.doing && sub.chat && stateT >= (sub.nextChat ?? 1.2)) {
            sub.nextChat = stateT + 3
            const lines = LINES[sub.chat] ?? ['...']
            sub.chatI = sub.chatI ?? 0
            say(lines[sub.chatI++ % lines.length], '#ffffff', 2.6) // in order: a conversation, no repeats
          }
          if (sub.doing && stateT > (sub.dur ?? 3)) {
            sub.onDone?.()
            grandpa.setPose('idle')
            choosePatrol()
          }
        }
        break
      }
      case 'slip':
        if (stateT > (GRANDPA.stun[sub.kind] ?? 4)) {
          grandpa.setPose('getUp')
          enter('getUp', { next: 'search' })
        }
        break
      case 'stuck':
        if (Math.floor(stateT * 1.2) !== Math.floor((stateT - dt) * 1.2)) voice('gpGrunt')
        if (stateT > GRANDPA.stun.glue) {
          grandpa.setPose('angry')
          say('giveup', '#ffffff', 1.8)
          enter('grumble', {})
        }
        break
      case 'asleep':
        if (Math.floor(stateT * 0.7) !== Math.floor((stateT - dt) * 0.7)) {
          voice('gpSnore')
          hooks.zzz?.(pos)
        }
        if (stateT > GRANDPA.stun.sleep) {
          grandpa.setPose('getUp')
          enter('getUp', { next: 'patrol' })
        }
        break
      case 'stunned':
        if (stateT > (sub?.dur ?? GRANDPA.stun.bazooka)) {
          grandpa.setPose('idle')
          enter('search', { dur: 4 })
        }
        break
      case 'ouch':
        if (stateT > GRANDPA.stun.hit) {
          grandpa.setPose('idle')
          if (sub?.thrower) {
            const a = awareness.get(sub.thrower)
            if (a) a.meter = Math.max(a.meter, 0.7)
          }
          enter('search', { dur: 3 })
        }
        break
      case 'getUp':
        if (stateT > 1) {
          grandpa.setPose('idle')
          if (sub?.next === 'search') enter('search', { dur: 4 })
          else choosePatrol()
        }
        break
    }

    // A thief being carried: the hand pulls them along (the heist module drives their body).
    if (state === 'carry' || state === 'caging') hooks.carryPoint?.(grandpa.handWorld)

    // Animate.
    grandpa.root.position.set(pos.x, 0, pos.z)
    grandpa.root.rotation.y = yaw
    grandpa.animate(dt, Math.hypot(pos.x - prevPos.x, pos.z - prevPos.z) / Math.max(dt, 1e-3) > 0.2 ? speed : 0, time)
    collider.setEnabled(state !== 'slip' && state !== 'asleep')
  }

  // --- Events the world sends him --------------------------------------------------------------------
  B.reset = (difficulty = 'normal') => {
    diff = DIFFICULTY[difficulty] ?? DIFFICULTY.normal
    awareness.clear()
    target = null
    carrying = null
    heat = false
    pos.set(-40, 0, -22)
    prevPos.copy(pos)
    yaw = -Math.PI / 2
    body.setTranslation({ x: pos.x, y: GRANDPA.height / 2, z: pos.z }, true)
    grandpa.setPose('idle')
    grandpa.say('')
    enabled = true
    activity = house.activities.find((a) => a.id === 'tea')
    lastActivity = 'tea'
    goTo(activity.stand[0], activity.stand[1], GRANDPA.walkSpeed)
    enter('patrol', { leg: 'stand' })
  }
  B.disable = () => {
    enabled = false
    stop()
  }
  B.update = update
  // A noise at `p` with radius r (metres). Through walls the radius shrinks.
  B.hear = (p, r, kind = 'noise') => {
    if (!enabled) return
    r *= GRANDPA.hearRange
    const d = Math.hypot(p.x - pos.x, p.z - pos.z)
    if (d > r) return
    // his own racket (a door he swung, loot his slippers kicked) doesn't count
    if (d < GRANDPA.radius + 6 && r < 60 && kind !== 'step') return
    const clear = segmentClear(pos.x, GRANDPA.eyeHeight, pos.z, p.x, Math.max(1, p.y ?? 1), p.z) >= 0.999
    if (!clear && d > r * NOISE.wallMuffle) return
    if (state === 'asleep' || state === 'activity' && activity?.id === 'nap') {
      if (r > 60 && d < r * 0.6) {
        grandpa.setPose('getUp')
        enter('getUp', { next: 'search' })
        hooks.voice?.('gpHuh', pos)
      }
      return
    }
    if (state === 'chase' || state === 'grab' || state === 'carry' || state === 'caging' || isDown() || state === 'distract' || state === 'alert' || state === 'fire' || state === 'flee') return
    investigate(p.x, p.z, kind === 'step' ? 'suspicious' : 'noise', r > 20)
  }
  // Something he must go and deal with.
  B.distract = (kind, p, data = {}) => {
    if (!enabled || isDown() || state === 'carry' || state === 'caging' || state === 'grab' || state === 'fire' || state === 'flee') return false
    if (state === 'chase' && kind !== 'tv') return false
    activity = null
    target = null
    const cfg = {
      alarm: { line: 'alarm', pose: 'smash', dur: 2.2, near: 3.5 },
      flush: { line: 'flush', pose: 'look', dur: 3, near: 3 },
      tv: { line: 'tv', pose: 'angry', dur: 3, near: 6 },
      thermostat: { line: 'heat', pose: 'adjust', dur: 2.5, near: 1.2 },
      secret: { line: 'secret', pose: 'lookAround', dur: 4, near: 3 },
      toast: { line: 'toast', pose: 'look', dur: 3.5, near: 2.5 },
      fan: { line: 'fan', pose: 'adjust', dur: 2, near: 1.5 },
      phone: { line: 'phoneRing', pose: 'phone', dur: 12, near: 2.5, chat: 'phoneChat', sight: 0.35 },
      lights: { line: 'lights', pose: 'adjust', dur: 1.5, near: 2 },
    }[kind] ?? { line: 'noise', pose: 'look', dur: 3 }
    say(cfg.line, '#ffb36b', 2.4)
    voice(kind === 'tv' ? 'gpShout' : 'gpHuh')
    const stand = data.stand ?? p
    goTo(stand.x, stand.z, speedOf(kind === 'tv' ? GRANDPA.chaseSpeed * 0.8 : GRANDPA.hurrySpeed))
    enter('distract', { kind, x: p.x, z: p.z, pose: cfg.pose, dur: cfg.dur, near: cfg.near, chat: cfg.chat, sight: cfg.sight, onArrive: data.onArrive, onDone: data.onDone })
    return true
  }
  // Traps under his feet.
  B.trip = (kind) => {
    if (!enabled || isDown() || state === 'activity' && (activity?.pose === 'read' || activity?.pose === 'sit' || activity?.id === 'nap')) return false
    if (carrying) dropCarried()
    target = null
    stop()
    if (kind === 'glue') {
      grandpa.setPose('stuck')
      say('stuck', '#fff1a8', 2.5)
      voice('gpGrunt')
      enter('stuck', {})
    } else {
      grandpa.setPose('slip')
      say('slip', '#fff1a8', 2.5)
      voice('gpSlip')
      enter('slip', { kind })
      hooks.slipped?.(pos)
    }
    return true
  }
  B.sleep = () => {
    if (!enabled || state === 'asleep') return false
    if (carrying) dropCarried()
    target = null
    stop()
    grandpa.setPose('sleepFloor')
    say('Zzz', '#c9b6ff', 3)
    voice('gpYawn')
    enter('asleep', {})
    return true
  }
  B.knock = (dur = GRANDPA.stun.bazooka) => {
    if (!enabled) return false
    if (carrying) dropCarried()
    target = null
    stop()
    grandpa.setPose('stunned')
    say('ouch', '#fff1a8', 2)
    voice('gpOuch')
    enter('stunned', { dur })
    return true
  }
  // Loot hit him (strength 0..1, thrower id or null).
  B.hit = (strength, thrower) => {
    if (!enabled || isDown()) return
    if (carrying) {
      dropCarried()
      hooks.voice?.('gpOuch', pos)
      grandpa.setPose('ouch')
      say('ouch', '#fff1a8', 1.6)
      enter('ouch', { thrower })
      return
    }
    if (strength < 0.3) return
    if (state === 'chase') return
    grandpa.setPose('ouch')
    say('ouch', '#fff1a8', 1.6)
    voice('gpOuch')
    stop()
    enter('ouch', { thrower })
  }
  // The held thief wriggled free / was bought free / a friend hit him.
  function dropCarried() {
    const th = carrying
    carrying = null
    if (th) hooks.dropped?.(th)
  }
  B.releaseCarried = () => {
    if (!carrying) return
    dropCarried()
    say('rescued', '#ffb36b', 1.8)
    grandpa.setPose('ouch')
    stop()
    enter('ouch', {})
  }
  B.setHeat = (on) => {
    heat = on
  }
  B.isDown = isDown
  // Crew clients: Grandpa is a puppet of the host's snapshots (no AI here, just his body for collisions).
  B.puppet = (x, z, yw) => {
    pos.set(x, 0, z)
    yaw = yw
    body.setNextKinematicTranslation({ x, y: GRANDPA.height / 2, z })
  }
  // This client became the crew's host mid-heist: carry on from where the puppet stood.
  B.takeOver = (difficulty, x, z, yw) => {
    diff = DIFFICULTY[difficulty] ?? DIFFICULTY.normal
    awareness.clear()
    target = null
    carrying = null
    pos.set(x, 0, z)
    prevPos.copy(pos)
    yaw = yw
    enabled = true
    grandpa.setPose('idle')
    choosePatrol()
  }
  B.targetId = () => target?.id ?? carrying?.id ?? ''
  // Snapshot for the crew (non-host clients draw a puppet).
  B.snapshot = () => [Math.round(pos.x * 100) / 100, Math.round(pos.z * 100) / 100, Math.round(yaw * 100) / 100, grandpa.pose, Math.round(speed * 10) / 10, state]
  void castRay
  return B
}
