// The other players in the room (net.js -> server roster): each one is a character like the local
// player's, dressed in their Bloxity look, animated by the same procedural animator (driven by their
// reported speed / grounded flag), playing their portal emote, showing their chat bubbles, with a name
// tag. Game body state comes with the pose and is drawn with the local player's code: the stretchy
// grabber arms reaching to their grab point, the sneak crouch, dangling from Grandpa's hand
// (game/bodyPose.js, game/grab.js makeArms). Only players in the viewer's zone (the lobby, or the same
// heist) and within NET.remoteRange are drawn. Nothing here is trusted for gameplay.
import * as THREE from 'three'
import { Group, Vector3 } from 'three'
import { NET, PLAYER_DIMS } from '../config.js'
import * as bloxity from '../bloxity.js'
import { buildDefaultCharacter } from './character.js'
import { buildLook } from './look.js'
import { AVATAR_SLOTS } from './cdn.js'
import { disposeAnimator, makeAnimator } from './animator.js'
import { createEmotePlayer } from './emotes.js'
import { infoLabel } from '../game/kit.js'
import { makeArms } from '../game/grab.js'
import { applyBodyPose } from '../game/bodyPose.js'

// A look arrives from another client: only known slot keys and slug-shaped ids get through, since an id
// ends up inside an asset URL. Anything else is dropped (= nothing equipped in that slot).
const LOOK_KEYS = new Set([...AVATAR_SLOTS.map((s) => s.key), 'skinId', 'pantsId', 'shirtId', 'faceId', 'characterId'])
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/
export function parseLook(json) {
  if (typeof json !== 'string' || !json) return null
  try {
    const raw = JSON.parse(json)
    const equipped = {}
    for (const [key, value] of Object.entries(raw?.equipped ?? {})) {
      if (!LOOK_KEYS.has(key)) continue
      const v = typeof value === 'number' ? String(value) : value
      if (typeof v === 'string' && SAFE_ID.test(v)) equipped[key] = v
    }
    const proportions = {}
    for (const [key, value] of Object.entries(raw?.proportions ?? {})) if (typeof value === 'number' && Number.isFinite(value)) proportions[key] = value
    return { equipped, proportions }
  } catch {
    return null
  }
}

const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a))
const TAG_HEIGHT = PLAYER_DIMS.height + NET.remoteNameHeight
const UP = new Vector3(0, 1, 0)

class Remote {
  constructor(root, armsRoot) {
    this.root = root
    this.group = new Group()
    this.group.visible = false // shown once the player is near
    root.add(this.group)
    this.arms = makeArms(armsRoot)
    this.avatar = null
    this.animator = null
    this.emotes = createEmotePlayer()
    this.pos = new Vector3()
    this.grabPt = new Vector3()
    this.prevY = 0
    this.yaw = 0
    this.placed = false
    this.near = false
    this.age = 0
    this.lookKey = null
    this.lookGen = 0
    this.emoteId = ''
    this.userId = ''
    this.bubble = null
    this.bubbleTimer = 0
    this.tag = infoLabel([{ text: '', size: 40, color: '#ffffff' }], 0.011)
    this.tag.position.y = TAG_HEIGHT
    this.group.add(this.tag)
    this.setAvatar(buildDefaultCharacter())
  }

  setAvatar(next) {
    if (this.avatar) this.group.remove(this.avatar)
    disposeAnimator(this.animator)
    this.avatar = next
    this.group.add(next)
    this.animator = makeAnimator(next)
    this.emotes.setAvatar(next, this.animator)
  }

  async loadLook(json) {
    const mine = ++this.lookGen
    const look = parseLook(json)
    try {
      const group = await buildLook({ equipped: look?.equipped ?? null, proportions: look?.proportions })
      if (mine !== this.lookGen) return
      this.setAvatar(group)
    } catch (err) {
      console.warn('[remote] could not build the look', err)
    }
  }

  hide() {
    this.group.visible = false
    this.arms.hide()
    if (this.placed) {
      this.placed = false
      this.emoteId = ''
      this.emotes.stop()
    }
  }

