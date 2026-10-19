import { describe, expect, it, vi } from 'vitest';
import {
  clipboardLabel,
  pasteBlockedReason,
  pasteClipboard,
  pasteProgressText,
  renamedNotice,
} from './filePaste';
import type { FileClipboard } from '@/stores/fileClipboardStore';

const clip = (over: Partial<FileClipboard> = {}): FileClipboard => ({
  sessionId: 's1',
  dir: '/home/a',
  items: [{ name: 'x.txt', isDir: false }],
  cut: false,
  ...over,
});

describe('filePaste', () => {
  it('labels single and multiple items', () => {
    expect(clipboardLabel(clip())).toBe('已复制「x.txt」');
    expect(
      clipboardLabel(
        clip({
          cut: true,
          items: [
            { name: 'a', isDir: true },
            { name: 'b', isDir: false },
          ],
        }),
      ),
    ).toBe('已剪切 2 项');
  });

  it('blocks paste across sessions or when empty', () => {
    expect(pasteBlockedReason(null, 's1')).toBeTruthy();
    expect(pasteBlockedReason(clip(), 's2')).toContain('另一台服务器');
    expect(pasteBlockedReason(clip(), 's1')).toBeNull();
  });

  it('pastes each item, aggregates errors and keeps going', async () => {
    const paste = vi
      .fn()
      .mockResolvedValueOnce('a (1)')
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('c');
    const progress = vi.fn();
    const res = await pasteClipboard(
      clip({
        items: [
          { name: 'a', isDir: true },
          { name: 'b', isDir: false },
          { name: 'c', isDir: false },
        ],
      }),
      '/dst',
      progress,
      paste,
    );
    expect(paste).toHaveBeenNthCalledWith(1, 's1', '/home/a/a', '/dst', false);
    expect(res.done).toEqual([
      { from: 'a', to: 'a (1)' },
      { from: 'c', to: 'c' },
    ]);
    expect(res.failed).toEqual(['b']);
    expect(res.errors).toHaveLength(1);
    expect(res.errors[0]).toContain('b: ');
    expect(progress).toHaveBeenCalledTimes(3);
    expect(renamedNotice(res)).toContain('「a (1)」');
  });

  it('progress text and no-rename notice', () => {
    expect(pasteProgressText(1, 3, true)).toBe('正在移动（1/3）…');
    expect(pasteProgressText(1, 1, false)).toBe('正在复制…');
    expect(renamedNotice({ done: [{ from: 'a', to: 'a' }], failed: [], errors: [] })).toBeNull();
  });
});
