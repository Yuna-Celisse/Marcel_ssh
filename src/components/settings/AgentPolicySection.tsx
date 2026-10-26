import { useState, useMemo, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  AGENT_MAX_TOOL_ROUNDS_MAX,
  AGENT_MAX_TOOL_ROUNDS_MIN,
} from '@/lib/constants';
import { PROTECTED_PATHS_RULE, modifiedRuleCount } from '@/lib/riskRules';
import { useRiskRuleCatalog } from '@/hooks/useRiskRuleCatalog';
import { useCommandCheck } from '@/hooks/useCommandCheck';
import { flashCustomRule, scrollToCustomRules } from '@/lib/riskRuleNav';
import { useRiskRuleFocusStore } from '@/stores/riskRuleFocusStore';
import { CommandCheckResultCard } from './CommandCheckResultCard';
import { CustomRiskRulesEditor } from './CustomRiskRulesEditor';
import { ProtectedPathsEditor } from './ProtectedPathsEditor';
import { ToolApprovalEditor } from './ToolApprovalEditor';
import * as tauri from '@/lib/tauri';
import Button from '@/components/ui/Button';
import Toggle from '@/components/ui/Toggle';
import Select from '@/components/ui/Select';
import SegmentedControl from '@/components/ui/SegmentedControl';
import { Card, SettingItem, useSearchRegistry } from './helpers';
import { useSettingsActions } from './SettingsActionsContext';
import { ValidatedInput } from './ValidatedInput';
import { emptyRegistry, modelOptionsByChannel } from '@/lib/llmRegistry';
import { useDefaultApprovalPrompt } from '@/hooks/useDefaultApprovalPrompt';
import { useSettingsStore } from '@/stores/settingsStore';

export { preCheckCustomPath } from '@/lib/riskRules';

export const DEFAULT_APPROVAL_PROMPT_FALLBACK =
  '（未能从后端读取内置审批提示词；留空即使用内置提示词。）';

/**
 * 用户填的自定义 API 地址是否「可疑到一定会失败」：非空、但缺 `http://`/`https://`。
 *
 * 只提示、不拦截，而且**不替用户改值**：后端刻意不校验 scheme、也不因为格式可疑
 * 就静默回落官方地址（静默回落会让用户以为请求打到了自己的网关）。所以这里只
 * 提前警告一句，免得他填完才发现每条 bash 都被拦下。
 */
export function needsUrlScheme(raw: string | undefined): boolean {
  const v = (raw ?? '').trim();
  if (!v) return false;
  return !/^https?:\/\//i.test(v);
}

/**
 * 命令确认方式：「每条都确认」是 `confirmEachCommand`，「按规则」/ 白名单是 `listMode`
 * （`denylist` / `allowlist`）。「按规则」下没有单独的名单：要问哪些命令全由下面的自定义规则
 * 与内置规则决定；只有白名单有一份「不问」的命令名单。
 */
const CONFIRM_MODE_OPTIONS = [
  { value: 'each', label: '每条都确认', title: '每条命令都问你' },
  { value: 'denylist', label: '按规则', title: '只问命中下面规则的命令' },
  { value: 'allowlist', label: '白名单', title: '名单里的命令不问，其余都问' },
] as const;

