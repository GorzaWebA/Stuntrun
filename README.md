# Stuntrun

**Stuntrun** is a low-poly 3D stunt racing game that runs in the browser. You race the clock while riding walls, driving upside down, spinning through corkscrews, looping the loop and jumping big gaps. You can chase your own ghost and build your own tracks in the editor. It works with a keyboard, a gamepad or a touchscreen, so it plays on desktop and on phones.

It's a static site with no build step, so GitHub Pages can host it as-is.

### ▶ [Play Stuntrun](https://gorzaweba.github.io/Stuntrun/)

<https://gorzaweba.github.io/Stuntrun/>

---

## Features

- **Weighty car physics.** A 1350 kg raycast-suspension car with real body roll and weight transfer. Its tyres break into a slide when you push too hard, and they grip less until the slide settles. It's slow to change direction at speed, so brake before corners.
- **Stunt grip.** On walls, ceilings, loops and rolls the tyres grip harder the faster you go. Above about 90 km/h the car sticks, so you can ride vertical walls and drive upside down. Below about 65 km/h gravity wins and you drop off. In the air the nose follows the flight path, so landings stay clean.
- **Stunt pieces.** Loops, corkscrews (a full 360° roll), upside-down sections, wall rides, near-vertical wall turns, small and big jumps, ramps, banked turns and boost pads.
- **Open areas with obstacles.** Wide floor sections with no barriers, where you pick your own line around pillars, barriers and cones, over speed bumps and off jump wedges. On raised platforms the open edges have a low safety rail.
- **11 campaign tracks**, from *Launch Pad* to *Grand Stunt*. Each has gold, silver and bronze medal times.
- **Stunt callouts.** "Big air", "Wall ride!" and "Upside down!" pop up as you pull them off.
- **Checkpoints and respawn.** You respawn at the last checkpoint with the speed you had there.
- **Ghost replays.** Your best run is saved and races alongside you as a translucent car.
- **Track editor.** Place, rotate, stack and erase 28 kinds of piece on a grid, test-drive the track straight away, save it on your device and share it with a link or a code.
- **Mobile ready.** On-screen touch controls with multi-touch, layouts for landscape and portrait, fullscreen and installable as a home-screen app.
- **Low-poly look.** Flat-shaded models with vertex colours, low-poly trees, rocks, mountains and clouds, and real-time shadows.
- **Procedural audio, no sound files.** A six-cylinder engine with automatic gear shifts, a rev limiter, turbo whistle, blow-off and exhaust pops when you lift off. Tyre squeal follows how much the tyres are sliding, and there's road rumble, grass, wind, landing thuds and crash sounds. A generated soundtrack plays calm on the menus and full drums in races, with its own key and tempo per track. Reverb and a master compressor keep the mix together.
- **Settings:** graphics (auto, low, medium, high), separate on/off and volume for sound effects and music, km/h or mph, three camera views and eight car colours.

## Controls

| Action | Keyboard | Touch | Gamepad |
| --- | --- | --- | --- |
| Accelerate | `W` / `↑` | ▲ (right) | RT / A |
| Brake / reverse | `S` / `↓` / `Space` | ▼ (right) | LT / B |
| Steer | `A` `D` / `←` `→` | ◀ ▶ (left) | Left stick / D-pad |
| Back to last checkpoint | `R` (or `Enter`) | ↺ button | Y / Back |
| Restart from the start | `R` twice quickly | ↺ twice quickly (or Pause → Restart) | Back twice |
| Pause | `Esc` / `P` | ❚❚ button | Start |
| Change camera | `C` | Settings | LB / RB |

You can steer a little while the car is in the air.

### Editor controls

| Action | Desktop | Touch |
| --- | --- | --- |
| Place piece | Left click | Tap |
| Erase piece | Right click, or `X` for erase mode | Erase button, then tap |
| Rotate piece | `R` | Rotate button |
| Build height | `E` / `Q` (or `PageUp` / `PageDown`) | Up / Down buttons |
| Move view | Drag, or `WASD` / arrows | Drag |
| Zoom | Mouse wheel | Pinch |
| Turn view | `Z` / `C`, or right-drag | Two-finger twist |
| Undo / Save / Test | `Ctrl+Z` / `Ctrl+S` / `T` | Toolbar buttons |
| Pick piece | `1`–`9` | Palette |

Every track needs one **Start** and at least one **Finish**. To finish, you have to drive through every **Checkpoint**, in any order.

**Track pieces**

| Group | Pieces |
| --- | --- |
| Basics | Start, Finish, Checkpoint, Straight, Booster |
| Turns | Tight turn (1×1), Turn (2×2), Wide turn (3×3), Banked turn (2×2), Wide banked turn (3×3) |
| Height | Ramp (+1 level over 2 tiles), Long ramp (+2 levels over 3 tiles). Rotated by 180° they work as downhills. |
| Air | Jump (small kicker), Big jump (2-tile kicker that launches you far) |
| Stunts | Loop left / right, Wall turn (2×2), Wide wall turn (3×3), Wall ride left / right (6 tiles), Corkscrew (360° roll, 7 tiles), Upside down (8 tiles, about 60 m driven on the ceiling) |
| Open areas | Open floor, Pillar, Barrier, Cones, Speed bumps, Jump wedge. These are 1×1 floor tiles with no barriers that join on all four sides, so you can lay out wide plazas. |

Wall turns, wall rides, corkscrews and upside-down sections roll the road around the car, so they need room below. Build them at least **2 levels up** (use ▲ in the editor). They need speed: arrive fast, or you'll fall off.

---

