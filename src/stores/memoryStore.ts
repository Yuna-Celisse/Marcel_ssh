import { create } from 'zustand';
import * as memoryApi from '@/lib/memoryApi';
import { getErrorMessage } from '@/lib/errors';
import { subscribeTauriEvent } from '@/lib/tauriEvent';
import {
  EVENT_MEMORY_CHANGED,
  EVENT_MEMORY_REFLECTION,
  type MemoryChangedEvent,
  type MemoryOpRecord,
  type MemoryOverview,
  type MemoryWriteOp,
  type ReflectionEvent,
  type ReflectionNote,
  type ScopeRef,
} from '@/lib/memory';
import { useTaskStore } from './taskStore';

/**
 * 长期记忆的前端缓存：管理页的全量列表、各会话的复盘提示行、对话里记忆卡片对应
 * 那一批操作的当前状态（撤销过没有）。
 *
 * 真相在后端：任何写入之后都靠 `memory-changed` 事件统一重拉，前端不做乐观拼接 ——
 * 撤销、整理助手、agent、复盘都可能同时改同一条，自己拼必然漂。
 */
interface MemoryState {
  overview: MemoryOverview | null;
  overviewError: string | null;
  /** 每次后端说「记忆变了」就 +1：Agent 面板的「记忆 N」等据此重取。 */
  revision: number;
  /** 会话 → 复盘提示行（加载过的会话才有键）。 */
  notes: Record<string, ReflectionNote[]>;
  /** batch → 这一批的操作记录（对话里的记忆卡片据此显示「已撤销」）。 */
  batches: Record<string, MemoryOpRecord[]>;
  /**
   * 别处要求「打开记忆管理页并定位到某个作用域」（连接右键「这台机器的记忆」）。
   * 管理页挂载 / 收到后消费一次就清空；`undefined` = 没有待处理的跳转。
   */
  pendingFocus: ScopeRef | null | undefined;
  setPendingFocus: (focus: ScopeRef | null | undefined) => void;

  init: () => void;
  loadOverview: () => Promise<void>;
  loadNotes: (conversationId: string) => Promise<void>;
  loadBatch: (batchId: string) => Promise<void>;
  apply: (ops: MemoryWriteOp[]) => Promise<MemoryOpRecord[]>;
  revertOp: (opId: number) => Promise<MemoryOpRecord>;
  revertBatch: (batchId: string) => Promise<MemoryOpRecord[]>;
  markSeen: (ids: string[]) => Promise<void>;
}

let subscribed = false;
let overviewWanted = false;
let overviewInflight: Promise<void> | null = null;
let overviewAgain = false;

function refreshAfterChange(get: () => MemoryState, conversationId: string | null) {
  const state = get();
  if (overviewWanted) void state.loadOverview();
  // 撤销会改提示行里的「已撤销」状态；只重拉加载过的会话。
  const convs = conversationId ? [conversationId] : Object.keys(state.notes);
  for (const id of convs) if (state.notes[id]) void state.loadNotes(id);
  for (const batchId of Object.keys(state.batches)) void state.loadBatch(batchId);
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  overview: null,
  overviewError: null,
  revision: 0,
  notes: {},
  batches: {},
  pendingFocus: undefined,
  setPendingFocus: (focus) => set({ pendingFocus: focus }),

  init: () => {
    if (subscribed) return;
    subscribed = true;
    subscribeTauriEvent<MemoryChangedEvent>(EVENT_MEMORY_CHANGED, (ev) => {
      set((s) => ({ revision: s.revision + 1 }));
      // 撤销 / 管理页的改动可能动到任何会话的提示行，conversationId 只在 agent / 复盘
      // 写入时有值；用户发起的一律全量刷新加载过的会话。
      refreshAfterChange(get, ev.source === 'agent' || ev.source === 'reflection' ? ev.conversationId : null);
    });
    subscribeTauriEvent<ReflectionEvent>(EVENT_MEMORY_REFLECTION, (ev) => {
      const note = ev.note;
      if (note) {
        set((s) => {
          const list = s.notes[ev.conversationId] ?? [];
          if (list.some((n) => n.id === note.id)) return s;
          return { notes: { ...s.notes, [ev.conversationId]: [...list, note] } };
        });
      }
      // 复盘花掉的 token 已记进会话用量：把新读数交给用量面板（后端口径，前端不累加）。
      if (ev.usage) useTaskStore.getState().applySideUsage(ev.conversationId, ev.usage);
    });
  },

  loadOverview: async () => {
    get().init();
    overviewWanted = true;
    if (overviewInflight) {
      overviewAgain = true;
      return overviewInflight;
    }
    overviewInflight = (async () => {
      try {
        do {
          overviewAgain = false;
          const overview = await memoryApi.memoryOverview();
          set({ overview, overviewError: null });
        } while (overviewAgain);
      } catch (e) {
        set({ overviewError: getErrorMessage(e) });
      } finally {
        overviewInflight = null;
      }
    })();
    return overviewInflight;
  },

  loadNotes: async (conversationId) => {
    get().init();
    try {
      const notes = await memoryApi.memoryReflectionNotes(conversationId);
      set((s) => ({ notes: { ...s.notes, [conversationId]: notes } }));
    } catch {
      // 提示行只是附加信息：取不到就不显示，不打断对话。
      set((s) => (s.notes[conversationId] ? s : { notes: { ...s.notes, [conversationId]: [] } }));
    }
  },

  loadBatch: async (batchId) => {
    get().init();
    try {
      const ops = await memoryApi.memoryBatchOps(batchId);
      set((s) => ({ batches: { ...s.batches, [batchId]: ops } }));
    } catch {
      /* 卡片退回「不知道撤销过没有」：照常显示撤销按钮，后端会拒绝重复撤销 */
    }
  },

  apply: async (ops) => {
    get().init();
    return memoryApi.memoryApply(ops);
  },

  revertOp: async (opId) => {
    get().init();
    return memoryApi.memoryRevertOp(opId);
  },

  revertBatch: async (batchId) => {
    get().init();
    return memoryApi.memoryRevertBatch(batchId);
  },

  markSeen: async (ids) => {
    if (ids.length === 0) return;
    await memoryApi.memoryMarkSeen(ids);
    set((s) => {
      if (!s.overview) return s;
      const seen = new Set(ids);
      const items = s.overview.items.map((m) => (seen.has(m.id) ? { ...m, isNew: false } : m));
      const fresh = new Map<string, number>();
      for (const m of items) {
        if (!m.isNew) continue;
        const k = `${m.scope}:${m.scopeKey}`;
        fresh.set(k, (fresh.get(k) ?? 0) + 1);
      }
      const summaries = s.overview.summaries.map((sum) => ({
        ...sum,
        newCount: fresh.get(`${sum.scope}:${sum.key}`) ?? 0,
      }));
      return { overview: { items, summaries } };
    });
  },
}));
