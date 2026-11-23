// Gadgets: what the hotbar does. Every client spawns the visuals (and local physics) of every use it
// hears about; only the authority (solo / host) lets them affect Grandpa (traps, sleep, knock-down).
//   marbles: 12 rolling marbles; Grandpa walking into them slips (job "Trip Grandpa on marbles")
//   glue: a sticky puddle; he gets stuck          banana: a peel; he slips
//   alarm: a ringing clock (after 3 s) he must go and smash ("Fool Grandpa with a clock")
//   smoke: a cloud that blocks his sight; in a chase he loses you ("Smoke bomb in a chase")
//   sleep: a thrown potion; gas puts him to sleep    xray: see him + his sight through walls (local)
//   energy: endless stamina + speed (local)          bazooka: a foam rocket that knocks him down
//   extinguisher: a foam blast that puts out fires (fire.js) and burning loot
import { CircleGeometry, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { GADGET_FX, GRANDPA, NOISE } from '../config.js'
import { RAPIER, addDynamicShape, castRay, removeDynamic } from '../physics.js'
import { makeBananaPeel, makeFoamRocket, makeGadget, makeMarble } from './models/gadgets.js'

const tmp = new Vector3()

export function createGadgets({ scene, fx, sound, hooks }) {
  const root = new Group()
  scene.add(root)
  const traps = [] // { kind, pos, radius, armed, items: [{ body, mesh }], decal, t }
  const smokes = [] // { pos, radius, until, emit }
  const things = [] // timed objects: alarm clocks, potions, rockets
  let time = 0

  const floorAt = (x, y, z) => {
    const hit = castRay(x, y + 1.5, z, 0, -1, 0, 30, { staticOnly: true })
    return hit ? hit.point.y : 0
  }

  function addTrap(kind, pos, radius, extra = {}) {
    const t = { kind, pos: pos.clone(), radius, armed: true, items: [], t: 0, ...extra }
    traps.push(t)
    return t
  }

  // origin = feet, dir = view direction, chest = throw origin, authority
  function use(id, { origin, dir, chest, authority }) {
    const fwd = tmp.set(dir.x, 0, dir.z).normalize()
    const ahead = new Vector3(origin.x + fwd.x * 2.2, origin.y, origin.z + fwd.z * 2.2)
    switch (id) {
      case 'marbles': {
        const trap = addTrap('marbles', ahead, GADGET_FX.trapRadius)
        sound('marbles', ahead)
        for (let i = 0; i < GADGET_FX.marbleCount; i++) {
          const mesh = makeMarble(i % 6)
          const a = (i / GADGET_FX.marbleCount) * Math.PI * 2
          mesh.position.set(chest.x + fwd.x * 0.8 + Math.cos(a) * 0.3, chest.y - 0.2, chest.z + fwd.z * 0.8 + Math.sin(a) * 0.3)
          root.add(mesh)
          const { body } = addDynamicShape(mesh, RAPIER.ColliderDesc.ball(GADGET_FX.marbleRadius / 2 + 0.01), { mass: 0.25, friction: 0.25, restitution: 0.55, linearDamping: 0.35, angularDamping: 0.2 })
          body.setLinvel({ x: fwd.x * 5 + Math.cos(a) * 3.5, y: 1.5, z: fwd.z * 5 + Math.sin(a) * 3.5 }, true)
          trap.items.push({ body, mesh })
        }
        hooks.noise?.(ahead, NOISE.marbles)
        break
      }
      case 'glue': {
        const y = floorAt(ahead.x, origin.y + 0.5, ahead.z)
        ahead.y = y
        const decal = new Group()
        const mat = new MeshStandardMaterial({ color: '#f4f0dc', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.92 })
        const disc = new Mesh(new CircleGeometry(GADGET_FX.glueRadius, 28), mat)
        disc.rotation.x = -Math.PI / 2
        decal.add(disc)
        for (let i = 0; i < 7; i++) {
          const b = new Mesh(new CircleGeometry(0.6 + Math.random() * 0.9, 16), mat)
          b.rotation.x = -Math.PI / 2
          const a = Math.random() * Math.PI * 2
          b.position.set(Math.cos(a) * GADGET_FX.glueRadius * 0.95, 0.01, Math.sin(a) * GADGET_FX.glueRadius * 0.95)
          decal.add(b)
        }
        decal.position.set(ahead.x, y + 0.04, ahead.z)
        decal.scale.setScalar(0.1)
        root.add(decal)
        addTrap('glue', ahead, GADGET_FX.glueRadius, { decal, grow: 0 })
        sound('glue', ahead)
        fx.burst(ahead, { count: 14, color: '#fffbe6', speed: 3, up: 2, size: 0.4, life: 0.6 })
        break
      }
      case 'banana': {
        const y = floorAt(ahead.x, origin.y + 0.5, ahead.z)
        ahead.y = y
        const peel = makeBananaPeel()
        peel.position.set(ahead.x, y + 0.02, ahead.z)
        peel.rotation.y = Math.random() * Math.PI * 2
        root.add(peel)
        addTrap('banana', ahead, GADGET_FX.bananaRadius, { decal: peel })
        sound('banana', ahead)
        break
      }
      case 'alarm': {
        const mesh = makeGadget('alarm')
        mesh.position.set(chest.x + dir.x * 1.2, chest.y, chest.z + dir.z * 1.2)
        root.add(mesh)
        const { body } = addDynamicShape(mesh, RAPIER.ColliderDesc.cuboid(0.4, 0.4, 0.25), { mass: 1, friction: 0.8, restitution: 0.2 })
        body.setLinvel({ x: dir.x * 9, y: dir.y * 9 + 4, z: dir.z * 9 }, true)
        things.push({ kind: 'alarm', mesh, body, t: 0, ringing: false, loop: null, authority, distracted: false })
        sound('throw', chest)
        break
      }
      case 'smoke': {
        const p = new Vector3(origin.x, origin.y + 1, origin.z)
        smokes.push({ pos: p, radius: GADGET_FX.smokeRadius, until: time + GADGET_FX.smokeTime, emit: 0 })
        fx.puff(p, { count: 46, color: ['#8c8ca0', '#a5a5b8', '#6f6f82'], size: [4, 13], life: 3.2, speed: 6, up: 2.5, spread: 2.5, alpha: 0.85 })
        fx.burst(p, { count: 20, color: '#ffffff', speed: 7, up: 3, size: 0.5, life: 0.5 })
        sound('smoke', p)
        if (authority) hooks.smoked?.(p)
        break
      }
      case 'sleep': {
        const mesh = makeGadget('sleep')
        mesh.position.set(chest.x + dir.x * 1.2, chest.y, chest.z + dir.z * 1.2)
        root.add(mesh)
        const { body } = addDynamicShape(mesh, RAPIER.ColliderDesc.ball(0.4), { mass: 0.6, friction: 0.6, restitution: 0.1 })
        const sp = GADGET_FX.throwSpeed
        body.setLinvel({ x: dir.x * sp, y: dir.y * sp + 5, z: dir.z * sp }, true)
        body.setAngvel({ x: 6, y: 2, z: 4 }, true)
        things.push({ kind: 'potion', mesh, body, t: 0, lastV: new Vector3(dir.x * sp, dir.y * sp + 5, dir.z * sp), authority })
        sound('throw', chest)
        break
      }
      case 'bazooka': {
        const mesh = makeFoamRocket()
        const p = new Vector3(chest.x + dir.x * 1.5, chest.y + 0.2, chest.z + dir.z * 1.5)
        mesh.position.copy(p)
        mesh.lookAt(p.x + dir.x, p.y + dir.y, p.z + dir.z)
        root.add(mesh)
        things.push({ kind: 'rocket', mesh, pos: p, dir: dir.clone().normalize(), t: 0, authority })
        sound('bazookaFire', p)
        fx.puff(p, { count: 10, color: '#ffffff', size: [1, 3], life: 0.8, speed: 3, up: 0.5, spread: 0.3 })
        hooks.noise?.(p, NOISE.bazooka * 0.5)
        break
      }
      case 'extinguisher': {
        // a foam blast down the crosshair: puts out burning floor and burning loot (game.js / fire.js)
        hooks.spray?.(chest, dir.clone().normalize(), authority)
        if (authority) hooks.noise?.(chest, NOISE.extinguisher)
        break
      }
      default:
        break
    }
  }

  function foamBoom(p, authority) {
    sound('foamBoom', p)
    fx.burst(p, { count: 60, color: ['#ff4fa3', '#ffd23f', '#4dff8a', '#3fb7ff', '#ffffff'], speed: 16, up: 6, size: 0.9, life: 1.2, gravity: -14 })
    fx.puff(p, { count: 18, color: '#fff2f8', size: [2, 7], life: 1.4, speed: 7, up: 2, spread: 1 })
    fx.ring(p, '#ff4fa3', GADGET_FX.rocketBlast * 1.4, 0.5)
    hooks.shake?.(p, 0.8)
    hooks.blast?.(p, GADGET_FX.rocketBlast)
    if (authority) {
      hooks.noise?.(p, NOISE.bazooka)
      hooks.rocketHit?.(p)
    }
  }

  function shatterPotion(th) {
    const p = th.mesh.position.clone()
    removeDynamic(th.body, th.mesh)
    root.remove(th.mesh)
    sound('potion', p)
    fx.puff(p, { count: 40, color: ['#b06cff', '#d6a8ff', '#8f4dff'], size: [3, 10], life: 3, speed: 4, up: 1.5, spread: 1.5, alpha: 0.75 })
    fx.burst(p, { count: 30, color: ['#e0c2ff', '#ffffff'], speed: 6, up: 3, size: 0.5, life: 1 })
    if (th.authority) hooks.gas?.(p, GADGET_FX.sleepRadius)
  }

  return {
    use,
    // Does the segment a -> b pass through smoke?
    smokeBlocks(a, b) {
      for (const s of smokes) {
        // closest point on the segment to the smoke centre
        const abx = b.x - a.x
        const aby = b.y - a.y
        const abz = b.z - a.z
        const len2 = abx * abx + aby * aby + abz * abz || 1
        let t = ((s.pos.x - a.x) * abx + (s.pos.y - a.y) * aby + (s.pos.z - a.z) * abz) / len2
        t = Math.max(0, Math.min(1, t))
        const dx = a.x + abx * t - s.pos.x
        const dy = a.y + aby * t - s.pos.y
        const dz = a.z + abz * t - s.pos.z
        if (dx * dx + dy * dy * 0.4 + dz * dz < s.radius * s.radius) return true
      }
      return false
    },
    inSmoke(p) {
      return smokes.some((s) => Math.hypot(p.x - s.pos.x, p.z - s.pos.z) < s.radius)
    },
    // Per frame. gp = { pos, moving, down } or null (authority only checks traps).
    update(dt, gp, authority) {
      time += dt
      // smoke clouds keep billowing, then thin out
      for (let i = smokes.length - 1; i >= 0; i--) {
        const s = smokes[i]
        if (time > s.until) {
          smokes.splice(i, 1)
          continue
        }
        s.emit += dt
        if (s.emit > 0.12) {
          s.emit = 0
          fx.puff(s.pos, { count: 3, color: ['#8c8ca0', '#a5a5b8', '#6f6f82'], size: [5, 12], life: 2.6, speed: 2.2, up: 0.6, spread: s.radius * 0.55, alpha: 0.7 })
        }
      }
      // traps
      for (let i = traps.length - 1; i >= 0; i--) {
        const t = traps[i]
        t.t += dt
        if (t.decal && t.kind === 'glue') {
          t.grow = Math.min(1, (t.grow ?? 0) + dt * 3)
          t.decal.scale.setScalar(0.1 + 0.9 * t.grow)
        }
        if (t.kind === 'marbles') {
          // the trap sits where the marbles are
          let n = 0
          tmp.set(0, 0, 0)
          for (const it of t.items) {
            const p = it.body.translation()
            tmp.x += p.x
            tmp.z += p.z
            n++
          }
          if (n) t.pos.set(tmp.x / n, t.pos.y, tmp.z / n)
        }
        if (authority && t.armed && gp && gp.moving && !gp.down) {
          const d = Math.hypot(gp.pos.x - t.pos.x, gp.pos.z - t.pos.z)
          if (d < t.radius + GRANDPA.radius * 0.6) {
            if (hooks.trip?.(t.kind, t.pos)) {
              t.armed = false
              if (t.kind === 'marbles') {
                for (const it of t.items) it.body.applyImpulse({ x: (Math.random() - 0.5) * 3, y: 1.5, z: (Math.random() - 0.5) * 3 }, true)
                sound('marbles', t.pos)
              }
              if (t.kind === 'banana' && t.decal) {
                t.decal.userData.fly = 1
              }
              t.t = 0
            }
          }
        }
        if (t.decal?.userData.fly) {
          t.decal.position.y += dt * 8
          t.decal.rotation.x += dt * 12
          t.decal.userData.fly -= dt
          if (t.decal.userData.fly <= 0) {
            root.remove(t.decal)
            t.decal = null
          }
        }
        const life = t.armed ? 120 : t.kind === 'glue' ? 8 : 20
        if (t.t > life) {
          for (const it of t.items) {
            removeDynamic(it.body, it.mesh)
            root.remove(it.mesh)
          }
          if (t.decal) root.remove(t.decal)
          traps.splice(i, 1)
        }
      }
      // timed things
      for (let i = things.length - 1; i >= 0; i--) {
        const th = things[i]
        th.t += dt
        if (th.kind === 'alarm') {
          if (!th.ringing && th.t > GADGET_FX.alarmDelay) {
            th.ringing = true
            th.loop = hooks.loop?.('alarmRing', th.mesh.position)
          }
          if (th.ringing) {
            th.mesh.rotation.z = Math.sin(time * 60) * 0.12
            th.loop?.setPos(th.mesh.position.x, th.mesh.position.y, th.mesh.position.z)
            if (th.authority && Math.floor(th.t) !== Math.floor(th.t - dt)) hooks.noise?.(th.mesh.position, NOISE.alarm * 0.6)
            if (th.authority && !th.distracted) {
              th.distracted = true
              hooks.alarm?.(th.mesh.position, () => {
                // Grandpa arrived and smashes it
                th.t = 999
                hooks.jobTrap?.('alarm')
              })
            }
          }
          if (th.t > GADGET_FX.alarmDelay + GADGET_FX.alarmRing || th.t >= 999) {
            th.loop?.stop()
            if (th.t >= 999) {
              sound('alarmSmash', th.mesh.position)
              fx.chunks(th.mesh.position, { count: 14, color: ['#ff6b5a', '#ffd23f', '#c0c6cc'], size: [0.15, 0.4], speed: 6, up: 5, floor: th.mesh.position.y - 0.4 })
            }
            removeDynamic(th.body, th.mesh)
            root.remove(th.mesh)
            things.splice(i, 1)
          }
        } else if (th.kind === 'potion') {
          const v = th.body.linvel()
          const dv = Math.hypot(v.x - th.lastV.x, v.y - th.lastV.y, v.z - th.lastV.z)
          th.lastV.set(v.x, v.y, v.z)
          if ((dv > 4 && th.t > 0.12) || th.t > 3) {
            shatterPotion(th)
            things.splice(i, 1)
          }
        } else if (th.kind === 'rocket') {
          const step = GADGET_FX.rocketSpeed * dt
          const hit = castRay(th.pos.x, th.pos.y, th.pos.z, th.dir.x, th.dir.y, th.dir.z, step + 0.6, { exclude: hooks.playerCollider?.() })
          const gpHit = gp && Math.hypot(th.pos.x - gp.pos.x, th.pos.z - gp.pos.z) < GRANDPA.radius + 1 && th.pos.y < GRANDPA.height + 1
          if (hit || gpHit || th.t > 3) {
            const p = hit ? new Vector3(hit.point.x, hit.point.y, hit.point.z) : th.pos.clone()
            root.remove(th.mesh)
            things.splice(i, 1)
            foamBoom(p, th.authority)
            continue
          }
          th.pos.addScaledVector(th.dir, step)
          th.dir.y -= dt * 0.08
          th.mesh.position.copy(th.pos)
          th.mesh.lookAt(th.pos.x + th.dir.x, th.pos.y + th.dir.y, th.pos.z + th.dir.z)
          fx.puff(th.pos, { count: 1, color: '#ffffff', size: [0.8, 2.4], life: 0.7, speed: 0.5, up: 0.2, spread: 0.1, alpha: 0.6 })
        }
      }
    },
    clear() {
      for (const t of traps) {
        for (const it of t.items) {
          removeDynamic(it.body, it.mesh)
          root.remove(it.mesh)
        }
        if (t.decal) root.remove(t.decal)
      }
      traps.length = 0
      smokes.length = 0
      for (const th of things) {
        th.loop?.stop()
        if (th.body) removeDynamic(th.body, th.mesh)
        root.remove(th.mesh)
      }
      things.length = 0
    },
  }
}
