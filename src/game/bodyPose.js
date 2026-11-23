// What a thief's body does besides walking: arms out while the stretchy grabber arms are holding
// something, a deep sneak crouch, and kicking + flailing while dangling from Grandpa's hand. Applied
// after the animator's pose, to the local player and to every other player's character alike.
import { Quaternion } from 'three'
import { BONE_INDEX } from '../avatar/rig.js'

const qa = new Quaternion()
const qb = new Quaternion()
const I = (name) => BONE_INDEX[name] * 3

// rig = animator.rig, avatar = the character root, s = { grab, crouch, held, t }
export function applyBodyPose(rig, avatar, s) {
  if (!rig) return
  const { grab = false, crouch = false, held = false, t = 0 } = s
  if (!grab && !crouch && !held) return
  for (const b of rig.bindings) {
    let x = 0
    let z = 0
    const i = b.index
    if (held) {
      if (i === I('ArmL1')) {
        x = -2.6 + Math.sin(t * 14) * 0.5
        z = -0.4
      } else if (i === I('ArmR1')) {
        x = -2.6 - Math.sin(t * 14) * 0.5
        z = 0.4
      } else if (i === I('LegL1')) x = Math.sin(t * 16) * 0.7
      else if (i === I('LegR1')) x = -Math.sin(t * 16) * 0.7
      else if (i === I('LegL2') || i === I('LegR2')) x = 0.6
    } else {
      if (grab && (i === I('ArmL1') || i === I('ArmR1'))) {
        x = -1.45
        z = i === I('ArmL1') ? 0.12 : -0.12
      }
      if (crouch) {
        if (i === I('LegL1') || i === I('LegR1')) x += -1.15
        else if (i === I('LegL2') || i === I('LegR2')) x += 1.75
        else if (i === I('Spine1')) x += 0.42
        else if (i === I('Neck1')) x += -0.3
      }
    }
    if (x === 0 && z === 0) continue
    qa.setFromAxisAngle(b.axisX, x)
    if (z) qa.premultiply(qb.setFromAxisAngle(b.axisZ, z))
    b.bone.quaternion.premultiply(qa)
  }
  if (crouch && !held && avatar) avatar.position.y -= 0.55
}
