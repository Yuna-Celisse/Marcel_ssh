import { useEffect, useState } from 'react';
import type { TerminalColors, UiThemeSettings, UiThemeZoneId, UiThemeZones } from '@/lib/types';
import { TERMINAL_COLOR_PRESETS } from '@/lib/constants';
import {
  CUSTOM_PRESET_ID,
  UI_THEME_NEUTRAL_ZONES,
  UI_THEME_PRESETS,
  UI_THEME_SEMANTIC_ZONES,
  deriveNeutralRamp,
  deriveTerminalColors,
  inferScheme,
} from '@/lib/uiTheme';

const TERMINAL_COLOR_FIELDS: { key: keyof TerminalColors; label: string }[] = [
  { key: 'background', label: '背景' },
  { key: 'foreground', label: '前景' },
  { key: 'cursor', label: '光标' },
  { key: 'selectionBackground', label: '选区' },
  { key: 'black', label: '黑' },
  { key: 'red', label: '红' },
  { key: 'green', label: '绿' },
  { key: 'yellow', label: '黄' },
  { key: 'blue', label: '蓝' },
  { key: 'magenta', label: '品红' },
  { key: 'cyan', label: '青' },
  { key: 'white', label: '白' },
  { key: 'brightBlack', label: '亮黑' },
  { key: 'brightRed', label: '亮红' },
  { key: 'brightGreen', label: '亮绿' },
  { key: 'brightYellow', label: '亮黄' },
  { key: 'brightBlue', label: '亮蓝' },
  { key: 'brightMagenta', label: '亮品红' },
  { key: 'brightCyan', label: '亮青' },
  { key: 'brightWhite', label: '亮白' },
];

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function normalizeHexInput(raw: string): string | null {
  const v = raw.trim();
  if (!HEX_RE.test(v)) return null;
  const hex = v.toLowerCase();
  if (hex.length === 4) {
    return `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  return hex;
}

/** 单个颜色的取色行：色块（原生取色器）+ 十六进制输入。分区与终端色共用。 */
function ZoneColorField({
  zone,
  value,
  onChange,
}: {
  zone: { label: string; hint?: string };
  value: string;
  onChange: (hex: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = (raw: string) => {
    const hex = normalizeHexInput(raw);
    if (hex) onChange(hex);
  };

  return (
    <label className="flex items-center gap-2.5 min-w-0" title={zone.hint ?? zone.label}>
      <span className="relative h-7 w-7 flex-shrink-0 overflow-hidden rounded-md border border-zinc-600">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={zone.label}
        />
        <span className="block h-full w-full" style={{ backgroundColor: value }} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="truncate text-[13px] text-zinc-200">{zone.label}</span>
        {zone.hint && <span className="truncate text-[11px] text-zinc-500">{zone.hint}</span>}
      </span>
      <input
        type="text"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          commit(e.target.value);
        }}
        onBlur={() => setDraft(value)}
        spellCheck={false}
        autoComplete="off"
        className="w-[5.5rem] flex-shrink-0 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-300 outline-none focus:border-indigo-500"
        placeholder="#000000"
      />
    </label>
  );
}

/**
 * 应用主题编辑器（桌面与移动端共用；语义唯一来源 lib/uiTheme.ts）。
 * 预设一键整体换色；分区行逐色自定义（改任意分区即进入「自定义」）。
 * onChange 直接落库 → <html> 上的 CSS 变量即时生效，整个应用就是实时预览。
 *
 * 终端配色是主题的一部分：选预设时 onChange 的第二个参数带上该预设成套的终端配色，
 * 调用方必须把两者在同一次 patch 里写入（否则会出现浅色界面配深色终端的中间态）；
 * 自定义主题在编辑器的「终端配色」组里单独微调，并在界面明暗翻转时自动重新生成。
 */
export function UiThemeEditor({
  value,
  terminalColors,
  onChange,
}: {
  value: UiThemeSettings;
  terminalColors: TerminalColors;
  onChange: (next: UiThemeSettings, terminalColors?: TerminalColors) => void;
}) {
  // 分区编辑器默认收起：预设一键换色是主路径，逐分区调整属于「自定义」。
  // 带着自定义主题进来时直接展开，与当前状态一致。
  const [customOpen, setCustomOpen] = useState(value.presetId === CUSTOM_PRESET_ID);
  const isCustom = value.presetId === CUSTOM_PRESET_ID;

  const setZone = (id: UiThemeZoneId, hex: string) => {
    const zones: UiThemeZones = { ...value.zones, [id]: hex };
    // 界面明暗翻转（比如把主背景从深拖到浅）时终端跟着重新生成，别留深色终端在浅色界面里
    const flipped = inferScheme(zones) !== inferScheme(value.zones);
    onChange({ presetId: CUSTOM_PRESET_ID, zones }, flipped ? deriveTerminalColors(zones) : undefined);
  };

  const selectPreset = (presetId: string) => {
    const preset = UI_THEME_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setCustomOpen(false);
    onChange({ presetId: preset.id, zones: { ...preset.zones } }, preset.terminal);
  };

  const setTerminal = (next: TerminalColors) => onChange(value, next);
  const selectedTerminalPreset = TERMINAL_COLOR_PRESETS.find(
    (p) => JSON.stringify(p.colors) === JSON.stringify(terminalColors),
  )?.name;

  return (
    <div className="flex flex-col gap-4">
      {/* 预设（含自定义入口） */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {UI_THEME_PRESETS.map((preset) => {
          const selected = value.presetId === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              onClick={() => selectPreset(preset.id)}
              className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                selected
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : 'border-zinc-800 bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-800'
              }`}
            >
              <span
                className="flex h-8 w-8 flex-shrink-0 flex-col justify-center gap-[3px] rounded-md border border-zinc-600 p-[3px]"
                style={{ backgroundColor: preset.zones.bg }}
              >
                <span className="h-1.5 rounded-sm" style={{ backgroundColor: preset.zones.card }} />
                <span className="h-1.5 rounded-sm" style={{ backgroundColor: preset.zones.hover }} />
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: preset.zones.accent }}
                />
              </span>
              <span className="min-w-0">
                <span
                  className={`block truncate text-sm ${
                    selected ? 'font-medium text-indigo-200' : 'text-zinc-200'
                  }`}
                >
                  {preset.name}
                </span>
                <span className="block text-[11px] text-zinc-500">
                  {preset.scheme === 'light' ? '浅色' : '深色'}
                </span>
              </span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setCustomOpen((v) => !v)}
          className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
            isCustom || customOpen
              ? 'border-indigo-500 bg-indigo-500/10'
              : 'border-zinc-800 bg-zinc-900 hover:bg-zinc-800 active:bg-zinc-800'
          }`}
        >
          <span className="h-8 w-8 flex-shrink-0 rounded-md border border-zinc-600 bg-gradient-to-br from-red-500 via-green-500 to-blue-500" />
          <span className="min-w-0">
            <span
              className={`block truncate text-sm ${
                isCustom || customOpen ? 'font-medium text-indigo-200' : 'text-zinc-200'
              }`}
            >
              自定义
            </span>
            <span className="block text-[11px] text-zinc-500">
              {customOpen ? '收起分区' : '逐分区调整颜色'}
            </span>
          </span>
        </button>
      </div>

      {customOpen && (
        <>
          {/* 分区编辑：中性灰阶 */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-zinc-400">界面灰阶</div>
              <button
                type="button"
                onClick={() =>
                  onChange({ presetId: CUSTOM_PRESET_ID, zones: deriveNeutralRamp(value.zones) })
                }
                className="rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700"
                title="以当前「主背景 / 卡片 / 标题」为锚点，自动生成其余灰阶档位"
              >
                按三档自动铺满
              </button>
            </div>
            <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              {UI_THEME_NEUTRAL_ZONES.map((zone) => (
                <ZoneColorField
                  key={zone.id}
                  zone={zone}
                  value={value.zones[zone.id]}
                  onChange={(hex) => setZone(zone.id, hex)}
                />
              ))}
            </div>
          </div>

          {/* 分区编辑：语义色 */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
            <div className="mb-2 text-xs font-medium text-zinc-400">
              语义色
              <span className="ml-2 font-normal text-zinc-500">选一个基准色，整套深浅由它自动生成</span>
            </div>
            <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              {UI_THEME_SEMANTIC_ZONES.map((zone) => (
                <ZoneColorField
                  key={zone.id}
                  zone={zone}
                  value={value.zones[zone.id]}
                  onChange={(hex) => setZone(zone.id, hex)}
                />
              ))}
            </div>
          </div>

          {/* 终端配色：主题的一部分；预设自带，这里给自定义主题微调 */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-medium text-zinc-400">
                终端配色
                <span className="ml-2 font-normal text-zinc-500">选预设主题时会随主题一起换</span>
              </div>
              <button
                type="button"
                onClick={() => setTerminal(deriveTerminalColors(value.zones))}
                className="flex-shrink-0 rounded-md border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-300 hover:bg-zinc-700"
                title="用当前界面的背景、文字与语义色生成一套终端配色"
              >
                从界面配色生成
              </button>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              {TERMINAL_COLOR_PRESETS.map((preset) => {
                const selected = selectedTerminalPreset === preset.name;
                return (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => setTerminal(preset.colors)}
                    className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                      selected
                        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-200'
                        : 'border-zinc-700 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 active:bg-zinc-700'
                    }`}
                  >
                    <span
                      className="h-3.5 w-3.5 rounded border border-zinc-600"
                      style={{ backgroundColor: preset.colors.background }}
                    />
                    {preset.name}
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">
              {TERMINAL_COLOR_FIELDS.map(({ key, label }) => (
                <ZoneColorField
                  key={key}
                  zone={{ label }}
                  value={terminalColors[key] ?? '#000000'}
                  onChange={(hex) => setTerminal({ ...terminalColors, [key]: hex })}
                />
              ))}
            </div>
            <div
              className="mt-3 rounded-lg p-3 font-mono text-xs"
              style={{ backgroundColor: terminalColors.background, color: terminalColors.foreground }}
            >
              <div className="mb-1 flex gap-2">
                <span style={{ color: terminalColors.red }}>错误</span>
                <span style={{ color: terminalColors.green }}>成功</span>
                <span style={{ color: terminalColors.yellow }}>警告</span>
                <span style={{ color: terminalColors.blue }}>信息</span>
              </div>
              <div style={{ color: terminalColors.cyan }}>user@host:~$</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
