import { useEffect, useRef, useState } from 'react';
import * as tauri from '@/lib/tauri';
import { getErrorMessage } from '@/lib/errors';
import { CHECK_MODES, type CheckMode } from '@/lib/riskRules';
import type { CommandCheckResult } from '@/lib/types';
import { useSettingsActions } from '@/components/settings/SettingsActionsContext';
import { useRiskRuleFocusStore } from '@/stores/riskRuleFocusStore';

export interface CommandCheck {
  command: string;
  setCommand: (command: string) => void;
  results: { mode: CheckMode; result: CommandCheckResult }[] | null;
  error: string | null;
}

/**
 * 设置页「测试命令」的逻辑（桌面与手机共用）：边输入边测，三种模式各问后端一次。
 *
 * - 用的是设置页里的**草稿**（规则、名单、保护路径、工具档位还没保存也生效），草稿一变就
 *   重测，所以改完一条规则回来结论是新的，不用再点一次「测试」。
 * - 命令文本放在 `riskRuleFocusStore` 里而不是组件 state：用户进二级页看规则时本组件被卸载，
 *   放 state 里回来就丢了。
 * - 与后端的判定是同一份（`decide_command`），所以这里显示的就是实际会发生的事。
 */
export function useCommandCheck(): CommandCheck {
  const { settings } = useSettingsActions();
  const command = useRiskRuleFocusStore((s) => s.testCommand);
  const setCommand = useRiskRuleFocusStore((s) => s.setTestCommand);

  const [results, setResults] = useState<CommandCheck['results']>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const draft = {
    riskRuleOverrides: settings.riskRuleOverrides ?? {},
    customRiskRules: settings.customRiskRules ?? [],
    customProtectedPaths: settings.customProtectedPaths ?? [],
    agentModeSettings: settings.agentModeSettings,
  };
  // 草稿内容变了才重测（对象引用每次渲染都新，不能直接当依赖）。
  const draftKey = JSON.stringify(draft);

  useEffect(() => {
    const cmd = command.trim();
    if (!cmd) {
      seq.current += 1;
      setResults(null);
      setError(null);
      return;
    }
    const mine = ++seq.current;
    const timer = window.setTimeout(async () => {
      try {
        const all = await Promise.all(
          CHECK_MODES.map(async ({ mode }) => ({
            mode,
            result: await tauri.agentCheckCommand(cmd, mode, draft),
          })),
        );
        if (seq.current !== mine) return;
        setResults(all);
        setError(null);
      } catch (e) {
        if (seq.current !== mine) return;
        setResults(null);
        setError(`测试失败：${getErrorMessage(e)}`);
      }
    }, 200);
    return () => window.clearTimeout(timer);
    // draft 用 draftKey 代表内容变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command, draftKey]);

  return { command, setCommand, results, error };
}
