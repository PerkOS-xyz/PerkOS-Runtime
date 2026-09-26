/**
 * Hold to approve: only one continuous hold, by the pointer or key that
 * started it, fires; anything that could let go of it unnoticed cancels it;
 * and the time and the conditions are checked again when it is up.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHold } from "../app/desks/hold";

const MS = 1600;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

function setup(canFire?: () => boolean) {
  const onFire = vi.fn();
  const changes: boolean[] = [];
  const hold = createHold({ ms: MS, onFire, onChange: (h) => changes.push(h), ...(canFire ? { canFire } : {}) });
  return { hold, onFire, changes };
}

describe("hold to approve", () => {
  it("fires once after a continuous hold for the whole count", () => {
    const { hold, onFire, changes } = setup();
    expect(hold.press("pointer:1")).toBe(true);
    vi.advanceTimersByTime(MS - 1);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(hold.holding).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("does nothing when let go early", () => {
    const { hold, onFire } = setup();
    hold.press("key: ");
    vi.advanceTimersByTime(MS / 2);
    hold.release("key: ");
    vi.advanceTimersByTime(MS * 2);
    expect(onFire).not.toHaveBeenCalled();
  });

  it("ignores a second start while armed, so no timer is left behind", () => {
    const { hold, onFire } = setup();
    // Two fingers, or a key and the mouse: only the first counts.
    expect(hold.press("pointer:1")).toBe(true);
    expect(hold.press("pointer:2")).toBe(false);
    expect(hold.press("key:Enter")).toBe(false);
    hold.release("pointer:2");
    hold.release("key:Enter");
    expect(hold.holding).toBe(true);
    hold.release("pointer:1");
    vi.advanceTimersByTime(MS * 3);
    expect(onFire).not.toHaveBeenCalled();
  });

  it("is cancelled by a blur, a hidden window or a cancelled pointer, and a new hold starts the count again", () => {
    const { hold, onFire } = setup();
    // Space down, then Tab: the key comes up somewhere else and the button only sees the blur.
    hold.press("key: ");
    vi.advanceTimersByTime(MS - 100);
    hold.cancel();
    vi.advanceTimersByTime(MS);
    expect(onFire).not.toHaveBeenCalled();
    hold.press("pointer:7");
    vi.advanceTimersByTime(MS - 100);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("checks again when the time is up, and lets go instead of firing when it must not", () => {
    let allowed = true;
    const { hold, onFire, changes } = setup(() => allowed);
    hold.press("pointer:1");
    allowed = false; // the quote expired, or the window lost the focus
    vi.advanceTimersByTime(MS);
    expect(onFire).not.toHaveBeenCalled();
    expect(hold.holding).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it("counts time, not callbacks: a timer that runs early waits for the rest", () => {
    let now = 0;
    const timers: Array<{ fn: () => void; ms: number }> = [];
    const onFire = vi.fn();
    const hold = createHold({
      ms: MS,
      onFire,
      now: () => now,
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => undefined,
    });
    hold.press("pointer:1");
    now = 1000;
    timers[0]!.fn();
    expect(onFire).not.toHaveBeenCalled();
    expect(timers[1]?.ms).toBe(600);
    now = 1600;
    timers[1]!.fn();
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("never fires a timer from an earlier hold", () => {
    const timers: Array<() => void> = [];
    const onFire = vi.fn();
    let now = 0;
    const hold = createHold({ ms: MS, onFire, now: () => now, setTimer: (fn) => timers.push(fn), clearTimer: () => undefined });
    hold.press("pointer:1");
    hold.release("pointer:1");
    hold.press("pointer:2");
    now = MS;
    // The first hold's timer was not cleared by this fake; it still must not count.
    timers[0]!();
    expect(onFire).toHaveBeenCalledTimes(0);
    timers[1]!();
    expect(onFire).toHaveBeenCalledTimes(1);
  });
});
