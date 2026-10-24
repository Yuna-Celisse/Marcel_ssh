import { useCallback, useEffect, useRef } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import type { AppSettings } from '@/lib/types';

/** 最后一次改动到落库的静默时长：连续调色（拖取色器/滑条）只落一次盘。 */
const PERSIST_DEBOUNCE_MS = 350;

/**
 * 「免保存」设置补丁通道（应用主题分区专用，桌面移动共用）。
 *
 * 桌面设置页整体是「草稿 + 保存按钮」流（SettingsActionsContext 的 update 只改
 * 本地草稿）；主题要的是改完即见、无需保存，所以这条通道刻意绕过草稿：
 * 改动先合并进 store.preview 立即生效（终端与主题的实时预览都认 preview），
 * 停稳 PERSIST_DEBOUNCE_MS 后一次性 store.update 落库（落库自动清 preview）；
 * 分区卸载时 flush，离开设置页不丢最后一次改动。
 */
export function useLiveSettingsPatch() {
  const settings = useSettingsStore((s) => s.settings);
  const preview = useSettingsStore((s) => s.preview);

  const pendingRef = useRef<Partial<AppSettings>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const patch = pendingRef.current;
    pendingRef.current = {};
    if (Object.keys(patch).length > 0) {
      useSettingsStore
        .getState()
        .update(patch)
        .catch((err) => console.error('主题设置落库失败:', err));
    }
  }, []);

  const liveUpdate = useCallback(
    (patch: Partial<AppSettings>) => {
      const store = useSettingsStore.getState();
      pendingRef.current = { ...pendingRef.current, ...patch };
      store.setPreview({ ...(store.preview ?? {}), ...patch });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, PERSIST_DEBOUNCE_MS);
    },
    [flush],
  );

  // 卸载即 flush：离开设置页（或切走分区）不带走在途改动。
  useEffect(() => flush, [flush]);

  return { settings, preview, liveUpdate };
}
