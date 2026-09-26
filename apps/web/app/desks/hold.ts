/**
 * Hold to approve, as a timer with rules and no browser: one continuous hold
 * by the one pointer or key that started it, cancelled by anything that could
 * let go of it unnoticed, and checked again when the time is up. The button
 * feeds it events; nothing here knows about the DOM, so it is tested on its own.
 */

export interface HoldOptions {
  /** How long the hold must last. */
  ms: number;
  onFire: () => void;
  onChange?: (holding: boolean) => void;
  /** Asked again when the time is up. False lets go instead of firing. */
  canFire?: () => boolean;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
}

export interface Hold {
  /** A pointer or key went down, named by `source` (for example "pointer:3"). Ignored while a hold is running. */
  press(source: string): boolean;
  /** That pointer or key came up. Only the one that started the hold can end it this way. */
  release(source: string): void;
  /** Something that could lose track of the hold: a blur, a hidden window, a cancelled pointer. */
  cancel(): void;
  readonly holding: boolean;
}

export function createHold(o: HoldOptions): Hold {
  const now = o.now ?? (() => Date.now());
  const setTimer = o.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = o.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let source: string | null = null;
  let startedAt = 0;
  let timer: unknown = null;
  // Each hold gets its own number, so a timer left from an earlier one can never fire.
  let generation = 0;

  const stop = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
    if (source === null) return;
    source = null;
    o.onChange?.(false);
  };

  const fire = (gen: number) => {
    if (gen !== generation || source === null) return;
    timer = null;
    // A timer can run early; the hold counts time, not callbacks.
    const left = o.ms - (now() - startedAt);
    if (left > 0) {
      timer = setTimer(() => fire(gen), left);
      return;
    }
    const ok = o.canFire ? o.canFire() : true;
    stop();
    if (ok) o.onFire();
  };

  return {
    press(s) {
      if (source !== null) return false;
      generation += 1;
      const gen = generation;
      source = s;
      startedAt = now();
      timer = setTimer(() => fire(gen), o.ms);
      o.onChange?.(true);
      return true;
    },
    release(s) {
      if (source !== null && s === source) stop();
    },
    cancel() {
      stop();
    },
    get holding() {
      return source !== null;
    },
  };
}
