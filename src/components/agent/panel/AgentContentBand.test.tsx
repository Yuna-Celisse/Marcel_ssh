// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentContentBand } from './AgentContentBand';
import { ForkOriginBar } from './ForkOriginBar';
import { RollbackNoticeBar } from './RollbackNoticeBar';
import { SubconversationBar } from './SubconversationBar';

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

/** 条幅里所有按钮都必须落在内容列里，不能留在铺满面板的外层（那里会被宽度把手盖住）。 */
function expectButtonsInsideColumn() {
  const buttons = Array.from(host.querySelectorAll('button'));
  expect(buttons.length).toBeGreaterThan(0);
  for (const button of buttons) {
    expect(button.closest('.agent-content-column')).not.toBeNull();
  }
}

describe('对话级条幅跟随内容列', () => {
  it('外壳全宽、内容收进内容列，属性透传到外壳', async () => {
    await act(async () => root.render(
      <AgentContentBand className="border-t" data-testid="band"><span>内容</span></AgentContentBand>,
    ));
    const band = host.querySelector<HTMLElement>('[data-testid="band"]')!;
    expect(band.className).toContain('border-t');
    expect(band.className).toContain('px-3');
    expect(band.querySelector('.agent-content-column')!.textContent).toBe('内容');
  });

  it('分叉来路条', async () => {
    await act(async () => root.render(<ForkOriginBar originTitle="x" onBack={() => {}} />));
    expectButtonsInsideColumn();
  });

  it('撤回 / 失败提示条', async () => {
    await act(async () => root.render(<RollbackNoticeBar notice="已撤回" onDismiss={() => {}} />));
    expectButtonsInsideColumn();
  });

  it('子 agent 返回条', async () => {
    await act(async () => root.render(
      <SubconversationBar subAgentMode="plan" isLocal={false} title="t" onBack={() => {}} />,
    ));
    expectButtonsInsideColumn();
  });
});
