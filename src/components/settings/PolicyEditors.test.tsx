// @vitest-environment jsdom
// 命令执行策略主页面的三个编辑器：受保护路径（内置 + 自己加的一份名单）、需要审批的工具、自定义规则。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { CustomRiskRule, RiskRuleInfo } from '@/lib/types';
import type { RiskRuleOverrides } from '@/lib/riskRules';
import type { ToolApprovalLevels } from '@/lib/toolApproval';
import { flashCustomRule } from '@/lib/riskRuleNav';
import { CustomRiskRulesEditor } from './CustomRiskRulesEditor';
import {
  ProtectedPathsEditor,
  type ProtectedPathsPatch,
} from './ProtectedPathsEditor';
import { ToolApprovalEditor } from './ToolApprovalEditor';

const validate = vi.fn(
  async (_paths: string[]): Promise<string | null> => null,
);
vi.mock('@/lib/tauri', () => ({
  validateCustomProtectedPaths: (paths: string[]) => validate(paths),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function render(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(node);
  });
}

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  validate.mockClear();
});

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

function buttonByText(text: string): HTMLButtonElement {
  const el = Array.from(host!.querySelectorAll('button')).find((b) =>
    b.textContent?.includes(text),
  );
  if (!el) throw new Error(`找不到按钮：${text}`);
  return el as HTMLButtonElement;
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('ToolApprovalEditor', () => {
  function Harness({ initial }: { initial: ToolApprovalLevels }) {
    const [levels, setLevels] = useState(initial);
    return (
      <>
        <ToolApprovalEditor levels={levels} onChange={setLevels} />
        <output data-testid="levels">{JSON.stringify(levels)}</output>
      </>
    );
  }
  const read = () => JSON.parse(host!.querySelector('output')!.textContent!);

  it('always shows bash first as a read-only row pointing at the command rules', async () => {
    const open = vi.fn();
    await render(
      <ToolApprovalEditor
        levels={{ edit_file: 'Approval' }}
        onChange={() => {}}
        onOpenCommandRules={open}
      />,
    );
    const text = host!.textContent!;
    expect(text.indexOf('执行命令')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('执行命令')).toBeLessThan(text.indexOf('编辑文件'));
    // 只读：没有给 bash 的档位下拉，也没有移除按钮。
    expect(host!.querySelector('[aria-label^="执行命令：审批档位"]')).toBeNull();
    expect(host!.querySelector('[aria-label="执行命令不再审批"]')).toBeNull();
    await act(async () => {
      buttonByText('按命令规则').click();
    });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('shows the named tools with their level, and nothing else', async () => {
    await render(
      <Harness
        initial={{ edit_file: 'Approval', write_file: 'ForceApproval' }}
      />,
    );
    const text = host!.textContent!;
    expect(text).toContain('编辑文件');
    expect(text).toContain('写入文件');
    expect(text).not.toContain('读取文件');
  });

  it('removing a tool stops approving it; adding it back starts at 请求审批', async () => {
    await render(
      <Harness initial={{ edit_file: 'Deny', write_file: 'Approval' }} />,
    );
    await act(async () => {
      host!
        .querySelector<HTMLButtonElement>(
          'button[aria-label="编辑文件不再审批"]',
        )!
        .click();
    });
    expect(read()).toEqual({ write_file: 'Approval' });

    await act(async () => {
      buttonByText('添加工具').click();
    });
    await act(async () => {
      buttonByText('+ 编辑文件').click();
    });
    expect(read()).toEqual({ write_file: 'Approval', edit_file: 'Approval' });
  });

  it('the level dropdown has no 放行 option', async () => {
    await render(<Harness initial={{ edit_file: 'Approval' }} />);
    await act(async () => {
      host!
        .querySelector<HTMLButtonElement>(
          'button[aria-label^="编辑文件：审批档位"]',
        )!
        .click();
    });
    const options = Array.from(host!.querySelectorAll('[role="option"]')).map(
      (o) => o.textContent,
    );
    expect(options).toHaveLength(3);
    expect(options.join('')).not.toContain('放行');
  });
});

describe('ProtectedPathsEditor', () => {
  const rule: RiskRuleInfo = {
    id: 'protected_paths',
    kind: 'rule',
    scope: 'posix',
    title: '写入受保护路径',
    description: '',
    examples: [],
    defaultLevel: 'ForceApproval',
    lists: [
      {
        key: 'protected_paths',
        label: '目录',
        hint: '',
        defaults: ['/etc', '/boot', '/sys'],
      },
    ],
  };

  function Harness({ initial }: { initial?: RiskRuleOverrides }) {
    const [overrides, setOverrides] = useState<RiskRuleOverrides>(
      initial ?? {},
    );
    const [custom, setCustom] = useState<string[]>([]);
    return (
      <>
        <ProtectedPathsEditor
          rule={rule}
          overrides={overrides}
          customPaths={custom}
          onChange={(patch: ProtectedPathsPatch) => {
            if (patch.riskRuleOverrides) setOverrides(patch.riskRuleOverrides);
            if (patch.customProtectedPaths)
              setCustom(patch.customProtectedPaths);
          }}
        />
        <output>{JSON.stringify({ overrides, custom })}</output>
      </>
    );
  }
  const read = () => JSON.parse(host!.querySelector('output')!.textContent!);

  it('built-in directories are listed (tagged 内置) and can be removed and restored', async () => {
    await render(<Harness />);
    expect(host!.textContent).toContain('/etc');
    expect(host!.textContent).toContain('内置');

    await act(async () => {
      host!
        .querySelector<HTMLButtonElement>('button[aria-label="移除 /boot"]')!
        .click();
    });
    expect(read().overrides).toEqual({
      protected_paths: { lists: { protected_paths: ['/etc', '/sys'] } },
    });
    // 删掉的留一个划线占位，点 ↺ 找回，名单回到默认 → 覆盖项消失。
    await act(async () => {
      host!
        .querySelector<HTMLButtonElement>('button[aria-label="找回 /boot"]')!
        .click();
    });
    expect(read().overrides).toEqual({});
  });

  it("a new directory goes to the user's own list, after the backend validates it", async () => {
    await render(<Harness />);
    const input = host!.querySelector<HTMLInputElement>(
      'input[aria-label="添加受保护路径"]',
    )!;
    await typeInto(input, '/home/me/.ssh');
    await act(async () => {
      buttonByText('添加').click();
    });
    expect(validate).toHaveBeenCalledWith(['/home/me/.ssh']);
    expect(read().custom).toEqual(['/home/me/.ssh']);
  });

  it('a path the backend rejects is not added, and the reason is shown', async () => {
    validate.mockResolvedValueOnce('必须是绝对路径');
    await render(<Harness />);
    const input = host!.querySelector<HTMLInputElement>(
      'input[aria-label="添加受保护路径"]',
    )!;
    await typeInto(input, 'relative/dir');
    await act(async () => {
      buttonByText('添加').click();
    });
    expect(read().custom).toEqual([]);
    expect(host!.textContent).toContain('必须是绝对路径');
  });

  it('typing a removed built-in directory restores it instead of adding a duplicate', async () => {
    await render(
      <Harness
        initial={{
          protected_paths: { lists: { protected_paths: ['/etc', '/sys'] } },
        }}
      />,
    );
    const input = host!.querySelector<HTMLInputElement>(
      'input[aria-label="添加受保护路径"]',
    )!;
    await typeInto(input, '/boot');
    await act(async () => {
      buttonByText('添加').click();
    });
    expect(read().overrides).toEqual({});
    expect(read().custom).toEqual([]);
  });
});

describe('CustomRiskRulesEditor', () => {
  function Harness() {
    const [rules, setRules] = useState<CustomRiskRule[]>([]);
    return (
      <>
        <CustomRiskRulesEditor rules={rules} onChange={setRules} />
        <output>{JSON.stringify(rules)}</output>
      </>
    );
  }
  const read = () => JSON.parse(host!.querySelector('output')!.textContent!);

  it('adds a row (conservative default), edits it, and deletes it', async () => {
    await render(<Harness />);
    await act(async () => {
      buttonByText('添加规则').click();
    });
    expect(read()).toHaveLength(1);
    expect(read()[0]).toMatchObject({
      command: '',
      level: 'ForceApproval',
      enabled: true,
    });

    await typeInto(
      host!.querySelector<HTMLInputElement>(
        'input[aria-label="自定义规则：命令名"]',
      )!,
      'docker',
    );
    await typeInto(
      host!.querySelector<HTMLInputElement>(
        'input[aria-label="自定义规则：参数包含"]',
      )!,
      'prune',
    );
    expect(read()[0]).toMatchObject({
      command: 'docker',
      argContains: 'prune',
    });

    await act(async () => {
      host!
        .querySelector<HTMLButtonElement>('button[aria-label="删除这条规则"]')!
        .click();
    });
    expect(read()).toEqual([]);
  });

  it('shows an example when there are no rules yet', async () => {
    await render(<Harness />);
    expect(host!.textContent).toContain('还没有规则');
    expect(host!.textContent).toContain('docker');
  });

  describe('refusal message', () => {
    function WithRule({ level }: { level: CustomRiskRule['level'] }) {
      const [rules, setRules] = useState<CustomRiskRule[]>([
        {
          id: 'r1',
          name: '',
          command: 'docker',
          argContains: 'prune',
          level,
          enabled: true,
          message: '',
        },
      ]);
      return (
        <>
          <CustomRiskRulesEditor rules={rules} onChange={setRules} />
          <output>{JSON.stringify(rules)}</output>
        </>
      );
    }
    const openRule = async () =>
      act(async () => {
        host!.querySelector<HTMLButtonElement>('#risk-rule-r1')!.click();
      });
    const box = () =>
      host!.querySelector<HTMLTextAreaElement>('textarea[aria-label$="拒绝说明"]');

    it('has no message box at a level that asks instead of refusing', async () => {
      await render(<WithRule level="ForceApproval" />);
      await openRule();
      expect(box()).toBeNull();
    });

    it('shows the message box at 直接拒绝 and saves what is typed', async () => {
      await render(<WithRule level="Deny" />);
      await openRule();
      expect(box()).not.toBeNull();
      const area = box()!;
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value',
        )!.set!;
        setter.call(area, '生产库禁止清理');
        area.dispatchEvent(new Event('input', { bubbles: true }));
      });
      expect(read()[0].message).toBe('生产库禁止清理');
    });
  });

  it('warns that a command with spaces will not take effect', async () => {
    await render(<Harness />);
    await act(async () => {
      buttonByText('添加规则').click();
    });
    await typeInto(
      host!.querySelector<HTMLInputElement>(
        'input[aria-label="自定义规则：命令名"]',
      )!,
      'docker system',
    );
    expect(host!.textContent).toContain('这条规则不生效');
  });
});

