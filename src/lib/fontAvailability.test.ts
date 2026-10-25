import { describe, expect, it } from 'vitest';
import {
  detectInstalledMonoFonts,
  isFontInstalled,
  primaryFontFamily,
  resolveEffectiveFont,
  stackForPickedFont,
  type MeasureText,
} from './fontAvailability';

/** 模拟一台只装了 Fira Code 的机器：声明里带它就比基准宽 3px，其余字体回退成基准宽度。 */
const onlyFira: MeasureText = (decl) => {
  const base = decl.includes('serif') && !decl.includes('sans') ? 100 : decl.includes('sans-serif') ? 110 : 120;
  return decl.includes('"Fira Code"') ? base + 3 : base;
};

describe('isFontInstalled', () => {
  it('候选字体宽度与纯基准不同 → 已安装', () => {
    expect(isFontInstalled('Fira Code', onlyFira)).toBe(true);
  });

  it('宽度全部相同（回退）→ 未安装', () => {
    expect(isFontInstalled('JetBrains Mono', onlyFira)).toBe(false);
  });

  it('通用族与内置字体恒为可用', () => {
    expect(isFontInstalled('monospace', onlyFira)).toBe(true);
    expect(isFontInstalled('Marcel Nerd Font Mono', onlyFira)).toBe(true);
  });

  it('环境无法量宽时按可用处理，不误报没找到', () => {
    expect(isFontInstalled('Whatever', () => null)).toBe(true);
  });
});

describe('detectInstalledMonoFonts', () => {
  it('只留下本机存在的候选', () => {
    expect(detectInstalledMonoFonts(onlyFira)).toEqual(['Fira Code']);
  });
});

describe('字体栈辅助', () => {
  it('primaryFontFamily 去引号取首个', () => {
    expect(primaryFontFamily('"Fira Code", monospace')).toBe('Fira Code');
    expect(primaryFontFamily('')).toBe('');
  });

  it('stackForPickedFont 加引号并以 monospace 保底，通用族原样', () => {
    expect(stackForPickedFont('Fira Code')).toBe('"Fira Code", monospace');
    expect(stackForPickedFont('monospace')).toBe('monospace');
  });
});

describe('resolveEffectiveFont', () => {
  it('跳过没装的字体并记下，落到第一个存在的', () => {
    expect(
      resolveEffectiveFont('JetBrains Mono, Fira Code, monospace', onlyFira),
    ).toEqual({ name: 'Fira Code', missing: ['JetBrains Mono'] });
  });

  it('全没装则落到通用族', () => {
    expect(resolveEffectiveFont('JetBrains Mono, monospace', onlyFira)).toEqual({
      name: 'monospace',
      missing: ['JetBrains Mono'],
    });
  });
});
