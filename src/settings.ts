import { isMuted, setMuted, sfx } from './engine/audio';
import { getQuality, getShowFps, setQuality, setShowFps, type Quality } from './engine/storage';
import { getLang, L, LANGS, setLang, UI } from './i18n';
import { LEVELS } from './game/levels';
import { levelsDone, resetProgress } from './game/progress';

export interface SettingsOpts {
  /** The back (or, in game, close) button. */
  onClose(): void;
  /** After the language changed. Left out, the panel just redraws itself in the new language. */
  onLangChange?(): void;
  /** After any other setting changed, so a running level can pick it up (e.g. the frame-rate readout). */
  onChange?(): void;
  /**
   * Opened over a paused level: a close button instead of back, no progress reset (the running level
   * would write its own progress back over it), and a note that some changes wait for the next level.
   */
  inGame?: boolean;
}

/** Settings page: language, sound, story progress and an app refresh. */
export function mountSettings(app: HTMLElement, onBack: () => void, onLangChange: () => void): () => void {
  return buildSettings(app, { onClose: onBack, onLangChange });
}

/** Builds the settings panel into `parent`; returns a function that removes it. */
export function buildSettings(parent: HTMLElement, opts: SettingsOpts): () => void {
  // With no route to re-run, a language change redraws the panel in place and leaves everything else alone.
  let teardown = () => {};
  const redraw = () => {
    teardown();
    teardown = draw(parent, opts, redraw);
  };
  redraw();
  return () => teardown();
}

function draw(parent: HTMLElement, opts: SettingsOpts, redraw: () => void): () => void {
  const inGame = !!opts.inGame;
  const el = document.createElement('div');
  el.className = `menu settings${inGame ? ' in-game' : ''}`;
  const t = L(UI);
  const toggle = (key: string, on: boolean) =>
    `<button class="switch ${on ? 'on' : ''}" data-toggle="${key}" role="switch" aria-checked="${on}">
      <span>${on ? t.on : t.off}</span><i></i>
    </button>`;

  let armTimer = 0;
  el.innerHTML = `
    <header class="menu-head">
      <button class="round-btn back" aria-label="${inGame ? t.close : t.home}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${inGame ? 'M6 6l12 12M18 6 6 18' : 'M15.5 4.5 8 12l7.5 7.5'}" /></svg></button>
      <h1 class="settings-title">${t.settings}</h1>
    </header>
    <main class="settings-list">
      <section class="setting">
        <div class="setting-text"><b>${t.language}</b></div>
        <div class="lang-toggle" role="radiogroup" aria-label="${t.language}">
          ${LANGS.map((l) => `<button class="${l.id === getLang() ? 'on' : ''}" data-lang="${l.id}" role="radio" aria-checked="${l.id === getLang()}" aria-label="${l.label}"><span>${l.flag}</span>${l.label}</button>`).join('')}
        </div>
      </section>
      <section class="setting">
        <div class="setting-text"><b>${t.soundLabel}</b></div>
        ${toggle('sound', !isMuted())}
      </section>
      <section class="setting">
        <div class="setting-text"><b>${t.graphics}</b><small>${t.graphicsHint}</small></div>
        <div class="lang-toggle" role="radiogroup" aria-label="${t.graphics}">
          ${(['auto', 'high', 'low'] as Quality[]).map((q) => `<button class="${q === getQuality() ? 'on' : ''}" data-quality="${q}" role="radio" aria-checked="${q === getQuality()}">${t[q === 'auto' ? 'qAuto' : q === 'high' ? 'qHigh' : 'qLow']}</button>`).join('')}
        </div>
      </section>
      <section class="setting">
        <div class="setting-text"><b>${t.fps}</b></div>
        ${toggle('fps', getShowFps())}
      </section>
      ${inGame ? `<p class="settings-note">${t.nextLevel}</p>` : `<section class="setting">
        <div class="setting-text"><b>${t.progress}</b><small class="progress-hint">${t.progressHint(levelsDone(), LEVELS.length)}</small></div>
        <button class="action-btn danger reset-progress" ${levelsDone() ? '' : 'disabled'}>${t.resetProgress}</button>
      </section>`}
      <section class="setting">
        <div class="setting-text"><b>${t.app}</b><small>${t.refreshHint}</small></div>
        <button class="action-btn refresh">${t.refresh}</button>
      </section>
    </main>`;
  parent.appendChild(el);

  async function refresh() {
    // Drop the service worker's caches so the reload fetches everything fresh.
    try {
      const regs = (await navigator.serviceWorker?.getRegistrations()) ?? [];
      await Promise.all(regs.map((r) => r.update().catch(() => {})));
      if ('caches' in window) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    } catch {
      /* not critical: reload anyway */
    }
    location.reload();
  }

  el.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('.back')) {
      sfx.tap();
      opts.onClose();
      return;
    }
    const langBtn = target.closest<HTMLElement>('[data-lang]');
    if (langBtn) {
      const l = langBtn.dataset.lang as (typeof LANGS)[number]['id'];
      if (l !== getLang()) {
        setLang(l);
        sfx.pop();
        if (opts.onLangChange) opts.onLangChange();
        else redraw();
      }
      return;
    }
    const qBtn = target.closest<HTMLElement>('[data-quality]');
    if (qBtn) {
      setQuality(qBtn.dataset.quality as Quality);
      el.querySelectorAll<HTMLElement>('[data-quality]').forEach((b) => {
        b.classList.toggle('on', b === qBtn);
        b.setAttribute('aria-checked', String(b === qBtn));
      });
      sfx.tap();
      opts.onChange?.();
      return;
    }
    const sw = target.closest<HTMLElement>('[data-toggle]');
    if (sw) {
      const on = !sw.classList.contains('on');
      if (sw.dataset.toggle === 'fps') setShowFps(on);
      else setMuted(!on);
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-checked', String(on));
      sw.querySelector('span')!.textContent = on ? t.on : t.off;
      sfx.tap();
      opts.onChange?.();
      return;
    }
    const reset = target.closest<HTMLButtonElement>('.reset-progress');
    if (reset) {
      // Two taps, so one stray tap can't wipe the story.
      clearTimeout(armTimer);
      if (!reset.classList.contains('armed')) {
        reset.classList.add('armed');
        reset.textContent = t.sure;
        sfx.tap();
        armTimer = window.setTimeout(() => {
          reset.classList.remove('armed');
          reset.textContent = t.resetProgress;
        }, 3000);
        return;
      }
      resetProgress();
      reset.classList.remove('armed');
      reset.textContent = t.resetProgress;
      reset.disabled = true;
      el.querySelector('.progress-hint')!.textContent = t.progressHint(0, LEVELS.length);
      sfx.whoosh();
      return;
    }
    const btn = target.closest<HTMLButtonElement>('.refresh');
    if (btn) {
      sfx.tap();
      btn.disabled = true;
      btn.textContent = '⏳';
      refresh();
    }
  });

  return () => {
    clearTimeout(armTimer);
    el.remove();
  };
}
