import { describe, expect, it, vi } from 'vitest';
import { attachPinchZoom } from './terminalPinchZoom';
import { createFontZoom } from '@/lib/terminalFontZoom';

/** Minimal EventTarget stub (vitest env is node, no jsdom). */
function makeContainer() {
  type Listener = (ev: unknown) => void;
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener(type: string, fn: Listener) {
      let set = listeners.get(type);
      if (!set) listeners.set(type, (set = new Set()));
      set.add(fn);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string, ev: unknown) {
      for (const fn of listeners.get(type) ?? []) fn(ev);
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

function setup(base = 14) {
  const container = makeContainer();
  const preview = vi.fn();
  const commit = vi.fn();
  const zoom = createFontZoom({ getBase: () => base, preview, commit });
  const handle = attachPinchZoom({ container: container as unknown as HTMLElement, zoom });

  const point = (x: number, y = 0) => ({ clientX: x, clientY: y });
  const fire = (type: string, touches: Array<{ clientX: number; clientY: number }>) => {
    const ev = { touches, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    container.dispatch(type, ev);
    return ev;
  };
  return { container, handle, preview, commit, point, fire };
}

describe('attachPinchZoom', () => {
  it('scales the font with the finger distance and commits once on lift', () => {
    const { fire, point, preview, commit } = setup(14);
    fire('touchstart', [point(100), point(200)]);
    const move = fire('touchmove', [point(50), point(250)]); // 100 → 200
    expect(preview).toHaveBeenLastCalledWith(28);
    expect(move.preventDefault).toHaveBeenCalled();
    expect(move.stopPropagation).toHaveBeenCalled();
    fire('touchmove', [point(100), point(200)]); // back to 100
    expect(preview).toHaveBeenLastCalledWith(14);
    fire('touchmove', [point(80), point(220)]); // 140 → 1.4×
    expect(commit).not.toHaveBeenCalled();
    fire('touchend', [point(80)]); // one finger left
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(20);
  });

  it('ignores a single-finger gesture entirely', () => {
    const { fire, point, preview, commit } = setup();
    fire('touchstart', [point(100)]);
    const move = fire('touchmove', [point(140)]);
    fire('touchend', []);
    expect(preview).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(move.stopPropagation).not.toHaveBeenCalled();
  });

  it('swallows the remaining finger until every finger is up', () => {
    const { fire, point } = setup();
    fire('touchstart', [point(100), point(200)]);
    fire('touchend', [point(100)]);
    const leftover = fire('touchmove', [point(120, 40)]);
    expect(leftover.stopPropagation).toHaveBeenCalled();
    expect(leftover.preventDefault).toHaveBeenCalled();
    fire('touchend', []);
    const fresh = fire('touchmove', [point(120, 40)]);
    expect(fresh.stopPropagation).not.toHaveBeenCalled();
  });

  it('commits nothing when the fingers return to the starting distance', () => {
    const { fire, point, commit } = setup();
    fire('touchstart', [point(100), point(200)]);
    fire('touchmove', [point(60), point(240)]);
    fire('touchmove', [point(100), point(200)]);
    fire('touchend', [point(100)]);
    expect(commit).not.toHaveBeenCalled();
  });

  it('ends the zoom on touchcancel', () => {
    const { fire, point, commit } = setup(14);
    fire('touchstart', [point(100), point(200)]);
    fire('touchmove', [point(50), point(250)]);
    fire('touchcancel', []);
    expect(commit).toHaveBeenCalledWith(28);
  });

  it('removes its listeners and flushes on dispose', () => {
    const { container, handle, fire, point, commit } = setup(14);
    fire('touchstart', [point(100), point(200)]);
    fire('touchmove', [point(50), point(250)]);
    handle.dispose();
    expect(commit).toHaveBeenCalledWith(28);
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) {
      expect(container.count(type)).toBe(0);
    }
  });
});
