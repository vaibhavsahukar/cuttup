# Reckless Driving: The Game

Infinitely generated arcade traffic game. Pick a car or a motorcycle, pick a map, and cut through endless traffic for distance, sustained speed and near misses until you wreck.

Built with TypeScript, Three.js (WebGL) and Vite, wrapped in Electron and packaged for Windows with electron-builder. Every model, road, prop, texture and sound is procedural; nothing is downloaded at runtime.

## Commands

| Command | What it does |
|---|---|
| `npm install` | Install dependencies (downloads the Electron binary) |
| `npm run dev` | Vite dev server + Electron window with hot reload |
| `npm run dev:web` | Vite dev server only (open http://localhost:5173 in a browser) |
| `npm run build` | Type check (`tsc --noEmit`) and production bundle into `dist/` |
| `npm start` | Run Electron against the production bundle in `dist/` |
| `npm run dist` | Build, then package Windows x64 **NSIS installer** and **portable exe** into `release/` |
| `npm run dist:dir` | Build, then package an unpacked Windows folder only (`release/win-unpacked/`) |
| `npm run tune` | Headless handling report for every vehicle (0-60, 0-100, top speed, braking, grip, power slide) |
| `npm run smoke` | Headless browser smoke test (needs `npm run dev:web` running) |
| `npm run check:traffic` | Headless traffic behaviour probe (overlaps, lane changes, signalling per driver type) |
| `npm run check:features` | Headless probes for near misses, oncoming near misses, pause, key rebinding, persistence |

Outputs of `npm run dist`:

* `release/Reckless Driving The Game Setup 1.0.0.exe` (NSIS installer, lets you choose the install directory)
* `release/Reckless-Driving-The-Game-1.0.0-portable.exe` (single file, no install)
* `release/win-unpacked/Reckless Driving The Game.exe` (unpacked app)

Building the Windows targets on Windows needs nothing extra. On Linux/macOS electron-builder needs **Wine** (both 64 and 32 bit prefixes; NSIS runs its uninstaller stub under Wine). The exe is unsigned and uses the default Electron icon.

The headless check scripts use Playwright's Chromium. Set `CHROME=/path/to/chromium` to use a specific browser binary.

## Controls

| Action | Keyboard (default, rebindable) | Gamepad (XInput / standard mapping) |
|---|---|---|
| Accelerate | W / ↑ | RT |
| Brake / reverse | S / ↓ | LT |
| Steer | A D / ← → | Left stick |
| Handbrake | Space | A or RB |
| Camera (chase / hood or cockpit) | C | Y |
| Look back | Left Shift / Q | B |
| Look left / right (camera) | J / L (numpad 4 / 6) | Right stick (swings the camera up to 135 degrees) |
| Bike: shift weight left / right | Z / X | D-pad left / right |
| Horn | H / Left Ctrl | L3 |
| Pause | Esc / P | Start / Back |
| Menus | Arrow keys + Enter, mouse | D-pad + A, B = back |

The crash scene stays on screen until you press Enter or the gamepad A button.

## Game overview

* **Maps**: City Highway, Countryside Highway, Forest Backroad (fog, curves, hills). All three are endless.
* **Time of day**: on the map screen choose *Natural clock* (the sun moves; one in-game hour per real minute, dawn, day, dusk and night with street lamps, lit windows and headlights coming on) or a fixed Dawn / Day / Dusk / Night, which freezes the clock.
* **Police**: at 15,000 points one police car starts chasing you, 2 at 30,000, 3 at 50,000 and 5 at 100,000. Cops weave through traffic and try to ram you. They are skilled, not perfect: when one crashes into traffic (both cars wreck) another unit is dispatched a few seconds later. A cop that falls far behind is also replaced. Tiers are in `POLICE_TIERS` in `src/traffic/Police.ts`.
* **Score**: distance scaled by speed, a sustained speed bonus above 100 mph, and near miss bonuses (closer and faster is worth more, oncoming passes are worth double, two near misses within 1.4 s is a **CUT UP** bonus). Near misses build a combo multiplier (up to x10) that decays after 5 s without one; any bump resets it.
* **Results**: score, distance, top speed, near misses, cut ups, time, how you wrecked, and a local top 10 per map. Retry / Change vehicle / Change map / Main menu.
* **Persistence**: settings and leaderboards are saved to `cutup-save.json` in the Electron user data folder (`%APPDATA%/CUT-UP` on Windows) via IPC, mirrored to `localStorage` (which is the only store when running in a plain browser).

## Project layout

```
electron/            main process (window, save file IPC, fullscreen/resolution) + preload bridge
src/
  data/vehicles.ts   ALL vehicle stats and handling knobs (single tuning file)
  data/maps.ts       map definitions (curvature, grade, fog, colours, traffic flow) + lane layouts
  world/             RoadPath (seeded infinite spline), Ribbon (pooled swept meshes),
                     ChunkManager (chunk streaming, instanced scenery), Environment (sky, fog, lights, backdrop),
                     Props (procedural scenery geometry), Textures (canvas generated road / facade textures)
  vehicles/          ModelKit (primitive merging), CarBuilder (parametric extruded bodies, 9 cars + 6 traffic types),
                     BikeBuilder (4 motorcycles + rider), Materials, Factory
  physics/           VehiclePhysics (arcade dynamics), RigidBody (crash tumbling)
  traffic/           Traffic (IDM car following, MOBIL style lane changes, driver subtypes, spawning, LOD)
  game/              Game (run orchestration, collisions, near misses), Player, CameraRig, Crash (cinematic),
                     Particles, Scoring
  audio/             AudioEngine (WebAudio synthesis: engine, wind, tyres, horns, crash, whoosh)
  input/             Input (keyboard + gamepad, rebindable)
  ui/                UI (DOM menus, HUD, settings, results), PreviewStage (3D turntable), style.css
  storage/Save.ts    settings, quality presets, leaderboard persistence
scripts/             tune, smoke, traffic and feature probes, Electron / asar launch checks
```

## How it works

### Infinite road
`RoadPath` generates seeded random control points for **curvature** and **grade** and blends between them with a cosine ease, then integrates heading, position and height in 2 m steps. Curvature and grade are therefore continuous everywhere, so there are no kinks at chunk seams; chunks only decide *where* geometry is built. Highways use gentle curves (radius ≥ 800 m) and small grades; the backroad uses radius down to 75 m and up to 7 % grade. Height is gently pulled back toward zero so the road never drifts off to extreme altitudes.

Everything (player, traffic, crash debris projection) lives in road coordinates `(s, d)`: `s` = distance along the road, `d` = lateral offset (+ = right of travel).

Chunks are 64 m long. A fixed pool of chunk slots is recycled: each slot owns **Ribbon** meshes (road, median, barrier, walls or guardrails, terrain) with fixed vertex counts whose buffers are rewritten in place, and a slice of global **InstancedMesh** pools for scenery (buildings, lamps, overpasses, barns, houses, power poles and wires, trees, rocks, hay bales, signs). At most two chunks are rebuilt per frame, always beyond the fog, so there is no allocation and no visible pop in.

### Road rules
* Highways: 5 lanes per direction (3.7 m), inner and outer shoulders with rumble strips, yellow left edge line, dashed lane lines, a concrete jersey barrier in the median and the opposite carriageway with oncoming traffic. The player is clamped between the median barrier and the outer wall/guardrail; glancing hits scrape (sparks, speed loss, combo reset), hard or high speed hits crash.
* Backroad: exactly two lanes with a dashed centre line. The player can use the oncoming lane. Leaving the tarmac onto gravel/grass reduces grip and adds drag; going further into the treeline at speed crashes.

### Vehicle physics
`VehiclePhysics` is a dynamic bicycle model with front/rear axles:
* Pacejka style lateral curve per axle, rear axle stiffer in the linear range (stable), with peak grip set per axle (`frontGrip`, `rearGrip`) so limit behaviour is the vehicle's character.
* Longitudinal load transfer from `cgHeight`, downforce, drag (derived so the drag limited top speed matches the spec), rolling resistance, road grade.
* Engine torque curve (`torquePeak`, `torqueFlat`) scaled so every gear delivers the rated peak power, automatic gearbox with shift cuts, rev limiter, electronic limiter for limited cars (M4, Supra).
* Drivetrain: RWD, FWD or AWD split. Excess drive force becomes wheelspin, and wheelspin eats that axle's lateral grip (friction circle, scaled by `powerOversteer`), which is what makes the ZR1, Supra and C63 tail happy while the AWD cars stay planted.
* Arcade assists scaled by `stability`: limit aware steering lock, auto counter-steer, yaw damping, ESC style yaw limiting and traction control. Low stability cars (ZR1 0.35) get much less help.
* Launch calibration: at startup each vehicle's longitudinal launch factor is bisected so the simulated 0-60 mph time matches `zeroSixty`. The factor fades out above ~35 m/s, so top speeds are untouched.
* Motorcycles: steering input sets a target **lean angle**, lean drives the turn (lean shows on the model, the rider hangs off, the chase cam rolls slightly, the cockpit cam leans fully). Wheelies and stoppies come from load transfer limits; the KTM SMC is by far the most wheelie prone. Above ~82 % of top speed a speed wobble grows (bar shake, camera shake). Collision box is 0.62 m wide, so bikes can filter through gaps cars cannot.

`npm run tune` prints the verification table. Current output:

```
Yamaha R6                    0-60 3.21s (ref 3.2)  top 159 mph (ref 165)
Kawasaki ZX-6R               0-60 3.20s (ref 3.2)  top 155 mph (ref 160)
Honda CBR600RR               0-60 3.30s (ref 3.3)  top 154 mph (ref 160)
KTM 450 SMC-R                0-60 3.99s (ref 4)    top 107 mph (ref 110)
Chevrolet Corvette C6 ZR1    0-60 3.30s (ref 3.3)  top 206 mph (ref 205)  powerslide 19 deg
BMW M4 (F82)                 0-60 4.10s (ref 4.1)  top 156 mph (ref 155)  powerslide 13 deg
Lamborghini Huracán          0-60 2.90s (ref 2.9)  top 195 mph (ref 200)  powerslide 1 deg
Honda Civic (10th gen)       0-60 7.00s (ref 7)    top 131 mph (ref 130)
Toyota GR Supra (A90)        0-60 3.90s (ref 3.9)  top 156 mph (ref 155)  powerslide 23 deg
Jeep Grand Cherokee (WK2)    0-60 7.00s (ref 7)    top 129 mph (ref 130)
Lamborghini Urus             0-60 3.60s (ref 3.6)  top 192 mph (ref 190)
Lexus RC F                   0-60 4.20s (ref 4.2)  top 164 mph (ref 168)  powerslide 7 deg
Mercedes-AMG C63 S           0-60 3.80s (ref 3.8)  top 182 mph (ref 180)  powerslide 15 deg
```
("powerslide" = peak sideslip when flooring it mid corner at 18 m/s with no counter-steer input: the ZR1 has the Huracán's power but far less ability to put it down.)

### Tuning knobs (`src/data/vehicles.ts`)

| Field | Effect |
|---|---|
| `hp`, `massKg` | Power to weight; drives acceleration beyond the launch phase and top speed via drag |
| `zeroSixty` | Target 0-60 time; launch factor is auto-calibrated to hit it |
| `topSpeedMph`, `limited` | Top speed (drag derived); `limited` = governor, car could go ~12 % faster |
| `drive` | `RWD` / `FWD` / `AWD` (AWD splits 40/60) |
| `gears`, `redline`, `idleRpm` | Gearbox spread and engine sound pitch range |
| `torquePeak`, `torqueFlat` | Torque curve shape (low peak + flat = turbo/supercharged shove) |
| `tireMu` | Overall grip |
| `launchMu` | Extra longitudinal traction (tyre width) |
| `frontGrip`, `rearGrip` | Peak grip balance; front < rear = understeer, front > rear = oversteer |
| `powerOversteer` | How much wheelspin kills rear lateral grip (0 = none, 1.35 = ZR1) |
| `stability` | Strength of all arcade assists (counter-steer, yaw damping, ESC, traction control) |
| `cgHeight`, `frontWeight`, `wheelbase` | Load transfer, wheelie/stoppie thresholds, yaw response |
| `yawInertia` | Multiplier on yaw inertia (higher = slower to change direction, e.g. Jeep 1.5) |
| `steerLock`, `steerSpeed`, `highSpeedSteer` | Steering range, rate (bikes: lean rate) and how much lock is kept at speed |
| `brakeG` | Braking strength before tyre limits |
| `downforce` | N per (m/s)² split 45/55 front/rear |
| `rollFactor`, `pitchFactor` | Visual body roll / dive per g |
| `engine.cylinders`, `engine.tone`, `engine.roughness` | Synth engine character |

Traffic tuning lives in `DRIVERS` in `src/traffic/Traffic.ts` (IDM headway `T`, min gap `s0`, accel `a`, comfortable decel `b`, lane change threshold, keep right bias, signal lead time, chance of not signalling, lane change duration, decision interval). Map traffic flow speed, fog and road shape live in `src/data/maps.ts`; density per km per lane is in `Traffic.densityAt`.

### Traffic
* Car following: Intelligent Driver Model against the nearest vehicle overlapping the car's lateral band (traffic, wrecks and the player), plus curve speed limits from look ahead curvature, plus a hard non overlap pass, so cars never phase through each other.
* Lane changes (highways): MOBIL style incentive (acceleration gain + keep right bias) with safety checks on the new leader gap, new follower gap and the new follower's required braking. Cars signal (blinking amber lamps) for a driver specific lead time before moving, brake lights come on when decelerating.
* Driver subtypes, assigned at spawn:
  * **Fast**: 10 to 25 % above flow, 0.55 s headway (tailgating), frequent random weaving, tight lane changes, signals late or (55 %) not at all.
  * **Slow**: 78 to 90 % of flow, big gaps, keeps right, changes lanes rarely and always signals 2.5 to 3.5 s ahead, gentle accelerations.
  * **Scared**: reacts to the player approaching fast from behind or alongside: honks, brakes hard, swerves away within/out of its lane, sometimes freezes (slows to ~45 % for a few seconds), and drifts in lane. Swerves are cancelled if the neighbouring lane is occupied.
* Oncoming cars stay in their lane; if the player is in their lane they honk, brake hard and dodge toward their shoulder.
* Spawning happens beyond the fog horizon ahead (or 170 to 230 m behind when traffic would catch up) with a free gap check; traffic density grows with difficulty and with distance travelled (up to +120 % after 12 km).
* Measured with `npm run check:traffic` (90 s simulated, city): 0 overlapping pairs, 0 cars spawned within 200 m of the player, fast drivers made ~10x the lane changes of slow drivers and signalled ~47 % of them, slow drivers signalled 100 %.

### Crash scene
On a crash (traffic, head on, barrier, treeline): time scale ramps to 0.18x, a flash + point light fires, the camera cuts to a low orbit around the wreck and then pulls out. The player vehicle (and the struck car) become rigid bodies with momentum exchange, tumble and roll scaled by impact speed and centre of gravity height, and bounce off barriers. Body vertices near the impact are dented; hood, door, bumper panels and wheels detach depending on severity. Sparks, paint and plastic debris and glass shards spray from the contact point. Traffic brakes for the wreck; cars that cannot stop in time crash into it too (pile ups, capped at 6). Audio: layered crash burst, glass tinkles, low thump and a muffled low pass "ringing ears" ring out. Motorcycles eject the rider as a separate tumbling body with flailing limbs. Results appear after ~5.5 s (skippable).

## Decisions made where the brief was ambiguous

* Huracán colour: green. Urus colour: yellow.
* Right hand traffic (US style), 5 lanes per direction on highways, US lane widths and markings.
* Motorcycle masses in the data file include a 75 kg rider (garage shows the bike's own weight).
* Real 0-60 / top speed figures are treated as targets: the launch factor auto-calibrates 0-60; top speed comes from drag. Bike top speeds land 3 to 6 % under reference because the wobble assist and drag curve were left as is.
* Any contact with traffic above ~2.5 m/s closing speed along the contact normal (or ~8 m/s total relative speed, 4 m/s for oncoming) is a crash; lighter touches are bumps that reset the combo.
* Traffic is cars only (sedan, hatchback, SUV, pickup, van, box truck) in 12 colours.
* The player starts with a rolling start at 22 m/s after a 3 second countdown.
* Difficulty (Easy / Normal / Hard / Insane) scales traffic flow speed and density.
* Graphics presets: Low (0.75x resolution, no shadows, short draw distance, half props), Medium, High (shadows), Ultra (1.5x resolution, more props, longer draw distance).
* Resolution setting resizes the window in windowed mode; fullscreen always uses the display resolution.

## Verification performed

* `tsc --noEmit` passes; `vite build` passes.
* Headless Chromium (SwiftShader software WebGL) smoke tests: menu, garage, all three maps with cars and bikes, chase and hood cameras, crash cinematic, results screen, pause menu, settings, key rebinding and persistence, near miss and oncoming near miss scoring. No console errors.
* The production bundle and the **exact `app.asar` from the Windows build** were launched with Electron (Linux, Xvfb): game boots from `file://`, runs a session, and writes the save file through IPC, with no errors.
* `npm run dist` produced both Windows exes (PE32+ x86-64).

## Known issues and limitations

* **Not verified on real Windows or a real GPU.** The Windows exes were built and inspected but could not be launched in the build container (Wine 64 bit could not be installed alongside the 32 bit Wine that NSIS needs). The packaged app bundle itself was verified with Linux Electron.
* **60 FPS not measured.** Only software rendering was available, so frame rate on a mid range laptop GPU is unverified. On High the city scene is ~600 draw calls and ~140k triangles with ~95 traffic cars alive; if it is slow, use Medium or Low (no shadows, fewer props, shorter draw distance).
* **Audio and gamepad were not heard/tested** (no audio device or controller in the container). The code paths run without errors.
* Vehicle models are stylised low poly approximations built from extruded profiles and primitives; they capture silhouette, proportions, colours and signature cues (e.g. the ZR1's raised hood with the clear window over the supercharger, wide rear fenders, big splitter and spoiler) but are not detailed replicas. Motorcycles are shown without a rider for now (the rider builder is kept in `BikeBuilder.ts`).
* Deformation is a vertex dent around the impact point. With no rider on the bikes there is currently no rider ejection.
* Traffic wheels do not spin (merged into one mesh per car for performance). Traffic uses per car meshes rather than GPU instancing.
* The KTM's rear stepping out is modest in the simulation (it is agile and wheelie prone, but the bike model does not power slide much).
* No custom app icon; the exe is unsigned, so Windows SmartScreen may warn on first launch.
