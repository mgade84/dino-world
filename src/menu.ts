import type { GameDef } from './types';
import { sfx } from './engine/audio';
import { getTotalStars } from './engine/storage';
import { L, UI } from './i18n';

const LOGO = 'Dino World';
const HOLD_MS = 3000;
const LOGO_COLORS = ['#ff5d8f', '#ff9f1c', '#ffd166', '#38b000', '#4cc9f0', '#3a86ff', '#b388ff', '#ff70a6'];

export function mountMenu(
  app: HTMLElement,
  games: GameDef[],
  onPick: (g: GameDef) => void,
  onSettings: () => void,
): () => void {
  const el = document.createElement('div');
  el.className = 'menu';

  let deco = '';
  for (let i = 0; i < 14; i++) {
    const size = 30 + Math.random() * 90;
    deco +=
      `<span style="width:${size}px;height:${size}px;left:${Math.random() * 100}%;` +
      `animation-duration:${14 + Math.random() * 16}s;animation-delay:${-Math.random() * 30}s"></span>`;
  }

  const logo = [...LOGO]
    .map((ch, i) =>
      ch === ' '
        ? '<i class="logo-gap"></i>'
        : `<span style="--i:${i};--lc:${LOGO_COLORS[i % LOGO_COLORS.length]}">${ch}</span>`,
    )
    .join('');

  const cards = games
    .map(
      (g, i) => `
      <button class="card" data-id="${g.id}" style="--c:${g.color};--i:${i}">
        <span class="card-age">${g.age}</span>
        <span class="card-emoji">${g.emoji}</span>
        <span class="card-title">${L(g.title)}</span>
      </button>`,
    )
    .join('');

  el.innerHTML = `
    <div class="menu-deco" aria-hidden="true">${deco}</div>
    <header class="menu-head">
      <h1 class="logo" aria-label="${LOGO}">${logo}</h1>
      <div class="menu-actions">
        <div class="pill">⭐ <b>${getTotalStars()}</b></div>
        <button class="round-btn settings-btn" aria-label="${L(UI).settings}">
          <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="29" /></svg>⚙️
          <span class="hold-hint">${L(UI).hold}</span>
        </button>
      </div>
    </header>
    <main class="grid">${cards}</main>`;
  app.appendChild(el);

  let picking = false;
  const onClick = (e: Event) => {
    const target = e.target as HTMLElement;
    const card = target.closest<HTMLElement>('.card');
    const g = card && games.find((x) => x.id === card.dataset.id);
    if (!g || picking) return;
    picking = true;
    sfx.pop();
    setTimeout(() => onPick(g), 140); // let the press animation show
  };
  el.addEventListener('click', onClick);

  // Child lock: settings open only after holding the button for HOLD_MS.
  const gear = el.querySelector<HTMLElement>('.settings-btn')!;
  let holdTimer = 0;
  let hintTimer = 0;
  const cancelHold = () => {
    if (!gear.classList.contains('holding')) return;
    clearTimeout(holdTimer);
    gear.classList.remove('holding');
    gear.classList.add('hint');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => gear.classList.remove('hint'), 2500);
  };
  gear.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    gear.setPointerCapture(e.pointerId);
    gear.classList.remove('hint');
    gear.classList.add('holding');
    sfx.tap();
    holdTimer = setTimeout(() => {
      gear.classList.remove('holding');
      sfx.pop();
      onSettings();
    }, HOLD_MS);
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) gear.addEventListener(ev, cancelHold);

  return () => {
    clearTimeout(holdTimer);
    clearTimeout(hintTimer);
    el.remove();
  };
}
