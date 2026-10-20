import { describe, it, expect } from 'vitest';
import {
  buildScopeDirectory,
  placeReflectionNotes,
  summarizeOps,
  type MemoryOpRecord,
  type ScopeSummary,
} from './memory';
import type { SavedConnection } from './types';

const conn = (id: string, name: string, group?: string): SavedConnection =>
  ({ id, name, host: `${name}.example`, port: 22, username: 'root', authMethod: 'password', group }) as SavedConnection;

describe('buildScopeDirectory', () => {
  const connections = [conn('a', 'web-01', 'prod'), conn('b', 'db-01', 'prod'), conn('c', 'lab')];

  it('lists every group and connection, even without memories', () => {
    const dir = buildScopeDirectory([], connections);
    expect(dir.groups.map((g) => g.ref.key)).toEqual(['prod']);
    expect(dir.hosts.map((h) => h.ref.key)).toEqual(['a', 'b', 'c']);
    expect(dir.total).toBe(0);
    expect(dir.orphanHosts).toEqual([]);
  });

  it('fills counts and totals from summaries', () => {
    const summaries: ScopeSummary[] = [
      { scope: 'user', key: '', count: 2, newCount: 1 },
      { scope: 'host', key: 'a', count: 3, newCount: 0 },
    ];
    const dir = buildScopeDirectory(summaries, connections);
    expect(dir.global.count).toBe(2);
    expect(dir.hosts[0].count).toBe(3);
    expect(dir.total).toBe(5);
    expect(dir.totalNew).toBe(1);
  });

  it('collects memories of deleted connections and vanished groups as orphans', () => {
    const summaries: ScopeSummary[] = [
      { scope: 'host', key: 'gone', count: 1, newCount: 0 },
      { scope: 'group', key: 'old', count: 2, newCount: 0 },
      { scope: 'host', key: 'gone-empty', count: 0, newCount: 0 },
    ];
    const dir = buildScopeDirectory(summaries, connections);
    expect(dir.orphanHosts.map((e) => e.ref.key)).toEqual(['gone']);
    expect(dir.orphanGroups.map((e) => e.ref.key)).toEqual(['old']);
  });
});

describe('summarizeOps', () => {
  const rec = (op: MemoryOpRecord['op'], reverted = false): MemoryOpRecord => ({
    id: 1,
    batchId: 'b',
    memoryId: 'm',
    op,
    before: null,
    after: null,
    source: 'agent',
    conversationId: null,
    createdAt: '2026-01-01T00:00:00Z',
    reverted,
  });

  it('counts per kind in add/update/delete order', () => {
    expect(summarizeOps([rec('delete'), rec('add'), rec('add'), rec('update')])).toBe('记住 2 条、更新 1 条、删除 1 条');
  });

  it('skips reverted ops and returns empty when all are reverted', () => {
    expect(summarizeOps([rec('add', true), rec('update')])).toBe('更新 1 条');
    expect(summarizeOps([rec('add', true)])).toBe('');
  });
});

describe('placeReflectionNotes', () => {
  const messages = [
    { id: 'm1', timestamp: '2026-01-01T10:00:00Z' },
    { id: 'm2', timestamp: '2026-01-01T10:01:00Z' },
    { id: 'm3', timestamp: '2026-01-01T10:02:00Z' },
    { id: 'm4', timestamp: '2026-01-01T10:03:00Z' },
  ];
  const note = (anchorMessageId: string, createdAt = '2026-01-01T11:00:00Z') => ({ anchorMessageId, createdAt });

  it('attaches to the row holding the anchor message', () => {
    const rows = [
      { key: 'r1', messageIds: ['m1'] },
      { key: 'r2', messageIds: ['m2'] },
    ];
    const n = note('m1');
    expect(placeReflectionNotes(messages, rows, [n]).get('r1')).toEqual([n]);
  });

  it('attaches to the folded row that stands in for a hidden anchor', () => {
    const rows = [
      { key: 'turn', messageIds: ['m1', 'm2', 'm3'] },
      { key: 'tail', messageIds: ['m4'] },
    ];
    const n = note('m2');
    // m2 is folded into the turn row; the row reach (m3) is later than the anchor, so it
    // falls back to the last row whose reach is not after the anchor — none here.
    expect(placeReflectionNotes(messages, rows, [n]).size).toBe(0);
    const rows2 = [
      { key: 'turn', messageIds: ['m1', 'm2'] },
      { key: 'tail', messageIds: ['m4'] },
    ];
    expect(placeReflectionNotes(messages, rows2, [note('m2')]).get('turn')).toHaveLength(1);
  });

  it('falls back to timestamps when the anchor id is unknown (live messages)', () => {
    const rows = [
      { key: 'r1', messageIds: ['m1'] },
      { key: 'r2', messageIds: ['m2'] },
      { key: 'r3', messageIds: ['m3'] },
    ];
    const n = note('db-id-not-in-window', '2026-01-01T10:01:30Z');
    expect(placeReflectionNotes(messages, rows, [n]).get('r2')).toEqual([n]);
  });

  it('drops notes that predate every loaded message', () => {
    const rows = [{ key: 'r1', messageIds: ['m1'] }];
    expect(placeReflectionNotes(messages, rows, [note('missing', '2025-12-31T00:00:00Z')]).size).toBe(0);
  });

  it('returns an empty map without notes or rows', () => {
    expect(placeReflectionNotes(messages, [], [note('m1')]).size).toBe(0);
    expect(placeReflectionNotes(messages, [{ key: 'r', messageIds: ['m1'] }], []).size).toBe(0);
  });
});
