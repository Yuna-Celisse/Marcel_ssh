import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createFontZoom,
  isFontZooming,
  pinchFontSize,
  subscribeFontZoomHint,
  wheelZoomSteps,
} from './terminalFontZoom';
import { TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from './terminalFont';

describe('pinchFontSize', () => {
  it('keeps the size when the distance has not changed', () => {
    expect(pinchFontSize(14, 100, 100)).toBe(14);
  });

  it('scales proportionally and rounds', () => {
    expect(pinchFontSize(14, 100, 150)).toBe(21);
    expect(pinchFontSize(20, 100, 60)).toBe(12);
  });

  it('clamps to the legal range', () => {
    expect(pinchFontSize(14, 100, 1000)).toBe(TERMINAL_FONT_SIZE_MAX);
    expect(pinchFontSize(14, 100, 1)).toBe(TERMINAL_FONT_SIZE_MIN);
  });

  it('falls back to the start size on a degenerate start distance', () => {
    expect(pinchFontSize(14, 0, 80)).toBe(14);
    expect(pinchFontSize(14, 100, Number.NaN)).toBe(14);
  });
});

describe('wheelZoomSteps', () => {
  it('treats a mouse notch as exactly one step, scroll up = zoom in', () => {
    expect(wheelZoomSteps(-100, 0, 0)).toEqual({ steps: 1, residual: 0 });
    expect(wheelZoomSteps(100, 0, 0)).toEqual({ steps: -1, residual: 0 });
  });

  it('treats line / page mode as one step per event', () => {
    expect(wheelZoomSteps(-3, 1, 0).steps).toBe(1);
    expect(wheelZoomSteps(1, 2, 0).steps).toBe(-1);
  });

  it('accumulates small trackpad-pinch deltas into steps', () => {
    let residual = 0;
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const r = wheelZoomSteps(-5, 0, residual);
      residual = r.residual;
      total += r.steps;
    }
    // 10 × 5 = 50px，每 12px 一档 → 4 档，余 2px
    expect(total).toBe(4);
    expect(residual).toBe(-2);
  });

  it('drops the leftover when the direction flips', () => {
    const first = wheelZoomSteps(-8, 0, 0);
    expect(first.steps).toBe(0);
    const flipped = wheelZoomSteps(8, 0, first.residual);
    expect(flipped).toEqual({ steps: 0, residual: 8 });
  });

  it('ignores zero and non-finite deltas', () => {
    expect(wheelZoomSteps(0, 0, 3)).toEqual({ steps: 0, residual: 3 });
    expect(wheelZoomSteps(Number.NaN, 0, 3)).toEqual({ steps: 0, residual: 3 });
  });
});

describe('createFontZoom', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function harness(base = 14, commitDelayMs = 0) {
    const preview = vi.fn();
    const commit = vi.fn();
    const zoom = createFontZoom({ getBase: () => base, preview, commit, commitDelayMs });
    return { zoom, preview, commit };
  }

  it('previews every distinct size but commits once at the end', () => {
    const { zoom, preview, commit } = harness();
    zoom.request(15);
    zoom.request(15);
    zoom.request(17);
    expect(preview.mock.calls.map(([s]) => s)).toEqual([15, 17]);
    expect(commit).not.toHaveBeenCalled();
    expect(isFontZooming()).toBe(true);
    zoom.flush();
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(17);
    expect(isFontZooming()).toBe(false);
  });

  it('does not commit when the size ended where it started', () => {
    const { zoom, commit } = harness();
    zoom.request(16);
    zoom.request(14);
    zoom.flush();
    expect(commit).not.toHaveBeenCalled();
    expect(isFontZooming()).toBe(false);
  });

  it('clamps requests and still emits a hint at the limit', () => {
    const { zoom, preview } = harness(TERMINAL_FONT_SIZE_MAX);
    const hints: number[] = [];
    const off = subscribeFontZoomHint((s) => hints.push(s));
    zoom.request(99);
    off();
    expect(preview).not.toHaveBeenCalled();
    expect(hints).toEqual([TERMINAL_FONT_SIZE_MAX]);
    zoom.flush();
  });

  it('step() is relative to the live size while zooming', () => {
    const { zoom, preview } = harness(14);
    zoom.step(1);
    zoom.step(1);
    zoom.step(-1);
    expect(preview.mock.calls.map(([s]) => s)).toEqual([15, 16, 15]);
    zoom.flush();
  });

  it('auto-commits after the delay and restarts the timer on each request', () => {
    const { zoom, commit } = harness(14, 250);
    zoom.step(1);
    vi.advanceTimersByTime(200);
    zoom.step(1);
    vi.advanceTimersByTime(200);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(60);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith(16);
    expect(zoom.isActive()).toBe(false);
  });

  it('reapply() re-sends the live size only while a zoom is in flight', () => {
    const { zoom, preview } = harness(14);
    zoom.reapply();
    expect(preview).not.toHaveBeenCalled();
    zoom.request(18);
    preview.mockClear();
    zoom.reapply();
    expect(preview).toHaveBeenCalledWith(18);
    zoom.flush();
  });

  it('dispose() commits a pending zoom', () => {
    const { zoom, commit } = harness(14, 250);
    zoom.step(2);
    zoom.dispose();
    expect(commit).toHaveBeenCalledWith(16);
    vi.advanceTimersByTime(1000);
    expect(commit).toHaveBeenCalledTimes(1);
  });
});
