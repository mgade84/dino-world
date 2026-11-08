import { load, save } from './engine/storage';

export type Lang = 'en' | 'da';
export type Txt = Record<Lang, string>;

export const LANGS: { id: Lang; flag: string; label: string }[] = [
  { id: 'en', flag: '🇬🇧', label: 'English' },
  { id: 'da', flag: '🇩🇰', label: 'Dansk' },
];

const deviceLang: Lang = navigator.language?.toLowerCase().startsWith('da') ? 'da' : 'en';
let lang: Lang = load<Lang>('lang', deviceLang);
document.documentElement.lang = lang;

export const getLang = () => lang;

export function setLang(l: Lang) {
  lang = l;
  save('lang', l);
  document.documentElement.lang = l;
}


/** Picks the current language's entry: L({ en: 'dog', da: 'hund' }), or a whole message table. */
export function L<T>(m: Record<Lang, T>): T {
  return m[lang];
}

const en = {
  home: 'Back to title screen',
  sound: 'Sound on/off',
  language: 'Language',
  settings: 'Settings',
  close: 'Close settings',
  soundLabel: 'Sound',
  graphics: 'Graphics',
  graphicsHint: 'Auto lowers the detail when the game runs slowly',
  qAuto: 'Auto',
  qHigh: 'High',
  qLow: 'Low',
  fps: 'Show frame rate',
  app: 'App',
  refresh: 'Refresh app',
  refreshHint: 'Loads the newest version',
  on: 'On',
  off: 'Off',
  progress: 'Story progress',
  progressHint: (done: number, total: number) => `Levels completed: ${done} of ${total}`,
  resetProgress: 'Reset progress',
  sure: 'Tap again to reset',
  nextLevel: 'Graphics and language changes take effect from the next level. Story progress can be reset from the title screen.',
};

/** Shell, splash and settings strings. Games keep their own tables next to their code. */
export const UI: Record<Lang, typeof en> = {
  en,
  da: {
    home: 'Tilbage til titelskærmen',
    sound: 'Lyd til/fra',
    language: 'Sprog',
    settings: 'Indstillinger',
    close: 'Luk indstillinger',
    soundLabel: 'Lyd',
    graphics: 'Grafik',
    graphicsHint: 'Auto sænker detaljerne, når spillet kører langsomt',
    qAuto: 'Auto',
    qHigh: 'Høj',
    qLow: 'Lav',
    fps: 'Vis billedfrekvens',
    app: 'App',
    refresh: 'Opdater app',
    refreshHint: 'Henter den nyeste version',
    on: 'Til',
    off: 'Fra',
    progress: 'Historien',
    progressHint: (done: number, total: number) => `Gennemførte baner: ${done} af ${total}`,
    resetProgress: 'Nulstil',
    sure: 'Tryk igen for at nulstille',
    nextLevel: 'Ændringer i grafik og sprog gælder fra næste bane. Historien kan nulstilles fra titelskærmen.',
  },
};