describe('CustomRiskRulesEditor chips', () => {
  const rule = (id: string, command: string, extra: Partial<CustomRiskRule> = {}) =>
    ({
      id,
      name: '',
      command,
      argContains: '',
      level: 'Approval',
      enabled: true,
      ...extra,
    }) as CustomRiskRule;

  function Harness({ initial }: { initial: CustomRiskRule[] }) {
    const [rules, setRules] = useState(initial);
    return (
      <>
        <CustomRiskRulesEditor rules={rules} onChange={setRules} />
        <output>{JSON.stringify(rules)}</output>
      </>
    );
  }
  const five = ['rm', 'mkfs', 'dd', 'shutdown', 'reboot'].map((c) => rule(`d-${c}`, c));
  const chip = (id: string) =>
    host!.querySelector<HTMLButtonElement>(`#risk-rule-${id}`)!;
  const cmdInput = () =>
    host!.querySelector<HTMLInputElement>('input[aria-label="自定义规则：命令名"]');

  it('shows every rule as one chip and no inputs until one is opened', async () => {
    await render(<Harness initial={five} />);
    for (const c of ['rm', 'mkfs', 'dd', 'shutdown', 'reboot']) {
      expect(chip(`d-${c}`).textContent).toBe(c);
    }
    expect(host!.querySelector('input')).toBeNull();
  });

  it('opens one rule at a time and closes it when the same chip is clicked again', async () => {
    await render(<Harness initial={five} />);
    await act(async () => {
      chip('d-mkfs').click();
    });
    expect(cmdInput()!.value).toBe('mkfs');
    await act(async () => {
      chip('d-dd').click();
    });
    expect(host!.querySelectorAll('input[aria-label="自定义规则：命令名"]')).toHaveLength(1);
    expect(cmdInput()!.value).toBe('dd');
    await act(async () => {
      chip('d-dd').click();
    });
    expect(cmdInput()).toBeNull();
  });

  it('marks a disabled rule on its chip', async () => {
    await render(<Harness initial={[rule('a', 'rm'), rule('b', 'dd', { enabled: false })]} />);
    expect(chip('b').title).toContain('已关闭');
    expect(chip('a').title).toContain('请求审批');
  });

  it('a reveal request opens the named rule', async () => {
    await render(<Harness initial={five} />);
    await act(async () => {
      flashCustomRule('d-shutdown');
    });
    expect(cmdInput()!.value).toBe('shutdown');
  });
});