export function AgentPolicySection() {
  const { settings, update } = useSettingsActions();
  const agent = settings.agentModeSettings;

  const updateAgent = (patch: Partial<typeof agent>) => {
    update({ agentModeSettings: { ...agent, ...patch } });
  };

  const [newCommand, setNewCommand] = useState('');
  const defaultApprovalPrompt = useDefaultApprovalPrompt();
  // 「命令超时」和「执行前模型审批」是偶尔调整的高级项，折叠收纳避免主面板太长。
  // 跟 ModelServiceSection 的「高级：自定义请求参数」折叠风格一致。
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const advancedSummary = useMemo(() => {
    const secs = settings.commandTimeoutSecs ?? 120;
    const approval = agent.enableModelCommandApproval
      ? agent.commandApprovalEngine === 'jev'
        ? '开（Jev）'
        : '开'
      : '关';
    return `${secs}s · 模型审批：${approval}`;
  }, [
    settings.commandTimeoutSecs,
    agent.enableModelCommandApproval,
    agent.commandApprovalEngine,
  ]);

  // Jev 引擎的 API Key（原始 Key 只进密钥链，永不回传前端）。
  const hasJevApiKey = useSettingsStore((s) => s.hasJevApiKey);
  const [jevKeyDraft, setJevKeyDraft] = useState('');
  const persistJevKey = async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.includes('******') || trimmed === '********') return;
    try {
      await tauri.saveJevApiKey(trimmed);
      useSettingsStore.setState({ hasJevApiKey: true });
      setJevKeyDraft('');
    } catch (err) {
      console.error('保存 TypeSafe API Key 失败:', err);
    }
  };
  const clearJevKey = async () => {
    try {
      await tauri.deleteJevApiKey();
      useSettingsStore.setState({ hasJevApiKey: false });
      setJevKeyDraft('');
    } catch (err) {
      console.error('清除 TypeSafe API Key 失败:', err);
    }
  };
  const jevEngine = agent.commandApprovalEngine === 'jev';


  const handleAddCommand = () => {
    const v = newCommand.trim();
    if (!v) return;
    if (!agent.allowCommands.includes(v)) {
      updateAgent({ allowCommands: [...agent.allowCommands, v] });
    }
    setNewCommand('');
  };

  const handleRemoveCommand = (cmd: string) => {
    updateAgent({
      allowCommands: agent.allowCommands.filter((c) => c !== cmd),
    });
  };

  const confirmMode = agent.confirmEachCommand ? 'each' : agent.listMode;

  const riskOverrides = settings.riskRuleOverrides ?? {};
  const customRules = settings.customRiskRules ?? [];
  const customPaths = settings.customProtectedPaths ?? [];
  const { catalog } = useRiskRuleCatalog();
  const openPage = useRiskRuleFocusStore((s) => s.openPage);
  const focusRule = useRiskRuleFocusStore((s) => s.focus);
  const modifiedCount = modifiedRuleCount(riskOverrides);
  const check = useCommandCheck();

  // 命中的是自定义规则 → 就在本页，滚过去；内置规则 → 进二级页并落到那一条。
  const jumpToRule = (ruleId: string) => {
    if (customRules.some((c) => c.id === ruleId)) flashCustomRule(ruleId);
    else focusRule(ruleId);
  };

  // 「内置风险规则」入口行不走 SettingItem（整行是个按钮），设置搜索靠这里手动登记，
  // 并带上全部规则名，搜规则名也能找到这一行。
  const { register, unregister } = useSearchRegistry();
  const ruleTitles = useMemo(() => catalog?.rules.map((r) => r.title) ?? [], [catalog]);
  const ruleTitlesKey = JSON.stringify(ruleTitles);
  useEffect(() => {
    register({
      id: 'cmd-builtin-rules',
      label: '内置风险规则',
      description: '查看并修改 Agent 执行命令前用的全部内置规则',
      keywords: [
        '规则',
        '风险',
        '拒绝',
        '强制审批',
        '请求审批',
        '放行',
        '豁免',
        'pkill',
        'sudo',
        'systemctl',
        'rm -rf',
        'Windows',
        '命令执行策略',
        'Agent',
        ...ruleTitles,
      ],
      sectionId: 'settings-command-policy',
    });
    return () => unregister('cmd-builtin-rules');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [register, unregister, ruleTitlesKey]);

  return (
    <div className="space-y-6">
      <Card
        id="settings-command-policy"
        title="命令执行策略"
        description="控制 Agent / Plan 模式下的命令安全边界"
      >
        <SettingItem
          id="cmd-list-mode"
          label="命令确认方式"
          description="哪些命令要先问你"
          sectionId="settings-command-policy"
          keywords={[
            'confirm',
            '确认',
            'list',
            'mode',
            '黑名单',
            '白名单',
            '按规则',
            '每条都手动确认',
            '命令执行策略',
            'Agent',
          ]}
        >
          <SegmentedControl
            ariaLabel="命令确认方式"
            value={confirmMode}
            onChange={(v) =>
              updateAgent(
                v === 'each'
                  ? { confirmEachCommand: true }
                  : { confirmEachCommand: false, listMode: v },
              )
            }
            options={CONFIRM_MODE_OPTIONS}
          />
        </SettingItem>
        {!agent.confirmEachCommand && agent.listMode === 'allowlist' && (
          <SettingItem
            id="cmd-list"
            label="允许的命令"
            description="这些命令不再问你，其余都问；按基础命令名匹配"
            sectionId="settings-command-policy"
            keywords={['command', 'list', '命令列表', '命令执行策略', 'Agent']}
          >
            <div className="flex-1 space-y-2 min-w-0 w-80">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newCommand}
                  onChange={(e) => setNewCommand(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCommand();
                    }
                  }}
                  placeholder="例如：rm 或 sudo"
                  className="flex-1 rounded-lg bg-zinc-800 border border-edge px-3 py-1.5 text-sm font-mono text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
                />
                <Button
                  variant="secondary"
                  size="md"
                  onClick={handleAddCommand}
                  disabled={!newCommand.trim()}
                >
                  添加
                </Button>
              </div>
              {agent.allowCommands.length === 0 ? (
                <p className="text-xs text-zinc-500 italic px-1">列表为空</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {agent.allowCommands.map((cmd) => (
                    <span
                      key={cmd}
                      className="group inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-zinc-800 border border-edge text-xs font-mono text-zinc-200"
                    >
                      {cmd}
                      <button
                        onClick={() => handleRemoveCommand(cmd)}
                        className="text-zinc-500 hover:text-red-400 transition-colors"
                        aria-label={`移除 ${cmd}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </SettingItem>
        )}
        <SettingItem
          id="cmd-custom-rules"
          label="自定义规则"
          description="命令命中就按所选档位处理，多条命中取最严"
          sectionId="settings-command-policy"
          keywords={['custom', 'rule', '自定义', '规则', '命令执行策略', 'Agent']}
        >
          <div className="flex-1 min-w-0">
            <CustomRiskRulesEditor
              rules={customRules}
              onChange={(next) => update({ customRiskRules: next })}
              reasonTemplate={catalog?.customRule}
            />
          </div>
        </SettingItem>
        <SettingItem
          id="cmd-plan-mode-approval"
          label="Plan 模式也需要审批"
          description="默认关：Plan 和 Auto 一样不弹审批"
          sectionId="settings-command-policy"
          keywords={['plan', '计划模式', '审批', '命令执行策略', 'Agent']}
        >
          <Toggle
            checked={agent.planModeRequiresApproval ?? false}
            onChange={(checked) =>
              updateAgent({ planModeRequiresApproval: checked })
            }
            label="Plan 模式下执行命令时需要用户确认"
          />
        </SettingItem>
        <SettingItem
          id="cmd-auto-force-approval"
          label="Auto 模式强制审批"
          description="Auto 下强制审批档仍要你确认"
          sectionId="settings-command-policy"
          keywords={['auto', 'force', 'approval', '强制', '审批', '命令执行策略', 'Agent']}
        >
          <Toggle
            checked={agent.autoModeForceApproval ?? false}
            onChange={(checked) => updateAgent({ autoModeForceApproval: checked })}
            label="系统级命令、受保护路径等在 Auto 模式下也弹窗确认"
          />
        </SettingItem>
        <SettingItem
          id="cmd-protected-paths"
          label="受保护路径"
          description="在这些路径下写入会触发审批"
          sectionId="settings-command-policy"
          keywords={[
            'protected',
            'paths',
            '受保护',
            '路径',
            'agent',
            '审批',
            '命令执行策略',
          ]}
        >
          <div className="flex-1 min-w-0">
            <ProtectedPathsEditor
              rule={catalog?.rules.find((r) => r.id === PROTECTED_PATHS_RULE) ?? null}
              overrides={riskOverrides}
              customPaths={customPaths}
              onChange={(patch) => update(patch)}
            />
          </div>
        </SettingItem>
        <SettingItem
          id="cmd-tool-approval"
          label="需要审批的工具"
          description="这些工具执行前按所选档位处理；命令由规则决定"
          sectionId="settings-command-policy"
          keywords={[
            'edit',
            'write',
            'file',
            'tool',
            '编辑',
            '写入',
            '文件',
            '文件修改审批',
            '工具',
            '审批',
            '命令执行策略',
            'Agent',
          ]}
        >
          <div className="flex-1 min-w-0">
            <ToolApprovalEditor
              levels={agent.toolApprovalLevels ?? {}}
              onChange={(next) => updateAgent({ toolApprovalLevels: next })}
              onOpenCommandRules={scrollToCustomRules}
            />
          </div>
        </SettingItem>
        <button
          type="button"
          onClick={openPage}
          className="flex w-full items-center gap-6 px-6 py-4 text-left transition-colors hover:bg-state-soft active:bg-state-mid"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-zinc-200">内置风险规则</span>
            <span className="mt-0.5 block text-xs text-zinc-500">
              rm -rf /、pkill、curl | sh 等 {catalog?.rules.length ?? ''} 条
            </span>
          </span>
          {modifiedCount > 0 && (
            <span className="rounded-full border border-indigo-700/50 bg-indigo-500/10 px-2 py-px text-xs text-indigo-200">
              已改 {modifiedCount}
            </span>
          )}
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-zinc-500" />
        </button>
        <SettingItem
          id="cmd-test"
          label="测试命令"
          description="看一条命令会不会被拦"
          sectionId="settings-command-policy"
          keywords={['test', '验证', '命令执行策略', 'Agent']}
        >
          <div className="flex-1 space-y-2 min-w-0 w-80">
            <input
              type="text"
              value={check.command}
              onChange={(e) => check.setCommand(e.target.value)}
              placeholder="例如：rm -rf /tmp/test"
              aria-label="测试命令"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full rounded-lg bg-zinc-800 border border-edge px-3 py-1.5 text-sm font-mono text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
            />
            {check.error && <p className="text-xs text-red-400">{check.error}</p>}
            {check.results && (
              <CommandCheckResultCard results={check.results} onJump={jumpToRule} />
            )}
          </div>
        </SettingItem>

        {/* 高级：命令超时时间 + 执行前模型审批。折叠收纳避免主面板太长。 */}
        <div className="px-6 py-4">
          <button
            type="button"
            onClick={() => setAdvancedOpen((o) => !o)}
            className="flex items-center gap-2 text-sm font-medium text-zinc-200 hover:text-zinc-100 transition-colors w-full"
            aria-expanded={advancedOpen}
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform ${advancedOpen ? 'rotate-90' : ''}`}
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 4l4 4-4 4" />
            </svg>
            <span>高级：超时与模型审批</span>
            <span className="text-[11px] text-zinc-500 font-normal ml-1">（{advancedSummary}）</span>
          </button>
          {advancedOpen && (
            <div className="mt-3">
              <SettingItem
                id="cmd-timeout"
                label="命令超时时间"
                description="Agent 执行单条命令的最大等待时间"
                sectionId="settings-command-policy"
                keywords={['timeout', '超时', '命令执行策略', 'Agent']}
              >
                <div className="flex items-center gap-3 w-80">
                  <input
                    type="range"
                    min={10}
                    max={300}
                    step={10}
                    value={settings.commandTimeoutSecs ?? 120}
                    onChange={(e) =>
                      update({ commandTimeoutSecs: Number(e.target.value) })
                    }
                    className="flex-1 accent-indigo-500"
                  />
                  <span className="text-sm font-mono text-zinc-300 w-16 text-right">
                    {settings.commandTimeoutSecs ?? 120}s
                  </span>
                </div>
              </SettingItem>
              <SettingItem
                id="cmd-model-approval"
                label="执行前模型审批"
                description="在执行命令前，用当前 Agent 模型结合上下文判断是否放行、转人工审批或阻止"
                sectionId="settings-command-policy"
                keywords={[
                  'model',
                  'approval',
                  '模型',
                  '审批',
                  '命令执行策略',
                  'Agent',
                  // 引擎 / 判据这些字眼只出现在子节点里，而设置搜索只索引
                  // label + description + keywords —— 不补的话按界面上看到的
                  // 词（jev / 引擎 / TypeSafe）一个也搜不到。
                  'Jev',
                  'TypeSafe',
                  '引擎',
                  '审批引擎',
                  '判据',
                ]}
              >
                <div className="w-80 space-y-2">
                  <Toggle
                    checked={agent.enableModelCommandApproval ?? false}
                    onChange={(checked) =>
                      updateAgent({ enableModelCommandApproval: checked })
                    }
                    label="在 bash 执行前调用模型做一次审批判定"
                  />
                  {agent.enableModelCommandApproval && (
                    <div className="pl-1 space-y-2">
                      <div className="space-y-1.5">
                        <span className="text-xs text-zinc-400">审批引擎</span>
                        <SegmentedControl
                          ariaLabel="命令审批引擎"
                          value={agent.commandApprovalEngine ?? 'model'}
                          onChange={(v) =>
                            updateAgent({ commandApprovalEngine: v })
                          }
                          options={[
                            {
                              value: 'model',
                              label: '跟随会话模型',
                              title: '用本会话的模型做审批判定（旧行为）',
                            },
                            {
                              value: 'jev',
                              label: 'Jev',
                              title: 'TypeSafe 的决策模型：更快、更便宜，需要单独配 API Key',
                            },
                          ]}
                        />
                      </div>
                      <p className="text-xs text-zinc-500">
                        {jevEngine
                          ? 'Jev 是 TypeSafe 的决策模型：一次请求直接返回类型化判定与概率，比走会话模型更快、更便宜。需要单独配置 API Key。'
                          : '用本会话的模型（或下面指定的审核模型）做审批判定。'}
                      </p>

                      {jevEngine ? (
                        <>
                          <div className="flex-1 flex gap-2 items-center">
                            <input
                              type="password"
                              value={jevKeyDraft || (hasJevApiKey ? '********' : '')}
                              onChange={(e) => setJevKeyDraft(e.target.value)}
                              onBlur={() => void persistJevKey(jevKeyDraft)}
                              placeholder={
                                hasJevApiKey
                                  ? '已保存，输入新 Key 可覆盖'
                                  : '输入 Jev 的 API Key（官方或你的网关）'
                              }
                              autoComplete="off"
                              className="flex-1 rounded-lg bg-zinc-800 border border-edge px-3 py-1.5 text-sm font-mono text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
                            />
                            {hasJevApiKey && (
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => void clearJevKey()}
                              >
                                清除
                              </Button>
                            )}
                          </div>
                          {!hasJevApiKey && (
                            <p className="text-xs text-amber-400/90">
                              还没配 Key。没配之前每条 bash 都会被明确拦下并提示，
                              不会静默回退到会话模型。
                            </p>
                          )}
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-400 flex-shrink-0 w-24">
                              模型 ID
                            </span>
                            <input
                              type="text"
                              value={agent.jevModelId ?? ''}
                              onChange={(e) =>
                                updateAgent({ jevModelId: e.target.value })
                              }
                              placeholder="留空使用内置默认（钉版本号）"
                              className="flex-1 rounded-lg bg-zinc-800 border border-edge px-3 py-1.5 text-xs font-mono text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
                            />
                          </div>
                          <p className="text-xs text-zinc-500">
                            内置默认已经钉住版本号，不建议改用{' '}
                            <code>jev-latest</code> 别名——别名会随官方发布前移，
                            审批行为不该在你不知情时改变。走中转或网关时，模型名
                            往往是它自己的一套（例如 Command Code 的{' '}
                            <code>typesafe/jev</code>），照对方文档填。
                          </p>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-400 flex-shrink-0 w-24">
                              API 地址
                            </span>
                            <input
                              type="text"
                              value={agent.jevBaseUrl ?? ''}
                              onChange={(e) =>
                                updateAgent({ jevBaseUrl: e.target.value })
                              }
                              placeholder="留空使用官方地址 api.typesafe.ai"
                              className="flex-1 rounded-lg bg-zinc-800 border border-edge px-3 py-1.5 text-xs font-mono text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-indigo-500"
                            />
                          </div>
                          <p className="text-xs text-zinc-500">
                            只在需要走代理、私有网关或本地 mock 时填。路径{' '}
                            <code>/v1/systemone</code> 是固定拼上去的——如果对方
                            文档给的基址末尾带 <code>/v1</code>
                            （如 <code>https://api.commandcode.ai/provider/v1</code>
                            ），要把那段去掉，否则会拼成{' '}
                            <code>…/v1/v1/systemone</code> 而 404。留空 = 保持官方地址。
                          </p>
                          {needsUrlScheme(agent.jevBaseUrl) && (
                            <p className="text-xs text-amber-400/90">
                              地址看起来缺了 <code>http://</code> 或{' '}
                              <code>https://</code>，照这样请求会失败并把每条 bash
                              拦下——补上协议头。
                            </p>
                          )}
                          <div className="flex items-center justify-between pt-1">
                            <span className="text-xs text-zinc-400">Jev 判据</span>
                            <button
                              type="button"
                              onClick={() => updateAgent({ jevApprovalPrompt: '' })}
                              className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                            >
                              恢复默认
                            </button>
                          </div>
                          <textarea
                            value={agent.jevApprovalPrompt || ''}
                            onChange={(e) =>
                              updateAgent({ jevApprovalPrompt: e.target.value })
                            }
                            rows={6}
                            placeholder="留空使用内置判据。这里填的是「要判断什么」，不要写输出格式——Jev 返回的是类型化选项，不生成文本。"
                            className="w-full rounded-lg bg-zinc-800 border border-edge px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-indigo-500 resize-none"
                          />
                          <p className="text-xs text-zinc-500">
                            {agent.jevBaseUrl?.trim() ? (
                              <>
                                判定结果与理由会连同对话上下文和这条命令一起发送到
                                你上面填的地址（
                                <code>
                                  {agent.jevBaseUrl.trim().replace(/\/+$/, '')}
                                </code>
                                ）。那要是一个第三方中转，命令里若带 token
                                或密码请注意。
                              </>
                            ) : (
                              <>
                                判定结果与理由会连同对话上下文和这条命令一起发送到
                                TypeSafe（<code>api.typesafe.ai</code>
                                ）——这是一台第三方服务器，命令里若带 token
                                或密码请注意。
                              </>
                            )}
                          </p>
                          <Toggle
                            checked={agent.jevReasonFollowup ?? false}
                            onChange={(checked) =>
                              updateAgent({ jevReasonFollowup: checked })
                            }
                            label="被判人审或阻止时，再打一轮 Jev 追问原因"
                          />
                          <p className="text-xs text-zinc-500">
                            第一轮的探针有时一个都命中不了，用户会看到「需要确认」
                            却没有任何解释。打开后这类命令会多打一次请求（延迟与
                            花费翻倍）专门问「为什么」；追问失败不影响判定。
                          </p>
                        </>
                      ) : (
                        <>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-400 flex-shrink-0 w-24">
                          审批模型
                        </span>
                        <Select
                          value={settings.llmRegistry?.slots?.modelApprovalModelId ?? ''}
                          onChange={(v) => {
                            // settings 未初始化时兜底：与 lib/llmRegistry 的
                            // emptyRegistry（空注册表唯一权威来源）同构。
                            const registry = settings.llmRegistry ?? emptyRegistry();
                            update({
                              llmRegistry: {
                                ...registry,
                                slots: { ...registry.slots, modelApprovalModelId: v },
                              },
                            });
                          }}
                          options={[
                            { value: '', label: '跟随会话模型' },
                            ...(settings.llmRegistry
                              ? modelOptionsByChannel(settings.llmRegistry)
                              : []),
                          ]}
                          placeholder="跟随会话模型"
                          className="w-72"
                        />
                      </div>
                      <p className="text-xs text-zinc-500">
                        选择更小更快的模型可降低审批延迟和成本。留空 = 跟随本会话正在使用的模型。
                      </p>
                      <div className="flex items-center justify-between pt-1">
                        <span className="text-xs text-zinc-400">审批提示词</span>
                        <button
                          type="button"
                          onClick={() => updateAgent({ modelApprovalPrompt: '' })}
                          className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                        >
                          恢复默认
                        </button>
                      </div>
                      <textarea
                        value={agent.modelApprovalPrompt || defaultApprovalPrompt}
                        onChange={(e) => {
                          const v = e.target.value;
                          updateAgent({
                            modelApprovalPrompt:
                              v === defaultApprovalPrompt ? '' : v,
                          });
                        }}
                        rows={6}
                        placeholder={DEFAULT_APPROVAL_PROMPT_FALLBACK}
                        className="w-full rounded-lg bg-zinc-800 border border-edge px-3 py-2 text-xs font-mono text-zinc-100 focus:outline-none focus:border-indigo-500 resize-none"
                      />
                        </>
                      )}
                    </div>
                  )}
                </div>
              </SettingItem>
            </div>
          )}
        </div>
      </Card>
      <Card
        id="settings-agent-rounds"
        title="执行轮数限制"
        description="控制 Agent 单次任务的工具调用轮数上限"
      >
        <SettingItem
          id="cmd-max-rounds"
          label="最大执行轮数"
          description="Agent 单次任务最多执行的工具调用轮数，超限自动停止"
          sectionId="settings-agent-rounds"
          keywords={['max', 'rounds', '轮数', '最大', '执行轮数', 'Agent']}
        >
          <ValidatedInput
            type="number"
            value={agent.maxToolRounds ?? 500}
            onChange={(v) => updateAgent({ maxToolRounds: v })}
            validate={(s) => {
              const v = Number(s);
              if (
                !Number.isInteger(v) ||
                v < AGENT_MAX_TOOL_ROUNDS_MIN ||
                v > AGENT_MAX_TOOL_ROUNDS_MAX
              )
                return `须为 ${AGENT_MAX_TOOL_ROUNDS_MIN}-${AGENT_MAX_TOOL_ROUNDS_MAX} 的整数`;
              return null;
            }}
            validatorId="maxToolRounds"
            validatorFn={(draft) => {
              const v = draft.agentModeSettings.maxToolRounds;
              if (
                !Number.isInteger(v) ||
                v < AGENT_MAX_TOOL_ROUNDS_MIN ||
                v > AGENT_MAX_TOOL_ROUNDS_MAX
              )
                return `最大执行轮数须为 ${AGENT_MAX_TOOL_ROUNDS_MIN}-${AGENT_MAX_TOOL_ROUNDS_MAX} 的整数（当前值：${v}）`;
              return null;
            }}
            min={AGENT_MAX_TOOL_ROUNDS_MIN}
            max={AGENT_MAX_TOOL_ROUNDS_MAX}
            step={1}
            suffix="轮"
            className="w-24"
          />
        </SettingItem>
      </Card>
    </div>
  );
}
