import { describe, expect, it } from 'vitest';
import type { AssistantEntry } from '@/stores/memoryAssistantStore';
import type { AssistantStep, MemoryItem, MemoryOpRecord } from '@/lib/memory';
import { assistantMessages } from './assistantMessages';

const AT = '2026-10-21T00:00:00Z';

function step(over: Partial<AssistantStep>): AssistantStep {
  return { id: 0, tool: 'memory_list', label: '查看记忆', detail: '机器「web-01」', outcome: '列出 12 条', ok: true, running: false, note: '', ...over };
}

const item = { id: 'm1', scope: 'host', scopeKey: 'c1', title: '重启前先停 nginx', content: '正文' } as MemoryItem;
const op = { id: 7, batchId: 'b1', memoryId: 'm1', op: 'add', before: null, after: item, reverted: false } as unknown as MemoryOpRecord;

function reply(over: Partial<Extract<AssistantEntry, { role: 'assistant' }>>): AssistantEntry {
  return {
    id: 'a1', role: 'assistant', runId: 'r', at: AT, text: '', status: 'done', activity: null,
    steps: [], batchId: null, ops: [], reverted: false, error: null, ...over,
  };
}

describe('assistantMessages', () => {
  it('用户话 → user 气泡；步骤 → 工具卡；模型发起前说的话 → 前面的一条助手正文', () => {
    const out = assistantMessages(
      [
        { id: 'u1', role: 'user', text: '合并重复的', at: AT },
        reply({ steps: [step({ note: '我先看看现有的记忆' })], text: '整理好了' }),
      ],
      [],
    );
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(out[1].content).toBe('我先看看现有的记忆');
    expect(out[2].toolResult).toMatchObject({ toolName: 'memory_list', summary: '机器「web-01」', result: '列出 12 条', success: true });
    expect(out[3].content).toBe('整理好了');
  });

  it('执行中的步骤带 isExecuting；失败的步骤 success=false', () => {
    const out = assistantMessages(
      [reply({ status: 'running', steps: [step({ id: 0, ok: false, outcome: '找不到机器' }), step({ id: 1, running: true, outcome: '' })] })],
      [],
    );
    const tools = out.filter((m) => m.role === 'tool');
    expect(tools[0].toolResult?.success).toBe(false);
    expect(tools[1].isExecuting).toBe(true);
  });

  it('改动 → 和 Agent 写记忆同一张 memory 卡；成功的 memory_apply 步骤不再单列', () => {
    const out = assistantMessages(
      [reply({ steps: [step({ tool: 'memory_apply', label: '修改记忆', outcome: '已提交 1 条修改' })], ops: [op] })],
      [],
    );
    expect(out).toHaveLength(1);
    expect(out[0].toolResult?.toolName).toBe('memory');
    expect(out[0].toolResult?.metadata?.memory).toMatchObject({ op: 'add', opId: 7, batchId: 'b1', memoryId: 'm1' });
  });

  it('失败的 memory_apply 要留着，原因才看得见', () => {
    const out = assistantMessages(
      [reply({ steps: [step({ tool: 'memory_apply', ok: false, outcome: '整批未提交' })] })],
      [],
    );
    expect(out).toHaveLength(1);
    expect(out[0].toolResult?.success).toBe(false);
  });

  it('等第一步期间给一个加载中占位；已停止 / 出错各一条系统提示', () => {
    expect(assistantMessages([reply({ status: 'running' })], [])[0]).toMatchObject({ role: 'assistant', isLoading: true });
    const stopped = assistantMessages([reply({ status: 'cancelled' })], []);
    expect(stopped[0]).toMatchObject({ role: 'system', content: '已停止' });
    const failed = assistantMessages([reply({ status: 'error', error: '模型不可用' })], []);
    expect(failed[0]).toMatchObject({ role: 'system', content: '模型不可用' });
  });
});
