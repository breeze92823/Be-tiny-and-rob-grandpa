# Tiny Thieves: Grandpa's House — game design (build spec)

An original co-op stealth heist. Players are TINY (1.8 m capsule) in a GIANT house (x6 real scale).
They sneak in, grab loot with stretchy grabber arms, throw it out of the house (it flies into the
getaway van's trailer = cash), dodge a giant patrolling Grandpa, set traps, and escape once the crew
hits the cash target. Mechanics are inspired by the user's reference screenshots, but the house
layout, lobby, Grandpa's look, UI art and names are our own.

Units: metres, +X east, +Z south (front of the house faces +Z), +Y up. Scale S = 6 (a 0.9 m real
counter is 5.4 m). Three.js 0.171 (vanilla, no React), Rapier 0.14 (`src/physics.js`), Vite.

## Game loop
1. **Lobby "The Hideout"** (centre (0, 0, 1500)): a mouse-hole hideout inside a wall (giant
   matchboxes, spools, thimbles, coins, candle, string lights). 3 crew pads (giant bottle caps):
   all NORMAL (every crew plays the same kind of game), max 4 players each. First player on a pad starts a 20 s
   countdown ("SETTING UP: 18s"), a full pad drops it to 5 s. LEAVE button while on a pad.
   Store (gadgets) + Upgrades stalls, leaderboard billboard, coins display.
2. **"YOUR HEIST IS STARTING"** overlay -> crew teleports to the sidewalk in front of Grandpa's house
   (centre (0, 0, 0)).
3. **Heist**: break in (garage door, windows, pet flap, mail slot), steal, throw loot outside.
   Every item that leaves the house footprint is collected (flies to the van trailer, +$value to
   the crew bank). Bank >= target -> van lights up "ESCAPE!" -> walking into the van's glowing door
   escapes (each player individually).
4. **Caught**: Grandpa grabs you, carries you to the bird cage in the living room. While carried:
   mash Space / tap to struggle (fills a bar; full = he drops you), a teammate hitting Grandpa with a
   thrown object makes him drop you, or BREAK FREE for coins. In the cage: a teammate opens the cage
   door (grab + swing) to free you. Cage timer runs out (45 s) or nobody left -> OUT: Spectate /
   Lobby / REVIVE (coins, back next to your team).
5. **Results**: escaped = coins = crew haul x difficulty mult + job bonuses; caught = 15 % of that.

Difficulty: `normal` target $1,000 (coin mult 1.0, grandpa speed x1, sight x1), `hard` $2,000
(x1.5, x1.15, x1.2), `nightmare` $3,000 (x2.2, x1.3, x1.35).

## Currency (project rule)
NOTHING is bought with premium currency. Coins (earned by escaping) buy everything: gadgets,
upgrades, Break Free (350), Revive (500). Prices are slightly high on purpose.

## The house (footprint x -54..54, z -42..42, floor y 0, walls 16 high, 1.2 thick)
```
z=-42 +-------------+-----------+--------------------+   back
      |  KITCHEN    | BATHROOM  |      BEDROOM       |
      |  x -54..-18 | x -18..6  |      x 6..54       |
z=-10 +---D(-30)----+--D(-6)----+-------D(24)--------+
      |               HALLWAY  z -10..4               | <- front door + mail slot at east end x=54
z=4   +----D(-36)---+-------ARCH(0, 10 wide)--+------+
      |  GARAGE     |   LIVING ROOM           |STUDY |  study = secret room behind the
      |  x -54..-18 |   x -18..30             |30..54|  living room bookshelf (x=30, z~20)
z=42  +==GARAGE DOOR+=====FRONT WINDOW========+------+   front (+Z): lawn, driveway, van
```
Entries: garage door (front, x -50..-22, prismatic lift, tutorial), living room front window
(sash slides up, sill 5.5, planter + crates to climb), kitchen pet flap (back door, ground),
bedroom side window (x=54), mail slot (front door, hallway east end, climb the doormat steps),
bathroom high window (drainpipe + AC unit).
Interior doors are hinged dynamic bodies (revolute joints), Grandpa shoves them open.

## Loot (id, name, $, size m [x,y,z], kg, material, flags) — `LOOT` in config.js
Materials: wood metal glass plastic soft ceramic paper rubber. fragile = shatters on a hard hit
(loses value, loud). coins = bursts into coins when broken.
HALLWAY: umbrella Umbrella 30 [6,1.2,1.2] 6 plastic; boot Rain Boot 15 [1.6,2.6,2.4] 4 rubber;
fedora Fedora Hat 25 [2.4,1.2,2.4] 2 soft; keys Car Keys 45 [1.2,0.3,1.6] 1 metal; vase Flower
Vase 60 [1.6,3,1.6] 5 ceramic fragile; wallet Fat Wallet 90 [1.6,0.4,1.2] 1 soft; pocketwatch
Pocket Watch 120 [0.9,0.25,1.1] 1 metal; snowglobe Snow Globe 40 [1.2,1.4,1.2] 3 glass fragile.
LIVING: remote TV Remote 20 [0.8,0.35,2.2] 1; lamp Table Lamp 45 [2,3.6,2] 6 ceramic; cushion
Fluffy Cushion 15 [3,1,3] 2 soft; book Old Book 25 [1.4,0.5,2] 2 paper; record Vinyl Record 55
[2,0.15,2] 1 plastic; trophy Golf Trophy 150 [1.2,2.6,1.2] 6 metal; teacup Fancy Teacup 35
[1,0.7,1] 1 ceramic fragile; cookietin Cookie Tin 40 [1.8,0.8,1.8] 3 metal; piggybank Piggy Bank
100 [1.6,1.4,2.2] 4 ceramic fragile coins; yarn Yarn Ball 10 [1.2,1.2,1.2] 1 soft; camera Vintage
Camera 130 [1.6,1.1,1] 4 metal; radio Retro Radio 85 [2.4,1.6,1] 8 wood.
KITCHEN: toaster Toaster 50 [2,1.4,1.2] 12 metal; pan Frying Pan 30 [1.8,0.4,3.4] 6 metal; teapot
Teapot 70 [2,1.6,1.4] 5 ceramic fragile; cheese Fancy Cheese 40 [1.6,0.9,1.2] 3 soft; cake
Birthday Cake 55 [2,1.4,2] 4 soft; mug Coffee Mug 10 [0.9,1,1.1] 1 ceramic; milk Milk Carton 8
[0.9,1.8,0.9] 2 paper; blender Blender 75 [1.2,2.4,1.2] 7 plastic; rollingpin Rolling Pin 15
[3,0.5,0.5] 3 wood; plate Fine China Plate 45 [1.8,0.15,1.8] 2 ceramic fragile.
BATHROOM: duck Rubber Duck 50 [1.4,1.4,1.6] 1 rubber (squeaks); toothbrush Electric Toothbrush 25
[0.4,1.8,0.4] 1 plastic; perfume Fancy Perfume 110 [0.8,1.2,0.8] 2 glass fragile; shampoo Shampoo
Bottle 12 [0.8,1.6,0.6] 2 plastic; tp Toilet Paper 5 [1,1,1] 1 paper; hairdryer Hair Dryer 45
[1.8,1.6,0.8] 3 plastic; soap Soap Bar 5 [0.9,0.4,0.6] 1 soft; dentures Golden Dentures 200
[0.9,0.6,0.9] 1 ceramic.
BEDROOM: alarmclock Alarm Clock 35 [1.2,1.2,0.7] 2 metal; jewelbox Jewelry Box 180 [1.6,1,1.2] 4
wood; pillow Pillow 10 [3,0.8,2] 2 soft; slipper Fuzzy Slipper 15 [1.2,0.8,2.4] 1 soft; teddy
Teddy Bear 40 [1.8,2.4,1.4] 2 soft; watch Gold Watch 160 [0.8,0.3,1.1] 1 metal; photo Photo Frame
30 [1.4,1.8,0.3] 2 wood; cash Cash Stack 140 [1.2,0.5,0.6] 1 paper; necklace Pearl Necklace 220
[1.2,0.2,1.2] 1 metal; diary Secret Diary 25 [1.2,0.4,1.6] 1 paper.
GARAGE: toolbox Toolbox 60 [2.4,1.4,1.2] 30 metal; hammer Hammer 20 [0.5,0.4,2.2] 4 metal; wrench
Wrench 25 [0.4,0.2,2] 3 metal; drill Power Drill 90 [1.6,1.6,0.6] 6 plastic; paintcan Paint Can
15 [1,1.1,1] 8 metal; flashlight Flashlight 20 [0.5,0.5,1.8] 2 metal; gascan Gas Can 25
[1.4,1.6,0.8] 6 plastic; hubcap Shiny Hubcap 45 [2,0.3,2] 4 metal.
STUDY (secret): goldbar Gold Bar 250 [1.4,0.5,0.7] 35 metal; crown Jeweled Crown 400 [1.6,1.2,1.6]
8 metal (THE hidden treasure, in the safe); globe Antique Globe 120 [1.8,2.4,1.8] 20 wood; painting
Small Painting 200 [2.2,1.8,0.3] 6 wood; diamond Giant Diamond 350 [0.9,0.9,0.9] 3 glass; coinjar
Coin Jar 150 [1.2,1.6,1.2] 6 glass fragile coins.

## Gadgets (bought with coins in the lobby, hotbar keys 1-9 in the heist)
marbles (scatter 12 marbles: Grandpa slips, 5 s), glue (puddle: stuck 7 s), banana (peel: slips
4 s; also free in the kitchen fruit bowl), alarm (alarm clock: rings after 3 s for 10 s, Grandpa
goes to smash it), smoke (smoke bomb: blocks sight 8 s, breaks a chase), sleep (sleep potion,
thrown: Grandpa naps 18 s), xray (X-ray specs: see Grandpa + his vision cone through walls 30 s),
energy (energy drink: endless stamina +20 % speed 15 s), bazooka (toy bazooka: foam rocket, stuns
Grandpa 4 s, knocks props, very loud; also one free on the lawn).

Upgrades (levels 0-5): arms (grab range +2 m), grip (grab strength / heavier loot), lungs (stamina
+20 %), feet (speed +4 %), soft (noise -12 %), ninja (visibility -8 %).

## Jobs (6 random per heist from the pool, shared by the crew, bonus $ to the bank + coins)
steal N items (timed), steal 3 from ROOM, steal a $100+ item, steal the hidden treasure, trip
Grandpa on marbles, glue Grandpa, slip Grandpa on a banana, fool Grandpa with a clock, smoke bomb in
a chase, turn up the heat (hallway thermostat), flush the toilet, break Grandpa's TV, open a secret
door, put Grandpa to sleep, free a caught friend, get launched by the toaster, ride the ceiling fan.

## Grandpa (~10.5 m tall, our own design)
Mustard knitted cardigan over a light-blue shirt + bow tie, brown corduroy trousers, maroon fuzzy
slippers, big nose, round glasses, bushy white eyebrows + mustache, bald crown with white side tufts,
walking cane. Brain: patrol activities (tea at the stove, newspaper in the armchair, TV, nap in bed,
workbench, toilet, thermostat), vision cone + line of sight, detection meter per player (? then !),
hears noise events (radius, muffled through walls), investigate, chase, search, catch (reach 3.5 m;
not under furniture), carry to cage. Reacts to traps (slip, stuck, sleep, stunned, distracted).

## Multiplayer protocol (Colyseus room `world`, max 16) — backend + client src/net.js
State `WorldState { players: Map<sid, PlayerState>, pads: ArraySchema<PadState>(3), heists: ArraySchema<HeistState> }`.
`PlayerState`: username, signedIn, pfp, userId, avatar, emote, x y z yaw speed grounded (pose),
`crouch` bool, `grab` bool, `gx gy gz` (grab point, drawn as stretchy arms), `zone` string ("lobby"
or "h<heistId>", set by the server only), `held` bool (in Grandpa's hand), `out` bool, `escapes` number.
`PadState`: index, difficulty, `members` ArraySchema<string> (waiting on the pad), `startsAt`
(server epoch ms, 0 = idle); a pad is free again as soon as its crew launches. `HeistState`: `id`,
`pad`, difficulty, `crew` ArraySchema<string> (in the heist), `host` (sessionId running Grandpa +
physics), `seed` uint32, `money`, `target`.
Client -> server: `joinPad {pad}` (no reply: a full pad silently takes nobody, so the client
checks `members` and re-sends), `leavePad`, `pose {...}`, `setAvatar`, `emote`,
`saveProgress`, `identify {token, username, pfp}`, `adReward {token, placement}`, `hs` (host snapshot,
relayed to the crew except the sender, only from the host),
`ha` (crew action, relayed to the host with `from` = sender sid), `hb` (host event, relayed to the
whole crew except the sender), `steal {value}` (host only: money += clamp), `escaped` (member left
the heist through the van), `leaveHeist` (back to the lobby). Server -> client: `heistStart {pad,
heistId, seed, difficulty, target, host, crew}`, `hostChanged {heistId, host}`, `heistOver {heistId, pad}`,
relayed `hs` / `ha` / `hb`, plus the template's `progress` / `noProgress` (both carry `serverTime`, the
server epoch ms the pads' `startsAt` is read against) / `serverError` / `leaderboard` / `adRewardResult
{ok, placement}`.
Saved progress (`PlayerDoc`): coins, upgrades {arms, grip, lungs, feet, soft, ninja} (0-5), gadgets
{id: count} (0-99), stats {heists, escapes, caught, stolen, earned, bestHaul, jobs}, tutorialDone,
prefs {music, sfx}, lastSeen. Leaderboards: escapes, earned, besthaul, stolen.
