// Fire in Grandpa's house.
//
// Start one: hold or drop flammable loot (paper, cloth, wood, plastic: a book, a pillow, the diary...) in
// the living-room fireplace and it catches. Carry / throw it somewhere in the house and let it rest: the
// floor there catches. The fire grows, spreads cell to cell (each room is split into ~6 m cells; through
// walls it spreads slowly, tiled rooms burn poorly), sets flammable loot in it alight (it burns to ash:
// that value is lost; metal / glass / ceramic loot survives), throws thieves out of the flames, and once a
// spot has burned through its fuel it goes out and stays charred. A burning gas can explodes.
//
// Put it out: the Fire Extinguisher gadget (a foam blast down the crosshair), or Grandpa, who fetches
// buckets of water from the nearest sink (brain.js). Doused cells stay wet for a while (a firebreak).
//
// The authority (solo / host) runs the simulation and the loot; crew clients draw the host's packed grid
// (`pack` / `unpack`, in the snapshot) and burning-loot list. Visuals: one instanced mesh of billboard
// flames (cells + burning loot), one of charred floor patches, pooled smoke / sparks from fx.js, the
// existing 3-light pool (fire glow spots), a crackle loop at the nearest fire and the hallway smoke alarm.
import {
  AdditiveBlending, CanvasTexture, Color, CylinderGeometry, Group, InstancedMesh, Mesh, MeshBasicMaterial, MeshStandardMaterial,
  Object3D, PlaneGeometry, SRGBColorSpace, TorusGeometry, Vector3,
} from 'three'
import { FIRE, ROOMS } from '../config.js'
import { segmentClear } from '../physics.js'
import { rng } from './kit.js'

const FLAMES_PER_CELL = 3
const LOOT_FLAMES = 64
const ALARM_POS = { x: 0, y: 14.6, z: -3 } // the smoke alarm on the hallway ceiling
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

let flameTex = null
function flameTexture() {
  if (flameTex) return flameTex
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 128
  const ctx = c.getContext('2d')
  const grd = ctx.createRadialGradient(32, 100, 4, 32, 80, 64)
  grd.addColorStop(0, 'rgba(255,250,210,1)')
  grd.addColorStop(0.3, 'rgba(255,190,60,0.95)')
  grd.addColorStop(0.65, 'rgba(255,90,20,0.55)')
  grd.addColorStop(1, 'rgba(255,40,0,0)')
  ctx.fillStyle = grd
  ctx.beginPath()
  ctx.moveTo(32, 2)
  ctx.bezierCurveTo(60, 48, 62, 112, 32, 127)
  ctx.bezierCurveTo(2, 112, 4, 48, 32, 2)
  ctx.fill()
  flameTex = new CanvasTexture(c)
  flameTex.colorSpace = SRGBColorSpace
  return flameTex
}

