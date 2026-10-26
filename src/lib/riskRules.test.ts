import { describe, expect, it } from 'vitest';
import type { CustomRiskRule, RiskRuleCatalog, RiskRuleInfo } from './types';
import {
  customRuleLabel,
  defaultCustomRiskRules,
  effectiveLevel,
  effectiveList,
  effectiveListByKey,
  emptyCustomRule,
  isLoosened,
  groupOutcomes,
  isRuleModified,
  modifiedRuleCount,
  outcomeOf,
  normalizeListItems,
  resetRule,
  ruleMatchesQuery,
  setExemptionOn,
  setRuleLevel,
  setRuleList,
  setRuleMessage,
  validateCustomRule,
} from './riskRules';

const kill: RiskRuleInfo = {
  id: 'name_based_kill',
  kind: 'rule',
  scope: 'posix',
  title: '按名字批量杀进程',
  description: 'pkill / killall 误伤面不可控',
  examples: ['pkill -f myapp'],
  defaultLevel: 'Deny',
  lists: [{ key: 'name_based_kill_commands', label: '命令名', hint: '', defaults: ['pkill', 'killall', 'zapall'] }],
};

const exempt: RiskRuleInfo = {
  id: 'read_only_exempt',
  kind: 'exemption',
  scope: 'posix',
  title: '只读命令读受保护路径',
  description: 'cat /etc/hosts 不算写',
  examples: ['cat /etc/hosts'],
  defaultLevel: 'Allow',
  lists: [],
};

const catalog: RiskRuleCatalog = {
  rules: [kill, exempt],
};

describe('effectiveLevel', () => {
  it('uses the default when nothing is overridden', () => {
    expect(effectiveLevel(kill, undefined)).toBe('Deny');
  });
  it('prefers the override, and treats a disabled rule as Allow', () => {
    expect(effectiveLevel(kill, { level: 'ForceApproval' })).toBe('ForceApproval');
    expect(effectiveLevel(kill, { enabled: false })).toBe('Allow');
  });
});

describe('setRuleLevel', () => {
  it('stores only differences: going back to the default removes the entry', () => {
    const changed = setRuleLevel({}, kill, 'ForceApproval');
    expect(changed).toEqual({ name_based_kill: { level: 'ForceApproval' } });
    expect(setRuleLevel(changed, kill, 'Deny')).toEqual({});
  });

  it('choosing a level re-enables a rule that was switched off', () => {
    const next = setRuleLevel({ name_based_kill: { enabled: false } }, kill, 'Approval');
    expect(next.name_based_kill).toEqual({ level: 'Approval' });
  });

  it('does not mutate its input', () => {
    const input = { name_based_kill: { level: 'Approval' as const } };
    setRuleLevel(input, kill, 'Allow');
    expect(input).toEqual({ name_based_kill: { level: 'Approval' } });
  });
});

describe('exemptions', () => {
  it('only the off state is stored', () => {
    const off = setExemptionOn({}, exempt, false);
    expect(off).toEqual({ read_only_exempt: { enabled: false } });
    expect(setExemptionOn(off, exempt, true)).toEqual({});
  });
});

describe('lists', () => {
  it('replaces the whole list and drops the override when it equals the default', () => {
    const edited = setRuleList({}, kill, 'name_based_kill_commands', ['pkill']);
    expect(effectiveList(kill, 'name_based_kill_commands', edited.name_based_kill)).toEqual(['pkill']);
    const back = setRuleList(edited, kill, 'name_based_kill_commands', ['pkill', 'killall', 'zapall']);
    expect(back).toEqual({});
  });

  it('null restores the default', () => {
    const edited = setRuleList({}, kill, 'name_based_kill_commands', ['pkill']);
    expect(setRuleList(edited, kill, 'name_based_kill_commands', null)).toEqual({});
  });

  it('an emptied list is a real override (the rule then matches nothing)', () => {
    const edited = setRuleList({}, kill, 'name_based_kill_commands', []);
    expect(edited.name_based_kill.lists).toEqual({ name_based_kill_commands: [] });
  });

  it('normalizes entries: trims, drops blanks and duplicates, keeps order', () => {
    expect(normalizeListItems([' a ', '', 'b', 'a', '  '])).toEqual(['a', 'b']);
  });

  it('finds an effective list by its global key', () => {
    const overrides = setRuleList({}, kill, 'name_based_kill_commands', ['pkill']);
    expect(effectiveListByKey(catalog, overrides, 'name_based_kill_commands')).toEqual(['pkill']);
    expect(effectiveListByKey(catalog, {}, 'name_based_kill_commands')).toEqual(['pkill', 'killall', 'zapall']);
    expect(effectiveListByKey(catalog, {}, 'nope')).toBeNull();
    expect(effectiveListByKey(null, {}, 'name_based_kill_commands')).toBeNull();
  });
});

