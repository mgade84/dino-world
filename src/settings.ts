import { isMuted, setMuted, sfx } from './engine/audio';
import { getLang, L, LANGS, setLang, UI } from './i18n';
import { LEVELS } from './game/levels';
import { levelsDone, resetProgress } from './game/progress';

/** Settings page: language, sound, story progress and an app refresh. */
export function mountSettings(app: HTMLElement, onBack: () => void, onLangChange: () => void): () => void {
  const el = document.createElement('div');
  el.className = 'menu settings';
  const t = L(UI);
  const toggle = (key: string, on: boolean) =>
    `<button class="switch ${on ? 'on' : ''}" data-toggle="${key}" role="switch" aria-checked="${on}">
      <span>${on ? t.on : t.off}</span><i></i>
    </button>`;

  let armTimer = 0;
  el.innerHTML = `
    <header class="menu-head">
      <button class="round-btn back" aria-label="${t.home}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15.5 4.5 8 12l7.5 7.5" /></svg></button>
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
        <div class="setting-text"><b>${t.progress}</b><small class="progress-hint">${t.progressHint(levelsDone(), LEVELS.length)}</small></div>
        <button class="action-btn danger reset-progress" ${levelsDone() ? '' : 'disabled'}>${t.resetProgress}</button>
      </section>
      <section class="setting">
        <div class="setting-text"><b>${t.app}</b><small>${t.refreshHint}</small></div>
        <button class="action-btn refresh">${t.refresh}</button>
      </section>
    </main>`;
  app.appendChild(el);

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
      onBack();
      return;
    }
    const langBtn = target.closest<HTMLElement>('[data-lang]');
    if (langBtn) {
      const l = langBtn.dataset.lang as (typeof LANGS)[number]['id'];
      if (l !== getLang()) {
        setLang(l);
        sfx.pop();
        onLangChange();
      }
      return;
    }
    const sw = target.closest<HTMLElement>('[data-toggle]');
    if (sw) {
      const on = !sw.classList.contains('on');
      setMuted(!on);
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-checked', String(on));
      sw.querySelector('span')!.textContent = on ? t.on : t.off;
      sfx.tap();
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
