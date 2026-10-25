// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useThemeSynced } from './useThemeSynced';
import { applyUiTheme, normalizeUiTheme } from '@/lib/uiTheme';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ value, onRender }: { value: string; onRender: (v: string) => void }) {
  onRender(useThemeSynced(value));
  return null;
}

describe('useThemeSynced', () => {
  let root: Root | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    vi.useRealTimers();
  });

  const mount = (value: string, seen: string[]) => {
    root = createRoot(document.createElement('div'));
    act(() => root!.render(<Probe value={value} onRender={(v) => seen.push(v)} />));
    return (next: string) =>
      act(() => root!.render(<Probe value={next} onRender={(v) => seen.push(v)} />));
  };

  it('值变化后先保持旧值，主题写入 DOM 时才采用新值', async () => {
    const seen: string[] = [];
    const update = mount('old', seen);
    update('new');
    expect(seen[seen.length - 1]).toBe('old');
    await act(async () => {
      applyUiTheme(normalizeUiTheme(undefined), false);
      await Promise.resolve();
    });
    expect(seen[seen.length - 1]).toBe('new');
  });

  it('没等到主题写入时超时兜底采用新值', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const update = mount('old', seen);
    update('new');
    expect(seen[seen.length - 1]).toBe('old');
    await act(async () => {
      vi.advanceTimersByTime(200);
      await Promise.resolve();
    });
    expect(seen[seen.length - 1]).toBe('new');
  });
});
