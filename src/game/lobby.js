// The Hideout: the crew's den (floorboards, brick and timber studs, a candle, string lights, matchbox
// benches, spools, a thimble, coins, a playing card). Three crew pads (all NORMAL) (bottle caps) with live signs, the
// Gadget Store and Upgrades stalls (walk onto their mats), a leaderboard billboard, and a glowing
// mouse-hole arch. Static, built once.
// Unlike the giant house, everything here is PLAYER-sized: the layout below is written in design units
// (the old giant den) and every length is multiplied by LOBBY.scale on the way into the world.
import { Color, CylinderGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, PointLight, TorusGeometry, Vector3, AdditiveBlending } from 'three'
import { DIFFICULTY, LOBBY } from '../config.js'
import { bake } from '../bake.js'
import { box, boxMM, canvasSign, cyl, dotTexture, emissive, groundDecal, infoLabel, metal, outlinedText, roundRect, solid, solidMM, sphere, surface } from './kit.js'
import { paintBrick, paintWoodFloor, paintFabric } from './paint.js'
import { RAPIER, world } from '../physics.js'
import { fmt } from './kit.js'

export function buildLobby(scene) {
  const S = LOBBY.scale
  const { x: cx, z: cz } = LOBBY.center
  // design units -> world metres
  const s = (v) => v * S
  const wx = (x) => cx + x * S
  const wz = (z) => cz + z * S
  // world-placed pieces (x / z relative to the centre, y from the floor, all in design units)
  const B = (parent, w, h, d, mat, x, y, z, o) => box(parent, s(w), s(h), s(d), mat, wx(x), s(y), wz(z), o)
  const BMM = (parent, x0, y0, z0, x1, y1, z1, mat, o) => boxMM(parent, wx(x0), s(y0), wz(z0), wx(x1), s(y1), wz(z1), mat, o)
  const C = (parent, rt, rb, h, mat, x, y, z, o) => cyl(parent, s(rt), s(rb), s(h), mat, wx(x), s(y), wz(z), o)
  // pieces inside a group placed in the world (local coordinates, design units)
  const lb = (parent, w, h, d, mat, x, y, z, o) => box(parent, s(w), s(h), s(d), mat, s(x), s(y), s(z), o)
  const lc = (parent, rt, rb, h, mat, x, y, z, o) => cyl(parent, s(rt), s(rb), s(h), mat, s(x), s(y), s(z), o)

  const hx = LOBBY.halfX / S
  const hz = LOBBY.halfZ / S
  const H = LOBBY.height / S
  const R = LOBBY.padRadius / S
  const g = new Group()
  const live = new Group()
  scene.add(live)
  const floor = surface('lob-floor', paintWoodFloor('#9a6a42', 4, 21), { tile: s(26), rough: 0.7, bump: 1 })
  const brick = surface('lob-brick', paintBrick('#9b5a44', '#cdbfa6'), { tile: s(9), rough: 0.9, bump: 1 })
  const timber = surface('lob-timber', paintWoodFloor('#7a5232', 2, 5), { tile: s(12), rough: 0.8, bump: 0.6 })
  // Floor, walls, ceiling + colliders.
  BMM(g, -hx - 2, -1, -hz - 2, hx + 2, 0, hz + 2, floor, { collide: true, cast: false })
  BMM(g, -hx - 2, 0, -hz - 2, hx + 2, H, -hz, brick, { collide: true })
  BMM(g, -hx - 2, 0, hz, hx + 2, H, hz + 2, brick, { collide: true })
  BMM(g, -hx - 2, 0, -hz, -hx, H, hz, brick, { collide: true })
  BMM(g, hx, 0, -hz, hx + 2, H, hz, brick, { collide: true })
  BMM(g, -hx - 2, H, -hz - 2, hx + 2, H + 2, hz + 2, timber, { collide: true })
  // Timber studs along the walls + ceiling beams.
  for (let x = -hx + 6; x < hx; x += 14) {
    BMM(g, x - 1, 0, -hz, x + 1, H, -hz + 2, timber)
    BMM(g, x - 1, 0, hz - 2, x + 1, H, hz, timber)
    BMM(g, x - 1.2, H - 2, -hz, x + 1.2, H, hz, timber)
  }
  // The mouse hole (glowing arch) in the back wall.
  {
    const arch = new Group()
    const glowMat = emissive('#fff0c8', 1.6, '#ffe6a8')
    lb(arch, 12, 9, 0.3, glowMat, 0, 4.5, 0)
    const top = new Mesh(new CylinderGeometry(s(6), s(6), s(0.3), 24, 1, false, 0, Math.PI), glowMat)
    top.rotation.x = Math.PI / 2
    top.rotation.z = Math.PI / 2
    top.position.y = s(9)
    arch.add(top)
    arch.position.set(cx, 0, wz(-hz + 0.2))
    g.add(arch)
    const rim = new Mesh(new TorusGeometry(s(6.3), s(0.5), 8, 24, Math.PI), timber)
    rim.position.set(cx, s(9), wz(-hz + 0.4))
    g.add(rim)
  }

  // --- Decor: everyday things at player scale ---
  // matchboxes (benches)
  for (const [x, z, r] of [[-30, 14, 0.2], [30, 16, -0.25], [-14, 26, 0]]) {
    B(g, 9, 3, 5, solid('#e8c46a', 0.7), x, 1.5, z, { collide: true }).rotation.y = r
    B(g, 9.05, 1.2, 5.05, solid('#c0392b', 0.6), x, 2, z).rotation.y = r
  }
  // spools of thread
  for (const [x, z, c] of [[-40, -10, '#ff6fa8'], [40, -8, '#3fb7ff'], [-41, 26, '#4dff8a']]) {
    C(g, 3.2, 3.2, 1, solid('#c8a070', 0.7), x, 0.5, z, { collide: true, seg: 24 })
    C(g, 2.8, 2.8, 6, solid(c, 0.95), x, 4, z, { collide: true, seg: 24 })
    C(g, 3.2, 3.2, 1, solid('#c8a070', 0.7), x, 7.5, z, { seg: 24 })
  }
  // thimble + coin stacks + a playing card + sugar cubes + buttons
  {
    C(g, 2.6, 3.2, 5.5, metal('#c9ccd2', 0.35), 36, 2.75, 26, { collide: true, seg: 22 })
    for (const [x, z, n] of [[-22, -18, 5], [24, -20, 7], [-6, 30, 3]]) {
      for (let i = 0; i < n; i++) C(g, 2.4, 2.4, 0.45, metal('#e0b44a', 0.3), x + (i % 2) * 0.2, 0.25 + i * 0.47, z, { seg: 24 })
      solidMM(wx(x - 2.4), 0, wz(z - 2.4), wx(x + 2.4), s(n * 0.47), wz(z + 2.4))
    }
    const card = canvasSign(s(10), s(14), 200, 280, (c, w, h) => {
      c.fillStyle = '#fffaf0'
      roundRect(c, 0, 0, w, h, 18)
      c.fill()
      c.fillStyle = '#d0262b'
      c.font = '700 70px Georgia, serif'
      c.fillText('A', 18, 72)
      c.font = '700 140px Georgia, serif'
      c.textAlign = 'center'
      c.fillText('♥', w / 2, h / 2 + 50)
    }, { emissiveBoost: 0.15 })
    card.mesh.position.set(wx(44.5), s(7), wz(-4))
    card.mesh.rotation.y = -Math.PI / 2 + 0.15
    card.mesh.rotation.z = 0.12
    g.add(card.mesh)
    for (let i = 0; i < 4; i++) B(g, 2.2, 2.2, 2.2, solid('#ffffff', 0.9), -38 + (i % 2) * 2.3, 1.1 + Math.floor(i / 2) * 2.2, -22, { collide: true })
    for (const [x, z, c] of [[-8, 16, '#ff6b5a'], [8, 18, '#3fb7ff'], [0, 24, '#ffd23f']]) {
      C(g, 2, 2, 0.8, solid(c, 0.4), x, 0.4, z, { collide: true, seg: 24 })
      for (let i = 0; i < 4; i++) C(g, 0.25, 0.25, 0.82, solid('#3a2a1a', 0.8), x + Math.cos(i * 1.57) * 0.6, 0.41, z + Math.sin(i * 1.57) * 0.6, { seg: 8, cast: false })
    }
  }
  // candle (a warm light). Lights keep their look at the smaller size: range x S, intensity x S^decay.
  const candlePos = new Vector3(wx(-42), 0, wz(0))
  C(g, 1.6, 1.8, 9, solid('#fff4e0', 0.6), -42, 4.5, 0, { collide: true, seg: 18 })
  C(g, 2.6, 2.6, 0.5, metal('#c9a447', 0.3), -42, 0.25, 0, { seg: 20 })
  const flame = new Mesh(new PlaneGeometry(s(1.2), s(2.2)), new MeshBasicMaterial({ map: dotTexture(), color: new Color(2.4, 1.6, 0.6), transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false }))
  flame.position.set(candlePos.x, s(10.3), candlePos.z)
  live.add(flame)
  const candleBase = 110 * S ** 1.6
  const candle = new PointLight('#ffb35c', candleBase, s(70), 1.6)
  candle.position.set(candlePos.x + s(2), s(12), candlePos.z)
  candle.userData.farCull = true // off while you are at the house (perf.js)
  live.add(candle)
  // string lights zig-zagging under the ceiling
  const bulbs = []
  const bulbCols = ['#ff6b8a', '#ffd23f', '#4dff8a', '#3fb7ff', '#b38cff']
  for (let i = 0; i < 26; i++) {
    const t = i / 25
    const x = -hx + 4 + t * (hx * 2 - 8)
    const z = Math.sin(t * Math.PI * 5) * (hz - 8)
    const b = sphere(live, s(0.45), emissive(bulbCols[i % 5], 2.2, bulbCols[i % 5]), wx(x), s(H - 4.5 - Math.abs(Math.sin(t * Math.PI * 10)) * 1.5), wz(z), { seg: 8 })
    bulbs.push(b)
  }
  const fill = new PointLight('#ffd9a8', 70 * S ** 1.4, s(120), 1.4)
  fill.position.set(cx, s(H - 6), wz(6))
  fill.userData.farCull = true
  live.add(fill)
  // rug under the pads
  const rug = surface('lob-rug', paintFabric('weave', '#3d4a8c', '#ffd23f'), { tile: s(8), rough: 1, bump: 0.3 })
  BMM(g, -38, 0.02, -24, 38, 0.12, -4, rug, { cast: false, collide: true })

  // --- Crew pads (bottle caps) ---
  const pads = LOBBY.pads.map((p, i) => {
    const d = DIFFICULTY[p.difficulty]
    const cap = new Group()
    const capMat = solid(d.color, 0.35, 0.4)
    lc(cap, R, R, 0.9, capMat, 0, 0.45, 0, { seg: 36 })
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2
      const tooth = lb(cap, 0.9, 1, 0.5, capMat, Math.cos(a) * (R + 0.1), 0.5, Math.sin(a) * (R + 0.1))
      tooth.rotation.y = -a
    }
    lc(cap, R - 1, R - 1, 0.1, solid('#ffffff', 0.5), 0, 0.95, 0, { seg: 36 })
    cap.position.set(p.x, 0, p.z)
    g.add(cap)
    world.createCollider(RAPIER.ColliderDesc.cylinder(s(0.5), LOBBY.padRadius).setTranslation(p.x, s(0.5), p.z))
    const ring = groundDecal(dotTexture(), d.color, LOBBY.padRadius * 2.9, 0.7)
    ring.position.set(p.x, s(1) + 0.04, p.z)
    live.add(ring)
    // sign above the pad
    const sign = canvasSign(s(10), s(5.6), 360, 200, () => {}, { emissiveBoost: 0.6 })
    sign.mesh.position.set(p.x, s(10.5), p.z)
    live.add(sign.mesh)
    cyl(g, s(0.25), s(0.25), s(8), metal('#c9ccd2', 0.4), p.x, s(4), p.z - s(0.6), { seg: 8 })
    const label = { count: -1, seconds: -1 }
    const paint = (count, seconds) => {
      if (label.count === count && label.seconds === seconds) return
      label.count = count
      label.seconds = seconds
      sign.setDraw((c, w, h) => {
        c.fillStyle = 'rgba(16,18,40,0.92)'
        roundRect(c, 4, 4, w - 8, h - 8, 26)
        c.fill()
        c.lineWidth = 8
        c.strokeStyle = d.color
        c.stroke()
        outlinedText(c, d.label, w / 2, 48, 46, d.color)
        outlinedText(c, `${count}/${LOBBY.padSize} THIEVES`, w / 2, 110, 38, '#ffffff')
        outlinedText(c, seconds > 0 ? `STARTING: ${seconds}s` : 'JOIN TO PLAY', w / 2, 158, 34, seconds > 0 ? '#9dff9d' : '#ffd23f')
      })
    }
    paint(0, 0)
    return { ...p, index: i, ring, sign, paint, d }
  })

  // --- Stalls: Gadget Store (west) and Upgrades (east) ---
  const stall = (x, z, title, color, rot) => {
    const p = new Vector3(wx(x), 0, wz(z))
    const st = new Group()
    lb(st, 12, 3.7, 5, solid('#e8c46a', 0.7), 0, 1.85, 0) // a matchbox counter (~1.1 m, waist high)
    lb(st, 12.05, 1.4, 5.05, solid(color, 0.55), 0, 2.8, 0)
    for (const sx of [-5.5, 5.5]) lb(st, 0.6, 10, 0.6, solid('#7a5232', 0.7), sx, 5, -2)
    lb(st, 13, 0.6, 6, solid(color, 0.55), 0, 10, -0.5) // awning
    const sign = canvasSign(s(11), s(3.2), 400, 116, (c, w, h) => {
      c.fillStyle = '#16122e'
      roundRect(c, 0, 0, w, h, 22)
      c.fill()
      outlinedText(c, title, w / 2, h / 2 + 4, 62, color)
    }, { emissiveBoost: 0.6 })
    sign.mesh.position.set(0, s(12), 0)
    st.add(sign.mesh)
    st.position.copy(p)
    st.rotation.y = rot
    g.add(st)
    world.createCollider(RAPIER.ColliderDesc.cuboid(s(6), s(1.85), s(2.5)).setTranslation(p.x, s(1.85), p.z).setRotation({ x: 0, y: Math.sin(rot / 2), z: 0, w: Math.cos(rot / 2) }))
    // the mat in front (walk on it to open the panel)
    const fwd = new Vector3(Math.sin(rot), 0, Math.cos(rot))
    const matPos = p.clone().addScaledVector(fwd, s(6.5))
    const mat = groundDecal(dotTexture(), color, s(9), 0.55)
    mat.position.set(matPos.x, 0.05, matPos.z)
    live.add(mat)
    return { pos: matPos, radius: s(4.5), mat }
  }
  const storeZone = stall(-34, 8, 'GADGETS', '#ffd23f', Math.PI / 2)
  const upgradeZone = stall(34, 8, 'UPGRADES', '#4dff8a', -Math.PI / 2)

  // --- Leaderboard billboard on the south wall ---
  const board = canvasSign(s(26), s(15), 520, 300, () => {}, { emissiveBoost: 0.45 })
  board.mesh.position.set(cx, s(11), wz(hz - 0.3))
  board.mesh.rotation.y = Math.PI
  live.add(board.mesh)
  BMM(g, -14, 2.5, hz - 0.2, 14, 19, hz, solid('#2a2f5a', 0.6))
  const drawBoard = (rows, title = 'TOP THIEVES') => {
    board.setDraw((c, w, h) => {
      const grd = c.createLinearGradient(0, 0, 0, h)
      grd.addColorStop(0, '#2b3a67')
      grd.addColorStop(1, '#141a33')
      c.fillStyle = grd
      roundRect(c, 0, 0, w, h, 24)
      c.fill()
      outlinedText(c, title, w / 2, 36, 40, '#ffd23f')
      c.font = '600 22px Fredoka, sans-serif'
      const list = rows.length ? rows : [{ name: 'No escapes yet!', value: '' }]
      list.slice(0, 8).forEach((r, i) => {
        const y = 82 + i * 27
        c.fillStyle = i % 2 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)'
        c.fillRect(20, y - 15, w - 40, 25)
        c.textAlign = 'left'
        c.fillStyle = ['#ffd23f', '#d8dde6', '#e0a070'][i] ?? '#ffffff'
        c.fillText(`#${i + 1}  ${String(r.name).slice(0, 20)}`, 30, y + 4)
        c.textAlign = 'right'
        c.fillStyle = '#9dff9d'
        c.fillText(typeof r.value === 'number' ? fmt(r.value) : r.value, w - 30, y + 4)
      })
    })
  }
  drawBoard([])

  // Welcome sign over the mouse hole.
  const welcome = infoLabel([{ text: 'THE HIDEOUT', size: 80, color: '#ffd23f' }, { text: 'Join a crew on a bottle cap!', size: 40, color: '#ffffff' }], s(0.035))
  welcome.position.set(cx, s(15), wz(-hz + 2.5))
  live.add(welcome)

  const baked = bake(g, true)
  baked.traverse((o) => {
    if (o.isMesh) o.receiveShadow = true
  })
  scene.add(baked)

  let t = 0
  return {
    pads,
    storeZone,
    upgradeZone,
    // `power` scales the game's lamp-pool light (game.js) to the hideout's size
    lamps: [{ x: candlePos.x, y: s(12), z: candlePos.z, power: S ** 1.4 }, { x: cx, y: s(H - 6), z: wz(6), power: S ** 1.4 }],
    drawBoard,
    // Which pad (index) a point stands on, or -1.
    padAt(p) {
      for (const pad of pads) if (Math.hypot(p.x - pad.x, p.z - pad.z) < LOBBY.padRadius + 0.3 && p.y < 3) return pad.index
      return -1
    },
    inside: (p) => Math.abs(p.x - cx) < LOBBY.halfX + 2 && Math.abs(p.z - cz) < LOBBY.halfZ + 2,
    update(dt, padViews, myPad) {
      t += dt
      flame.scale.set(1 + Math.sin(t * 13) * 0.08, 1 + Math.sin(t * 9) * 0.12, 1)
      candle.intensity = candleBase * (1 + Math.sin(t * 11) * 0.09 + Math.sin(t * 23) * 0.055)
      bulbs.forEach((b, i) => (b.material.emissiveIntensity = 1.6 + Math.sin(t * 2 + i) * 0.8))
      pads.forEach((pad, i) => {
        const v = padViews?.[i] ?? { count: 0, seconds: 0 }
        pad.paint(v.count, v.seconds)
        pad.ring.material.opacity = 0.45 + Math.sin(t * 3 + i) * 0.2 + (myPad === i ? 0.3 : 0)
      })
      storeZone.mat.material.opacity = 0.4 + Math.sin(t * 2.5) * 0.15
      upgradeZone.mat.material.opacity = 0.4 + Math.sin(t * 2.5 + 1) * 0.15
    },
  }
}
