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
