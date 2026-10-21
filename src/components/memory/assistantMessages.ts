import type { AgentMessage } from '@/lib/types';
import { opItem, scopeLabel, scopeOf, type MemoryOpRecord } from '@/lib/memory';
import type { AssistantEntry } from '@/stores/memoryAssistantStore';

type Connections = Parameters<typeof scopeLabel>[1];

/**
 * 把整理助手的对话记录翻译成 Agent 对话用的 `AgentMessage[]`，交给 Agent 的消息列表渲染。
 *
 * 为什么翻译而不是自己画：整理助手和 Agent 本质是同一种东西——用户说话、模型说话、
 * 模型调工具、工具给结果。自己画一套，气泡、间距、工具卡、分组、展开方式、流式滚动都要
 * 另写另调，而且每次和 Agent 对话那边出入都会被一眼看出来（头像、缩进、错位）。
 * 翻译成同一种消息，长相和行为就天然一致，Agent 那边以后怎么改这边跟着变。
 *
 * 对应关系：
 * - 用户说的话 → `user` 气泡；
 * - 助手每一步 → `tool` 工具卡（执行中转圈，标题行是「对谁做的」，展开看结果）；
 *   发起这一步之前它说的话 → 这一步前面的一条 `assistant` 正文；
 * - 它改的记忆 → 和 Agent 写记忆同一张 `memory` 卡（展开看正文/改前改后，可编辑、可撤销）；
 *   `memory_apply` 那一步成功后就不再单列——它的结果就是这些卡；
 * - 最终回复 → `assistant` 正文。
 */
export function assistantMessages(entries: readonly AssistantEntry[], connections: Connections): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const e of entries) {
    if (e.role === 'user') {
      out.push({ id: e.id, role: 'user', content: e.text, timestamp: e.at });
      continue;
    }
    const running = e.status === 'running';
    for (const s of e.steps) {
      if (s.note) {
        out.push({ id: `${e.id}:note:${s.id}`, role: 'assistant', content: s.note, timestamp: e.at });
      }
      // 成功的 memory_apply：下面那些记忆卡就是它的结果，再列一行是重复。
      if (s.tool === 'memory_apply' && !s.running && s.ok) continue;
      out.push({
        id: `${e.id}:step:${s.id}`,
        role: 'tool',
        content: '',
        timestamp: e.at,
        isExecuting: s.running,
        toolResult: {
          toolName: s.tool,
          summary: s.detail,
          result: s.outcome,
          success: s.ok,
          blocked: false,
          toolCallId: `${e.id}:${s.id}`,
        },
      });
    }
    for (const op of e.ops) {
      const card = memoryCard(e.id, e.at, op, connections);
      if (card) out.push(card);
    }
    if (e.text) out.push({ id: `${e.id}:text`, role: 'assistant', content: e.text, timestamp: e.at });
    if (e.status === 'cancelled') {
      out.push({ id: `${e.id}:stopped`, role: 'system', content: '已停止', timestamp: e.at });
    }
    if (e.error) out.push({ id: `${e.id}:error`, role: 'system', content: e.error, timestamp: e.at });
    // 等第一个字 / 第一步期间对话里没有任何东西，用「加载中」占位（和 Agent 一样，可见的运行状态在列表下面）。
    if (running && !e.text && e.steps.length === 0) {
      out.push({ id: `${e.id}:loading`, role: 'assistant', content: '', timestamp: e.at, isLoading: true });
    }
  }
  return out;
}

/** 一条改动 → Agent 对话里「写记忆」的那张卡所需的消息（形状见 `MemoryToolView` 的 `readMeta`）。 */
function memoryCard(entryId: string, at: string, op: MemoryOpRecord, connections: Connections): AgentMessage | null {
  const item = opItem(op);
  if (!item) return null;
  return {
    id: `${entryId}:op:${op.id}`,
    role: 'tool',
    content: '',
    timestamp: at,
    toolResult: {
      toolName: 'memory',
      summary: item.title,
      result: '',
      success: true,
      blocked: false,
      metadata: {
        memory: {
          op: op.op,
          opId: op.id,
          batchId: op.batchId,
          memoryId: op.memoryId,
          scopeLabel: scopeLabel(scopeOf(item), connections),
          before: op.before,
          after: op.after,
        },
      },
    },
  };
}