## Playing on GitHub (GitHub Pages)

The game is plain HTML, CSS and JavaScript modules, and three.js is vendored in `vendor/`. GitHub Pages can serve the repository without any build:

1. Push this repository to GitHub.
2. Open the repository's **Settings → Pages**.
3. Under **Build and deployment**, choose **Source: Deploy from a branch**.
4. Pick the branch that holds the game, for example `main`, and the folder **/ (root)**, then click **Save**.
5. After a minute the game is live at `https://<your-user>.github.io/<repo-name>/`.

The empty `.nojekyll` file tells Pages to serve the files exactly as they are.

**Sharing tracks:** the editor's *Share* button creates a link like `https://<your-user>.github.io/<repo-name>/#track=…`. Opening that link loads the track straight into a race and saves it under *My tracks*.

**On a phone:** open the Pages URL, tap the fullscreen button on the menu or use *Add to Home Screen*, and turn the phone sideways.

## Running locally

Browsers don't load JavaScript modules from `file://` URLs, so the folder needs to be served over HTTP:

```bash
# any static server works, for example:
python3 -m http.server 8080
# or
npx serve .
```

Then open <http://localhost:8080>.

## Testing the tracks

`tools/simulate.mjs` drives every campaign track with the built-in autopilot, using the same physics as the game but without a browser. It checks that each track can be finished:

```bash
npm test                                   # all campaign tracks
node tools/simulate.mjs --styles           # also drive cautiously and aggressively
node tools/simulate.mjs topsy-turvy --verbose
node tools/simulate.mjs --medals           # suggested medal times
node tools/simulate.mjs "--script=U2 S*2 B S CS S*2 D2 S F"   # try a track script
node tools/map.mjs grand-stunt             # ASCII top-down map of a track
```

Node 18 or newer is needed. There are no npm dependencies.

## Adding campaign tracks

Campaign tracks are written in a small "turtle" script in `js/tracks.js`. Each token places a piece where the previous one ended:

| Token | Piece |
| --- | --- |
| `S` `C` `B` `F` | straight, checkpoint, booster, finish |
| `L1` `L2` `L3` / `R1` `R2` `R3` | tight / normal / wide turn, left or right |
| `BL2` `BR2` `BL3` `BR3` | banked turns |
| `U` `D` / `U2` `D2` | ramp up/down one level, or long ramp two levels |
| `K` / `BK` | jump kicker / big jump |
| `G` | gap: skip one tile, for example after a kicker |
| `OL` `OR` | loop that exits one lane left or right |
| `WL2` `WR2` `WL3` `WR3` | wall turns (need level 2 or higher) |
| `VL` `VR` | wall ride on the left / right wall (needs level 2 or higher) |
| `CS` | corkscrew (needs level 2 or higher) |
| `INV` | upside-down section (needs level 2 or higher) |
| `P` `PL` `PR` | open floor; `PL` / `PR` turn the route left / right inside the open area |
| `PB` `PJ` `PC` `PWL` `PWR` `PP` | open floor with speed bumps / jump wedge / cones / barrier on the left / barrier on the right / pillar |
| `X/n` | widen with open floor to `n` tiles, for example `PB/5` |
| `<X` `>>X` | place a piece 1 tile left / 2 tiles right of the previous one without moving on, for example `<<PP` |
| `X*n` | repeat a token, for example `S*4` |

For example, `S*2 U2 S*2 B S INV S*2 D2 S F` gives: two straights, a long ramp up two levels, two straights, a booster, a straight, an upside-down section, two straights, a long ramp back down, a straight and the finish.

Design tips from building the campaign:

- Give jumps a long landing zone (four or more straights). A booster right before a kicker can carry you over everything.
- Don't put a checkpoint where cars are still in the air after a jump. You have to drive through the gate.
- Put a booster and a couple of straights before rolls and wall turns so cars arrive fast and centred.
- The car is heavy. Leave room to brake before tight corners, especially after a jump, because you can't brake in the air.
- Where an open area turns, use `PL` / `PR` and make it at least 3 wide so drivers can take a wider line.

After adding a track, run `npm test` to check it can be finished, and `node tools/simulate.mjs --medals` to get medal times.

## Project structure

```
index.html            page shell, menus and HUD markup
css/style.css         UI styling, responsive and touch layouts
js/main.js            game bootstrap, state machine, menus, HUD
js/car.js             vehicle physics (suspension rays, tyres, adhesion, collisions)
js/collision.js       triangle spatial hash: ray casts and sphere contacts
js/pieces.js          procedural track pieces (geometry, connectors, cells)
js/track.js           track builder, route finder, turtle scripts, share codes
js/tracks.js          campaign tracks and medal times
js/race.js            race rules: timer, checkpoints, finish, respawn
js/editor.js          track editor
js/scenery.js         sky, lights, ground, trees, mountains, clouds
js/carModel.js        low-poly car mesh
js/camera.js          chase and orbit cameras
js/input.js           keyboard, touch and gamepad input
js/audio.js           WebAudio engine/tyre/impact sounds and generative music
js/ghost.js           ghost recording and playback
js/bot.js             autopilot (menu demo and track tests)
js/storage.js         localStorage helpers (best times, ghosts, tracks, settings)
tools/                headless simulator and ASCII map tool
vendor/               three.js r170 (MIT licence)
```

Best times, ghosts, settings and your own tracks are stored in the browser's `localStorage` on each device.

## Credits

- Rendering: [three.js](https://threejs.org) (MIT licence, see `vendor/three.LICENSE`).
- All models, tracks, physics and sounds are generated in code. The game uses no external art or audio assets.
