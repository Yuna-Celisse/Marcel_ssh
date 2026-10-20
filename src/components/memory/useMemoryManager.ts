import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as memoryApi from '@/lib/memoryApi';
import { getErrorMessage } from '@/lib/errors';
import {
  buildScopeDirectory,
  filterMatches,
  queryMatches,
  sameScope,
  sortForList,
  type MemoryFilter,
  type MemoryItem,
  type ScopeEntry,
  type ScopeRef,
} from '@/lib/memory';
import { useConnectionStore } from '@/stores/connectionStore';
import { useMemoryStore } from '@/stores/memoryStore';

const UNDO_VISIBLE_MS = 10_000;

export interface UndoOffer {
  text: string;
  batchId: string;
}

/**
 * 记忆管理页的共享逻辑（桌面 `MemorySection` 与手机 `MobileMemorySection` 共用）：
 * 作用域目录、筛选 + 搜索、删除 / 置顶 / 清空作用域，以及删除后的「撤销」。
 *
 * 删除不弹确认框：所有写入都有操作日志，误删了点「撤销」就回来 —— 比每次都问
 * 「确定吗」更不打断，也更不会被习惯性点掉。
 */
export function useMemoryManager() {
  const overview = useMemoryStore((s) => s.overview);
  const loadError = useMemoryStore((s) => s.overviewError);
  const pendingFocus = useMemoryStore((s) => s.pendingFocus);
  const connections = useConnectionStore((s) => s.connections);
  const [filter, setFilter] = useState<MemoryFilter>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [undo, setUndo] = useState<UndoOffer | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    void useMemoryStore.getState().loadOverview();
  }, []);

  // 别处要求「打开并定位到某个作用域」（连接右键「这台机器的记忆」）：消费一次。
  useEffect(() => {
    if (pendingFocus === undefined) return;
    setFilter(pendingFocus ? { kind: 'scope', ref: pendingFocus } : { kind: 'all' });
    setQuery('');
    useMemoryStore.getState().setPendingFocus(undefined);
  }, [pendingFocus]);

  const directory = useMemo(
    () => buildScopeDirectory(overview?.summaries ?? [], connections),
    [overview, connections],
  );

  const items = useMemo(
    () =>
      sortForList(
        (overview?.items ?? []).filter((m) => filterMatches(m, filter, directory) && queryMatches(m, query)),
      ),
    [overview, filter, directory, query],
  );

  // 「新」标记：这次打开看到过的，离开页面时清掉（看的时候还亮着，免得一眼没看清就没了）。
  const seen = useRef(new Set<string>());
  useEffect(() => {
    for (const m of items) if (m.isNew) seen.current.add(m.id);
  }, [items]);
  useEffect(
    () => () => {
      const ids = [...seen.current];
      if (ids.length > 0) void useMemoryStore.getState().markSeen(ids).catch(() => {});
    },
    [],
  );

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  const run = useCallback(async (fn: () => Promise<void>) => {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(getErrorMessage(e));
    }
  }, []);

  const remove = useCallback(
    (item: MemoryItem) =>
      run(async () => {
        const [rec] = await useMemoryStore
          .getState()
          .apply([{ op: 'delete', id: item.id, expectedVersion: item.version }]);
        if (rec) setUndo({ text: `已删除「${item.title}」`, batchId: rec.batchId });
      }),
    [run],
  );

  const togglePin = useCallback(
    (item: MemoryItem) =>
      run(async () => {
        await useMemoryStore
          .getState()
          .apply([{ op: 'update', id: item.id, expectedVersion: item.version, pinned: !item.pinned }]);
      }),
    [run],
  );

  const clearScope = useCallback(
    (entry: ScopeEntry) =>
      run(async () => {
        const r = await memoryApi.memoryDeleteScope(entry.ref);
        if (r.count > 0) setUndo({ text: `已清空 ${entry.label} 的 ${r.count} 条记忆`, batchId: r.batchId });
      }),
    [run],
  );

  const undoLast = useCallback(
    () =>
      run(async () => {
        if (!undo) return;
        await useMemoryStore.getState().revertBatch(undo.batchId);
        setUndo(null);
      }),
    [run, undo],
  );

  /** 当前筛选落在单个作用域上：整理助手据此「聚焦」、新增据此预选。 */
  const focus: ScopeRef | null = filter.kind === 'scope' ? filter.ref : null;

  /** 当前筛选对应的目录条目（标题 / 清空按钮用）。 */
  const selectedEntry: ScopeEntry | null = useMemo(() => {
    if (filter.kind !== 'scope') return null;
    const all = [directory.global, ...directory.groups, ...directory.hosts, ...directory.orphanHosts, ...directory.orphanGroups];
    return all.find((e) => sameScope(e.ref, filter.ref)) ?? null;
  }, [filter, directory]);

  return {
    loaded: overview !== null,
    loadError,
    directory,
    filter,
    setFilter,
    query,
    setQuery,
    items,
    focus,
    selectedEntry,
    remove,
    togglePin,
    clearScope,
    undo,
    undoLast,
    dismissUndo: () => setUndo(null),
    actionError,
    clearActionError: () => setActionError(null),
  };
}

export type MemoryManager = ReturnType<typeof useMemoryManager>;

export function filterKey(filter: MemoryFilter): string {
  return filter.kind === 'scope' ? `scope:${filter.ref.scope}:${filter.ref.key}` : filter.kind;
}
