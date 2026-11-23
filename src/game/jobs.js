// Jobs: 6 per heist (seeded, the same for the whole crew), tracked by the authority and mirrored to the
// crew in the host snapshot. Done jobs add their bonus to the crew bank (heist.js) and coins at the end.
import { JOBS, JOBS_PER_HEIST, ROOMS } from '../config.js'
import { rng } from './kit.js'

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

export function createJobs(hooks = {}) {
  let list = []

  function roll(seed, crewSize = 1) {
    const r = rng(seed ^ 0x10b5)
    const pool = JOBS.filter((j) => !j.crewOnly || crewSize > 1)
    const timed = r.shuffle(pool.filter((j) => j.kind === 'stealCount'))[0]
    const steal = r.shuffle(pool.filter((j) => j.kind === 'stealRoom' || j.kind === 'stealValue'))[0]
    const rest = r.shuffle(pool.filter((j) => j !== timed && j !== steal && j.kind !== 'stealCount'))
    const picked = [timed, steal, ...rest].slice(0, JOBS_PER_HEIST)
    const rooms = ROOMS.filter((q) => q.id !== 'study' && q.id !== 'hallway')
    list = picked.map((def) => {
      const room = def.kind === 'stealRoom' ? r.pick(rooms) : null
      return {
        def,
        room: room?.id ?? null,
        text: def.text.replace('{ROOM}', room?.name ?? ''),
        n: def.n ?? 1,
        count: 0,
        done: false,
        failed: false,
        time: def.time ?? 0,
      }
    })
  }

  function progress(j, add = 1) {
    if (j.done || j.failed) return
    j.count = Math.min(j.n, j.count + add)
    if (j.count >= j.n) {
      j.done = true
      hooks.done?.(j)
    }
  }

  return {
    roll,
    get list() {
      return list
    },
    onSteal(prop) {
      for (const j of list) {
        const k = j.def.kind
        if (k === 'stealCount') progress(j)
        else if (k === 'stealRoom' && prop.room === j.room) progress(j)
        else if (k === 'stealValue' && prop.value >= j.def.n) progress(j, j.n)
        else if (k === 'stealTreasure' && prop.def.treasure) progress(j, j.n)
      }
    },
    onTrap(kind) {
      for (const j of list) if (j.def.kind === 'trap' && j.def.trap === kind) progress(j, j.n)
    },
    onEvent(kind) {
      for (const j of list) if (j.def.kind === 'event' && j.def.event === kind) progress(j, j.n)
    },
    update(dt) {
      for (const j of list) {
        if (j.def.kind !== 'stealCount' || j.done || j.failed) continue
        j.time = Math.max(0, j.time - dt)
        if (j.time <= 0) {
          j.failed = true
          hooks.failed?.(j)
        }
      }
    },
    doneCount: () => list.filter((j) => j.done).length,
    view() {
      return list.map((j) => {
        let p = ''
        if (j.def.kind === 'stealCount') p = j.done ? '' : `${fmtTime(j.time)}`
        else if (j.n > 1) p = `${j.count}/${j.n}`
        return { text: j.def.kind === 'stealCount' && !j.done && !j.failed ? `${j.text} (${j.count}/${j.n})` : j.text, progress: p, done: j.done, failed: j.failed }
      })
    },
    // Network mirror (host -> crew).
    pack: () => list.map((j) => [j.count, j.done ? 1 : 0, j.failed ? 1 : 0, Math.round(j.time)]),
    unpack(arr) {
      if (!Array.isArray(arr)) return
      arr.forEach(([count, done, failed, time], i) => {
        const j = list[i]
        if (!j) return
        const was = j.done
        j.count = count
        j.done = !!done
        j.failed = !!failed
        j.time = time
        if (!was && j.done) hooks.done?.(j, true)
      })
    },
  }
}
