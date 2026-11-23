// Builds the character a Bloxity look describes, for the local player and for remote players alike:
//   1. a custom (uploaded) character when `characterId` is worn and the SDK can resolve it,
//   2. otherwise the regular avatar: player.glb + skin texture + body parts + accessories + proportions.
// Never throws and never returns nothing: any failure falls back toward the regular / default avatar.
import { characterAccessoryMatrix, getCharacter, getCharacterFor, getSkinTextureUrl, getSkinTextureUrlFor } from '../bloxity.js'
import { isEquipped } from './cdn.js'
import { loadBaseCharacter, loadCustomCharacter } from './character.js'
import { applyProportions, attachCharacterAccessories, attachEquippedAccessories } from './loader.js'

// local: this player's own look (equipped / proportions come from the SDK getters already read by the
// caller); remote: a look that arrived over the network (ids only).
export async function buildLook({ equipped, proportions, local = false }) {
  if (equipped && (local || isEquipped(equipped.characterId))) {
    const character = local ? await getCharacter() : await getCharacterFor(equipped)
    if (character) {
      const custom = await loadCustomCharacter(character.glbUrl)
      if (custom) {
        await attachCharacterAccessories(custom, equipped, character, characterAccessoryMatrix)
        return custom
      }
    }
  }
  const group = await loadBaseCharacter()
  if (equipped) {
    await attachEquippedAccessories(group, equipped, { skinTextureUrl: local ? getSkinTextureUrl() : getSkinTextureUrlFor(equipped) })
    applyProportions(group, proportions)
  }
  return group
}
