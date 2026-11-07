import type { Txt } from './i18n';

/** Which part of the game the title screen opened. */
export type Mode = 'story' | 'rampage';

/** What the shell hands to the game. */
export interface GameContext {
  /** Full-screen element to mount canvases in. */
  area: HTMLElement;
  /** The game's root element, for extra DOM like toolbars. */
  shell: HTMLElement;
  /** Pixels at the top covered by the HUD (the exit button). */
  readonly topInset: number;
  /** Back to the title screen. */
  exit(): void;
}

export interface GameDef {
  id: string;
  title: Txt;
  emoji: string;
  color: string;
  /** Starts the game; returns a cleanup function. */
  start(ctx: GameContext, mode: Mode): () => void;
}
