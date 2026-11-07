# Dino World 🦖

3D dinosaur adventures for children in two worlds. **Jungle:** pick a T-Rex, Triceratops, Stegosaurus, Brachiosaurus, the super-fast Spinoraptor or a Pteranodon (hold the jump button to fly), bite out of the cage (🦷, 3 bites), smash 10 jeeps, scare 10 visitors and free 4 caged dinosaurs for bonus stars. **Ocean:** pick a Mosasaurus, Plesiosaur or the speedy Ichthyosaur, swim at the surface, hold 🤿 to dive to the seabed, eat 10 fish and scare the tourists off 5 boats.

Age 4+. iPad-first, offline-capable web game. No ads, no network calls, no tracking. It started as a game in [Mini Mix](https://github.com/mgade84/mini-mix) and shares its shell.

Games speak short prompts so non-readers can play. **Settings** (hold ⚙️ on the start screen for 3 seconds, so children don't open it by accident): language (English or Danish, defaults to the device language), sound on/off, reset stars, and *Refresh app* (clears the offline cache and reloads the newest version).

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

- **Vite + TypeScript, no UI framework.** Three.js (WebGL), loaded on demand: a world picker (`src/game/index.ts`) loads the jungle (`game.ts`, `world.ts`) or the ocean (`sea.ts`, `seaworld.ts`). Procedural low-poly dinosaurs with a shared walk/roar rig (`dinos.ts`, `species.ts`), an instanced jungle (one draw call per plant kind) with grid-based collisions, and a third-person chase camera.
- `src/engine/audio.ts` synthesizes every sound effect with Web Audio and handles iOS audio unlocking and speech.
- Start screen, HUD and overlays are plain DOM with transform/opacity-only CSS animations.

## Danish speech clips

iPads and iPhones speak with the device voice. Elsewhere Danish uses one MP3 per phrase passed to `say()`, recorded with Piper (`da_DK-talesyntese-medium`; Piper is MIT, the voice is trained on a CC0 dataset). The clips are generated, not committed: the production build records them in the Dockerfile's `phrases` and `voice` stages, and Docker's build cache keeps earlier recordings.

For the dev server, generate them once (and again after changing spoken Danish text):

```bash
scripts/voice/build.sh   # writes public/voice/ (git-ignored); needs only Docker
```

When you add or change a spoken Danish phrase, also add it to `scripts/voice/phrases.ts`.
