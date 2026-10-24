import { DEFAULT_TERMINAL_COLORS, TERMINAL_COLOR_PRESETS } from './constants';
import type { TerminalColors } from './types';

/**
 * 终端配色的唯一来源是设置里的 `terminalColors`——它是应用主题的一部分：选预设主题时
 * 与界面一并写入（见 UiThemeEditor / lib/uiTheme.ts 预设的 `terminal`），所以这里
 * **不再**按界面明暗偷偷换色（旧版读 data-marcel-theme 强制亮色，与存档脱节，
 * 浅色主题下终端是否变亮取决于渲染时机）。
 * 唯一保留的强制亮色是调试页的「浅色主题」开关（debugStore.lightMode），由调用方显式传入。
 */
export function getLightTerminalColors(): TerminalColors {
  return TERMINAL_COLOR_PRESETS.find((preset) => preset.name === '亮色')?.colors ?? DEFAULT_TERMINAL_COLORS;
}

export function resolveTerminalColors(
  colors: TerminalColors | null | undefined,
  forceLight = false,
): TerminalColors {
  if (forceLight) return getLightTerminalColors();
  return colors ?? DEFAULT_TERMINAL_COLORS;
}
