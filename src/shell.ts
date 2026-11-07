import type { GameContext, GameDef, Mode } from './types';
import { sfx } from './engine/audio';
import { L, UI } from './i18n';

export function mountGame(app: HTMLElement, def: GameDef, mode: Mode, onExit: () => void): () => void {
  const el = document.createElement('div');
  el.className = 'game';
  el.innerHTML = `
    <div class="game-area"></div>
    <div class="hud">
      <button class="round-btn home" aria-label="${L(UI).home}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 4.5 8 12l7.5 7.5" /></svg>
      </button>
    </div>`;
  app.appendChild(el);

  const area = el.querySelector<HTMLElement>('.game-area')!;
  const hud = el.querySelector<HTMLElement>('.hud')!;

  el.querySelector('.home')!.addEventListener('click', () => {
    sfx.tap();
    onExit();
  });

  const ctx: GameContext = {
    area,
    shell: el,
    get topInset() {
      return hud.getBoundingClientRect().bottom - el.getBoundingClientRect().top + 8;
    },
    exit: onExit,
  };

  let cleanup = () => {};
  try {
    cleanup = def.start(ctx, mode);
  } catch (err) {
    console.error(`Game "${def.id}" failed to start`, err);
  }

  return () => {
    cleanup();
    el.remove();
  };
}
