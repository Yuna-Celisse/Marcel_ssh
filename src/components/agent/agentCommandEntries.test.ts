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

  describe('分叉会话命令', () => {
    const commandIds = (query: string) =>
      buildAgentCommandEntries({ modeSubmenu: false, query, skills, currentModeLabel: '' }).flatMap((e) =>
        e.kind === 'command' ? [e.id] : [],
      );

    it('命令列表里有，并且中英文关键字都能搜到', () => {
      expect(commandIds('')).toContain('fork');
      expect(commandIds('fork')).toEqual(['fork']);
      expect(commandIds('分叉')).toEqual(['fork']);
      expect(commandIds('分支')).toEqual(['fork']);
    });

    it('不会被别的命令的关键字误匹配', () => {
      expect(commandIds('压缩')).toEqual(['compact']);
      expect(commandIds('mode')).toEqual(['toggle-mode']);
    });
  });
});
