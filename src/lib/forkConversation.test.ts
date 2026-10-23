import { describe, it, expect } from 'vitest';
import { resolveForkAnchor } from '@/lib/forkConversation';
import type { AgentMessage } from '@/lib/types';

function msg(id: string, role: AgentMessage['role'], extra: Partial<AgentMessage> = {}): AgentMessage {
  return { id, role, content: '', timestamp: `ts-${id}`, ...extra };
}

describe('resolveForkAnchor', () => {
  const messages: AgentMessage[] = [
    msg('u1', 'user', { timestamp: '2026-01-01T00:00:00Z' }),
    msg('a1', 'assistant', { timestamp: '2026-01-01T00:00:10Z' }),
    msg('u2', 'user', { timestamp: '2026-01-01T00:01:00Z' }),
    msg('t1', 'tool', { timestamp: '2026-01-01T00:01:05Z' }),
    msg('a2', 'assistant', { timestamp: '2026-01-01T00:01:20Z' }),
  ];

  it('live 消息（无 dbId）：id 原样带回，turnStartedAt 取所在回合首条 user 的时间', () => {
    expect(resolveForkAnchor(messages, 'a2')).toEqual({
      messageId: 'a2',
      turnStartedAt: '2026-01-01T00:01:00Z',
    });
  });

  it('锚点自己就是回合首条 user：turnStartedAt 就是它自己的时间', () => {
    expect(resolveForkAnchor(messages, 'u2')).toEqual({
      messageId: 'u2',
      turnStartedAt: '2026-01-01T00:01:00Z',
    });
  });

  it('已回填 dbId 的消息：优先传库内 id（时间戳照带，做双保险）', () => {
    const withDb = [
      ...messages.slice(0, 2),
      { ...msg('u2', 'user', { timestamp: '2026-01-01T00:01:00Z' }), dbId: 'db-u2' },
      ...messages.slice(3),
    ];
    expect(resolveForkAnchor(withDb, 'a2')).toEqual({
      messageId: 'a2',
      turnStartedAt: '2026-01-01T00:01:00Z',
    });
    // 回合首条带 dbId、锚点在回合中间：锚点自己的 dbId 优先
    const anchorWithDb = [...messages.slice(0, 4), { ...msg('a2', 'assistant'), dbId: 'db-a2' }];
    expect(resolveForkAnchor(anchorWithDb, 'a2')).toEqual({
      messageId: 'db-a2',
      turnStartedAt: '2026-01-01T00:01:00Z',
    });
  });

  it('notice 回合（作业唤醒轮）同样是合法回合起点', () => {
    const noticeTurn = [
      msg('u1', 'user', { timestamp: '2026-01-01T00:00:00Z' }),
      msg('a1', 'assistant'),
      msg('n1', 'notice', { timestamp: '2026-01-01T00:02:00Z' }),
      msg('a2', 'assistant'),
    ];
    expect(resolveForkAnchor(noticeTurn, 'a2')).toEqual({
      messageId: 'a2',
      turnStartedAt: '2026-01-01T00:02:00Z',
    });
  });

  it('锚点不在列表里：退化为只传 id（与旧行为一致，后端给不出兜底）', () => {
    expect(resolveForkAnchor(messages, 'ghost')).toEqual({ messageId: 'ghost' });
  });

  it('锚点在回合中段（工具消息）：turnStartedAt 仍取本回合首条 user', () => {
    expect(resolveForkAnchor(messages, 't1')).toEqual({
      messageId: 't1',
      turnStartedAt: '2026-01-01T00:01:00Z',
    });
  });
});
