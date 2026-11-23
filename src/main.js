import * as THREE from 'three'
import { ACESFilmicToneMapping, Clock, Group, PCFSoftShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, WebGLRenderer } from 'three'
import { CAMERA, graphicsPreset, LEADERBOARDS, RENDER } from './config.js'
import * as bloxity from './bloxity.js'
import { install as installInput, onKey } from './input.js'
import { installTouch } from './touch.js'
import { createPlayerBody, interpolate as interpolatePlayer, player, resetPlayer, respawn } from './player.js'
import { setCameraSensitivity, syncYawToPlayer, update as updateCamera } from './camera.js'
import { onModeChanged, toggleMode } from './modes.js'
import * as physics from './physics.js'
import { bodyCount, initPhysics, stepPhysics } from './physics.js'
import { createLighting } from './lighting.js'
import { createWorld } from './world.js'
import { createGame } from './game/game.js'
import * as netApi from './net.js'
import { initNet, net, sendEmote, sendPose, syncAvatar } from './net.js'
import { createRemotePlayers } from './avatar/remotePlayers.js'
import { setMuted, setVolume, unlock as unlockAudio } from './game/sfx.js'
import { setMusicVolume } from './game/music.js'
import { setFpsVisible, tickFps } from './fps.js'
import { createEmotes } from './avatar/emotes.js'
import { createPostFx } from './postfx.js'
import { createFarLights, singlePassFlat } from './perf.js'
import { setNeonBloom } from './propkit.js'
import { buildDefaultCharacter } from './avatar/character.js'
import { applyProportions } from './avatar/loader.js'
import { buildLook } from './avatar/look.js'
import { disposeAnimator, makeAnimator } from './avatar/animator.js'

// Boot order: Bloxity SDK -> renderer -> Rapier (async wasm) -> sky + lighting, the game (house, yard,
// hideout, Grandpa, HUD), player body -> avatar (async, swaps in when ready) -> loop. The SDK is
// optional at every step.
let lighting = null
let renderer = null
let postfx = null
let game = null

// Settings come from the portal's settings menu (or their defaults offline).
function applySetting(key, value) {
  if (key === 'camera_sensitivity') setCameraSensitivity(value)
  else if (key === 'master_volume') setVolume(value / 100)
  else if (key === 'music_volume') setMusicVolume(value / 100)
  else if (key === 'show_fps') setFpsVisible(value)
  else if (key === 'fullscreen') bloxity.requestFullscreen(value)
  else if (key === 'graphics_quality' && renderer) {
    const next = graphicsPreset(value)
    quality = next
    renderer.shadowMap.enabled = next.shadows
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, next.dpr))
    lighting?.setShadows(next)
    applyGlow()
    game?.setDensity(next.particles)
  }
}

// Light Effects (the in-game Settings window): off drops the bloom glow and hides every point light
// (room lamps, fireplace, TV, candle, lobby fill), leaving just the sun, sky fill and environment light.
let quality = null // the graphicsPreset() in use
let lightEffects = true
function applyGlow() {
  if (!postfx || !quality) return
  const bloom = quality.bloom && lightEffects
  postfx.configure({ ...quality, bloom })
  setNeonBloom(bloom)
  postfx.setSize(window.innerWidth, window.innerHeight)
}
function setLightEffects(on) {
  on = on !== false
  if (on === lightEffects) return
  lightEffects = on
  applyGlow()
  scene.traverse((o) => {
    if ((o.isPointLight || o.isSpotLight) && !o.userData.farCull) o.visible = on // far-culled ones: farLights
  })
}
bloxity.onSetting(applySetting)
bloxity.init()
bloxity.defineLeaderboards?.(LEADERBOARDS)

// --- Renderer ---------------------------------------------------------------
const preset = graphicsPreset(bloxity.settings.graphics_quality)
renderer = new WebGLRenderer({ antialias: preset.antialias, powerPreference: 'high-performance' })
renderer.outputColorSpace = SRGBColorSpace
renderer.toneMapping = ACESFilmicToneMapping
renderer.toneMappingExposure = RENDER.exposure
renderer.shadowMap.enabled = preset.shadows
renderer.shadowMap.type = PCFSoftShadowMap
renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.dpr))
document.body.appendChild(renderer.domElement)
// Esc closes a panel, else opens the portal menu.
installInput(() => (game?.panelOpen ? game.hud.closePanel() : bloxity.showMenu()), renderer.domElement)

// Audio starts on the first gesture (browsers require one).
const unlock = () => unlockAudio()
window.addEventListener('pointerdown', unlock, { capture: true })
window.addEventListener('keydown', unlock, { capture: true })

const scene = new Scene()
const camera = new PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far)
postfx = createPostFx(renderer, scene, camera)
quality = preset
applyGlow()

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight)
  postfx.setSize(window.innerWidth, window.innerHeight)
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

for (const key of Object.keys(bloxity.settings)) applySetting(key, bloxity.settings[key])

// --- Physics + world -----------------------------------------------------------
bloxity.loadingStep('Starting physics')
await initPhysics()

lighting = createLighting(scene, renderer, preset)
lighting.sun.shadow.camera.layers.enable(1) // hidden outdoor scenery still casts (game/roomCull.js)
const world = createWorld(scene)
bloxity.loadingStep("Building Grandpa's house")
game = createGame({ scene, camera, renderer, preset, setLightEffects })
initNet(game) // loads / mirrors the saved progress through the game server (offline-safe)
const farLights = createFarLights(scene)
singlePassFlat(scene)
createPlayerBody()
syncYawToPlayer()

