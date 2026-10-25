import { SlidersHorizontal } from 'lucide-react';
import { useRiskRuleCatalog } from '@/hooks/useRiskRuleCatalog';
import { useSettingsStore } from '@/stores/settingsStore';

/**
 * 审批弹窗里的「命中的风险规则」：告诉用户是哪几条规则要他点头，并给出调整入口。
 *
 * 规则名取自后端规则目录（内置）或设置里的自定义规则，不在前端抄一份。
 * 没有命中任何规则（档位来自命令名单、模型审批、插件声明……）就不渲染 ——
 * 此时没有"规则"可调，别造一个空块。桌面审批弹窗与手机审批底部面板共用。
 */
export function RiskRuleHits({
  ruleIds,
  onOpenRule,
  compact,
}: {
  ruleIds: string[] | undefined;
  /** 点「调整」：调用方负责收起弹窗并跳到该规则。 */
  onOpenRule?: (ruleId: string) => void;
  compact?: boolean;
}) {
  const { catalog } = useRiskRuleCatalog();
  const custom = useSettingsStore((s) => s.settings.customRiskRules);
  if (!ruleIds || ruleIds.length === 0) return null;

  const titleOf = (id: string): string =>
    catalog?.rules.find((r) => r.id === id)?.title ??
    custom?.find((c) => c.id === id)?.name?.trim() ??
    id;

  return (
    <div className="rounded-lg border border-edge bg-zinc-800/50 px-3 py-2">
      <div className="mb-1 text-xs font-medium text-zinc-300">命中的风险规则</div>
      <ul className="space-y-1">
        {ruleIds.map((id) => (
          <li key={id} className="flex items-center justify-between gap-2 text-xs text-zinc-400">
            <span className="min-w-0 truncate">{titleOf(id) || '自定义规则'}</span>
            {onOpenRule && (
              <button
                type="button"
                onClick={() => onOpenRule(id)}
                className={`inline-flex flex-shrink-0 items-center gap-1 rounded-md text-indigo-300 hover:text-indigo-200 active:text-indigo-200 ${
                  compact ? 'px-2 py-1.5' : 'px-1.5 py-0.5'
                }`}
              >
                <SlidersHorizontal className="h-3 w-3" />
                调整
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
