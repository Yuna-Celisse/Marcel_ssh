// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SkillChips from './SkillChips';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const skills = [
  { id: 'c1', skillId: 'a', name: '排错', content: '先看日志' },
  { id: 'c2', skillId: 'b', name: '部署', content: '先备份' },
];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('SkillChips', () => {
  it('shows every skill as a tag instead of expanding its instructions', () => {
    act(() => root.render(<SkillChips skills={skills} />));
    expect(host.querySelectorAll('[data-skill-chip]')).toHaveLength(2);
    expect(host.textContent).toContain('排错');
    expect(host.textContent).toContain('部署');
    expect(host.textContent).not.toContain('先看日志');
  });

  it('removes only the clicked tag', () => {
    const onRemove = vi.fn();
    act(() => root.render(<SkillChips skills={skills} onRemove={onRemove} />));
    const button = host.querySelector<HTMLButtonElement>('[aria-label="移除 Skill 部署"]')!;
    act(() => button.click());
    expect(onRemove).toHaveBeenCalledWith('c2');
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('is read-only without onRemove (sent messages)', () => {
    act(() => root.render(<SkillChips skills={skills} />));
    expect(host.querySelector('[aria-label^="移除 Skill"]')).toBeNull();
  });
});
