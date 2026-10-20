import { effectiveDefaultModel, findModel, modelFullLabel } from '@/lib/llmRegistry';
import type { LlmRegistry, ModelEntry } from '@/lib/types';

/** 整理助手这次会用哪个模型、凭什么用它（与后端 `resolve_assistant_model` 同一条规则）。 */
export interface AssistantModelChoice {
  model: ModelEntry | undefined;
  /** chosen = 用户在助手里点名选的；memorySlot = 设置里的「记忆模型」；default = 全局默认模型。 */
  source: 'chosen' | 'memorySlot' | 'default' | 'none';
}

/**
 * 优先级：助手里明确选的 → 设置里的记忆模型 → 全局默认模型。
 * 助手没有「当前会话」，所以不存在「跟随会话模型」这一档。
 */
export function resolveAssistantModelChoice(registry: LlmRegistry, chosenId: string): AssistantModelChoice {
  const chosen = chosenId ? findModel(registry, chosenId) : undefined;
  if (chosen) return { model: chosen, source: 'chosen' };
  const slotId = registry.slots.memoryModelId ?? '';
  const slot = slotId ? findModel(registry, slotId) : undefined;
  if (slot) return { model: slot, source: 'memorySlot' };
  const fallback = effectiveDefaultModel(registry);
  return fallback ? { model: fallback, source: 'default' } : { model: undefined, source: 'none' };
}

/** 「不选」这一项的说明：落到哪个模型、为什么。 */
export function unchosenLabel(registry: LlmRegistry): string {
  const { model, source } = resolveAssistantModelChoice(registry, '');
  if (!model) return '尚未配置模型';
  const name = modelFullLabel(registry, model.id);
  return source === 'memorySlot' ? `沿用记忆模型设置（${name}）` : `沿用默认模型（${name}）`;
}