// --- Player avatar ----------------------------------------------------------
const playerGroup = new Group()
scene.add(playerGroup)
let avatar = null
let animator = null
let generation = 0
let avatarReady = false

const emotes = createEmotes()
emotes.onChange(sendEmote)
const remotes = createRemotePlayers(scene)

function setAvatar(next) {
  if (avatar) playerGroup.remove(avatar)
  disposeAnimator(animator)
  avatar = next
  playerGroup.add(avatar)
  animator = makeAnimator(avatar)
  emotes.setAvatar(avatar, animator)
}

// --- Chat bubbles -------------------------------------------------------------
let bubble = null
let bubbleTimer = 0
bloxity.onChat((m) => {
  if (!m) return
  if (!m.isLocalPlayer) return void remotes.say(m.userId, bloxity.bubbleText(m))
  if (!avatar) return
  bubble?.remove?.()
  clearTimeout(bubbleTimer)
  bubble = bloxity.attachBubble(THREE, playerGroup, bloxity.bubbleText(m))
  bubbleTimer = setTimeout(() => {
    bubble?.remove?.()
    bubble = null
  }, bloxity.chatBubbleSeconds() * 1000)
})

// --- Ad breaks ----------------------------------------------------------------------
let adPaused = false
bloxity.onAdBreak((on) => {
  adPaused = on
  setMuted(on)
})

setAvatar(buildDefaultCharacter())

async function loadAvatar() {
  const mine = ++generation
  try {
    const signed = !!bloxity.authState.user
    const group = await buildLook({
      equipped: signed ? bloxity.getEquippedAvatar() : null,
      proportions: signed ? bloxity.getProportions() : null,
      local: signed,
    })
    if (mine !== generation) return
    setAvatar(group)
    syncAvatar()
  } finally {
    if (mine === generation) avatarReady = true
  }
}

let signedIn = null
bloxity.subscribeAuth((s) => {
  const now = !!s.user
  if (now !== signedIn) {
    signedIn = now
    loadAvatar()
  }
})
bloxity.onAvatarChanged(loadAvatar)
bloxity.onProportionsChanged(() => {
  applyProportions(avatar, bloxity.getProportions())
  syncAvatar()
})
bloxity.onRespawnRequest(() => (game.canRespawn() ? respawn() : game.portalRespawn()))

// --- Modes + keys --------------------------------------------------------------
let firstPerson = false
onModeChanged((mode) => {
  firstPerson = mode === 'player'
})
onKey('KeyV', toggleMode)
onKey('KeyN', () => lighting.toggleDayNight())
onKey('KeyR', () => game.canRespawn() && respawn())
installTouch({ mode: toggleMode, day: () => lighting.toggleDayNight(), respawn: () => game.canRespawn() && respawn() })

// --- Loop -------------------------------------------------------------------
const clock = new Clock()
let shownLoading = true
let readySince = 0

let simTime = 0
let flatCheck = 2
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1)
  simTime += dt
  frame(dt, simTime)
})

function frame(dt, elapsed, render = true) {
  tickFps(dt)
  if (adPaused) {
    if (render) postfx.render()
    return
  }

  stepPhysics(dt)
  interpolatePlayer()

  const p = player.renderPosition
  playerGroup.position.set(p.x, p.y, p.z)
  playerGroup.rotation.y = player.facing
  playerGroup.visible = !firstPerson && !(game.bodyState().out && game.inHeist)
  const speed = Math.hypot(player.velocity.x, player.velocity.z)
  animator?.update(dt, {
    grounded: player.grounded || game.bodyState().held,
    speed: game.bodyState().held ? 0 : speed,
    verticalVelocity: game.bodyState().held ? 0 : player.velocity.y,
    turn: 0,
  })
  emotes.update(dt, speed, player.grounded)
  game.animate(animator, avatar, emotes.playing, elapsed)
  sendPose(player, speed, game.bodyState())
  remotes.update(dt, net.players, net.sessionId, player.position, game.zone)

  updateCamera(camera, dt)
  game.update(dt, elapsed)
  game.fx.applyShake(dt)
  world.update(dt, elapsed)
  lighting.update(dt, p)
  farLights.update(camera, scene.fog?.far ?? Infinity, lightEffects)
  // late arrivals (loot glass, FX rings, gadgets): re-check now and then
  flatCheck -= dt
  if (flatCheck <= 0) {
    flatCheck = 2
    singlePassFlat(scene)
  }
  if (render) postfx.render()

  if (shownLoading) {
    readySince += dt
    if (avatarReady || readySince > 5) {
      shownLoading = false
      bloxity.notifyFirstFrame()
    }
  }
}

window.addEventListener('beforeunload', bloxity.teardown)

// Dev-only console hook, e.g. __game.teleport(0, 0, 60) / __game.game.debug.start('normal')
if (import.meta.env.DEV) {
  const teleport = (x, y, z, facing = player.facing) => {
    resetPlayer({ x, y, z }, facing)
    syncYawToPlayer()
  }
  // advance(seconds): run frames synchronously at 60 fps (tests; the pane throttles rAF when hidden)
  const advance = (seconds) => {
    const n = Math.round(seconds * 60)
    for (let i = 0; i < n; i++) {
      simTime += 1 / 60
      frame(1 / 60, simTime, i === n - 1)
    }
  }
  window.__game = { player, scene, renderer, camera, postfx, bodies: bodyCount, toggleMode, teleport, game, physics, emotes, remotes, advance, net: netApi }
}
