import { describe, expect, it } from 'vitest';
import { emptyRegistry } from '@/lib/llmRegistry';
import type { LlmRegistry, ModelEntry } from '@/lib/types';
import { resolveAssistantModelChoice, unchosenLabel } from './memoryAssistantModel';

function model(id: string, name: string): ModelEntry {
  return { id, channelId: 'c1', modelName: name, displayName: name } as unknown as ModelEntry;
}

function registry(over: Partial<LlmRegistry> = {}, slot = ''): LlmRegistry {
  const base = emptyRegistry();
  return {
    ...base,
    channels: [{ id: 'c1', name: '渠道', enabled: true } as never],
    models: [model('m1', 'big'), model('m2', 'small')],
    lastUsedModelId: 'm1',
    ...over,
    slots: { ...base.slots, memoryModelId: slot },
  };
}

describe('resolveAssistantModelChoice', () => {
  it('助手里点名选的优先，其次设置里的记忆模型，最后全局默认；没有「跟随会话」这一档', () => {
    expect(resolveAssistantModelChoice(registry({}, 'm2'), 'm1')).toMatchObject({ source: 'chosen', model: { id: 'm1' } });
    expect(resolveAssistantModelChoice(registry({}, 'm2'), '')).toMatchObject({ source: 'memorySlot', model: { id: 'm2' } });
    expect(resolveAssistantModelChoice(registry(), '')).toMatchObject({ source: 'default', model: { id: 'm1' } });
  });

  it('选的模型已被删除时不沿用失效 id', () => {
    expect(resolveAssistantModelChoice(registry({}, 'm2'), 'gone')).toMatchObject({ source: 'memorySlot' });
  });

  it('不选这一项写明会落到哪个模型', () => {
    expect(unchosenLabel(registry({}, 'm2'))).toContain('沿用记忆模型设置');
    expect(unchosenLabel(registry())).toContain('沿用默认模型');
  });
});
