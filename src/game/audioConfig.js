// Every audio tunable for sfx.js (effects + ambience) and music.js (adaptive score). Levels are linear
// gains; times are seconds. Nothing else in the audio code holds a magic number worth tuning.

export const AUDIO = {
  // master gain at volume 1 (setVolume scales it); the portal's default volume before setVolume
  master: 0.9,
  defaultVolume: 0.8,
  // mix buses (effects only: music has its own level in MUSIC)
  bus: { ui: 0.55, world: 0.9, grandpa: 1.0, ambience: 0.42 },
  // glue compressor + brickwall-ish limiter on the master: stacked hits never clip into crackle
  compressor: { threshold: -12, knee: 8, ratio: 3, attack: 0.006, release: 0.25 },
  limiter: { threshold: -2, knee: 0, ratio: 20, attack: 0.001, release: 0.08 },

  // generated convolution reverb, fed from the world + grandpa buses (send level per zone, scaled by
  // the room inside the house: tiled bathroom / bare garage ring more, the soft bedroom less)
  reverb: {
    seconds: 2.8,
    preDelay: 0.018,
    send: { lobby: 0.2, yard: 0.05, house: 0.4, none: 0.1 },
    room: { kitchen: 1, bathroom: 1.4, bedroom: 0.7, hallway: 1.1, living: 0.85, garage: 1.3, study: 0.95 },
    glide: 0.35, // time constant of send changes
  },

  // Voice budget: every one-shot oscillator / noise / sample source counts until it ends. Over the cap
  // new one-shots are dropped (that is what keeps the audio thread from crackling). Low-priority sounds
  // (hover, footsteps, creaks) give up at lowPrio x cap, important ones (stingers, Grandpa) may use up
  // to highPrio x cap, and individual partials are dropped past hard x cap.
  voices: { desktop: 130, mobile: 64, lowPrio: 0.6, highPrio: 1.25, hard: 1.35 },
  maxLoops: 24, // simultaneously built loop handles (more stay dormant until one stops)
  minorYield: 0.15, // minor UI blips are skipped this long after a major sound
  pitchJitter: 0.035, // +- random pitch per call so repeats never sound identical

  // 3D: PannerNode panning model, distance classes, distance fade + air absorption.
  // Inverse distance law (full level inside `ref`), then a fade over the last `fadeFrac` of `range`
  // to silence (sounds beyond range are not even started) and a lowpass that closes toward
  // `airAtRange` Hz at the range edge (distant sounds are duller).
  panning: { desktop: 'HRTF', mobile: 'equalpower' },
  rolloff: 1,
  fadeFrac: 0.3,
  airAtRange: 2200,
  dist: {
    tiny: { ref: 1.5, range: 18 }, // footsteps of other thieves, creaks
    small: { ref: 2.5, range: 25 }, // a dropped spoon
    medium: { ref: 4, range: 40 }, // doors, gadgets, crashes
    big: { ref: 7, range: 60 }, // Grandpa's steps and voice
    huge: { ref: 10, range: 85 }, // alarm bell, bazooka, the big body crash
  },
  // impacts / landings / Grandpa steps reach further with strength: range x (base + span x strength)
  strengthRange: { base: 0.65, span: 0.7 },

  // Grandpa's voice: formant scale (< 1 = bigger vocal tract), pitch multiplier, overall voice level
  grandpa: { formant: 0.84, pitch: 1, voice: 0.5 },

  // Minimum re-trigger gap per sound (s). Impacts / steps are keyed per material so two different
  // materials can land together. Grandpa voice lines also never overlap (lower-rank lines wait).
  gaps: {
    click: 0.04, hover: 0.06, open: 0.1, close: 0.1, buy: 0.15, error: 0.2, toast: 0.25, countdown: 0.2,
    go: 1, jobDone: 0.5, coins: 0.2, register: 0.3, levelUp: 0.8, struggle: 0.05, breakFree: 0.5,
    step: 0.05, jump: 0.1, land: 0.12, grab: 0.08, release: 0.08, throw: 0.1, stretch: 0.12, crouch: 0.15,
    pickup: 0.1, collect: 0.06,
    impact: 0.03, shatter: 0.06, squeak: 0.1, coinBurst: 0.2, tvBreak: 0.5,
    gpStep: 0.12, gpMumble: 1, gpHmm: 0.8, gpHuh: 0.8, gpShout: 1, gpGotcha: 1.2, gpOuch: 0.4, gpSlip: 1,
    gpGrunt: 0.5, gpYawn: 2, gpSnore: 1.5, gpGrumble: 1.5, gpCaneTap: 0.12,
    doorSlam: 0.25, doorClick: 0.1, garageClunk: 0.3, windowThud: 0.2, flush: 3, thermostat: 0.5, toasterArm: 0.3, toasterPop: 0.5, fanCord: 0.2, phoneDial: 1, phonePickup: 0.3, lightSwitch: 0.08,
    secretDoor: 2, safeOpen: 1.5, cageClose: 0.4, cageOpen: 0.4, fireCrackle: 0.1, clockChime: 3,
    marbles: 0.3, glue: 0.3, banana: 0.2, alarmSmash: 0.5, smoke: 0.5, potion: 0.4, sleepZ: 0.6, xrayOn: 0.5,
    drink: 1, bazookaFire: 0.3, foamBoom: 0.3, stars: 0.8,
    spotted: 0.6, lost: 0.8, caught: 1.5, escape: 1.2, vanDoor: 0.5, heartbeat: 0.2,
  },

  // automatic ambience beds (frame), crossfaded by env.zone / env.indoorMix
  ambience: {
    fade: 0.6, // time constant of bed crossfades
    // yard.level: the outdoor bed (breeze, hum, birds, cars) is off; the music carries the outside
    yard: { level: 0, breeze: 0.38, leaves: 0.06, hum: 0.22, birds: [1.2, 4.5], birdLevel: 0.55, cars: [14, 32], carLevel: 0.16, muffled: 650 },
    house: { tone: 0.32, mains: 0.012, clock: 0.16, clockPeriod: 1.05, fridge: 0.2 },
    // lobby.level: the hideout bed (room tone, candle, TV, creaks, laughs) is off; only the music plays there
    lobby: { level: 0, tone: 0.2, candle: 0.05, creaks: [5, 13], creakLevel: 0.25, tv: 0.14, laughs: [16, 40], laughLevel: 0.1, wall: 520 },
    danger: { heart: 0.55, drone: 0.1, minBpm: 64, maxBpm: 148, threshold: 0.04 },
  },
}

