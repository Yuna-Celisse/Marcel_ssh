import type { SkillResource } from '@/lib/types';

/** 与后端 `skills::parser` 的 MAX_* 保持一致；后端仍会再校验一次。 */
export const MAX_RESOURCE_BYTES = 1024 * 1024;
export const MAX_TOTAL_RESOURCE_BYTES = 4 * 1024 * 1024;
export const MAX_RESOURCE_COUNT = 100;

const encoder = new TextEncoder();
export const byteLength = (s: string) => encoder.encode(s).length;

/** 路径规整：反斜杠转 `/`，去掉首尾空白与开头的 `./`。 */
export function normalizeResourcePath(raw: string): string {
  return raw.trim().replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

/**
 * 校验一个资源路径（规则同后端 `validate_resources`）。
 * `selfIndex` = 正在改名的那一项下标（不与自己比重复）。返回错误文案，合法则 null。
 */
export function validateResourcePath(
  path: string,
  resources: SkillResource[],
  selfIndex = -1,
): string | null {
  if (!path) return '请填写资源路径';
  if (path.startsWith('/')) return '资源路径必须是相对路径';
  if (path.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) {
    return '资源路径含非法片段（空段 / . / ..）';
  }
  if (!path.toLowerCase().endsWith('.md')) return '只支持 .md 资源文件';
  if (resources.some((r, i) => i !== selfIndex && r.path === path)) return '已有同名资源';
  return null;
}

/** 整组资源的体积 / 数量检查，返回错误文案或 null。 */
export function validateResourceBudget(resources: SkillResource[]): string | null {
  if (resources.length > MAX_RESOURCE_COUNT) return `资源数量超过上限（${MAX_RESOURCE_COUNT} 个）`;
  let total = 0;
  for (const r of resources) {
    const n = byteLength(r.content);
    if (n > MAX_RESOURCE_BYTES) return `${r.path} 超过单文件上限（${MAX_RESOURCE_BYTES / 1024} KB）`;
    total += n;
  }
  if (total > MAX_TOTAL_RESOURCE_BYTES) {
    return `资源合计超过上限（${MAX_TOTAL_RESOURCE_BYTES / 1024} KB）`;
  }
  return null;
}
