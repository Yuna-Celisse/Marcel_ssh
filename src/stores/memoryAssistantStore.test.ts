import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (payload: unknown) => void;
const handlers: Handler[] = [];
let finishRun: (reply: unknown) => void = () => {};

vi.mock('@/lib/tauriEvent', () => ({
  subscribeTauriEvent: (_name: string, handler: Handler) => {
    handlers.push(handler);
    return () => {};
  },
}));
vi.mock('@/lib/memoryApi', () => ({
  memoryAssistantRun: vi.fn(
    () => new Promise((resolve) => {
      finishRun = resolve;
    }),
  ),
  memoryAssistantCancel: vi.fn(),
  memoryRevertBatch: vi.fn(),
}));

import { useMemoryAssistantStore } from './memoryAssistantStore';

const emit = (ev: Record<string, unknown>) => handlers.forEach((h) => h(ev));

describe('memoryAssistantStore', () => {
  beforeEach(() => {
    useMemoryAssistantStore.setState({ entries: [], runningId: null });
  });

  it('工具调用前模型顺口说的话不留在正文里，结束时正文与流式内容一致（不整段换掉）', async () => {
    const sending = useMemoryAssistantStore.getState().send('合并重复的', null);
    const runId = useMemoryAssistantStore.getState().runningId!;
    const reply = () => {
      const e = useMemoryAssistantStore.getState().entries.slice(-1)[0];
      return e?.role === 'assistant' ? e : null;
    };

    emit({ runId, kind: 'text', text: '我先看看现有的记忆。' });
    expect(reply()?.text).toBe('我先看看现有的记忆。');
    emit({ runId, kind: 'tool', text: '查看记忆' });
    expect(reply()?.text).toBe('');
    expect(reply()?.activity).toBe('查看记忆');

    emit({ runId, kind: 'text', text: '合并好了。' });
    const streamed = reply()?.text;
    finishRun({ text: '合并好了。', batchId: null, ops: [] });
    await sending;
    expect(reply()?.text).toBe(streamed);
    expect(reply()?.status).toBe('done');
  });
});

describe('memoryAssistantStore 模型选择', () => {
  it('把用户点名选的模型带给后端，并记在本机', async () => {
    const api = await import('@/lib/memoryApi');
    const mem = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
    useMemoryAssistantStore.getState().setModelId('m-small');
    expect(localStorage.getItem('marcel.memory.assistantModelId')).toBe('m-small');
    const sending = useMemoryAssistantStore.getState().send('整理一下', null);
    finishRun({ text: '好', batchId: null, ops: [] });
    await sending;
    const calls = vi.mocked(api.memoryAssistantRun).mock.calls;
    expect(calls[calls.length - 1]?.[4]).toBe('m-small');
    useMemoryAssistantStore.getState().setModelId('');
    expect(localStorage.getItem('marcel.memory.assistantModelId')).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('memoryAssistantStore 整理过程', () => {
  const step = (over: Record<string, unknown>) => ({
    id: 0, tool: 'memory_list', label: '查看记忆', detail: '全部', outcome: '', ok: true, running: true, note: '', ...over,
  });

  it('每一步开始、出结果都实时进清单，结束后以后端的完整清单为准', async () => {
    const sending = useMemoryAssistantStore.getState().send('整理', null);
    const runId = useMemoryAssistantStore.getState().runningId!;
    const reply = () => {
      const e = useMemoryAssistantStore.getState().entries.slice(-1)[0];
      return e?.role === 'assistant' ? e : null;
    };

    emit({ runId, kind: 'tool', text: '查看记忆', step: step({ note: '先看看现有的' }) });
    expect(reply()?.steps).toHaveLength(1);
    expect(reply()?.steps[0].running).toBe(true);

    // 后端的「出结果」事件带的是完整的一步（含 note）
    emit({ runId, kind: 'step', text: '', step: step({ running: false, outcome: '列出 12 条', note: '先看看现有的' }) });
    expect(reply()?.steps).toHaveLength(1); // 同一步更新，不是新增
    expect(reply()?.steps[0]).toMatchObject({ running: false, outcome: '列出 12 条', note: '先看看现有的' });

    emit({ runId, kind: 'tool', text: '阅读历史会话', step: step({ id: 1, tool: 'history_read', label: '阅读历史会话' }) });
    expect(reply()?.steps).toHaveLength(2);

    // 事件可能漏：最终回复带完整清单，以它为准
    const full = [step({ running: false, outcome: '列出 12 条' }), step({ id: 1, label: '阅读历史会话', running: false, outcome: '读完了' }), step({ id: 2, label: '修改记忆', running: false, outcome: '已提交 1 条修改' })];
    finishRun({ text: '好了', batchId: null, ops: [], steps: full });
    await sending;
    expect(reply()?.steps).toHaveLength(3);
    expect(reply()?.steps.every((s) => !s.running)).toBe(true);
  });
});