// deps: { scene, house, fx, sound(name, pos, opts), loop(name, pos) -> handle, hooks }
// hooks (authority side effects, wired by game.js): ignite(p), burnUp(p), boom(p), started(cell, p)
export function createFire({ scene, house, fx, sound, loop, hooks = {} }) {
  // --- The grid -------------------------------------------------------------------------------------
  const cells = []
  const byRoom = new Map()
  const rand = rng(0xf17e)
  for (const r of ROOMS) {
    const nx = Math.max(1, Math.round((r.x1 - r.x0) / FIRE.cell))
    const nz = Math.max(1, Math.round((r.z1 - r.z0) / FIRE.cell))
    const cw = (r.x1 - r.x0) / nx
    const cd = (r.z1 - r.z0) / nz
    const list = []
    const M = 1.3 // flames stay this far inside the room's walls
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const x0 = r.x0 + ix * cw
        const z0 = r.z0 + iz * cd
        const fuel = FIRE.fuel[r.id] ?? 40
        const c = {
          i: cells.length, room: r.id, x0, x1: x0 + cw, z0, z1: z0 + cd, cx: x0 + cw / 2, cz: z0 + cd / 2,
          heat: 0, ignite: 0, fuel, fuel0: fuel, char: 0, wet: 0, high: false, baseY: 0, burn: FIRE.burnability[r.id] ?? 1,
          nb: [], flames: [],
          // charred patch: the cell minus the wall margin
          px0: Math.max(x0, r.x0 + M), px1: Math.min(x0 + cw, r.x1 - M), pz0: Math.max(z0, r.z0 + M), pz1: Math.min(z0 + cd, r.z1 - M),
        }
        for (let k = 0; k < FLAMES_PER_CELL; k++) {
          c.flames.push({
            x: clamp(x0 + cw * (0.15 + 0.7 * rand()), r.x0 + M, r.x1 - M),
            z: clamp(z0 + cd * (0.15 + 0.7 * rand()), r.z0 + M, r.z1 - M),
            s: 0.7 + rand() * 0.6,
            ph: rand() * 20,
          })
        }
        cells.push(c)
        list.push(c)
      }
    }
    byRoom.set(r.id, { r, nx, nz, cw, cd, list })
  }
  // neighbours: shared edge (k 1) or corner (FIRE.diagonal); across a wall x FIRE.throughWall
  for (const a of cells) {
    for (const b of cells) {
      if (a === b) continue
      const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
      const oz = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0)
      if (ox < -0.01 || oz < -0.01) continue
      let k = ox > 0.5 || oz > 0.5 ? 1 : FIRE.diagonal
      if (a.room !== b.room) k *= FIRE.throughWall
      a.nb.push({ c: b, k })
    }
  }
  function cellAt(x, z) {
    const room = house.roomAt(x, z)
    const g = room && byRoom.get(room)
    if (!g) return null
    const ix = clamp(Math.floor((x - g.r.x0) / g.cw), 0, g.nx - 1)
    const iz = clamp(Math.floor((z - g.r.z0) / g.cd), 0, g.nz - 1)
    return g.list[iz * g.nx + ix]
  }
  const distToCell = (c, x, z) => Math.hypot(Math.max(c.x0 - x, 0, x - c.x1), Math.max(c.z0 - z, 0, z - c.z1))

  let count = 0 // burning cells
  let everBurned = 0
  let inferno = false
  function recount() {
    count = 0
    for (const c of cells) if (c.heat > 0) count++
  }

  // --- Simulation (authority) ----------------------------------------------------------------------
  function step(dt) {
    for (const c of cells) {
      if (c.wet > 0) c.wet = Math.max(0, c.wet - dt)
      if (c.heat <= 0) continue
      if (c.fuel > 0) {
        c.heat = Math.min(1, c.heat + FIRE.grow * c.burn * dt)
        c.fuel -= c.heat * dt
        c.char = Math.max(c.char, Math.min(1, 1 - c.fuel / c.fuel0))
      } else {
        c.heat = Math.max(0, c.heat - 0.15 * dt) // burned out
        c.char = 1
      }
    }
    for (const c of cells) {
      if (c.heat < 0.2) continue
      for (const { c: n, k } of c.nb) {
        if (n.heat > 0 || n.fuel <= 0 || n.wet > 0) continue
        n.ignite += FIRE.spread * c.heat * k * n.burn * dt
      }
    }
    for (const c of cells) {
      if (c.heat > 0) continue
      if (c.ignite >= 1 && c.fuel > 0 && c.wet <= 0) {
        c.heat = 0.1
        c.ignite = 0
        c.high = false
        c.baseY = 0
        everBurned++
      } else c.ignite = Math.max(0, c.ignite - 0.03 * dt)
    }
    recount()
  }
  // Something burning at (x, y, z) heats the cell under it; true = a new fire started there.
  function seed(x, y, z, amount) {
    const c = cellAt(x, z)
    if (!c || c.fuel <= 0 || c.wet > 0) return false
    const fresh = c.heat <= 0
    if (fresh) {
      c.heat = Math.max(0.06, amount)
      c.high = y > FIRE.highY
      c.baseY = c.high ? y : 0
      everBurned++
      count++
    } else c.heat = Math.min(1, c.heat + amount)
    return fresh ? c : null
  }
  function burst(x, z, r, heat) {
    for (const c of cells) {
      if (distToCell(c, x, z) > r || c.fuel <= 0) continue
      if (c.heat <= 0) everBurned++
      c.heat = Math.max(c.heat, heat)
      c.wet = 0
      c.high = false
      c.baseY = 0
    }
    recount()
  }
  // Water / foam at (x, z) within r: cools burning cells (out at 0: wet for a while). bucket = Grandpa's
  // throw (can't reach a fire lit high up). Returns how many burning cells it hit.
  function douse(x, z, r, power, bucket = false) {
    let hit = 0
    for (const c of cells) {
      const d = distToCell(c, x, z)
      if (d > r) continue
      if (bucket && c.high) continue
      const k = power * (1 - (0.6 * d) / r)
      c.ignite = 0
      if (c.heat > 0) {
        hit++
        c.heat -= k
        if (c.heat <= 0.03) {
          c.heat = 0
          c.wet = FIRE.wetTime
        }
      } else c.wet = Math.max(c.wet, FIRE.wetTime * 0.6)
    }
    recount()
    return hit
  }
  // The extinguisher: foam down a line from `o` along `dir` for `range` m, widening.
  function douseCone(o, dir, range) {
    const E = FIRE.extinguisher
    const len = Math.hypot(dir.x, dir.z) || 1
    const dx = dir.x / len
    const dz = dir.z / len
    let hit = 0
    for (let t = 1.2; t <= range; t += 1.5) hit += douse(o.x + dx * t, o.z + dz * t, E.radius * (0.45 + (0.55 * t) / range), E.power * 0.4)
    return hit
  }

  // --- Queries ------------------------------------------------------------------------------------------
  function heatAt(x, y, z) {
    const c = cellAt(x, z)
    if (!c || c.heat <= 0) return 0
    if (y < c.baseY - 1.5 || y > c.baseY + FIRE.hurtTop) return 0
    return c.heat
  }
  // Grandpa: can he see a burning spot from `eye` (its flames, at their base + 2 m)?
  function canSee(eye, range) {
    let checks = 0
    for (const c of cells) {
      if (c.heat <= 0.05) continue
      const d = Math.hypot(c.cx - eye.x, c.cz - eye.z)
      if (d > range) continue
      if (house.roomAt(eye.x, eye.z) === c.room) return true
      for (const f of c.flames) if (segmentClear(eye.x, eye.y, eye.z, f.x, c.baseY + 2, f.z) >= 0.999) return true
      if (++checks >= 8) break
    }
    return false
  }
  // The nearest burning spot Grandpa can throw a bucket at (not lit high up, not behind the shut secret
  // door), or null.
  function nearestReachable(x, z) {
    let best = null
    let bd = Infinity
    for (const c of cells) {
      if (c.heat <= 0 || c.high) continue
      if (c.room === 'study' && !house.nav.flags.secret) continue
      const d = (c.cx - x) ** 2 + (c.cz - z) ** 2
      if (d < bd) {
        bd = d
        best = c
      }
    }
    return best
  }

  // --- Network --------------------------------------------------------------------------------------------
  // one char per cell: '0' nothing, '1'-'9' burning (heat), 'A'-'I' burning high up, 'a'-'e' charred
  function pack() {
    let s = ''
    for (const c of cells) {
      if (c.heat > 0) {
        const q = clamp(Math.ceil(c.heat * 9), 1, 9)
        s += c.high ? String.fromCharCode(64 + q) : String(q)
      } else if (c.char > 0.04) s += String.fromCharCode(96 + clamp(Math.ceil(c.char * 5), 1, 5))
      else s += '0'
    }
    return s
  }
  function unpack(s) {
    if (typeof s !== 'string' || s.length !== cells.length) return
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]
      const ch = s.charCodeAt(i)
      if (ch >= 49 && ch <= 57) {
        c.heat = (ch - 48) / 9
        c.high = false
        c.baseY = 0
      } else if (ch >= 65 && ch <= 73) {
        c.heat = (ch - 64) / 9
        if (!c.high) c.baseY = FIRE.highY + 1
        c.high = true
      } else {
        c.heat = 0
        if (ch >= 97 && ch <= 101) c.char = Math.max(c.char, (ch - 96) / 5)
        else c.char = 0
      }
    }
    recount()
  }

  // --- Burning loot (authority) --------------------------------------------------------------------------
  const H = FIRE.hearth
  const inHearth = (t) => t.x > H.x0 && t.x < H.x1 && t.z > H.z0 && t.z < H.z1 && t.y < H.y1
  function lootStep(dt, props) {
    for (const p of props) {
      if (p.state !== 'home' || !p.body) {
        p.fire = null
        continue
      }
      const fl = FIRE.flammable[p.mat]
      const t = p.body.translation()
      if (p.fire) {
        p.fire.life -= dt
        if (p.fire.fuse != null) {
          p.fire.fuse -= dt
          if (p.fire.fuse <= 0) {
            hooks.boom?.(p)
            continue
          }
        }
        // resting (not held, slow) in the house: the floor under it catches
        const v = p.body.linvel()
        const slow = !p.heldBy && Math.hypot(v.x, v.y, v.z) < 1.5
        if (slow && house.insideFootprint(t.x, t.z, -0.6)) {
          p.fire.rest += dt
          if (p.fire.rest > FIRE.seedAfter) {
            const c = seed(t.x, t.y - p.half.y, t.z, FIRE.seedHeat * dt)
            if (c) hooks.started?.(c, p)
          }
        } else p.fire.rest = 0
        if (p.fire.life <= 0) hooks.burnUp?.(p)
        continue
      }
      if (!fl) continue
      // in the fireplace
      if (inHearth(t)) {
        p.hearthT = (p.hearthT ?? 0) + dt
        if (p.hearthT >= FIRE.igniteTime) {
          p.hearthT = 0
          hooks.ignite?.(p)
          continue
        }
      } else p.hearthT = 0
      // in a burning spot
      if (heatAt(t.x, t.y, t.z) >= FIRE.lootHeat) {
        p.catchT = (p.catchT ?? 0) + dt
        if (p.catchT >= fl.catch) {
          p.catchT = 0
          hooks.ignite?.(p)
        }
      } else p.catchT = 0
    }
  }
  // Light / put out an item (all clients keep p.fire for the visuals; the authority's runs the clock).
  function setLootFire(p, on) {
    if (!on) {
      p.fire = null
      return
    }
    if (p.fire) return
    const fl = FIRE.flammable[p.mat] ?? { life: 12 }
    p.fire = { life: fl.life, rest: 0, fuse: p.id === 'gascan' ? FIRE.gasFuse : null }
  }

  // --- Visuals ----------------------------------------------------------------------------------------------
  const flameGeo = new PlaneGeometry(1, 1)
  flameGeo.translate(0, 0.5, 0)
  const flameMat = new MeshBasicMaterial({ map: flameTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, side: 2, toneMapped: false, color: new Color(1.1, 0.72, 0.45) })
  const flames = new InstancedMesh(flameGeo, flameMat, cells.length * FLAMES_PER_CELL + LOOT_FLAMES)
  flames.frustumCulled = false
  flames.renderOrder = 5
  flames.count = 0
  flames.setColorAt(0, new Color(1, 1, 1))
  scene.add(flames)
  const charGeo = new PlaneGeometry(1, 1)
  charGeo.rotateX(-Math.PI / 2)
  const charMat = new MeshBasicMaterial({ color: '#120c08', transparent: true, opacity: 0.78, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })
  const chars = new InstancedMesh(charGeo, charMat, cells.length)
  chars.frustumCulled = false
  chars.count = 0
  scene.add(chars)
  // Grandpa's bucket
  const bucket = new Group()
  const tin = new MeshStandardMaterial({ color: '#9aa3ad', metalness: 0.6, roughness: 0.35 })
  const pail = new Mesh(new CylinderGeometry(0.95, 0.72, 1.5, 18, 1, true), tin)
  pail.material.side = 2
  bucket.add(pail)
  const bottom = new Mesh(new CylinderGeometry(0.72, 0.72, 0.06, 18), tin)
  bottom.position.y = -0.74
  bucket.add(bottom)
  const water = new Mesh(new CylinderGeometry(0.9, 0.9, 0.05, 18), new MeshStandardMaterial({ color: '#5fb6ff', roughness: 0.1, metalness: 0, transparent: true, opacity: 0.85 }))
  water.position.y = 0.5
  bucket.add(water)
  const handle = new Mesh(new TorusGeometry(0.95, 0.05, 6, 20, Math.PI), tin)
  handle.position.y = 0.72
  bucket.add(handle)
  bucket.visible = false
  scene.add(bucket)

  const dummy = new Object3D()
  const col = new Color()
  const camPos = new Vector3()
  const tmp = new Vector3()
  let time = 0
  let smokeAcc = 0
  let charT = 0
  let crackle = null
  let alarm = null

  function drawFlames(camera, props) {
    camera.getWorldPosition(camPos)
    let n = 0
    for (const c of cells) {
      if (c.heat <= 0.02) continue
      for (const f of c.flames) {
        const h = (2 + 7.5 * c.heat) * f.s * (0.82 + 0.14 * Math.sin(time * 8.5 + f.ph) + 0.08 * Math.sin(time * 21 + f.ph * 2))
        dummy.position.set(f.x + Math.sin(time * 2.7 + f.ph) * 0.2, c.baseY, f.z)
        dummy.rotation.set(0, Math.atan2(camPos.x - f.x, camPos.z - f.z), 0)
        dummy.scale.set(h * 0.62, h, 1)
        dummy.updateMatrix()
        flames.setMatrixAt(n, dummy.matrix)
        // additive: fade the ones right in the camera's face (inside a blaze it whited out the screen)
        const near = Math.min(1, Math.max(0.12, (Math.hypot(camPos.x - f.x, camPos.z - f.z) - 2) / 12))
        flames.setColorAt(n, col.setScalar((0.3 + 0.45 * c.heat) * near))
        n++
      }
    }
    let lootN = 0
    for (const p of props) {
      if (!p.fire || p.state !== 'home' || lootN >= LOOT_FLAMES - 1) continue
      const m = p.mesh.position
      const s = Math.max(p.half.x, p.half.y, p.half.z)
      for (let k = 0; k < 2; k++) {
        const ph = p.netId * 1.7 + k * 2.3
        const h = (1.1 + s * 1.5) * (0.8 + 0.2 * Math.sin(time * 11 + ph))
        const x = m.x + Math.sin(ph) * s * 0.3
        const z = m.z + Math.cos(ph) * s * 0.3
        dummy.position.set(x, m.y - p.half.y * 0.2, z)
        dummy.rotation.set(0, Math.atan2(camPos.x - x, camPos.z - z), 0)
        dummy.scale.set(h * 0.6, h, 1)
        dummy.updateMatrix()
        flames.setMatrixAt(n, dummy.matrix)
        flames.setColorAt(n, col.setScalar(1))
        n++
        lootN++
      }
    }
    flames.count = n
    flames.instanceMatrix.needsUpdate = true
    if (flames.instanceColor) flames.instanceColor.needsUpdate = true
  }
  function drawChars() {
    let n = 0
    for (const c of cells) {
      if (c.char <= 0.04) continue
      const k = 0.35 + 0.65 * c.char
      const w = (c.px1 - c.px0) * k
      const d = (c.pz1 - c.pz0) * k
      dummy.position.set((c.px0 + c.px1) / 2, 0.15, (c.pz0 + c.pz1) / 2)
      dummy.rotation.set(0, 0, 0)
      dummy.scale.set(w, 1, d)
      dummy.updateMatrix()
      chars.setMatrixAt(n++, dummy.matrix)
    }
    chars.count = n
    chars.instanceMatrix.needsUpdate = true
  }
  function smoke(dt, props) {
    smokeAcc += dt * Math.min(9, count ? 0.8 + count * 0.45 : 0)
    while (smokeAcc >= 1) {
      smokeAcc -= 1
      let pick = null
      let k = Math.floor(Math.random() * count)
      for (const c of cells) {
        if (c.heat <= 0) continue
        if (k-- <= 0) {
          pick = c
          break
        }
      }
      if (!pick) break
      const f = pick.flames[Math.floor(Math.random() * pick.flames.length)]
      fx.puff(tmp.set(f.x, pick.baseY + 3 + pick.heat * 5, f.z), { count: 2, color: '#3d3936', size: [3, 7], life: 3.4, speed: 1.2, up: 3.2, spread: 1.6, alpha: 0.42 })
      if (Math.random() < 0.5) fx.burst(tmp.set(f.x, pick.baseY + 1.5, f.z), { count: 4, color: ['#ffb347', '#ff7a1a', '#fff1a0'], speed: 2, up: 6, size: 0.25, life: 1.1, gravity: 2 })
    }
    for (const p of props) {
      if (!p.fire || p.state !== 'home' || Math.random() > dt * 2.5) continue
      fx.puff(tmp.copy(p.mesh.position).setY(p.mesh.position.y + p.half.y + 1), { count: 1, color: '#4a4644', size: [1, 2.5], life: 2, speed: 0.6, up: 2.2, spread: 0.3, alpha: 0.4 })
    }
  }
  function sounds(camera) {
    camera.getWorldPosition(camPos)
    if (count > 0) {
      let best = null
      let bd = Infinity
      for (const c of cells) {
        if (c.heat <= 0) continue
        const d = (c.cx - camPos.x) ** 2 + (c.cz - camPos.z) ** 2
        if (d < bd) {
          bd = d
          best = c
        }
      }
      if (!crackle) crackle = loop('fireplace', { x: best.cx, y: best.baseY + 2, z: best.cz })
      crackle.setPos(best.cx, best.baseY + 2, best.cz)
      crackle.setParam(Math.min(1, 0.35 + count / 10))
    } else if (crackle) {
      crackle.stop()
      crackle = null
    }
    if (count >= FIRE.alarmCells) {
      if (!alarm) alarm = loop('smokeAlarm', ALARM_POS)
    } else if (alarm) {
      alarm.stop()
      alarm = null
    }
  }

  return {
    cells,
    cellAt,
    seed,
    burst,
    douse,
    douseCone,
    heatAt,
    canSee,
    nearestReachable,
    pack,
    unpack,
    setLootFire,
    count: () => count,
    get inferno() {
      return inferno
    },
    get alarm() {
      return count >= FIRE.alarmCells
    },
    // share of the house burning right now (0..1)
    share: () => count / cells.length,
    reset() {
      for (const c of cells) {
        c.heat = 0
        c.ignite = 0
        c.fuel = c.fuel0
        c.char = 0
        c.wet = 0
        c.high = false
        c.baseY = 0
      }
      count = 0
      everBurned = 0
      inferno = false
      flames.count = 0
      chars.count = 0
      bucket.visible = false
      crackle?.stop()
      crackle = null
      alarm?.stop()
      alarm = null
    },
    // Per frame. authority: simulate the grid + loot; everyone: draw.
    update(dt, { authority, camera, props, active }) {
      time += dt
      if (!active) {
        if (flames.count || crackle || alarm) this.reset()
        return { inferno: false }
      }
      if (authority) {
        step(dt)
        lootStep(dt, props)
      } else {
        // crew: char creeps on while it burns (the host only sends coarse levels)
        for (const c of cells) if (c.heat > 0) c.char = Math.min(1, c.char + (dt * c.heat) / c.fuel0)
      }
      const wasInferno = inferno
      inferno = count / cells.length >= FIRE.wholeHouse
      drawFlames(camera, props)
      charT -= dt
      if (charT <= 0) {
        charT = 0.4
        drawChars()
      }
      smoke(dt, props)
      sounds(camera)
      return { inferno: inferno && !wasInferno }
    },
    // Up to n bright fire spots for the light pool, nearest the camera first.
    glowSpots(camera, n = 2) {
      if (!count) return []
      camera.getWorldPosition(camPos)
      return cells
        .filter((c) => c.heat > 0.25)
        .map((c) => ({ c, d: (c.cx - camPos.x) ** 2 + (c.cz - camPos.z) ** 2 }))
        .sort((a, b) => a.d - b.d)
        .slice(0, n)
        .map(({ c }) => ({ x: c.cx, y: c.baseY + 10, z: c.cz, power: 0.15 + 0.25 * c.heat, color: '#ff7a2a', room: c.room }))
    },
    // Grandpa's bucket in his hand (null hides it)
    setBucket(hand) {
      bucket.visible = !!hand
      if (hand) bucket.position.set(hand.x, hand.y - 0.9, hand.z)
    },
    // The splash of a bucket of water (all clients).
    splashFx(x, z) {
      const p = tmp.set(x, 1.5, z)
      sound('splash', p)
      fx.burst(p, { count: 46, color: ['#9fd8ff', '#ffffff', '#5fb0ff'], speed: 10, up: 7, size: 0.6, life: 0.9, gravity: -20 })
      fx.puff(tmp.set(x, 3, z), { count: 10, color: '#e8eef2', size: [2, 5], life: 2.2, speed: 2.5, up: 3, spread: 3, alpha: 0.5 })
      fx.ring(tmp.set(x, 0.3, z), '#9fd8ff', FIRE.bucket.radius, 0.7)
    },
    // The extinguisher's foam blast (all clients).
    sprayFx(o, dir, range) {
      const len = Math.hypot(dir.x, dir.y, dir.z) || 1
      sound('spray', o)
      for (let t = 1; t < range; t += 1.6) {
        const p = tmp.set(o.x + (dir.x / len) * t, o.y + (dir.y / len) * t, o.z + (dir.z / len) * t)
        fx.burst(p, { count: 6, color: ['#ffffff', '#eef6ff', '#dfe9f2'], speed: 2 + t * 0.2, up: 1, size: 0.5 + t * 0.06, life: 0.7, gravity: -6 })
      }
      fx.puff(tmp.set(o.x + (dir.x / len) * range * 0.6, o.y, o.z + (dir.z / len) * range * 0.6), { count: 8, color: '#f4f8fb', size: [1.5, 4], life: 1.6, speed: 2, up: 1, spread: 2.5, alpha: 0.55 })
    },
  }
}
