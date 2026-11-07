# Dino World 🦖

A 3D dinosaur breakout for ages 12 and up. A tropical storm knocks out the power at Primordia, Halcyon Genetics' dinosaur park on Kessick Island, and Specimen T-07, a T-Rex, gets its chance.

- **Story:** a chain of levels, each with a mission brief, objectives and park-radio chatter. Break out of Paddock 7 before the backup power returns, wreck the security jeeps and scatter the work crews on the service roads, then free the caged dinosaurs and bring down the buildings on Main Street. Rangers fire tranquilliser darts (dodge them, or charge and scatter them), live electric fences throw you back, and if your energy runs out you're sedated and wake at the last checkpoint. Then black out the island by wrecking the power station's generators (the fences die and every paddock opens), and finally stop the evacuation by capsizing the boats leaving the north docks. Each level opens with a short cinematic shot.
- **Rampage:** free play on the island for any dinosaur you've freed in the story, scored with a combo multiplier for chained mayhem, a saved best score, and more rangers the more damage you do. It unlocks after level 1.

People get scared, knocked flat and run; nobody gets hurt. iPad-first (touch), and it also plays with keyboard and mouse: WASD to move, mouse to look, click to roar or bite, Space to jump, Esc to pause. Offline-capable web game. No ads, no network calls, no tracking. It started as a game in [Mini Mix](https://github.com/mgade84/mini-mix) and shares its shell.

**Settings** (hold ⚙️ on the title screen for 3 seconds): language (English or Danish, defaults to the device language), sound on/off, graphics quality (Auto adapts the detail to keep the frame rate up), a frame-rate readout for checking speed on a device, reset story progress, and *Refresh app* (clears the offline cache and reloads the newest version).

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

- **Vite + TypeScript, no UI framework.** Three.js (WebGL), loaded on demand when a level starts (`src/game/game.ts`, `world.ts`). Levels are data in `src/game/levels.ts`. Procedural dinosaurs with no asset files: smooth skinned bodies swept along the spine, jointed legs and skin textures painted in code (`dinos.ts`, `species.ts`); a storm with GPU rain, lightning and thunder (`weather.ts`); an instanced jungle (one draw call per plant kind) with grid-based collisions, and a third-person chase camera.
- `src/engine/audio.ts` synthesizes every sound effect with Web Audio (there are no sound files and no speech) and handles iOS audio unlocking.
- The title screen, story screens and HUD are plain DOM with transform/opacity-only CSS animations.
