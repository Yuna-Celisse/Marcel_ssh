import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { InjectedMemories as Injected, MemoryItem } from '@/lib/memory';

vi.mock('@/stores/connectionStore', () => {
  const state = { connections: [] };
  const useConnectionStore = (sel: (s: typeof state) => unknown) => sel(state);
  return { useConnectionStore };
});

import { GROUP_PREVIEW, groupInjected, InjectedMemoryList } from './InjectedMemories';

function mem(id: string, over: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id,
    scope: 'host',
    scopeKey: 'c1',
    kind: 'fact',
    title: `标题${id}`,
    content: `正文${id}`,
    pinned: false,
    source: 'user',
    sourceConversationId: null,
    sourceMessageId: null,
    createdAt: '2026-10-19T00:00:00Z',
    updatedAt: '2026-10-19T00:00:00Z',
    version: 1,
    isNew: false,
    ...over,
  } as MemoryItem;
}

function data(items: MemoryItem[], over: Partial<Injected> = {}): Injected {
  return {
    items,
    frozen: false,
    removedSince: 0,
    pending: 0,
    elsewhere: 0,
    carried: {},
    leftOut: 0,
    enabled: true,
    ...over,
  };
}

describe('groupInjected', () => {
  it('组内置顶在前、完整带入在前、只有标题的在后，同档保持原顺序', () => {
    const d = data([mem('a'), mem('b'), mem('c', { pinned: true }), mem('d')], {
      carried: { a: 'title', b: 'full', c: 'title', d: 'full' },
    });
    const [g] = groupInjected(d);
    expect(g.items.map((e) => e.item.id)).toEqual(['c', 'b', 'd', 'a']);
  });

  it('表里没有的条目按完整带入处理（旧数据、没有 carried 字段也能用）', () => {
    const [g] = groupInjected(data([mem('a')]));
    expect(g.items[0].carried).toBe('full');
  });
});

describe('InjectedMemoryList', () => {
  const many = Array.from({ length: GROUP_PREVIEW + 4 }, (_, i) => mem(`m${i}`));

  it('每组默认只露出前几条，其余折成「还有 N 条」', () => {
    const html = renderToStaticMarkup(<InjectedMemoryList data={data(many)} error={null} />);
    expect(html).toContain('标题m0');
    expect(html).not.toContain(`标题m${GROUP_PREVIEW}`);
    expect(html).toContain('还有 4 条');
  });

  it('只有标题的条目打「仅标题」，并说明含义；放不下的另起一行说清', () => {
    const items = [mem('a'), mem('b')];
    const html = renderToStaticMarkup(
      <InjectedMemoryList data={data(items, { carried: { a: 'full', b: 'title' }, leftOut: 3 })} error={null} />,
    );
    expect(html).toContain('仅标题');
    expect(html).toContain('要细节得自己去查');
    expect(html).toContain('另有 3 条太多放不进提示词');
  });

  it('全是完整带入时不出现「仅标题」的说明', () => {
    const html = renderToStaticMarkup(<InjectedMemoryList data={data([mem('a')], { carried: { a: 'full' } })} error={null} />);
    expect(html).not.toContain('仅标题');
  });

  it('「管理记忆」在滚动区外面：列表再长它也在', () => {
    const html = renderToStaticMarkup(<InjectedMemoryList data={data(many)} error={null} />);
    const scrollEnd = html.indexOf('管理记忆');
    expect(scrollEnd).toBeGreaterThan(html.lastIndexOf('overflow-y-auto'));
  });
});
