import { useEffect, useRef } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { applyUiTheme, normalizeUiTheme } from '@/lib/uiTheme';

/**
 * 应用主题的运行时挂载点：订阅设置里的 uiTheme，变化时把分区颜色写到
 * <html> 的 CSS 变量上（桌面与移动端 App 根各挂一次）。
 * 认 store.preview 里的 uiTheme（设置页「免保存」通道的实时预览），预览优先。
 * 启动第一帧的兜底在 main.tsx 的 initUiThemeEarly（读 localStorage 缓存，
 * 避免浅色主题用户先看到一帧深色）。设置加载完成前不应用——store 里此时是默认值，
 * 应用它会把缓存的主题盖成默认、加载完再切回来，每次启动都白播一遍揭开动画；
 * 加载完后的第一次应用不带动画（落位），之后用户主动切换才带。
 */
export function useUiTheme(): void {
  const uiTheme = useSettingsStore((s) => s.settings.uiTheme);
  const previewTheme = useSettingsStore((s) => s.preview?.uiTheme);
  const loaded = useSettingsStore((s) => s.loaded);
  const settledRef = useRef(false);
  const current = previewTheme ?? uiTheme;

  useEffect(() => {
    if (!loaded) return;
    applyUiTheme(normalizeUiTheme(current), settledRef.current);
    settledRef.current = true;
  }, [current, loaded]);
}
