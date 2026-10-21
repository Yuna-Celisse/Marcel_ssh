import { create } from 'zustand';
import * as memoryApi from '@/lib/memoryApi';
import { getErrorMessage, parseAppError } from '@/lib/errors';
import { subscribeTauriEvent } from '@/lib/tauriEvent';
import {
  EVENT_MEMORY_ASSISTANT_PROGRESS,
  type AssistantProgressEvent,
  type AssistantStep,
  type AssistantTurn,
  type MemoryOpRecord,
  type ScopeRef,
} from '@/lib/memory';

export type AssistantEntry =
  | { id: string; role: 'user'; text: string; at: string }
  | {
      id: string;
      role: 'assistant';
      runId: string;
      /** 开始的时间（ISO）。 */
      at: string;
      text: string;
      status: 'running' | 'done' | 'cancelled' | 'error';
      /** 运行中「正在做什么」（查看记忆 / 搜索历史会话……）。 */
      activity: string | null;
      /** 过程：每一步看了什么、读了哪段会话、结果如何（运行中实时追加，结束后以后端清单为准）。 */
      steps: AssistantStep[];
      batchId: string | null;
      ops: MemoryOpRecord[];
      /** 用户点过「撤销这次」。 */
      reverted: boolean;
      error: string | null;
    };

export type AssistantReplyEntry = Extract<AssistantEntry, { role: 'assistant' }>;

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
  /** 用户在助手里点名选的模型（空 = 沿用记忆模型设置 / 默认模型）。只存在本机。 */
  modelId: string;
  setModelId: (modelId: string) => void;
  send: (prompt: string, focus: ScopeRef | null) => Promise<void>;
  cancel: () => Promise<void>;
  undo: (entryId: string) => Promise<void>;
  /** 只撤销这次里的某一处改动。 */
  undoOp: (entryId: string, opId: number) => Promise<void>;
  clear: () => void;
}

let subscribed = false;

const MODEL_KEY = 'marcel.memory.assistantModelId';

function readModelId(): string {
  try {
    return localStorage.getItem(MODEL_KEY) ?? '';
  } catch {
    return '';
  }
}

function patchRun(entries: AssistantEntry[], runId: string, fn: (e: AssistantReplyEntry) => AssistantReplyEntry) {
  return entries.map((e) => (e.role === 'assistant' && e.runId === runId ? fn(e) : e));
}

function upsertStep(steps: AssistantStep[], step: AssistantStep): AssistantStep[] {
  const i = steps.findIndex((s) => s.id === step.id);
  if (i < 0) return [...steps, step];
  const next = steps.slice();
  next[i] = step;
  return next;
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
  modelId: readModelId(),

  setModelId: (modelId) => {
    try {
      if (modelId) localStorage.setItem(MODEL_KEY, modelId);
      else localStorage.removeItem(MODEL_KEY);
    } catch {
      /* 存不下就只在本次运行里生效，无害 */
    }
    set({ modelId });
  },

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
            // 调工具之前模型顺口说的话（「我先看看」）不是最终回复：后端最终只回传最后一轮的文字，
            // 这里不清掉的话，结束那一刻正文会整段换掉、卡片跟着跳一下。
            if (ev.kind === 'tool' || ev.kind === 'step') {
              const steps = ev.step ? upsertStep(e.steps, ev.step) : e.steps;
              return ev.kind === 'tool' ? { ...e, text: '', activity: ev.text, steps } : { ...e, steps };
            }
            return { ...e, batchId: ev.batchId ?? e.batchId, ops: mergeOps(e.ops, ev.ops ?? []) };
          }),
        }));
      });
    }
    const history = historyFrom(get().entries);
    const runId = crypto.randomUUID();
    const at = new Date().toISOString();
    set((s) => ({
      runningId: runId,
      entries: [
        ...s.entries,
        { id: `u-${runId}`, role: 'user', text, at },
        {
          id: `a-${runId}`,
          role: 'assistant',
          runId,
          at,
          text: '',
          status: 'running',
          activity: null,
          steps: [],
          batchId: null,
          ops: [],
          reverted: false,
          error: null,
        },
      ],
    }));
    try {
      const reply = await memoryApi.memoryAssistantRun(runId, history, text, focus, get().modelId);
      set((s) => ({
        entries: patchRun(s.entries, runId, (e) => ({
          ...e,
          text: reply.text,
          status: 'done',
          activity: null,
          steps: reply.steps?.length ? reply.steps : e.steps,
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

  undoOp: async (entryId, opId) => {
    await memoryApi.memoryRevertOp(opId);
    set((s) => ({
      entries: s.entries.map((e) =>
        e.id === entryId && e.role === 'assistant'
          ? { ...e, ops: e.ops.map((o) => (o.id === opId ? { ...o, reverted: true } : o)) }
          : e,
      ),
    }));
  },

  clear: () => {
    if (get().runningId) return;
    set({ entries: [] });
  },
}));
