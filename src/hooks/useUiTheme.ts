import { useEffect, useRef } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { applyUiTheme, normalizeUiTheme } from '@/lib/uiTheme';

/**
 * 应用主题的运行时挂载点：订阅设置里的 uiTheme，变化时把分区颜色写到
 * <html> 的 CSS 变量上（桌面与移动端 App 根各挂一次）。
 * 认 store.preview 里的 uiTheme（设置页「免保存」通道的实时预览），预览优先。
 * 启动第一帧的兜底在 main.tsx 的 initUiThemeEarly（读 localStorage 缓存，
 * 避免浅色主题用户先看到一帧深色）；首帧应用不带过渡，之后的应用带颜色过渡。
 */
export function useUiTheme(): void {
  const uiTheme = useSettingsStore((s) => s.settings.uiTheme);
  const previewTheme = useSettingsStore((s) => s.preview?.uiTheme);
  const firstRunRef = useRef(true);
  const current = previewTheme ?? uiTheme;

  useEffect(() => {
    applyUiTheme(normalizeUiTheme(current), !firstRunRef.current);
    firstRunRef.current = false;
  }, [current]);
}
