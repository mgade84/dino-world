# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Dino World is an offline-capable, iPad-first 3D web game for children, built with Vite, TypeScript and Three.js and no UI framework. It makes no network calls and has no ads or tracking. Keep it that way. It was split out of Mini Mix (`../mini-mix`), and `src/` outside `src/game/` is a copy of Mini Mix's shell and engine. When you fix a bug there, consider whether Mini Mix needs the same fix.

## Commands

Docker is the supported workflow, so you don't need Node installed locally:

```bash
docker compose --profile dev up            # Vite dev server, hot reload → http://localhost:5175
docker compose --profile prod up -d --build  # nginx static build → http://localhost:8082 (PORT=… to change)
WATCH_POLLING=true docker compose --profile dev up   # if edits don't trigger reloads
docker compose --profile dev up --build -V           # after changing package.json
```

With Node installed locally (`npm ci` first): `npm run typecheck` (tsc --noEmit, strict, noUnusedLocals/Parameters), `npm run build`, `npm run dev`.

`scripts/voice/build.sh` generates the recorded Danish speech into `public/voice/` for the dev server; it needs only Docker. The production image generates it itself.

The project has no test suite and no linter. `npm run typecheck` is the main correctness check. The build targets `es2020`/`safari14` (iPadOS 14+ Safari), so don't use newer runtime APIs without a fallback.

## Architecture

- **Routing** (`src/main.ts`): hash-based. `#/` is the start screen (`menu.ts`, one card for the game), `#/settings` is the grown-up settings page (`settings.ts`), and `#/<game.id>` mounts the game through `shell.ts`. Each mount returns an unmount function, and `route()` calls it before mounting the next view. Changing the language re-runs `route()`, so views read strings when they mount.
- **Game contract** (`src/types.ts`): the game is a `GameDef` exported from `src/game/index.ts`. `start(ctx)` must return a cleanup function that tears down everything it created: the renderer, geometries, listeners, timers, audio and speech. The shell owns the HUD (home button, star counter) and the `celebrate()`/`choose()` overlays, and adds stars to the stored total. The game must leave `ctx.topInset` free for the HUD.
- **Three.js**: `src/game/index.ts` lazy-loads each world with dynamic `import()`, so Three.js lands in separate chunks. Keep every Three.js import out of the eager graph.
- **Audio** (`src/engine/audio.ts`): every sound effect is synthesized with Web Audio; there are no effect files. `say()` uses the Web Speech API on iOS. Elsewhere it speaks Danish with clips generated at build time into `public/voice/da/` (played through the Web Audio graph, so mute applies) and otherwise uses the Web Speech API. `main.ts` wires up iOS audio unlocking.
- **Storage** (`src/engine/storage.ts`): `load`/`save` wrap localStorage with the `dinoworld:` prefix and swallow errors.
- **Offline**: `public/sw.js` is registered only in production builds. Navigations are network-first and other same-origin GETs are cache-first.

## Conventions

- **i18n**: English and Danish (`src/i18n.ts`). `L(x)` picks the current language. Shell strings live in `UI`; the game's strings are in `src/game/strings.ts`, typed as `Record<Lang, typeof en>` so TypeScript flags any missing Danish string. Every new user-facing string, including spoken prompts, needs both languages.
- **Non-readers**: the game speaks short prompts with `say()`, and gameplay must not depend on reading.
- **Danish speech clips**: every Danish text passed to `say()` needs a clip. When you add or change one, extend `scripts/voice/phrases.ts`. Clips are generated at build time, never committed (`public/voice/` is git-ignored), and named by `clipKey(text)`, so any text change means a new recording. Missing clips fall back to the device voice and log a warning in dev.
- **iPad/touch**: the page sets `touch-action: none`, blocks pinch-zoom and long-press menus, respects safe-area insets and supports multi-touch through pointer ids. DOM UI animates with `transform` and `opacity` only.
- **Grown-up gating**: settings open only after holding ⚙️ on the start screen for 3 seconds. Any grown-up-only option belongs on that page.
