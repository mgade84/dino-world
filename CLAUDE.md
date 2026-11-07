# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Dino World is an offline-capable, iPad-first 3D web game for ages 12 and up, built with Vite, TypeScript and Three.js and no UI framework. It makes no network calls and has no ads or tracking. Keep it that way. It is a story game: a T-Rex breaking out of a dinosaur theme park during a storm. The park, island, company and characters are original (Primordia park on Kessick Island, run by Halcyon Genetics; the hero is Specimen T-07). Keep it that way: no names, logos, music or recreated scenes from existing films or games. It was split out of Mini Mix (`../mini-mix`), and `src/` outside `src/game/` is a copy of Mini Mix's shell and engine. When you fix a bug there, consider whether Mini Mix needs the same fix.

## Commands

Docker is the supported workflow, so you don't need Node installed locally:

```bash
docker compose --profile dev up            # Vite dev server, hot reload → http://localhost:5175
docker compose --profile prod up -d --build  # nginx static build → http://localhost:8082 (PORT=… to change)
WATCH_POLLING=true docker compose --profile dev up   # if edits don't trigger reloads
docker compose --profile dev up --build -V           # after changing package.json
```

To typecheck without local Node: `docker compose --profile dev run --rm dev npm run typecheck`.

With Node installed locally (`npm ci` first): `npm run typecheck` (tsc --noEmit, strict, noUnusedLocals/Parameters), `npm run build`, `npm run dev`.

`scripts/voice/build.sh` generates the recorded Danish speech into `public/voice/` for the dev server; it needs only Docker. The production image generates it itself.

The project has no test suite and no linter. `npm run typecheck` is the main correctness check. The build targets `es2020`/`safari14` (iPadOS 14+ Safari), so don't use newer runtime APIs without a fallback.

## Architecture

- **Routing** (`src/main.ts`): hash-based. `#/` is the title screen (`splash.ts`/`splash.css`: a DOM/SVG storm scene with the Story and Rampage menu), `#/settings` is the settings page (`settings.ts`), and `#/story` and `#/rampage` mount the game in that mode through `shell.ts`. Each mount returns an unmount function, and `route()` calls it before mounting the next view. Changing the language re-runs `route()`, so views read strings when they mount.
- **Game contract** (`src/types.ts`): the game is a `GameDef` exported from `src/game/index.ts`. `start(ctx, mode)` must return a cleanup function that tears down everything it created: the renderer, geometries, listeners, timers, audio and speech. The shell owns only the back-to-title button; the game must leave `ctx.topInset` free for it, and can call `ctx.exit()`. There is no score or star system.
- **Three.js**: `src/game/index.ts` lazy-loads `game.ts` with dynamic `import()`, so Three.js lands in a separate chunk. Keep every Three.js import out of the eager graph: `levels.ts`, `progress.ts`, `species.ts` and `strings.ts` are imported by the title screen, settings and `scripts/voice/phrases.ts`, so they must stay free of it.
- **Game flow** (`src/game/index.ts`): plain DOM screens around the 3D level. Story mode goes level select → mission brief → level → debrief (next level or retry). Rampage starts the island straight away with no goals and respawns targets. Each level is a fresh `runDino(ctx, { level, onEnd, onRestart, onQuit })` from `game.ts`, torn down before the next.
- **Levels** (`levels.ts`): data, not code. A `LevelDef` holds its name, place, brief, goals (`escape`, `smash`, `scare`, `free` with counts), a start (`cage` or just outside the broken paddock), an optional time limit, park-radio lines and a `ready` flag. Levels with `ready: false` show as "coming soon". A new goal kind needs counting in `game.ts` (`progress()`), a label in `strings.ts` and the brief text in `index.ts`.
- **Progress** (`progress.ts`): levels completed in order, and which species are unlocked for Rampage (the T-Rex hero always is; freeing a caged dinosaur unlocks its species). Stored under `dinoworld:progress`; settings can reset it.
- **3D modules**: `game.ts` (the level: input, camera, HUD, objectives, radio, pause menu), `world.ts` (terrain and plants), `weather.ts` (storm sky dome, GPU rain that follows the camera, lightning and thunder, rain sound; the level adds `weather.flash` to its lights), `dinos.ts` (the dinosaurs), `park.ts` (cages, jeeps, people). Species are in `species.ts`; to add one, add it to `DINOS` and a builder to `BUILD` in `dinos.ts`.
- **Dinosaur models** (`dinos.ts`): no asset files. A body is a list of spine `Station`s (z, height, half-width, half-height, belly drop) from tail tip to snout; `skinnedBody()` sweeps a cross-section through them into one `SkinnedMesh` and skins it to a pelvis bone, a tail chain and a chest/neck/head chain. Horns, jaws, eyes, plates and wings are attached to the bone at their position with `attach()`. Legs (`buildLeg`) are hip/knee/ankle/foot groups so `animate()` can lift and plant feet. Skin is a scale-and-stripe colour and bump texture painted on a canvas per species colour set (`skinMaterial`). Every swept geometry goes into `owned` and is freed by `disposeDinoAssets()`.
- **Controls**: touch uses a joystick wherever the finger lands plus on-screen buttons. On a computer, a click captures the mouse (pointer lock) for mouse look; WASD/arrows move, click/E/R roars or bites, Space jumps, and Esc/P pauses. Releasing the mouse pointer pauses the game.
- **Three.js disposal**: geometries, materials and skin textures are shared at module level in `dinos.ts`/`park.ts` and freed by `disposeDinoAssets()`/`disposePark()`; `weather.dispose()` frees the storm. Per-run resources go through a local `keep()` helper into a disposables list. `runDino`'s cleanup must call all of these plus `renderer.dispose()`.
- **Audio** (`src/engine/audio.ts`): every sound effect is synthesized with Web Audio; there are no effect files. `say()` uses the Web Speech API on iOS. Elsewhere it speaks Danish with clips generated at build time into `public/voice/da/` (played through the Web Audio graph, so mute applies) and otherwise uses the Web Speech API. `main.ts` wires up iOS audio unlocking.
- **Storage** (`src/engine/storage.ts`): `load`/`save` wrap localStorage with the `dinoworld:` prefix and swallow errors.
- **Offline**: `public/sw.js` is registered only in production builds. Navigations are network-first and other same-origin GETs are cache-first.

## Conventions

- **i18n**: English and Danish (`src/i18n.ts`). `L(x)` picks the current language. Shell strings live in `UI`; the game's strings are in `src/game/strings.ts`, typed as `Record<Lang, typeof en>` so TypeScript flags any missing Danish string. Every new user-facing string, including spoken prompts, needs both languages.
- **Tone (12+)**: realistic and moody, not cute. People get scared, knocked down and run away; nobody is hurt, there is no blood and nobody dies. Reading is fine (briefs, objectives, subtitles), but key story beats are also spoken as park radio through `radio()` in `game.ts`, which shows a subtitle and calls `say()`.
- **Danish speech clips**: every Danish text passed to `say()` needs a clip. `scripts/voice/phrases.ts` collects every level's radio lines from `LEVELS` automatically; any other spoken text must be added there by hand. Clips are generated at build time, never committed (`public/voice/` is git-ignored), and named by `clipKey(text)`, so any text change means a new recording. Missing clips fall back to the device voice and log a warning in dev.
- **iPad first**: the page sets `touch-action: none`, blocks pinch-zoom and long-press menus, respects safe-area insets and supports multi-touch through pointer ids. DOM UI animates with `transform` and `opacity` only.
- **Settings gating**: settings open only after holding ⚙️ on the title screen for 3 seconds.