  update(p, dt, viewer, zone) {
    this.userId = p.userId || ''
    this.id = p.id
    const sameZone = (p.zone || 'lobby') === zone
    const dist = Math.hypot(p.x - viewer.x, p.y - viewer.y, p.z - viewer.z)
    this.near = sameZone && !p.out && dist <= NET.remoteRange + (this.near ? NET.remoteRangeSlack : 0)
    if (!this.near) return this.hide()
    this.group.visible = true
    this.age += dt

    if (p.avatar !== this.lookKey) {
      this.lookKey = p.avatar
      void this.loadLook(p.avatar)
    }
    const name = p.username || 'Thief'
    if (this.tag.userData.name !== name) {
      this.tag.userData.name = name
      this.tag.setLines([{ text: name, size: 40, color: '#ffffff' }])
    }
    if (p.emote !== this.emoteId) {
      this.emoteId = p.emote
      void this.emotes.play(p.emote)
    }

    const dx = p.x - this.pos.x
    const dy = p.y - this.pos.y
    const dz = p.z - this.pos.z
    if (!this.placed || Math.hypot(dx, dy, dz) > NET.remoteSnap) {
      this.pos.set(p.x, p.y, p.z)
      this.yaw = p.yaw
      this.prevY = p.y
      this.placed = true
    } else {
      const k = 1 - Math.exp(-NET.remoteLerp * dt)
      this.pos.x += dx * k
      this.pos.y += dy * k
      this.pos.z += dz * k
      this.yaw += wrapAngle(p.yaw - this.yaw) * k
    }
    this.group.position.copy(this.pos)
    this.group.rotation.y = this.yaw
    const vy = dt > 0 ? (this.pos.y - this.prevY) / dt : 0
    this.prevY = this.pos.y
    this.animator?.update(dt, { grounded: p.grounded || p.held, speed: p.held ? 0 : p.speed, verticalVelocity: p.held ? 0 : vy, turn: 0 })
    this.emotes.update(dt, p.speed, p.grounded)
    applyBodyPose(this.animator?.rig, this.avatar, { grab: p.grab, crouch: p.crouch, held: p.held, t: this.age })
    this.tag.position.y = p.crouch ? TAG_HEIGHT - 0.6 : TAG_HEIGHT

    // stretchy arms to their grab point
    if (p.grab && !p.held) {
      const k = 1 - Math.exp(-18 * dt)
      if (this.grabPt.lengthSq() === 0) this.grabPt.set(p.gx, p.gy, p.gz)
      else this.grabPt.lerp(new Vector3(p.gx, p.gy, p.gz), k)
      const f = this.yaw
      const rx = Math.cos(f)
      const rz = -Math.sin(f)
      const y = this.pos.y + (p.crouch ? 0.8 : 1.33)
      const shL = new Vector3(this.pos.x - rx * 0.42 + Math.sin(f) * 0.35, y, this.pos.z - rz * 0.42 + Math.cos(f) * 0.35)
      const shR = new Vector3(this.pos.x + rx * 0.42 + Math.sin(f) * 0.35, y, this.pos.z + rz * 0.42 + Math.cos(f) * 0.35)
      const side = new Vector3().subVectors(this.grabPt, this.pos).cross(UP).normalize().multiplyScalar(0.28)
      this.arms.update(shL, shR, this.grabPt.clone().sub(side), this.grabPt.clone().add(side), 0, this.age)
    } else {
      this.grabPt.set(0, 0, 0)
      this.arms.hide()
    }
  }

  say(text, seconds) {
    this.bubble?.remove?.()
    clearTimeout(this.bubbleTimer)
    this.bubble = bloxity.attachBubble(THREE, this.group, text)
    this.bubbleTimer = setTimeout(() => {
      this.bubble?.remove?.()
      this.bubble = null
    }, seconds * 1000)
  }

  dispose() {
    this.lookGen++
    this.bubble?.remove?.()
    clearTimeout(this.bubbleTimer)
    this.emotes.stop()
    disposeAnimator(this.animator)
    this.tag.dispose()
    this.arms.hide()
    this.arms.root.parent?.remove(this.arms.root)
    this.root.remove(this.group)
  }
}

export function createRemotePlayers(scene) {
  const root = new Group()
  scene.add(root)
  const remotes = new Map() // sessionId -> Remote

  return {
    // `players` = the roster (MapSchema, null when offline), `mine` = this session id, `viewer` = the
    // local player's feet, `zone` = the local player's zone ("lobby" or "h<pad>").
    update(dt, players, mine, viewer, zone = 'lobby') {
      if (!players) {
        for (const r of remotes.values()) r.dispose()
        remotes.clear()
        return
      }
      const seen = new Set()
      players.forEach((p, id) => {
        if (id === mine) return
        seen.add(id)
        let r = remotes.get(id)
        if (!r) remotes.set(id, (r = new Remote(root, scene)))
        r.update(p, dt, viewer, zone)
      })
      for (const [id, r] of remotes) {
        if (seen.has(id)) continue
        r.dispose()
        remotes.delete(id)
      }
    },
    say(userId, text) {
      if (!userId) return false
      for (const r of remotes.values()) {
        if (r.userId !== userId) continue
        r.say(text, bloxity.chatBubbleSeconds())
        return true
      }
      return false
    },
    // Where a drawn remote is (spectating follows it).
    position(id) {
      for (const [sid, r] of remotes) if (sid === id && r.near) return r.pos
      return null
    },
    get count() {
      return remotes.size
    },
  }
}
