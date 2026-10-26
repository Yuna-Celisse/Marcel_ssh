import { useEffect, useState } from 'react';
import * as tauri from '@/lib/tauri';

/**
 * 「需要审批的工具」里可以点名的内置工具名，取自后端工具声明表。
 *
 * 清单随应用版本固定、运行期不变，整个进程只取一次（桌面与手机设置页共用）。取不到时
 * 返回 `null`，编辑器退回前端认识的那些工具 —— 设置页不因此打不开。
 */
let cached: string[] | null = null;
let inflight: Promise<string[]> | null = null;

function load(): Promise<string[]> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = tauri
      .agentListApprovableTools()
      .then((names) => {
        cached = names;
        return names;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** 测试用：清掉缓存。 */
export function resetApprovableToolsCache(): void {
  cached = null;
  inflight = null;
}

export function useApprovableTools(): string[] | null {
  const [names, setNames] = useState<string[] | null>(cached);

  useEffect(() => {
    if (cached) {
      setNames(cached);
      return;
    }
    let cancelled = false;
    load()
      .then((n) => {
        if (!cancelled) setNames(n);
      })
      // 取不到就用前端认识的那些（names 保持 null），不弹错：这只是个"可选项"清单。
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return names;
}
