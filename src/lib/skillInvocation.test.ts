import { describe, expect, it } from 'vitest';
import type { Skill } from './types';
import { expandSkillForInput } from './skillInvocation';

function skill(patch: Partial<Skill>): Skill {
  return {
    id: 'id1', name: '排错', description: '', prompt: '先看日志', enabled: true,
    position: 0, createdAt: '', updatedAt: '', ...patch,
  };
}

describe('expandSkillForInput', () => {
  it('returns the plain prompt when there are no resources', () => {
    expect(expandSkillForInput(skill({}))).toBe('先看日志');
  });

  it('lists resources for an enabled skill so the model knows it can read them', () => {
    const text = expandSkillForInput(skill({
      resources: [{ path: 'references/a.md', content: 'A' }, { path: 'b.md', content: 'B' }],
    }));
    expect(text.startsWith('先看日志')).toBe(true);
    expect(text).toContain('2 个资源文件');
    expect(text).toContain('「排错:」');
    expect(text).toContain('- references/a.md\n- b.md');
    expect(text).not.toContain('A');
  });

  it('does not advertise resources of a disabled skill (no tool is registered for it)', () => {
    expect(expandSkillForInput(skill({
      enabled: false, resources: [{ path: 'a.md', content: 'A' }],
    }))).toBe('先看日志');
  });
});
