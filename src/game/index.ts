import type { GameDef } from '../types';
import { sfx } from '../engine/audio';
import { L } from '../i18n';
import { LEVELS, type Goal, type LevelDef } from './levels';
import { completeLevel, levelOpen, levelsDone } from './progress';
import { clock, S } from './strings';
import './dino.css';

type Run = typeof import('./game').runDino;
/** Three.js and the island are only downloaded when a level starts. */
let runPromise: Promise<Run> | null = null;
const loadRun = () => (runPromise ??= import('./game').then((m) => m.runDino).catch((err) => ((runPromise = null), Promise.reject(err))));

/** Keyboard-and-mouse players get keyboard hints; touch players get touch hints. */
const finePointer = () => window.matchMedia?.('(pointer: fine)').matches ?? false;

function goalText(g: Goal) {
  switch (g.kind) {
    case 'escape': return S().goalEscape;
    case 'smash': return `${S().goalSmash} ×${g.n}`;
    case 'scare': return `${S().goalScare} ×${g.n}`;
    case 'free': return `${S().goalFree} ×${g.n}`;
    case 'destroy': return `${S().goalDestroy} ×${g.n}`;
  }
}

/** Story: level select → briefing → level → debrief. Rampage: straight onto the island. */
export const dino: GameDef = {
  id: 'dino',
  title: { en: 'Dino World', da: 'Dinoverden' },
  emoji: '🦖',
  color: '#c8401e',
  start(ctx, mode) {
    let cleanup: (() => void) | null = null;
    let screen: HTMLElement | null = null;
    let dead = false;
    const loading = document.createElement('div');
    loading.className = 'dn-loading';

    function show(cls: string, html: string) {
      screen?.remove();
      screen = document.createElement('div');
      screen.className = `dn-screen ${cls}`;
      screen.style.setProperty('--top', `${ctx.topInset}px`);
      screen.innerHTML = html;
      ctx.shell.appendChild(screen);
      return screen;
    }
    function closeScreen() {
      screen?.remove();
      screen = null;
    }
    function stopRun() {
      cleanup?.();
      cleanup = null;
    }

    function levelSelect() {
      stopRun();
      const done = levelsDone();
      const cards = LEVELS.map((lv, i) => {
        const open = levelOpen(i);
        const state = i < done ? 'done' : open ? 'open' : 'locked';
        const tag = !lv.ready ? S().comingSoon : state === 'locked' ? S().locked : '';
        return `
          <button class="dn-level ${state}" data-i="${i}" ${open ? '' : 'disabled'}>
            <span class="dn-level-no">${String(i + 1).padStart(2, '0')}</span>
            <span class="dn-level-text"><b>${L(lv.name)}</b><small>${L(lv.place)}</small></span>
            ${tag ? `<span class="dn-tag">${tag}</span>` : state === 'done' ? '<span class="dn-check" aria-hidden="true"></span>' : ''}
          </button>`;
      }).join('');
      const el = show('dn-levels', `<div class="dn-panel"><h2>${S().levels}</h2><div class="dn-level-list">${cards}</div></div>`);
      el.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-i]');
        if (!b || b.disabled) return;
        sfx.tap();
        brief(Number(b.dataset.i));
      });
    }

    function brief(i: number) {
      stopRun();
      const lv = LEVELS[i];
      const goals = lv.goals.map((g) => `<li>${goalText(g)}</li>`).join('');
      const el = show('dn-brief', `
        <div class="dn-panel">
          <p class="dn-kicker">${S().level(i + 1)} · ${L(lv.place)}</p>
          <h2>${L(lv.name)}</h2>
          <p class="dn-brief-text">${L(lv.brief)}</p>
          <h3>${S().objectives}</h3>
          <ul class="dn-brief-goals">${goals}${lv.timeLimit ? `<li class="dn-time">${S().timeLimit(clock(lv.timeLimit))}</li>` : ''}</ul>
          <p class="dn-controls">${finePointer() ? S().controlsKeys : S().controlsTouch}</p>
          <div class="dn-row">
            <button class="dn-big dn-ghost" data-act="back">${S().back}</button>
            <button class="dn-big" data-act="go">${S().start}</button>
          </div>
        </div>`);
      el.addEventListener('click', (e) => {
        const a = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
        if (!a) return;
        sfx.tap();
        if (a === 'go') play(lv, i);
        else levelSelect();
      });
    }

    function debrief(i: number, won: boolean, time: number) {
      stopRun();
      const lv = LEVELS[i];
      if (won) completeLevel(i);
      const hasNext = won && levelOpen(i + 1);
      const el = show(`dn-debrief ${won ? 'won' : 'lost'}`, `
        <div class="dn-panel">
          <p class="dn-kicker">${S().level(i + 1)} · ${L(lv.name)}</p>
          <h2>${won ? S().complete : S().failed}</h2>
          ${won ? `<p class="dn-brief-text">${S().timeTaken(clock(time))}</p>` : ''}
          ${won && !hasNext ? `<p class="dn-brief-text">${S().finale}</p>` : ''}
          <div class="dn-row">
            <button class="dn-big dn-ghost" data-act="levels">${S().toLevels}</button>
            ${won ? (hasNext ? `<button class="dn-big" data-act="next">${S().next}</button>` : '') : `<button class="dn-big" data-act="retry">${S().retry}</button>`}
          </div>
        </div>`);
      el.addEventListener('click', (e) => {
        const a = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act;
        if (!a) return;
        sfx.tap();
        if (a === 'next') brief(i + 1);
        else if (a === 'retry') play(lv, i);
        else levelSelect();
      });
    }

    function play(lv: LevelDef | null, i: number) {
      closeScreen();
      stopRun();
      loading.textContent = S().loading;
      ctx.shell.appendChild(loading);
      loadRun()
        .then((run) => {
          if (dead) return;
          loading.remove();
          cleanup = run(ctx, {
            level: lv,
            onEnd: ({ won, time }) => debrief(i, won, time),
            onRestart: () => play(lv, i),
            onQuit: () => (lv ? levelSelect() : ctx.exit()),
          });
        })
        .catch((err) => {
          console.error(err);
          loading.textContent = S().loadFailed;
        });
    }

    if (mode === 'rampage') play(null, -1);
    else levelSelect();

    return () => {
      dead = true;
      stopRun();
      closeScreen();
      loading.remove();
    };
  },
};
