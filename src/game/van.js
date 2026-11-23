// The getaway van on the driveway: a chunky retro van (our own design: two-tone mint and cream with a
// lightning stripe) towing an open trailer where stolen loot piles up. Its side door glows once the
// crew has enough cash: walking into the glow escapes. A floating label shows "$720 TO ESCAPE".
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, AdditiveBlending, Vector3 } from 'three'
import { VAN } from '../config.js'
import { box, canvasSign, cyl, dotTexture, emissive, glass, groundDecal, infoLabel, metal, outlinedText, roundRect, solid, solidCuboid, sphere } from './kit.js'
import { fmt } from './kit.js'

export function buildVan(scene) {
  const g = new Group()
  const mint = solid('#7fd6c2', 0.35, 0.25)
  const cream = solid('#fff3d6', 0.4, 0.1)
  const tire = solid('#1f2024', 0.85)
  const chrome = metal('#d6dbe0', 0.2)
  // Body (van faces +Z toward the street; local X = its right side).
  box(g, 10, 5.5, 22, mint, 0, 4.6, 0, { round: 1.2 })
  box(g, 10.05, 3.2, 22.05, cream, 0, 8.6, -1, { round: 1 })
  box(g, 9.4, 1.4, 21, cream, 0, 10.4, -1.5, { round: 0.6 }) // roof
  // lightning stripe
  const stripe = canvasSign(20, 2.2, 400, 44, (c, w, h) => {
    c.fillStyle = '#ffd23f'
    c.beginPath()
    c.moveTo(0, h * 0.35)
    for (let i = 0; i <= 8; i++) c.lineTo((i / 8) * w, i % 2 ? h * 0.15 : h * 0.85)
    c.lineTo(w, h * 0.65)
    for (let i = 8; i >= 0; i--) c.lineTo((i / 8) * w, i % 2 ? h * 0.45 : h * 1)
    c.closePath()
    c.fill()
  }, { emissiveBoost: 0.2, transparent: true })
  for (const s of [-1, 1]) {
    const m = stripe.mesh.clone()
    m.position.set(s * 5.06, 5.8, 0)
    m.rotation.y = s * Math.PI / 2
    g.add(m)
  }
  // windscreen + side windows
  box(g, 8.6, 2.6, 0.2, glass('#9cc3d8', 0.55), 0, 8.6, 10.95)
  for (const s of [-1, 1]) for (const z of [4, -2, -8]) box(g, 0.2, 2.2, 4.2, glass('#9cc3d8', 0.55), s * 5.06, 8.7, z)
  // bumpers, lights, grille
  box(g, 10.4, 1.1, 1, chrome, 0, 2, 11.2, { round: 0.3 })
  box(g, 10.4, 1.1, 1, chrome, 0, 2, -11.2, { round: 0.3 })
  for (const s of [-1, 1]) {
    sphere(g, 0.75, emissive('#fff6d8', 1.2, '#ffffff'), s * 3.6, 4.4, 11.1, { seg: 12 })
    sphere(g, 0.6, emissive('#ff4a3a', 0.8, '#a01010'), s * 4, 4.4, -11.1, { seg: 10 })
  }
  box(g, 4.5, 1.6, 0.3, chrome, 0, 4.2, 11.1)
  // wheels
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const t = cyl(g, 2, 2, 1.5, tire, sx * 4.6, 2, sz * 7, { seg: 20 })
      t.rotation.z = Math.PI / 2
      const h = cyl(g, 1, 1, 1.6, chrome, sx * 4.6, 2, sz * 7, { seg: 14 })
      h.rotation.z = Math.PI / 2
    }
  // sliding side door (right side, +X): outline
  box(g, 0.15, 6.2, 5.4, solid('#6ac5b0', 0.4), 5.08, 6.2, 1)
  box(g, 0.3, 0.4, 1.6, chrome, 5.2, 6.4, 3)
  // Trailer behind (toward -Z), open top.
  const tr = new Group()
  const wood = solid('#a8763f', 0.8)
  box(tr, 9, 0.8, 11, solid('#5b6470', 0.5, 0.4), 0, 2.6, 0)
  for (const s of [-1, 1]) box(tr, 0.5, 2.4, 11, wood, s * 4.25, 4.2, 0)
  box(tr, 9, 2.4, 0.5, wood, 0, 4.2, -5.25)
  box(tr, 9, 2.4, 0.5, wood, 0, 4.2, 5.25)
  for (const s of [-1, 1]) {
    const t = cyl(tr, 1.6, 1.6, 1.2, tire, s * 4.9, 1.6, 0, { seg: 18 })
    t.rotation.z = Math.PI / 2
  }
  box(tr, 0.6, 0.6, 4, metal('#55606b', 0.4), 0, 2.2, 7)
  tr.position.set(0, 0, -17)
  g.add(tr)

  g.position.set(VAN.x, 0, VAN.z)
  scene.add(g)
  // colliders (world space; the van faces +Z so no rotation needed)
  solidCuboid(5, 5.5, 11, VAN.x, 5.5, VAN.z)
  solidCuboid(4.5, 1.6, 5.5, VAN.x, 1.6, VAN.z - 17)
  for (const s of [-1, 1]) solidCuboid(0.25, 1.2, 5.5, VAN.x + s * 4.25, 4.2, VAN.z - 17)
  solidCuboid(4.5, 1.2, 0.25, VAN.x, 4.2, VAN.z - 22.25)
  solidCuboid(4.5, 1.2, 0.25, VAN.x, 4.2, VAN.z - 11.75)

  // Escape glow at the side door + label.
  const door = new Vector3(VAN.x + 8.2, 0, VAN.z + 1)
  const glow = groundDecal(dotTexture(), '#4dff8a', VAN.escapeRadius * 3, 0)
  glow.position.set(door.x, 0.2, door.z)
  scene.add(glow)
  const beam = new Mesh(new PlaneGeometry(6, 14), new MeshBasicMaterial({ map: dotTexture(), color: '#4dff8a', transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: 2 }))
  beam.position.set(door.x, 7, door.z)
  scene.add(beam)
  const label = infoLabel([{ text: '$1,000 TO ESCAPE', size: 64, color: '#ffffff' }], 0.035)
  label.position.set(VAN.x, 15, VAN.z)
  scene.add(label)
  let ready = false
  let t = 0
  void roundRect
  void outlinedText
  return {
    door,
    trailer: { x: VAN.x, z: VAN.z - 17, y: 3 },
    setMoney(m, target) {
      const left = Math.max(0, target - m)
      ready = left <= 0
      label.setLines(ready ? [{ text: 'ESCAPE HERE!', size: 72, color: '#4dff8a' }] : [{ text: `$${fmt(left)} TO ESCAPE`, size: 64, color: '#ffffff' }])
    },
    get ready() {
      return ready
    },
    near(p) {
      return Math.hypot(p.x - door.x, p.z - door.z) < VAN.escapeRadius
    },
    update(dt) {
      t += dt
      glow.material.opacity = ready ? 0.55 + Math.sin(t * 4) * 0.25 : 0
      beam.material.opacity = ready ? 0.35 + Math.sin(t * 4) * 0.15 : 0
      beam.lookAt(beam.position.x + Math.sin(t) * 0.001, beam.position.y, beam.position.z + 1)
    },
  }
}
