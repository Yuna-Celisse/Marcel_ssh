import { scopeId, scopeOf, type Carried, type InjectedMemories, type MemoryItem, type ScopeRef } from '@/lib/memory';

/** 每组默认露出几条，其余折起来：几十条记忆不该把弹层撑成一面墙。 */
export const GROUP_PREVIEW = 6;

export interface InjectedGroup {
  ref: ScopeRef;
  items: { item: MemoryItem; carried: Carried }[];
}

/**
 * 按作用域分组；组内置顶在前、完整带入在前、只有标题的在后（和模型提示词里的优先级一致），
 * 同档保持后端给的顺序。
 */
export function groupInjected(data: InjectedMemories | null): InjectedGroup[] {
  const out: InjectedGroup[] = [];
  for (const m of data?.items ?? []) {
    const ref = scopeOf(m);
    const entry = { item: m, carried: data?.carried?.[m.id] ?? 'full' };
    const hit = out.find((g) => scopeId(g.ref) === scopeId(ref));
    if (hit) hit.items.push(entry);
    else out.push({ ref, items: [entry] });
  }
  const rank = (e: InjectedGroup['items'][number]) => (e.item.pinned ? 0 : 2) + (e.carried === 'full' ? 0 : 1);
  for (const g of out) {
    // 稳定排序：同档保持原顺序。
    g.items = g.items
      .map((e, i) => ({ e, i }))
      .sort((x, y) => rank(x.e) - rank(y.e) || x.i - y.i)
      .map((x) => x.e);
  }
  return out;
}
