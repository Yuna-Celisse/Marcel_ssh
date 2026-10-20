import { useEffect } from 'react';
import { emptyRegistry, findModel, modelFullLabel } from '@/lib/llmRegistry';
import { resolveAssistantModelChoice } from '@/lib/memoryAssistantModel';
import { useMemoryAssistantStore } from '@/stores/memoryAssistantStore';
import { useSettingsStore } from '@/stores/settingsStore';

/** 助手当前要用的模型（含来源），入口按钮和对话框顶部共用，两处不会各说各话。 */
export function useAssistantModel() {
  const registry = useSettingsStore((s) => s.settings.llmRegistry) ?? emptyRegistry();
  const chosenId = useMemoryAssistantStore((s) => s.modelId);
  // 选过的模型后来被删了：退回「不选」，别拿着一个失效 id 去请求。
  useEffect(() => {
    if (chosenId && !findModel(registry, chosenId)) useMemoryAssistantStore.getState().setModelId('');
  }, [registry, chosenId]);
  const choice = resolveAssistantModelChoice(registry, chosenId);
  return { registry, chosenId, choice, label: choice.model ? modelFullLabel(registry, choice.model.id) : '' };
}
