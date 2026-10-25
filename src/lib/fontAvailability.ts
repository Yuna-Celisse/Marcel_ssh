/**
 * 字体可用性探测与「字体选择器」的纯逻辑（桌面设置页、手机外观页共用）。
 *
 * 为什么不枚举系统字体：WebView 里没有无需授权的枚举接口（`queryLocalFonts` 会弹权限框，
 * 各平台 WebView 支持也不一致）。这里改用「常见等宽字体候选表 + 画布量宽探测」：
 * 同一串文字，用「候选字体, 基准字体」与「纯基准字体」各量一次，宽度不同就说明候选字体
 * 真的存在（回退时两次用的是同一个基准字体，宽度必然相等）。不弹权限、各平台一致。
 * 候选表之外的字体走选择器里的「自定义」输入，同样用这个探测给出「找到 / 没找到」。
 */
import {
  BUNDLED_NERD_FONT_FAMILY,
  isBundledNerdFontFamily,
  parseFontFamilies,
} from '@/lib/terminalFont';

/** 常见等宽 / 编程字体。顺序即下拉里的展示顺序（编程字体在前，系统自带字体在后）。 */
export const MONO_FONT_CANDIDATES: readonly string[] = [
  'JetBrains Mono',
  'JetBrainsMono Nerd Font',
  'JetBrainsMono NF',
  'Fira Code',
  'FiraCode Nerd Font',
  'Cascadia Code',
  'Cascadia Mono',
  'Maple Mono',
  'Maple Mono NF CN',
  'Sarasa Mono SC',
  'Sarasa Term SC',
  'LXGW WenKai Mono',
  'Iosevka',
  'Source Code Pro',
  'Hack',
  'Hack Nerd Font',
  'MesloLGS NF',
  'Meslo LG M',
  'Roboto Mono',
  'IBM Plex Mono',
  'Inconsolata',
  'Ubuntu Mono',
  'DejaVu Sans Mono',
  'Noto Sans Mono',
  'Noto Sans Mono CJK SC',
  'Liberation Mono',
  'SF Mono',
  'Menlo',
  'Monaco',
  'Consolas',
  'Lucida Console',
  'Courier New',
];

/** 量宽用的样本：混合窄字符、宽字符、符号与汉字，不同字体的宽度几乎不可能全部碰巧相同。 */
const PROBE_TEXT = 'mwi1lO0@#WMg~｜中文字体Ag';
const PROBE_SIZE = '72px';
const BASELINES = ['monospace', 'serif', 'sans-serif'] as const;

/** 返回「给定字体族声明下 PROBE_TEXT 的宽度」；环境没有画布时返回 null。 */
export type MeasureText = (fontFamily: string) => number | null;

let sharedContext: CanvasRenderingContext2D | null | undefined;

const canvasMeasure: MeasureText = (fontFamily) => {
  if (sharedContext === undefined) {
    try {
      sharedContext =
        typeof document === 'undefined'
          ? null
          : (document.createElement('canvas').getContext('2d') ?? null);
    } catch {
      sharedContext = null;
    }
  }
  if (!sharedContext) return null;
  sharedContext.font = `${PROBE_SIZE} ${fontFamily}`;
  return sharedContext.measureText(PROBE_TEXT).width;
};

const GENERIC_KEYWORDS = new Set([
  'monospace',
  'ui-monospace',
  'sans-serif',
  'serif',
  'system-ui',
  'cursive',
  'fantasy',
  'math',
  'emoji',
  'fangsong',
]);

function stripQuotes(token: string): string {
  return token.replace(/^["']|["']$/g, '').trim();
}

/** CSS 里引用一个字体名：统一加双引号（内部引号转义）。 */
export function quoteFontName(name: string): string {
  return `"${name.replace(/["\\]/g, '')}"`;
}

const installedCache = new Map<string, boolean>();

/**
 * 字体是否在本机可用。无法探测（无画布）时按「可用」处理——宁可不提示也不误报「没找到」。
 * 内置 Nerd Font 随包分发，恒为可用。
 */
export function isFontInstalled(
  name: string,
  measure: MeasureText = canvasMeasure,
): boolean {
  const clean = stripQuotes(name);
  if (!clean) return false;
  if (GENERIC_KEYWORDS.has(clean.toLowerCase())) return true;
  if (isBundledNerdFontFamily(clean)) return true;

  const useCache = measure === canvasMeasure;
  if (useCache) {
    const hit = installedCache.get(clean);
    if (hit !== undefined) return hit;
  }

  const quoted = quoteFontName(clean);
  let result = true;
  for (const base of BASELINES) {
    const withCandidate = measure(`${quoted}, ${base}`);
    const baseOnly = measure(base);
    if (withCandidate === null || baseOnly === null) {
      result = true;
      break;
    }
    result = false;
    if (Math.abs(withCandidate - baseOnly) > 0.01) {
      result = true;
      break;
    }
  }
  if (useCache) installedCache.set(clean, result);
  return result;
}

/** 候选表里本机真正装了的字体（保持候选表顺序）。 */
export function detectInstalledMonoFonts(
  measure: MeasureText = canvasMeasure,
): string[] {
  return MONO_FONT_CANDIDATES.filter((name) => isFontInstalled(name, measure));
}

/** 字体栈的首选字体（去引号）；空栈返回 ''。通用族（monospace…）也原样返回。 */
export function primaryFontFamily(stack: string): string {
  const first = parseFontFamilies(stack)[0];
  return first ? stripQuotes(first) : '';
}

/** 选择器选中某个字体后写进设置的字体栈：首选 + monospace 保底（缺字时仍是等宽）。 */
export function stackForPickedFont(name: string): string {
  if (GENERIC_KEYWORDS.has(name.toLowerCase())) return name.toLowerCase();
  return `${quoteFontName(name)}, monospace`;
}

/** 内置字体选项对应的栈。 */
export const BUNDLED_FONT_STACK = stackForPickedFont(BUNDLED_NERD_FONT_FAMILY);

/** 系统等宽选项对应的栈。 */
export const SYSTEM_MONO_FONT_STACK = 'monospace';

export interface EffectiveFont {
  /** 终端实际会用来画 ASCII 的字体名；落到通用族时是 'monospace'。 */
  name: string;
  /** 栈里排在它前面、但本机没找到的字体（用来提示「你写的 X 没找到」）。 */
  missing: string[];
}

/**
 * 解析字体栈「实际生效」的字体：从左到右第一个本机存在的字体。
 * 终端对栈的处理就是这个顺序，所以界面据此告诉用户「现在到底在用谁」。
 */
export function resolveEffectiveFont(
  stack: string,
  measure: MeasureText = canvasMeasure,
): EffectiveFont {
  const missing: string[] = [];
  for (const token of parseFontFamilies(stack)) {
    const name = stripQuotes(token);
    if (GENERIC_KEYWORDS.has(name.toLowerCase())) {
      return { name: name.toLowerCase(), missing };
    }
    if (isFontInstalled(name, measure)) return { name, missing };
    missing.push(name);
  }
  return { name: 'monospace', missing };
}
