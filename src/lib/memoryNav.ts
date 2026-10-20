import { collectPlatformHints, isMobilePlatform } from '@/platform';
import { useMemoryStore } from '@/stores/memoryStore';
import { useSettingsNavStore } from '@/stores/settingsNavStore';
import { useViewStore } from '@/stores/viewStore';
import type { ScopeRef } from './memory';

/** 设置里「记忆」分类的 id（桌面 `settingsNavigation`、手机 `mobileSettingsModel` 同名）。 */
export const MEMORY_SETTINGS_CATEGORY = 'memory';

/**
 * 打开记忆管理页；给了 `focus` 就直接筛到那个作用域（「这台机器的记忆」）。
 *
 * 平台差异只在这里：桌面切到设置视图再跳分类，手机经 `mobile:open-settings`
 * 事件切到设置 Tab（与后台保活卡片同一条路）。
 */
export function openMemorySettings(focus?: ScopeRef): void {
  useMemoryStore.getState().setPendingFocus(focus ?? null);
  if (isMobilePlatform(collectPlatformHints())) {
    window.dispatchEvent(
      new CustomEvent('mobile:open-settings', { detail: { category: MEMORY_SETTINGS_CATEGORY } }),
    );
    return;
  }
  useViewStore.getState().setActiveId('builtin.settings');
  useSettingsNavStore.getState().requestNavigate(MEMORY_SETTINGS_CATEGORY);
}
