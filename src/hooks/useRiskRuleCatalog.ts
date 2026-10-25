import { useEffect, useState } from 'react';
import * as tauri from '@/lib/tauri';
import { getErrorMessage } from '@/lib/errors';
import type { RiskRuleCatalog } from '@/lib/types';

/**
 * 内置命令风险规则的目录（说明、默认档位、名单默认值），取自后端 `agent/risk/rules.rs`。
 *
 * 目录随应用版本固定、运行期不变，所以整个进程只取一次（桌面与手机设置页、
 * 命令测试共用同一份）。取不到时返回 `null` 并带上原因，页面显示重试入口而不是空白。
 */
let cached: RiskRuleCatalog | null = null;
let inflight: Promise<RiskRuleCatalog> | null = null;

function load(): Promise<RiskRuleCatalog> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = tauri
      .agentListRiskRules()
      .then((c) => {
        cached = c;
        return c;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

/** 测试用：清掉缓存。 */
export function resetRiskRuleCatalogCache(): void {
  cached = null;
  inflight = null;
}

export function useRiskRuleCatalog(): {
  catalog: RiskRuleCatalog | null;
  error: string | null;
  retry: () => void;
} {
  const [catalog, setCatalog] = useState<RiskRuleCatalog | null>(cached);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (cached) {
      setCatalog(cached);
      return;
    }
    let cancelled = false;
    setError(null);
    load()
      .then((c) => {
        if (!cancelled) setCatalog(c);
      })
      .catch((e) => {
        if (!cancelled) setError(getErrorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { catalog, error, retry: () => setAttempt((n) => n + 1) };
}