describe('modification bookkeeping', () => {
  it('counts and resets', () => {
    const o = setRuleLevel(setExemptionOn({}, exempt, false), kill, 'Approval');
    expect(modifiedRuleCount(o)).toBe(2);
    expect(isRuleModified(o.name_based_kill)).toBe(true);
    expect(isRuleModified(undefined)).toBe(false);
    expect(Object.keys(resetRule(o, 'name_based_kill'))).toEqual(['read_only_exempt']);
  });

  it('only a looser level than the default counts as loosened', () => {
    expect(isLoosened('Deny', 'ForceApproval')).toBe(true);
    expect(isLoosened('Deny', 'Allow')).toBe(true);
    expect(isLoosened('ForceApproval', 'Deny')).toBe(false);
    expect(isLoosened('Approval', 'Approval')).toBe(false);
  });
});

describe('search', () => {
  it('matches title, description, examples, list items and the level name', () => {
    expect(ruleMatchesQuery(kill, undefined, 'pkill')).toBe(true);
    expect(ruleMatchesQuery(kill, undefined, 'killall')).toBe(true);
    expect(ruleMatchesQuery(kill, undefined, '直接拒绝')).toBe(true);
    expect(ruleMatchesQuery(kill, undefined, '误伤')).toBe(true);
    expect(ruleMatchesQuery(kill, undefined, 'systemctl')).toBe(false);
    expect(ruleMatchesQuery(kill, undefined, '   ')).toBe(true);
  });

  it('searches the effective list, not the defaults', () => {
    const o = setRuleList({}, kill, 'name_based_kill_commands', ['mykiller']);
    expect(ruleMatchesQuery(kill, o.name_based_kill, 'mykiller')).toBe(true);
    expect(ruleMatchesQuery(kill, o.name_based_kill, 'zapall')).toBe(false);
  });
});

describe('custom rules', () => {
  it('a new rule is conservative by default and has a unique id', () => {
    const a = emptyCustomRule();
    const b = emptyCustomRule();
    expect(a.level).toBe('ForceApproval');
    expect(a.enabled).toBe(true);
    expect(a.id).not.toBe(b.id);
  });

  it('validates the command name', () => {
    const base = emptyCustomRule();
    expect(validateCustomRule(base)).toMatch(/命令名/);
    expect(validateCustomRule({ ...base, command: 'docker prune' })).toMatch(/基础命令/);
    expect(validateCustomRule({ ...base, command: 'docker' })).toBeNull();
  });
});

describe('命令测试的结论', () => {
  const r = (allowed: boolean, requiresConfirmation: boolean) =>
    ({ allowed, requiresConfirmation }) as never;

  it('被拒绝 > 要人确认 > 直接执行', () => {
    expect(outcomeOf(r(false, false))).toBe('deny');
    expect(outcomeOf(r(false, true))).toBe('deny');
    expect(outcomeOf(r(true, true))).toBe('ask');
    expect(outcomeOf(r(true, false))).toBe('run');
  });

  it('按结论合并三种模式；三种一样就标「所有模式」', () => {
    const mixed = groupOutcomes([
      { mode: 'agent', result: r(true, true) },
      { mode: 'plan', result: r(true, false) },
      { mode: 'auto', result: r(true, false) },
    ]);
    expect(mixed).toEqual([
      { outcome: 'ask', modes: ['Agent'], all: false },
      { outcome: 'run', modes: ['Plan', 'Auto'], all: false },
    ]);
    const same = groupOutcomes([
      { mode: 'agent', result: r(false, false) },
      { mode: 'plan', result: r(false, false) },
      { mode: 'auto', result: r(false, false) },
    ]);
    expect(same).toEqual([{ outcome: 'deny', modes: ['Agent', 'Plan', 'Auto'], all: true }]);
  });
});

describe('custom rule naming and defaults', () => {
  it('shows the command plus argument when no name is set (matches the backend)', () => {
    const rule = { ...emptyCustomRule(), command: 'docker' };
    expect(customRuleLabel(rule)).toBe('docker');
    expect(customRuleLabel({ ...rule, argContains: 'prune' })).toBe(
      'docker prune',
    );
    expect(customRuleLabel({ ...rule, name: '清理镜像' })).toBe('清理镜像');
  });

  it('ships the five old denylist commands as ordinary rules at 请求审批', () => {
    const rules = defaultCustomRiskRules();
    expect(rules.map((r) => r.command)).toEqual([
      'rm',
      'mkfs',
      'dd',
      'shutdown',
      'reboot',
    ]);
    expect(rules.every((r) => r.level === 'Approval' && r.enabled)).toBe(true);
    expect(rules.map((r) => r.id)).toEqual([
      'default-rm',
      'default-mkfs',
      'default-dd',
      'default-shutdown',
      'default-reboot',
    ]);
  });
});

describe('setRuleMessage', () => {
  it('stores the text as a difference, and a blank text removes it again', () => {
    const written = setRuleMessage({}, kill, '改用 systemctl 重启指定服务');
    expect(written).toEqual({
      name_based_kill: { message: '改用 systemctl 重启指定服务' },
    });
    expect(setRuleMessage(written, kill, '   ')).toEqual({});
  });

  it('keeps what is typed as typed (no trimming while the user is still typing)', () => {
    expect(setRuleMessage({}, kill, 'a ').name_based_kill?.message).toBe('a ');
  });

  it('counts as a modification, so the row shows 已改 and 恢复默认', () => {
    expect(isRuleModified({ message: '别用' })).toBe(true);
    expect(isRuleModified({ message: '  ' })).toBe(false);
  });
});
