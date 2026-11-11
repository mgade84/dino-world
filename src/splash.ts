import type { GameDef } from './types';
import { sfx } from './engine/audio';
import { L, UI } from './i18n';
import { rampageBest, rampageOpen } from './game/progress';
import { S } from './game/strings';
import './splash.css';

/** The jungle's edge against the sky: a ragged canopy with a few tall palms. */
const CANOPY = `
<svg class="sp-canopy" viewBox="0 0 1200 300" preserveAspectRatio="none" aria-hidden="true">
  <path d="M0 140c30-30 60-40 90-20 20-40 70-50 100-20 30-30 70-20 90 10 30-40 90-40 120 0 20-20 60-20 80 10 40-50 110-40 130 10 30-20 70-10 90 20 30-30 80-30 100 0 20-40 80-50 110-10 30-20 70-10 90 20 40-30 90-20 110 10 20-10 60-10 90 10V300H0z"/>
  <path d="M188 120l6-90M194 30c-30 0-50 10-62 26 22-8 44-12 62-10-28 4-46 18-54 34 20-14 40-22 54-24 10 8 24 22 30 38-2-18-10-32-20-40 18 0 38 6 54 18-12-18-36-28-58-28 16-8 36-8 56 0-18-14-42-16-62-14z"/>
  <path d="M1012 130l-4-100M1008 30c-30-4-52 6-66 20 22-6 46-6 64-2-28 8-44 24-50 40 18-16 38-26 52-30 12 8 26 20 34 36-4-18-14-30-24-38 18-2 38 4 56 14-14-16-38-24-60-22 14-10 34-12 54-6-18-12-42-14-60-12z"/>
</svg>`;

/** The paddock's perimeter fence: concrete posts and cables, one section torn open. */
const fence = (sign: { danger: string; paddock: string; voltage: string }) => `
<svg class="sp-fence" viewBox="0 0 1200 260" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <g class="sp-posts">
    <rect x="70" y="20" width="26" height="240"/><rect x="330" y="20" width="26" height="240"/>
    <rect x="840" y="20" width="26" height="240"/><rect x="1100" y="20" width="26" height="240"/>
  </g>
  <g class="sp-wires">
    <path d="M96 50H330M96 90H330M96 130H330M96 170H330M96 210H330"/>
    <path d="M866 50h234M866 90h234M866 130h234M866 170h234M866 210h234"/>
    <path d="M356 50c80 10 130 60 150 120M356 90c60 16 96 56 108 110M356 130c40 20 66 50 70 100"/>
    <path d="M840 50c-90 14-140 70-160 140M840 90c-60 18-100 56-112 120M840 130c-40 22-66 56-70 104"/>
    <path d="M356 210c30 6 50 20 60 50M840 210c-30 6-52 22-62 50"/>
  </g>
  <g class="sp-sign">
    <rect x="128" y="96" width="170" height="92" rx="4"/>
    <rect class="sp-sign-band" x="128" y="96" width="170" height="26" rx="4"/>
    <text x="213" y="115" text-anchor="middle">${sign.danger}</text>
    <text class="sp-sign-sub" x="213" y="148" text-anchor="middle">${sign.paddock}</text>
    <text class="sp-sign-sub" x="213" y="172" text-anchor="middle">${sign.voltage}</text>
  </g>
</svg>`;

/** Title screen: a storm over a broken paddock fence, something watching from the dark, and the menu. */
export function mountSplash(
  app: HTMLElement,
  def: GameDef,
  go: { story(): void; rampage(): void; settings(): void },
): () => void {
  const el = document.createElement('div');
  el.className = 'splash';
  const t = L(UI);
  const s = S();
  const canRampage = rampageOpen();

  el.innerHTML = `
    <div class="sp-scene" aria-hidden="true">
      <div class="sp-clouds sp-clouds-a"></div>
      <div class="sp-clouds sp-clouds-b"></div>
      <div class="sp-bolt"><svg viewBox="0 0 100 400" preserveAspectRatio="none"><path d="M60 0L38 120l18 4-30 110 16 2-24 164 50-190-18-2 34-112-18-4z"/></svg></div>
      ${CANOPY}
      <div class="sp-eyes"><i></i><i></i></div>
      ${fence(s.sign)}
      <div class="sp-rain"></div>
      <div class="sp-rain sp-rain-near"></div>
      <div class="sp-flash"></div>
      <div class="sp-vignette"></div>
    </div>

    <div class="sp-title">
      <div class="sp-logo"><h1>${L(def.title)}</h1><span class="sp-beta">${s.beta}</span></div>
      <p>${s.tagline}</p>
    </div>

    <nav class="sp-menu">
      <button class="sp-item" data-go="story"><b>${s.story}</b><small>${s.storySub}</small></button>
      <button class="sp-item" data-go="rampage" ${canRampage ? '' : 'disabled'}><b>${s.rampage}</b><small>${canRampage ? (rampageBest() ? s.best(rampageBest().toLocaleString()) : s.rampageSub) : s.rampageLocked}</small></button>
      <button class="sp-item" data-go="settings"><b>${t.settings}</b><small>${s.settingsSub}</small></button>
    </nav>`;
  app.appendChild(el);

  const timers: number[] = [];

  // Lightning at random intervals, with thunder a moment later (once audio has been unlocked by a tap).
  function strike() {
    el.classList.remove('flash');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('flash');
    timers.push(window.setTimeout(() => sfx.thunder(), 500 + Math.random() * 900));
    timers.push(window.setTimeout(strike, 6000 + Math.random() * 7000));
  }
  timers.push(window.setTimeout(strike, 1800));

  let leaving = false;
  el.querySelector('.sp-menu')!.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-go]');
    if (!b || b.disabled || leaving) return;
    if (b.dataset.go === 'settings') {
      sfx.tap();
      go.settings();
      return;
    }
    leaving = true;
    sfx.roar(1.3);
    el.classList.add('going');
    timers.push(window.setTimeout(b.dataset.go === 'story' ? go.story : go.rampage, 700));
  });

  return () => {
    timers.forEach(clearTimeout);
    el.remove();
  };
}
