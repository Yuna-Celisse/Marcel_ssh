import { Card, SettingItem } from "./helpers";
import { useLiveSettingsPatch } from "./useLiveSettingsPatch";
import { UiThemeEditor } from "./UiThemeEditor";
import { FontSizeInput } from "./FontSizeInput";

/**
 * 应用主题分区（桌面）：界面主题 + 终端外观（终端颜色 / 字号 / 字体）。
 * 整个分区走 useLiveSettingsPatch 的免保存通道——改完即见、无需按保存；
 * 终端外观从原「终端外观」分区收编而来（settings-appearance 已移除）。
 */
export function ThemeSection() {
  const { settings, preview, liveUpdate } = useLiveSettingsPatch();

  // 预览优先：防抖落库前界面显示的就是刚改的值
  const uiTheme = preview?.uiTheme ?? settings.uiTheme;
  const terminalColors = preview?.terminalColors ?? settings.terminalColors;
  const fontSize = preview?.fontSize ?? settings.fontSize;
  const fontFamily = preview?.fontFamily ?? settings.fontFamily;

  return (
    <Card
      id="settings-theme"
      title="应用主题"
      description="界面与终端的配色、字号与字体；改动即时生效，无需保存"
    >
      <SettingItem
        id="ui-theme"
        label="主题与颜色分区"
        description="选预设整体换色（终端配色随主题成套切换），或进自定义逐分区调整；语义色按基准色自动生成整套深浅"
        sectionId="settings-theme"
        keywords={[
          "theme",
          "color",
          "dark",
          "light",
          "terminal",
          "主题",
          "颜色",
          "配色",
          "深色",
          "浅色",
          "外观",
          "界面",
          "终端颜色",
          "终端配色",
        ]}
      >
        <UiThemeEditor
          value={uiTheme}
          terminalColors={terminalColors}
          // 主题与终端配色同一次 patch 写入：preview 与落库都是原子的，不会出现半套
          onChange={(uiTheme, terminalColors) =>
            liveUpdate({ uiTheme, ...(terminalColors && { terminalColors }) })
          }
        />
      </SettingItem>
      <SettingItem
        id="font-size"
        label="字号"
        description="终端字体大小"
        sectionId="settings-theme"
        keywords={["font", "size", "字体大小", "界面", "终端外观"]}
      >
        <FontSizeInput
          value={fontSize}
          onChange={(fontSize) => liveUpdate({ fontSize })}
        />
      </SettingItem>
      <SettingItem
        id="font-family"
        label="字体"
        description="终端字体族；Nerd Fonts 图标已内置，无需自己安装"
        sectionId="settings-theme"
        keywords={[
          "font",
          "family",
          "typeface",
          "nerd",
          "字体",
          "界面",
          "终端外观",
        ]}
      >
        <input
          type="text"
          value={fontFamily}
          onChange={(e) => liveUpdate({ fontFamily: e.target.value })}
          className="flex-1 rounded-lg bg-zinc-800 border border-edge px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-indigo-500"
        />
      </SettingItem>
    </Card>
  );
}
