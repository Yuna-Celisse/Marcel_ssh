import { collectPlatformHints, isMobilePlatform } from '@/platform';
import { useRiskRuleFocusStore } from '@/stores/riskRuleFocusStore';
import { useSettingsNavStore } from '@/stores/settingsNavStore';
import { useViewStore } from '@/stores/viewStore';

/** 设置里承载「命令执行策略」（及其下「内置风险规则」二级页）的分类 id：桌面是「Agent」，手机是「命令策略」。 */
export const RISK_RULES_DESKTOP_CATEGORY = 'agent';
export const RISK_RULES_MOBILE_CATEGORY = 'agent-policy';

/**
 * 打开设置里的「内置风险规则」二级页并定位到某一条（审批弹窗里"调整这条规则"用）。
 *
 * 平台差异只在这里：桌面切到设置视图再跳分类，手机经 `mobile:open-settings`
 * 事件切到设置 Tab（与记忆页同一条路，见 `memoryNav.openMemorySettings`）。
 * 打开二级页与定位都走 `riskRuleFocusStore`：`focus(id)` 一步把页打开并留下待处理的定位，
 * 规则列表挂载后接手。
 */
export function openRiskRule(ruleId: string): void {
  useRiskRuleFocusStore.getState().focus(ruleId);
  if (isMobilePlatform(collectPlatformHints())) {
    window.dispatchEvent(
      new CustomEvent('mobile:open-settings', {
        detail: { category: RISK_RULES_MOBILE_CATEGORY },
      }),
    );
    return;
  }
  useViewStore.getState().setActiveId('builtin.settings');
  useSettingsNavStore.getState().requestNavigate(RISK_RULES_DESKTOP_CATEGORY);
}

/** 自定义规则行的 DOM id（命令测试里点命中的自定义规则时，据此滚过去）。 */
export const customRuleDomId = (id: string) => `risk-rule-${id}`;

/** 滚到「命令执行策略」主页面里的某条自定义规则并短暂高亮。内置规则不走这里（它们在二级页）。 */
export function flashCustomRule(id: string): void {
  const el = document.getElementById(customRuleDomId(id));
  if (!el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('bg-indigo-500/10');
  window.setTimeout(() => el.classList.remove('bg-indigo-500/10'), 1800);
}
