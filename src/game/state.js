// The player's progress: coins, upgrades, gadget inventory, stats, tutorial flag and prefs.
// The server's save is the only copy (net.js mirrors snapshot() to it and hydrates from it); a guest or
// offline session starts fresh every page load (nothing is stored in the browser).
import { GADGETS, STARTER_GADGETS, UPGRADES, UPGRADE_MAX, upgradePrice, GADGET_BY_ID } from '../config.js'

const freshUpgrades = () => Object.fromEntries(UPGRADES.map((u) => [u.id, 0]))
const freshStats = () => ({ heists: 0, escapes: 0, caught: 0, stolen: 0, earned: 0, bestHaul: 0, jobs: 0 })

export function createState() {
  const s = {
    coins: 0,
    upgrades: freshUpgrades(),
    gadgets: { ...STARTER_GADGETS },
    stats: freshStats(),
    tutorialDone: false,
    prefs: { music: true, sfx: true, lights: true },
    lastSeen: 0,
  }
  const saveListeners = []
  const changeListeners = []
  const changed = () => {
    for (const fn of changeListeners) fn(s)
  }
  const save = (flush = false) => {
    s.lastSeen = Date.now()
    for (const fn of saveListeners) fn(flush)
  }
  const num = (v, max = 1e12) => (Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0)

  const api = {
    data: s,
    onSave: (fn) => saveListeners.push(fn),
    onChange: (fn) => changeListeners.push(fn),
    save,
    snapshot() {
      return JSON.parse(JSON.stringify(s))
    },
    hydrate(doc = {}) {
      if (Number.isFinite(doc.coins)) s.coins = num(doc.coins)
      if (doc.upgrades) for (const u of UPGRADES) s.upgrades[u.id] = Math.min(UPGRADE_MAX, Math.floor(num(doc.upgrades[u.id] ?? 0)))
      if (doc.gadgets) {
        s.gadgets = {}
        for (const g of GADGETS) s.gadgets[g.id] = Math.min(99, Math.floor(num(doc.gadgets[g.id] ?? 0)))
      }
      if (doc.stats) for (const k of Object.keys(s.stats)) s.stats[k] = num(doc.stats[k] ?? s.stats[k])
      if (typeof doc.tutorialDone === 'boolean') s.tutorialDone = doc.tutorialDone
      if (doc.prefs) {
        s.prefs.music = doc.prefs.music !== false
        s.prefs.sfx = doc.prefs.sfx !== false
        s.prefs.lights = doc.prefs.lights !== false
      }
      changed()
    },
    earn(n) {
      s.coins = num(s.coins + Math.max(0, Math.round(n)))
      s.stats.earned = num(s.stats.earned + Math.max(0, Math.round(n)))
      changed()
      save()
    },
    // Coins that are not a heist haul (a rewarded ad): they never count toward the 'earned' stat / board.
    grant(n) {
      s.coins = num(s.coins + Math.max(0, Math.round(n)))
      changed()
      save(true)
    },
    spend(n) {
      if (s.coins < n) return false
      s.coins -= n
      changed()
      save(true)
      return true
    },
    buyGadget(id) {
      const g = GADGET_BY_ID[id]
      if (!g || (s.gadgets[id] ?? 0) >= 99 || !api.spend(g.price)) return false
      s.gadgets[id] = (s.gadgets[id] ?? 0) + 1
      changed()
      save(true)
      return true
    },
    addGadget(id, n = 1) {
      s.gadgets[id] = Math.min(99, (s.gadgets[id] ?? 0) + n)
      changed()
      save()
    },
    useGadget(id) {
      if ((s.gadgets[id] ?? 0) <= 0) return false
      s.gadgets[id]--
      changed()
      save()
      return true
    },
    buyUpgrade(id) {
      const u = UPGRADES.find((q) => q.id === id)
      const lvl = s.upgrades[id] ?? 0
      if (!u || lvl >= UPGRADE_MAX || !api.spend(upgradePrice(u, lvl))) return false
      s.upgrades[id] = lvl + 1
      changed()
      save(true)
      return true
    },
    // Record a finished heist: returns { best }.
    recordHeist({ escaped, haul, items, jobs }) {
      s.stats.heists++
      if (escaped) s.stats.escapes++
      else s.stats.caught++
      s.stats.stolen += items
      s.stats.jobs += jobs
      const best = escaped && haul > s.stats.bestHaul
      if (best) s.stats.bestHaul = haul
      changed()
      save(true)
      return { best }
    },
    setPref(key, on) {
      s.prefs[key] = !!on
      changed()
      save()
    },
    finishTutorial() {
      if (s.tutorialDone) return
      s.tutorialDone = true
      save()
    },
  }
  return api
}
