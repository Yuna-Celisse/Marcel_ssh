import { describe, expect, it } from 'vitest';
import type { Skill } from '@/lib/types';
import { buildAgentCommandEntries } from './agentCommandEntries';

const mk = (id: string, name: string): Skill => ({
  id, name, description: '', prompt: name, enabled: true, position: 0, createdAt: '', updatedAt: '',
});

describe('buildAgentCommandEntries', () => {
  const skills = [mk('a', '排错'), mk('b', '部署')];
  const names = (exclude?: string[]) => buildAgentCommandEntries({
    modeSubmenu: false, query: '', skills, currentModeLabel: '', excludeSkillIds: exclude,
  }).flatMap((e) => (e.kind === 'skill' ? [e.skill.name] : []));

  it('lists every user skill by default', () => {
    expect(names()).toEqual(['排错', '部署']);
  });

  it('hides skills that are already tagged so another one can be picked', () => {
    expect(names(['a'])).toEqual(['部署']);
    expect(names(['a', 'b'])).toEqual([]);
  });
});
