# Smash Court

A polished, playable 3D arcade tennis game that runs in the browser. Built with
**Three.js + Vite + TypeScript**, custom ball physics (no physics engine), procedural
characters, procedural audio and zero external asset files.

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # type-check + production bundle in dist/
npm run preview   # serve the production build
```

## Controls

| Action | Player 1 | Player 2 (local) | Gamepad |
| --- | --- | --- | --- |
| Move | `W A S D` | Arrow keys | Left stick / D-pad |
| Topspin | `J` | Numpad 1 / `,` | A |
| Slice | `K` | Numpad 2 / `.` | B |
| Flat | `J`+`K` together | both together | A + B |
| Lob | `J` then `K` (while holding) | – | A then B |
| Drop shot | `K` then `J` (while holding) | – | B then A |
| Dive / lunge | `L` | Numpad 3 / `/` | X / LB |
| Power Shot (full meter) | `U` | Numpad 0 / Right Shift | Y / RB |
| Pause | `Esc` | | Start |

* **Charge**: press a shot button *before* the ball arrives. You plant your feet, a meter fills above your head, and the swing fires automatically when the ball gets to you. Longer charge = harder shot. Release early to cancel.
* **Aim**: hold a direction at contact. Left/right steers across the court; toward the net = deep, away = short.
* **Timing**: hit early for cross-court, late for down the line, on time for a **PERFECT** flash and a power bonus.
* **Serve**: press once to toss, again at the top of the toss for a fast serve.
* **Chance zones**: when the opponent floats a weak ball a glowing star appears. Stand on it and hit for a boosted shot; use the button matching the star's colour for an extra bonus.
* **Power Shot**: good shots and long rallies fill the meter. When it's full press `U`. The receiver must press a shot button within a short window to block, or their racket gets knocked back.

## Modes

* **Exhibition** – 1P vs CPU (Easy / Medium / Hard) or 2P local. 1 game, 1 set or best of 3.
* **Doubles** – 2 v 2 with CPU partners.
* **Tournament** – a three-round ladder against increasingly difficult opponents on different courts.
* **Practice** – ball machine with adjustable shot type, feed position, target zones and interval.

## Roster

Eight original characters, each with a distinct silhouette, palette, victory animation, voice and Power Shot:

| Character | Type | Power Shot |
| --- | --- | --- |
| Ace Volley | All-Around | Thunder Drive (lightning) |
| Brick Bastion | Power | Seismic Slam (quake) |
| Zippy Zest | Speed | Cyclone Dash (wind) |
| Lumen Vale | Technical | Glacier Line (ice) |
| Hex Mirage | Tricky | Phantom Curve (shadow) |
| Oakley Root | Defensive | Blossom Burst (bloom) |
| Pepper Flare | Power | Inferno Smash (fire) |
| Nimbus Prism | All-Around | Prism Bounce (rainbow) |

## Courts

Metro Stadium (hard), Terracotta Terrace (clay, leaves ball marks), Willowbrook Lawn (grass, fast and low) and Sugar Rush Court (candy court at sunset with bouncy gumdrop patches).

## Code layout

```
src/
  config/    all tunable constants: court dimensions, physics, shots, characters, courts, AI difficulty
  core/      fixed-timestep game loop, input manager (keyboard + gamepad), state machine, human controller, Game orchestrator
  physics/   ball integrator (gravity, drag, Magnus, bounces, net), numerical shot solver, trajectory prediction
  entities/  Ball, Player, procedural CharacterModel, Net, Court
  ai/        CPU opponent controller, practice ball machine
  rules/     tennis scoring (points, games, sets, tiebreaks)
  match/     match flow: serving, faults, lets, rallies, side switching, replay recording
  render/    scene/lights/sky, camera rig, toon materials + outlines, particles, trail, crowd, effects
  ui/        HUD and menus (DOM)
  audio/     procedural Web Audio SFX, crowd and music
```

Physics notes live at the top of `src/physics/BallPhysics.ts` and `src/physics/ShotSolver.ts`.
Characters are built from primitives in `src/entities/CharacterModel.ts`; the rig exposes named
pivots so GLTF models can be swapped in later.
