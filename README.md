# Stuntrun

**Stuntrun** is a low-poly 3D stunt racing game that runs in the browser. You race the clock on tracks full of loops, jumps, banked turns and boost pads, chase your own ghost, and build your own tracks in the editor. It works with a keyboard, a gamepad or a touchscreen, so it plays on desktop and on phones.

It's a static site with no build step, so GitHub Pages can host it as-is.

▶ **Play:** `https://gorzaweba.github.io/Stuntrun/` (once GitHub Pages is enabled, see below)

---

## Features

- **Arcade physics.** A raycast-suspension car with grip, downforce, boost and air control. It sticks to loops and banked turns and lands jumps.
- **8 campaign tracks**, from *First Gear* to *Grand Stunt*. Each has gold, silver and bronze medal times.
- **Checkpoints and respawn.** You respawn at the last checkpoint with the speed you had there.
- **Ghost replays.** Your best run is saved and races alongside you as a translucent car.
- **Track editor.** Place, rotate, stack and erase 15 kinds of piece on a grid, test-drive the track straight away, save it on your device and share it with a link or a code.
- **Mobile ready.** On-screen touch controls with multi-touch, layouts for landscape and portrait, fullscreen and installable as a home-screen app.
- **Low-poly look.** Flat-shaded models with vertex colours, low-poly trees, rocks, mountains and clouds, and real-time shadows.
- **Synthesised audio.** The engine, tyres, wind, boost and UI sounds are generated with WebAudio, so there are no audio files.
- **Graphics settings** (auto, low, medium, high), sound on/off and volume, km/h or mph, three camera views and eight car colours.

## Controls

| Action | Keyboard | Touch | Gamepad |
| --- | --- | --- | --- |
| Accelerate | `W` / `↑` | ▲ (right) | RT / A |
| Brake / reverse | `S` / `↓` / `Space` | ▼ (right) | LT / B |
| Steer | `A` `D` / `←` `→` | ◀ ▶ (left) | Left stick / D-pad |
| Respawn at checkpoint | `Enter` / `Backspace` | ↺ button | Y |
| Restart | `R` | Pause → Restart | Back / Select |
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

**Track pieces:** Start, Finish, Checkpoint, Straight, Booster, Tight turn (1×1), Turn (2×2), Wide turn (3×3), Banked turn (2×2), Wide banked turn (3×3), Ramp (+1 level), Long ramp (+2 levels), Jump, Loop (exits one lane to the left) and Loop (exits one lane to the right). A ramp works as a downhill too if you place it rotated by 180°.

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
node tools/simulate.mjs sky-bridge --verbose
node tools/simulate.mjs --medals           # suggested medal times
node tools/simulate.mjs "--script=S*3 OL S*2 F"   # try a track script
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
| `K` | jump kicker |
| `G` | gap: skip one tile, for example after a kicker |
| `OL` `OR` | loop that exits one lane left or right |
| `X*n` | repeat a token, for example `S*4` |

For example, `S*2 B S OL S*2 R2 S C S F` gives: two straights, a booster, a straight, a loop, two straights, a right turn, a straight, a checkpoint, a straight and the finish.

After adding a track, run `npm test` to check it can be finished, and `node tools/simulate.mjs --medals` to get medal times.

## Project structure

```
index.html            page shell, menus and HUD markup
css/style.css         UI styling, responsive and touch layouts
js/main.js            game bootstrap, state machine, menus, HUD
js/car.js             vehicle physics (suspension rays, tyres, collisions)
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
js/audio.js           WebAudio synthesiser
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
