import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { CustomRiskRule } from '@/lib/types';
import {
  CUSTOM_RULE_LEVELS,
  emptyCustomRule,
  validateCustomRule,
} from '@/lib/riskRules';
import { customRuleDomId } from '@/lib/riskRuleNav';
import Toggle from '@/components/ui/Toggle';
import { LevelSelect } from './RiskLevelSelect';

const fieldClass =
  'rounded-lg border border-edge bg-zinc-800 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-500';

/**
 * 自定义规则（桌面与手机共用）：一行写成「命令 + 参数含 + 档位」，例如 `docker` + `prune` → 强制审批。
 * 与内置规则同层，取最严；命令名只填基础命令，参数写在"参数含"里。
 */
export function CustomRiskRulesEditor({
  rules,
  onChange,
  compact,
}: {
  rules: CustomRiskRule[];
  onChange: (next: CustomRiskRule[]) => void;
  compact?: boolean;
}) {
  // 刚点「添加规则」建出来的那一行：渲染时自动聚焦命令框，免得用户再点一下。
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const input = `${fieldClass} min-w-0 border font-mono ${
    compact ? 'px-3 py-2.5 text-sm' : 'px-2.5 py-1.5 text-xs'
  }`;

  const patch = (id: string, next: Partial<CustomRiskRule>) =>
    onChange(rules.map((r) => (r.id === id ? { ...r, ...next } : r)));

  return (
    <div className="space-y-2">
      {rules.map((rule) => {
        const error = validateCustomRule(rule);
        return (
          <div
            key={rule.id}
            id={customRuleDomId(rule.id)}
            className="space-y-1 rounded-lg transition-colors duration-500"
          >
            <div
              className={`flex gap-2 ${compact ? 'flex-wrap' : 'items-center'}`}
            >
              <input
                type="text"
                value={rule.command}
                onChange={(e) => patch(rule.id, { command: e.target.value })}
                placeholder="命令，如 docker"
                aria-label="自定义规则：命令名"
                autoFocus={justAdded === rule.id}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={`${input} ${compact ? 'w-[calc(50%-0.25rem)]' : 'w-32'}`}
              />
              <input
                type="text"
                value={rule.argContains}
                onChange={(e) =>
                  patch(rule.id, { argContains: e.target.value })
                }
                placeholder="参数含（可选）"
                aria-label="自定义规则：参数包含"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={`${input} ${compact ? 'min-w-0 flex-1' : 'w-36'}`}
              />
              <span
                className={
                  compact
                    ? 'flex w-full items-center gap-2'
                    : 'ml-auto flex items-center gap-2'
                }
              >
                {compact && <span className="flex-1" />}
                <LevelSelect
                  ariaLabel={`${rule.command || '新规则'}：处置档位`}
                  value={rule.level}
                  options={CUSTOM_RULE_LEVELS}
                  compact={compact}
                  onChange={(level) => patch(rule.id, { level })}
                />
                <Toggle
                  size={compact ? 'md' : 'sm'}
                  checked={rule.enabled}
                  onChange={(enabled) => patch(rule.id, { enabled })}
                />
                <button
                  type="button"
                  onClick={() =>
                    onChange(rules.filter((r) => r.id !== rule.id))
                  }
                  className={`flex-shrink-0 text-zinc-500 hover:text-red-400 active:text-red-400 ${
                    compact ? 'p-2' : 'p-1'
                  }`}
                  aria-label="删除这条规则"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </span>
            </div>
            {error && rule.command !== '' && (
              <p className="text-[11px] text-amber-400/90">
                {error}，填好之前这条规则不生效。
              </p>
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => {
          const rule = emptyCustomRule();
          setJustAdded(rule.id);
          onChange([...rules, rule]);
        }}
        className={`inline-flex items-center gap-1 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-state-mid active:bg-state-mid ${
          compact ? 'px-3 py-2 text-sm' : 'px-2.5 py-1 text-xs'
        }`}
      >
        <Plus className="h-3.5 w-3.5" />
        添加规则
      </button>
    </div>
  );
}
