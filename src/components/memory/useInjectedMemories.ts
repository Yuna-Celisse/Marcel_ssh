import { useEffect, useState } from 'react';
import { getErrorMessage } from '@/lib/errors';
import * as memoryApi from '@/lib/memoryApi';
import type { InjectedMemories } from '@/lib/memory';
import { useMemoryStore } from '@/stores/memoryStore';

/**
 * 这段对话带着哪些记忆（还没开始的对话：开始时会带上哪些）。记忆一变（`revision`）
 * 就重取 —— 删掉的条目下一轮就不再带，这里要立刻反映出来。
 */
export function useInjectedMemories(conversationId: string | null, sessionId: string | null) {
  const revision = useMemoryStore((s) => s.revision);
  const [data, setData] = useState<InjectedMemories | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    useMemoryStore.getState().init();
    let alive = true;
    memoryApi
      .memoryConversationInjected(conversationId, sessionId)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (alive) setError(getErrorMessage(e));
      });
    return () => {
      alive = false;
    };
  }, [conversationId, sessionId, revision]);
  return { data, error };
}
