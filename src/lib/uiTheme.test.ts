// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyUiTheme,
  CUSTOM_PRESET_ID,
  DEFAULT_UI_THEME_SETTINGS,
  DEFAULT_UI_THEME_ZONES,
  deriveNeutralRamp,
  deriveScale,
  deriveTerminalColors,
  inferScheme,
  normalizeUiTheme,
  resolveThemeVars,
  resolveUiThemeScheme,
  UI_THEME_NEUTRAL_ZONES,
  UI_THEME_PRESETS,
  UI_THEME_SEMANTIC_ZONES,
  getUiThemePreset,
} from './uiTheme';

function channelDiff(a: string, b: string): number {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return Math.max(...pa.map((v, i) => Math.abs(v - pb[i])));
}

beforeEach(() => {
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.marcelTheme;
  document.documentElement.classList.remove('marcel-theme-transition');
  localStorage.clear();
});

describe('normalizeUiTheme', () => {
  it('fills missing zones with defaults and lowercases hex', () => {
    const t = normalizeUiTheme({ presetId: 'custom', zones: { bg: '#ABCDEF' } } as never);
    expect(t.zones.bg).toBe('#abcdef');
    expect(t.zones.card).toBe(DEFAULT_UI_THEME_ZONES.card);
    expect(t.zones.accent).toBe(DEFAULT_UI_THEME_ZONES.accent);
  });

  it('drops invalid colors instead of crashing or persisting them', () => {
    const t = normalizeUiTheme({
      presetId: 'custom',
      zones: { bg: 'not-a-color', accent: 'javascript:alert(1)', card: '#27272a' },
    } as never);
    expect(t.zones.bg).toBe(DEFAULT_UI_THEME_ZONES.bg);
    expect(t.zones.accent).toBe(DEFAULT_UI_THEME_ZONES.accent);
    expect(t.zones.card).toBe('#27272a');
  });

  it('未知预设降级：带过分区的回「自定义」保住配色，什么都没有的回默认', () => {
    const t = normalizeUiTheme({ presetId: 'does-not-exist', zones: { bg: '#101010' } } as never);
    expect(t.presetId).toBe('custom');
    expect(t.zones.bg).toBe('#101010');

    const empty = normalizeUiTheme({ presetId: 'does-not-exist', zones: {} } as never);
    expect(empty.presetId).toBe('obsidian');
    expect(empty.zones.bg).toBe(DEFAULT_UI_THEME_ZONES.bg);
  });

  it('presets stay complete, unique and deliberately small', () => {
    const ids = UI_THEME_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    // 预设刻意精简：默认暗色 + 浅色 + 一个高对比暗色；加新预设前先想清楚是否真需要
    expect(ids).toEqual(['obsidian', 'daylight', 'graphite']);
    for (const preset of UI_THEME_PRESETS) {
      for (const zone of Object.keys(DEFAULT_UI_THEME_ZONES)) {
        expect(preset.zones[zone as keyof typeof DEFAULT_UI_THEME_ZONES]).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    expect(getUiThemePreset('obsidian')).toBeTruthy();
  });
});

describe('deriveScale', () => {
  it('pins the base color at step 500 and reproduces the reference scale for the default accent', () => {
    const scale = deriveScale('#6366f1', 'indigo');
    expect(scale[5]).toBe('#6366f1');
    const ref = ['#eef2ff', '#e0e7ff', '#c7d2fe', '#a5b4fc', '#818cf8', '#6366f1', '#4f46e5', '#4338ca', '#3730a3', '#312e81', '#1e1b4b'];
    for (let i = 0; i < ref.length; i += 1) {
      expect(channelDiff(scale[i], ref[i])).toBeLessThanOrEqual(3);
    }
  });

  it('keeps 500 exactly on an arbitrary user pick and stays monotonic in lightness', () => {
    const scale = deriveScale('#e67e80', 'red');
    expect(scale[5]).toBe('#e67e80');
    const ls = scale.map((hex) => hexToL(hex));
    for (let i = 1; i < ls.length; i += 1) {
      expect(ls[i]).toBeLessThanOrEqual(ls[i - 1] + 1e-6);
    }
  });

  it('浅色方案整条曲线反向：文字档变深、底色档变浅（500 档仍钉在基准色）', () => {
    const light = deriveScale('#4f46e5', 'indigo', 'light');
    expect(light[5]).toBe('#4f46e5');
    // text-indigo-200/300（浅色下是正文级文字）必须比 500 深
    expect(hexToL(light[3])).toBeLessThan(hexToL(light[5]));
    expect(hexToL(light[2])).toBeLessThan(hexToL(light[3]));
    // bg-indigo-900/950（暗色下的深彩底）在浅色下变成浅彩底
    expect(hexToL(light[9])).toBeGreaterThan(hexToL(light[5]));
    expect(hexToL(light[10])).toBeGreaterThan(hexToL(light[9]));
    // 暗色方案保持原方向（亮档在上）
    const dark = deriveScale('#6366f1', 'indigo', 'dark');
    expect(hexToL(dark[3])).toBeGreaterThan(hexToL(dark[5]));
  });

  it('produces a grey ramp for a neutral base (chroma collapses to 0)', () => {
    const scale = deriveScale('#808080', 'amber');
    for (const hex of scale) {
      expect(channelDiff(hex, '#808080') <= 128).toBe(true);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      expect(Math.abs(r - g)).toBeLessThanOrEqual(2);
      expect(Math.abs(g - b)).toBeLessThanOrEqual(2);
    }
  });
});

function hexToL(hex: string): number {
  // 粗略明度：直接用 sRGB 加权，够判单调性。
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

describe('deriveNeutralRamp', () => {
  it('keeps the three anchors and fills the rest between them', () => {
    const input = { ...DEFAULT_UI_THEME_ZONES, bg: '#101010', card: '#303030', textHeading: '#f0f0f0' };
    const out = deriveNeutralRamp(input);
    expect(out.bg).toBe('#101010');
    expect(out.card).toBe('#303030');
    expect(out.textHeading).toBe('#f0f0f0');
    for (const zone of UI_THEME_NEUTRAL_ZONES) {
      expect(out[zone.id]).toMatch(/^#[0-9a-f]{6}$/);
    }
    // 表面在背景与卡片之间
    expect(hexToL(out.surface)).toBeGreaterThan(hexToL('#101010'));
    expect(hexToL(out.surface)).toBeLessThan(hexToL('#303030'));
    // 次要文字在卡片与标题之间
    expect(hexToL(out.textSecondary)).toBeGreaterThan(hexToL('#303030'));
    expect(hexToL(out.textSecondary)).toBeLessThan(hexToL('#f0f0f0'));
  });
});

describe('resolveThemeVars', () => {
  it('default theme writes exactly the Tailwind default values (no visual drift)', () => {
    const vars = resolveThemeVars(DEFAULT_UI_THEME_SETTINGS);
    expect(vars['--color-zinc-950']).toBe('#09090b');
    expect(vars['--color-zinc-900']).toBe('#18181b');
    expect(vars['--color-zinc-800']).toBe('#27272a');
    expect(vars['--color-zinc-100']).toBe('#f4f4f5');
    expect(vars['--color-indigo-500']).toBe('#6366f1');
    expect(vars['--color-red-500']).toBe('#ef4444');
    expect(vars['--color-amber-500']).toBe('#f59e0b');
    expect(vars['--color-emerald-500']).toBe('#10b981');
    expect(vars['--color-sky-500']).toBe('#0ea5e9');
  });

  it('浅色主题的语义文字档落在深色端（白底可读，这是晨雾丑过的根因）', () => {
    const daylight = resolveThemeVars({ presetId: 'daylight', zones: getUiThemePreset('daylight')!.zones });
    const l = (hex: string) => hexToL(hex);
    expect(l(daylight['--color-indigo-300'])).toBeLessThan(l(daylight['--color-indigo-500']));
    expect(l(daylight['--color-red-400'])).toBeLessThan(l(daylight['--color-red-500']));
    expect(l(daylight['--color-amber-300'])).toBeLessThan(l(daylight['--color-amber-500']));
    expect(l(daylight['--color-emerald-950'])).toBeGreaterThan(l(daylight['--color-emerald-500']));
  });

  it('covers every neutral slot and the full 11-step ramp for each semantic palette', () => {
    const vars = resolveThemeVars(DEFAULT_UI_THEME_SETTINGS);
    for (const zone of UI_THEME_NEUTRAL_ZONES) {
      expect(vars[zone.cssVar!]).toMatch(/^#[0-9a-f]{6}$/);
    }
    for (const zone of UI_THEME_SEMANTIC_ZONES) {
      for (const step of [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]) {
        expect(vars[`--color-${zone.palette}-${step}`]).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });
});

describe('terminal colors belong to the theme', () => {
  const luminance = (hex: string) => hexToL(hex);

  it('每个预设自带终端配色，且明暗与界面一致（浅色界面不配深色终端）', () => {
    for (const preset of UI_THEME_PRESETS) {
      const termLight = luminance(preset.terminal.background) > 128;
      expect(termLight).toBe(preset.scheme === 'light');
      expect(preset.terminal.foreground).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('曜石的终端配色就是原默认终端色（默认主题与未启用主题逐像素一致）', () => {
    expect(getUiThemePreset('obsidian')!.terminal.background).toBe('#18181b');
  });

  it('deriveTerminalColors：背景/前景/语义色来自界面分区，明暗跟随主背景', () => {
    const light = getUiThemePreset('daylight')!.zones;
    const t = deriveTerminalColors(light);
    expect(t.background).toBe(light.surface);
    expect(t.foreground).toBe(light.textBody);
    expect(t.red).toBe(light.danger);
    // 浅底上 bright 比普通色更深而不是更亮
    expect(luminance(t.brightRed)).toBeLessThan(luminance(t.red));

    const dark = getUiThemePreset('obsidian')!.zones;
    const d = deriveTerminalColors(dark);
    expect(d.background).toBe(dark.surface);
    expect(luminance(d.brightGreen)).toBeGreaterThan(luminance(d.green));
  });
});

describe('scheme resolution', () => {
  it('follows the preset scheme', () => {
    expect(resolveUiThemeScheme({ presetId: 'obsidian', zones: DEFAULT_UI_THEME_ZONES })).toBe('dark');
    expect(resolveUiThemeScheme({ presetId: 'daylight', zones: getUiThemePreset('daylight')!.zones })).toBe('light');
  });

  it('infers light from a bright background for custom themes', () => {
    expect(inferScheme({ ...DEFAULT_UI_THEME_ZONES, bg: '#f5f5f5' })).toBe('light');
    expect(inferScheme({ ...DEFAULT_UI_THEME_ZONES, bg: '#101014' })).toBe('dark');
    expect(resolveUiThemeScheme({ presetId: CUSTOM_PRESET_ID, zones: { ...DEFAULT_UI_THEME_ZONES, bg: '#f5f5f5' } })).toBe('light');
  });
});

describe('applyUiTheme', () => {
  it('writes palette variables, color-scheme and data-marcel-theme onto <html>', () => {
    applyUiTheme({ presetId: 'daylight', zones: { ...getUiThemePreset('daylight')!.zones } });
    expect(document.documentElement.style.getPropertyValue('--color-zinc-950')).toBe(getUiThemePreset('daylight')!.zones.bg);
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(document.documentElement.dataset.marcelTheme).toBe('light');

    applyUiTheme(DEFAULT_UI_THEME_SETTINGS);
    expect(document.documentElement.style.getPropertyValue('--color-zinc-950')).toBe('#09090b');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(document.documentElement.dataset.marcelTheme).toBe('dark');
  });

  it('caches the applied theme for the early-startup path', () => {
    applyUiTheme({ presetId: 'daylight', zones: { ...getUiThemePreset('daylight')!.zones } });
    expect(localStorage.getItem('marcel.uiTheme.cache')).toBeTruthy();
  });

  it('animate=true 挂过渡类、停稳后摘除、连发续期；animate=false 立即摘', async () => {
    vi.useFakeTimers();
    try {
      const hasClass = () => document.documentElement.classList.contains('marcel-theme-transition');
      applyUiTheme(DEFAULT_UI_THEME_SETTINGS, true);
      expect(hasClass()).toBe(true);

      // 停稳前连发（预览拖动）续期
      await vi.advanceTimersByTimeAsync(400);
      applyUiTheme(DEFAULT_UI_THEME_SETTINGS, true);
      await vi.advanceTimersByTimeAsync(400);
      expect(hasClass()).toBe(true);

      await vi.advanceTimersByTimeAsync(300);
      expect(hasClass()).toBe(false);

      applyUiTheme(DEFAULT_UI_THEME_SETTINGS, false);
      expect(hasClass()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
