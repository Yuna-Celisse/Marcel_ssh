import { useEffect, useState } from 'react';
import * as memoryApi from '@/lib/memoryApi';

/**
 * 这台机器（连接）有几条记忆。删连接的确认框据此决定要不要给「同时删除这台机器的
 * N 条记忆」那个复选框（0 条就不显示，免得多一个没意义的选项）。
 */
export function useHostMemoryCount(connectionId: string | null): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    if (!connectionId) return;
    let alive = true;
    memoryApi
      .memoryCountForConnection(connectionId)
      .then((n) => {
        if (alive) setCount(n);
      })
      .catch(() => {
        /* 数不出来就不提供这个选项：记忆照常留在「已删除的连接」里 */
      });
    return () => {
      alive = false;
    };
  }, [connectionId]);
  return count;
}