// Adaptive score (music.js). Two groups share one transport each: 'home' (F major: lobby, results)
// and 'heist' (D minor: sneak, suspicious, chase, held). Inside a group, moods only change layer
// weights + tempo, which glide step by step, so the score turns without restarting.
export const MUSIC = {
  level: 0.5, // loop level into the master (kept modest under the SFX)
  stingLevel: 0.62,
  reverb: 0.2, // send into the shared reverb
  lookahead: 0.25, // s of notes booked ahead on ctx.currentTime
  glide: 0.12, // per 16th: how far layer weights move toward the mood (crossfade speed)
  tempoGlide: 0.08,
  fadeIn: 1.6, // a group starting
  fadeOut: 1.2, // a group stopping (mood 'off' or the other group taking over)
  gap: 0.6, // delay before a new group starts after another one fades
  stingGap: 0.8,
  // per stinger: [loop level while ducked (x), duck length (s)]
  duck: { start: [0.3, 1.5], spotted: [0.35, 1.4], lost: [0.6, 1.4], caught: [0.25, 2.6], escape: [0.25, 2.8], job: [0.6, 1.2] },
  moods: {
    // home group (F major)
    lobby: { bpm: 100, swing: 0.32, walk: 1, marimba: 1, comp: 0.65, snaps: 0.6, shaker: 0.45, kick: 0.4, funk: 0, claps: 0, hats: 0, glock: 0, brass: 0 },
    results: { bpm: 116, swing: 0.08, walk: 0, marimba: 0.6, comp: 0.7, snaps: 0, shaker: 0.35, kick: 0.9, funk: 1, claps: 0.8, hats: 0.6, glock: 0.75, brass: 0.75 },
    // heist group (D minor)
    sneak: { bpm: 96, swing: 0.2, pizz: 1, brush: 0.6, celesta: 0.75, strings: 0, pulse: 0, timp: 0, run: 0, drums: 0, stabs: 0, xylo: 0, tuba: 0, tick: 0 },
    suspicious: { bpm: 104, swing: 0.12, pizz: 0.9, brush: 0.5, celesta: 0.5, strings: 0.85, pulse: 0.75, timp: 0.6, run: 0, drums: 0, stabs: 0, xylo: 0, tuba: 0, tick: 0 },
    chase: { bpm: 152, swing: 0, pizz: 0, brush: 0, celesta: 0, strings: 0.6, pulse: 0, timp: 0.5, run: 1, drums: 1, stabs: 0.9, xylo: 0.7, tuba: 0, tick: 0 },
    held: { bpm: 84, swing: 0.22, pizz: 0.35, brush: 0, celesta: 0, strings: 0.45, pulse: 0, timp: 0, run: 0, drums: 0, stabs: 0, xylo: 0, tuba: 1, tick: 0.7 },
  },
}
