// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForkOriginBar } from './ForkOriginBar';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('分叉来路提示条', () => {
  it('写明来源标题，并告诉用户这里的改动不影响原会话', async () => {
    await act(async () => root.render(<ForkOriginBar originTitle="迁移 nginx" onBack={() => {}} />));
    expect(host.textContent).toContain('分叉自');
    expect(host.textContent).toContain('迁移 nginx');
    expect(host.textContent).toContain('不会影响原会话');
  });

  it('点「返回原会话」触发回调', async () => {
    const onBack = vi.fn();
    await act(async () => root.render(<ForkOriginBar originTitle="x" onBack={onBack} />));
    const button = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('返回原会话'))!;
    await act(async () => button.click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('手机端命中区加高到 44px', async () => {
    await act(async () => root.render(<ForkOriginBar mobile originTitle="x" onBack={() => {}} />));
    expect(host.querySelector('button')!.className).toContain('min-h-11');
  });
});
