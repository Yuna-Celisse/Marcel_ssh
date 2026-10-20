import { create } from 'zustand';
import * as memoryApi from '@/lib/memoryApi';
import { getErrorMessage, parseAppError } from '@/lib/errors';
import { subscribeTauriEvent } from '@/lib/tauriEvent';
import {
  EVENT_MEMORY_ASSISTANT_PROGRESS,
  type AssistantProgressEvent,
  type AssistantTurn,
  type MemoryOpRecord,
  type ScopeRef,
} from '@/lib/memory';

export type AssistantEntry =
  | { id: string; role: 'user'; text: string }
  | {
      id: string;
      role: 'assistant';
      runId: string;
      text: string;
      status: 'running' | 'done' | 'cancelled' | 'error';
      /** 运行中「正在做什么」（查看记忆 / 搜索历史会话……）。 */
      activity: string | null;
      batchId: string | null;
      ops: MemoryOpRecord[];
      /** 用户点过「撤销这次」。 */
      reverted: boolean;
      error: string | null;
    };

type AssistantReplyEntry = Extract<AssistantEntry, { role: 'assistant' }>;

/**
 * 记忆管理页的整理助手：用户一句话（「把重复的合并」「从历史会话整理 web-01 的记忆」），
 * 它查看 / 改记忆、翻历史会话，一次请求的所有改动是同一批，「撤销这次」一键回退。
 *
 * 状态放在 store 而不是组件里：请求可能跑几十秒，用户中途离开设置页再回来，
 * 对话和结果都得还在（后端照跑，进度事件照收）。
 */
interface AssistantState {
  entries: AssistantEntry[];
  runningId: string | null;
  send: (prompt: string, focus: ScopeRef | null) => Promise<void>;
  cancel: () => Promise<void>;
  undo: (entryId: string) => Promise<void>;
  clear: () => void;
}

let subscribed = false;

function patchRun(entries: AssistantEntry[], runId: string, fn: (e: AssistantReplyEntry) => AssistantReplyEntry) {
  return entries.map((e) => (e.role === 'assistant' && e.runId === runId ? fn(e) : e));
}

function mergeOps(prev: MemoryOpRecord[], next: MemoryOpRecord[]): MemoryOpRecord[] {
  const seen = new Set(prev.map((o) => o.id));
  return [...prev, ...next.filter((o) => !seen.has(o.id))];
}

/** 发给后端的往来：只要已完成的文字（失败 / 停止的那一轮不回放）。 */
function historyFrom(entries: AssistantEntry[]): AssistantTurn[] {
  const out: AssistantTurn[] = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const reply = entries[i + 1];
    if (e.role !== 'user' || reply?.role !== 'assistant' || reply.status !== 'done') continue;
    out.push({ role: 'user', content: e.text });
    out.push({ role: 'assistant', content: reply.text });
  }
  return out;
}

export const useMemoryAssistantStore = create<AssistantState>((set, get) => ({
  entries: [],
  runningId: null,

  send: async (prompt, focus) => {
    const text = prompt.trim();
    if (!text || get().runningId) return;
    if (!subscribed) {
      subscribed = true;
      subscribeTauriEvent<AssistantProgressEvent>(EVENT_MEMORY_ASSISTANT_PROGRESS, (ev) => {
        set((s) => ({
          entries: patchRun(s.entries, ev.runId, (e) => {
            if (e.status !== 'running') return e;
            if (ev.kind === 'text') return { ...e, text: e.text + ev.text };
            if (ev.kind === 'tool') return { ...e, activity: ev.text };
            return { ...e, batchId: ev.batchId ?? e.batchId, ops: mergeOps(e.ops, ev.ops ?? []) };
          }),
        }));
      });
    }
    const history = historyFrom(get().entries);
    const runId = crypto.randomUUID();
    set((s) => ({
      runningId: runId,
      entries: [
        ...s.entries,
        { id: `u-${runId}`, role: 'user', text },
        {
          id: `a-${runId}`,
          role: 'assistant',
          runId,
          text: '',
          status: 'running',
          activity: null,
          batchId: null,
          ops: [],
          reverted: false,
          error: null,
        },
      ],
    }));
    try {
      const reply = await memoryApi.memoryAssistantRun(runId, history, text, focus);
      set((s) => ({
        entries: patchRun(s.entries, runId, (e) => ({
          ...e,
          text: reply.text,
          status: 'done',
          activity: null,
          batchId: reply.batchId ?? e.batchId,
          ops: mergeOps(e.ops, reply.ops),
        })),
      }));
    } catch (err) {
      const cancelled = parseAppError(err).kind === 'Cancelled';
      set((s) => ({
        entries: patchRun(s.entries, runId, (e) => ({
          ...e,
          status: cancelled ? 'cancelled' : 'error',
          activity: null,
          error: cancelled ? null : getErrorMessage(err),
        })),
      }));
    } finally {
      set((s) => (s.runningId === runId ? { runningId: null } : s));
    }
  },

  cancel: async () => {
    const runId = get().runningId;
    if (runId) await memoryApi.memoryAssistantCancel(runId);
  },

  undo: async (entryId) => {
    const entry = get().entries.find((e) => e.id === entryId);
    if (!entry || entry.role !== 'assistant' || !entry.batchId) return;
    await memoryApi.memoryRevertBatch(entry.batchId);
    set((s) => ({
      entries: s.entries.map((e) => (e.id === entryId && e.role === 'assistant' ? { ...e, reverted: true } : e)),
    }));
  },

  clear: () => {
    if (get().runningId) return;
    set({ entries: [] });
  },
}));
