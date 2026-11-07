import type { ChoiceOption, GameContext, GameDef } from './types';
import { say, sfx, stopSpeech } from './engine/audio';
import { addTotalStars } from './engine/storage';
import { L, UI } from './i18n';

const CONFETTI = ['#ff5d8f', '#4cc9f0', '#80ed99', '#ffd166', '#b388ff', '#ff9f1c'];

/** CSS-only confetti: transform/opacity animations run on the compositor. */
function burstHTML(n = 40) {
  let s = '<div class="burst">';
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
    const d = 200 + Math.random() * 280;
    s +=
      `<i style="--k:${CONFETTI[i % CONFETTI.length]};` +
      `--dx:${Math.round(Math.cos(a) * d)}px;--dy:${Math.round(Math.sin(a) * d + 140)}px;` +
      `--r:${Math.round(Math.random() * 720 - 360)}deg;animation-delay:${(Math.random() * 0.15).toFixed(2)}s"></i>`;
  }
  return s + '</div>';
}

export function mountGame(app: HTMLElement, def: GameDef, onExit: () => void): () => void {
  const el = document.createElement('div');
  el.className = 'game';
  el.style.setProperty('--c', def.color);
  el.innerHTML = `
    <div class="game-area"></div>
    <div class="hud">
      <button class="round-btn home" aria-label="${L(UI).home}">🏠</button>
      <div class="hud-title">${def.emoji} ${L(def.title)}</div>
      <div class="pill stars">⭐ <b>0</b></div>
    </div>`;
  app.appendChild(el);

  const area = el.querySelector<HTMLElement>('.game-area')!;
  const hud = el.querySelector<HTMLElement>('.hud')!;
  const starsEl = el.querySelector<HTMLElement>('.stars')!;
  const starsNum = starsEl.querySelector('b')!;
  let stars = 0;
  let overlay: HTMLElement | null = null;

  el.querySelector('.home')!.addEventListener('click', () => {
    sfx.tap();
    onExit();
  });

  function showOverlay(html: string) {
    overlay?.remove();
    overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.innerHTML = html;
    el.appendChild(overlay);
    return overlay;
  }

  function closeOverlay() {
    overlay?.remove();
    overlay = null;
  }

  const ctx: GameContext = {
    area,
    shell: el,
    get topInset() {
      return hud.getBoundingClientRect().bottom - el.getBoundingClientRect().top + 8;
    },
    addStars(n = 1) {
      stars += n;
      starsNum.textContent = String(stars);
      addTotalStars(n);
      starsEl.classList.remove('bump');
      void starsEl.offsetWidth; // restart the CSS animation
      starsEl.classList.add('bump');
    },
    celebrate(title = L(UI).greatJob, subtitle = '', count = 3) {
      sfx.win();
      say(title);
      const row = Array.from({ length: count }, (_, i) => `<span style="--i:${i}">⭐</span>`).join('');
      const o = showOverlay(`
        ${burstHTML()}
        <div class="panel">
          <span class="big-emoji">🎉</span>
          <h2>${title}</h2>
          ${subtitle ? `<p>${subtitle}</p>` : ''}
          <div class="star-row">${row}</div>
          <button class="big-btn" style="--bc:#38b000">${L(UI).playAgain}</button>
        </div>`);
      const shownAt = performance.now();
      return new Promise<void>((resolve) => {
        const btn = o.querySelector('button')!;
        btn.addEventListener('click', () => {
          // Ignore the frantic taps that were meant for the game.
          if (performance.now() - shownAt < 800) return;
          sfx.tap();
          closeOverlay();
          resolve();
        });
      });
    },
    choose<T>(title: string, options: ChoiceOption<T>[], emoji = '👋') {
      const btns = options
        .map(
          (o, i) =>
            `<button class="big-btn" data-i="${i}" style="--bc:${o.color ?? '#ffb703'}">${o.emoji ?? ''} ${o.label}</button>`,
        )
        .join('');
      const o = showOverlay(`
        <div class="panel">
          <span class="big-emoji">${emoji}</span>
          <h2>${title}</h2>
          <div class="choices">${btns}</div>
        </div>`);
      return new Promise<T>((resolve) => {
        o.addEventListener('click', (e) => {
          const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
          if (!b) return;
          sfx.tap();
          closeOverlay();
          resolve(options[Number(b.dataset.i)].value);
        });
      });
    },
  };

  let cleanup = () => {};
  try {
    cleanup = def.start(ctx);
  } catch (err) {
    console.error(`Game "${def.id}" failed to start`, err);
  }

  return () => {
    cleanup();
    stopSpeech();
    el.remove();
  };
}
