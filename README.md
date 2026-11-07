# Dino World 🦖

A 3D dinosaur breakout for ages 12 and up. A tropical storm knocks out the power at Primordia, Halcyon Genetics' dinosaur park on Kessick Island, and Specimen T-07, a T-Rex, gets its chance.

- **Story:** a chain of levels, each with a mission brief, objectives and park-radio chatter. Break out of Paddock 7 before the backup power returns, wreck the security jeeps and scatter the work crews on the service roads, then free the caged dinosaurs on Main Street. Levels 4 (*Blackout*) and 5 (*Last Boat*) are still being built.
- **Rampage:** free play on the island with no objectives, for any dinosaur you've freed in the story. It unlocks after level 1.

People get scared, knocked over and run; nobody gets hurt. iPad-first (touch), and it also plays with keyboard and mouse: WASD to move, mouse to look, click to roar or bite, Space to jump, Esc to pause. Offline-capable web game. No ads, no network calls, no tracking. It started as a game in [Mini Mix](https://github.com/mgade84/mini-mix) and shares its shell.

**Settings** (hold ⚙️ on the title screen for 3 seconds): language (English or Danish, defaults to the device language), sound on/off, reset story progress, and *Refresh app* (clears the offline cache and reloads the newest version).

## Run it

Everything runs in Docker, so you don't need Node installed.

```bash
# Development (hot reload) → http://localhost:5175
docker compose --profile dev up

# Production (nginx) → http://localhost:8082   (change with PORT=…)
docker compose --profile prod up -d --build
```

Open `http://<your-computer-ip>:5175` (or `:8082`) on an iPad on the same Wi-Fi. For a full-screen, app-like experience: Safari → Share → **Add to Home Screen**. Offline support (service worker) only activates over HTTPS or on `localhost`.

## Tech

- **Vite + TypeScript, no UI framework.** Three.js (WebGL), loaded on demand when a level starts (`src/game/game.ts`, `world.ts`). Levels are data in `src/game/levels.ts`. Procedural low-poly dinosaurs with a shared walk/roar rig (`dinos.ts`, `species.ts`), an instanced jungle (one draw call per plant kind) with grid-based collisions, and a third-person chase camera.
- `src/engine/audio.ts` synthesizes every sound effect with Web Audio and handles iOS audio unlocking and speech.
- The title screen, story screens and HUD are plain DOM with transform/opacity-only CSS animations.

## Danish speech clips

iPads and iPhones speak with the device voice. Elsewhere Danish uses one MP3 per phrase passed to `say()`, recorded with Piper (`da_DK-talesyntese-medium`; Piper is MIT, the voice is trained on a CC0 dataset). The clips are generated, not committed: the production build records them in the Dockerfile's `phrases` and `voice` stages, and Docker's build cache keeps earlier recordings.

For the dev server, generate them once (and again after changing spoken Danish text):

```bash
scripts/voice/build.sh   # writes public/voice/ (git-ignored); needs only Docker
```

When you add or change a spoken Danish phrase, also add it to `scripts/voice/phrases.ts`.
