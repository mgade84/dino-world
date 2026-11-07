import type { Txt } from './i18n';

export interface ChoiceOption<T> {
  label: string;
  value: T;
  emoji?: string;
  color?: string;
}

/** What the shell hands to every game. */
export interface GameContext {
  /** Full-screen element to mount canvases in. */
  area: HTMLElement;
  /** The game's root element, for extra DOM like toolbars. */
  shell: HTMLElement;
  /** Pixels at the top covered by the HUD (home button / stars). */
  readonly topInset: number;
  addStars(n?: number): void;
  /** Shows a celebration overlay; resolves when the child taps "Play again". */
  celebrate(title?: string, subtitle?: string, stars?: number): Promise<void>;
  /** Shows big picture buttons; resolves with the chosen value. */
  choose<T>(title: string, options: ChoiceOption<T>[], emoji?: string): Promise<T>;
}

export interface GameDef {
  id: string;
  title: Txt;
  emoji: string;
  color: string;
  age: string;
  /** Starts the game; returns a cleanup function. */
  start(ctx: GameContext): () => void;
}
