import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import * as tauri from '@/lib/tauri';
import {
  AGENT_MAX_TOOL_ROUNDS_MAX,
  AGENT_MAX_TOOL_ROUNDS_MIN,
} from '@/lib/constants';
import { PROTECTED_PATHS_RULE, modifiedRuleCount } from '@/lib/riskRules';
import { useRiskRuleCatalog } from '@/hooks/useRiskRuleCatalog';
import { useApprovableTools } from '@/hooks/useApprovableTools';
import { useCommandCheck } from '@/hooks/useCommandCheck';
import { useRiskRuleFocusStore } from '@/stores/riskRuleFocusStore';
import { CommandCheckResultCard } from '@/components/settings/CommandCheckResultCard';
import { CustomRiskRulesEditor } from '@/components/settings/CustomRiskRulesEditor';
import { ProtectedPathsEditor } from '@/components/settings/ProtectedPathsEditor';
import { flashCustomRule, scrollToCustomRules } from '@/lib/riskRuleNav';
import { ToolApprovalEditor } from '@/components/settings/ToolApprovalEditor';
import Toggle from '@/components/ui/Toggle';
import SegmentedControl from '@/components/ui/SegmentedControl';
import { useSettingsActions } from '@/components/settings/SettingsActionsContext';
import {
  DEFAULT_APPROVAL_PROMPT_FALLBACK,
  needsUrlScheme,
} from '@/components/settings/AgentPolicySection';
import { useDefaultApprovalPrompt } from '@/hooks/useDefaultApprovalPrompt';
import { emptyRegistry, modelFullLabel, modelLabel } from '@/lib/llmRegistry';
import MobileSheet from '../ui/MobileSheet';
import { MobileSettingRow } from './MobileSettingRow';
import { useSettingsStore } from '@/stores/settingsStore';

const inputClass =
  'w-full rounded-lg border border-edge bg-zinc-800 px-3 py-2.5 font-mono text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-500 disabled:opacity-40';

/** Full agent command policy for mobile — same settings surface as desktop. */
export function MobileAgentPolicySection() {
  const { settings, update } = useSettingsActions();
  const agent = settings.agentModeSettings;

  const updateAgent = (patch: Partial<typeof agent>) => {
    update({ agentModeSettings: { ...agent, ...patch } });
  };

  const defaultApprovalPrompt = useDefaultApprovalPrompt();

  const [newCommand, setNewCommand] = useState('');
  const [approvalModelPickerOpen, setApprovalModelPickerOpen] = useState(false);

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

  const confirmMode = agent.confirmEachCommand ? 'each' : agent.listMode;

  const handleAddCommand = () => {
    const v = newCommand.trim();
    if (!v) return;
    if (!agent.allowCommands.includes(v)) {
      updateAgent({ allowCommands: [...agent.allowCommands, v] });
    }
    setNewCommand('');
  };

  const riskOverrides = settings.riskRuleOverrides ?? {};
  const customRules = settings.customRiskRules ?? [];
  const customPaths = settings.customProtectedPaths ?? [];
  const { catalog } = useRiskRuleCatalog();
  const approvableTools = useApprovableTools();
  const openPage = useRiskRuleFocusStore((s) => s.openPage);
  const focusRule = useRiskRuleFocusStore((s) => s.focus);
  const modifiedCount = modifiedRuleCount(riskOverrides);
  const check = useCommandCheck();

  // 命中的是自定义规则 → 就在本页，滚过去；内置规则 → 进二级页并落到那一条。
  const jumpToRule = (ruleId: string) => {
    if (customRules.some((c) => c.id === ruleId)) flashCustomRule(ruleId);
    else focusRule(ruleId);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Command timeout */}
      <MobileSettingRow
        label="命令超时时间"
        description="Agent 执行单条命令的最大等待时间"
        trailing={
          <span className="w-14 text-right font-mono text-sm text-indigo-300">
            {settings.commandTimeoutSecs ?? 120}s
          </span>
        }
      >
        <input
          type="range"
          min={10}
          max={300}
          step={10}
          value={settings.commandTimeoutSecs ?? 120}
          onChange={(e) =>
            update({ commandTimeoutSecs: Number(e.target.value) })
          }
          className="mt-1 h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-700 accent-indigo-500"
        />
      </MobileSettingRow>

      {/* 命令确认方式：「每条都确认」并在这里；只有白名单有一份「不问」的命令名单 */}
      <MobileSettingRow
        label="命令确认方式"
        description="哪些命令要先问你"
      >
        <div className="mt-2 space-y-2">
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
            options={[
              { value: 'each', label: '每条都确认' },
              { value: 'denylist', label: '按规则' },
              { value: 'allowlist', label: '白名单' },
            ]}
          />
          {!agent.confirmEachCommand && agent.listMode === 'allowlist' && (
            <>
              <p className="text-xs text-zinc-500">
                允许的命令：这些命令不再问你，其余都问；按基础命令名匹配（不含路径或参数）
              </p>
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
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className={inputClass}
                />
                <button
                  type="button"
                  onClick={handleAddCommand}
                  disabled={!newCommand.trim()}
                  className="flex-shrink-0 rounded-lg bg-zinc-800 px-4 py-2.5 text-sm text-zinc-200 active:bg-state-mid disabled:opacity-40"
                >
                  添加
                </button>
              </div>
              {agent.allowCommands.length === 0 ? (
                <p className="px-1 text-xs italic text-zinc-500">列表为空</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {agent.allowCommands.map((cmd) => (
                    <span
                      key={cmd}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-edge bg-zinc-800 px-2.5 py-1.5 font-mono text-xs text-zinc-200"
                    >
                      {cmd}
                      <button
                        type="button"
                        onClick={() =>
                          updateAgent({
                            allowCommands: agent.allowCommands.filter((c) => c !== cmd),
                          })
                        }
                        className="-mr-0.5 px-0.5 text-zinc-500 active:text-red-400"
                        aria-label={`移除 ${cmd}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </MobileSettingRow>
      {/* 自定义规则 */}
      <MobileSettingRow label="自定义规则" description="命令命中就按所选档位处理，多条命中取最严">
        <div className="mt-2">
          <CustomRiskRulesEditor
            rules={customRules}
            onChange={(next) => update({ customRiskRules: next })}
            reasonTemplate={catalog?.customRule}
            compact
          />
        </div>
      </MobileSettingRow>

      <MobileSettingRow
        label="Plan 模式也需要审批"
        description="默认关闭，与 AUTO 一致；开启后按命令确认方式与规则审批"
        trailing={
          <Toggle
            checked={agent.planModeRequiresApproval ?? false}
            onChange={(checked) =>
              updateAgent({ planModeRequiresApproval: checked })
            }
          />
        }
      />
      <MobileSettingRow
        label="Auto 模式强制审批"
        description="默认关闭；开启后系统级命令、受保护路径等强制审批档仍弹窗"
        trailing={
          <Toggle
            checked={agent.autoModeForceApproval ?? false}
            onChange={(checked) => updateAgent({ autoModeForceApproval: checked })}
          />
        }
      />
      {/* Model approval */}
      <MobileSettingRow
        label="执行前模型审批"
        description="执行命令前让模型判定放行/转人工/阻止"
        trailing={
          <Toggle
            checked={agent.enableModelCommandApproval ?? false}
            onChange={(checked) =>
              updateAgent({ enableModelCommandApproval: checked })
            }
          />
        }
      >
        {agent.enableModelCommandApproval && (
          <div className="mt-2 space-y-1.5">
            <span className="text-xs text-zinc-400">审批引擎</span>
            <SegmentedControl
              ariaLabel="命令审批引擎"
              value={agent.commandApprovalEngine ?? 'model'}
              onChange={(v) => updateAgent({ commandApprovalEngine: v })}
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
            {agent.commandApprovalEngine === 'jev' ? (
              <>
                <div className="flex items-center gap-2">
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
                    className={inputClass}
                  />
                  {hasJevApiKey && (
                    <button
                      type="button"
                      onClick={() => void clearJevKey()}
                      className="flex-shrink-0 rounded-lg border border-edge px-3 py-2.5 text-xs text-zinc-400 active:bg-state-mid"
                    >
                      清除
                    </button>
                  )}
                </div>
                {!hasJevApiKey && (
                  <p className="text-xs text-amber-400/90">
                    还没配 Key。没配之前每条 bash 都会被明确拦下并提示，不会静默回退到会话模型。
                  </p>
                )}
                <span className="text-xs text-zinc-400">模型 ID</span>
                <input
                  type="text"
                  value={agent.jevModelId ?? ''}
                  onChange={(e) => updateAgent({ jevModelId: e.target.value })}
                  placeholder="留空使用内置默认（钉版本号）"
                  className={inputClass}
                />
                <p className="text-xs text-zinc-500">
                  内置默认已经钉住版本号，不建议改用 jev-latest 别名——别名会随官方发布前移。走中转或网关时，模型名往往是它自己的一套（例如 Command Code 的 typesafe/jev），照对方文档填。
                </p>
                <span className="text-xs text-zinc-400">API 地址</span>
                <input
                  type="text"
                  value={agent.jevBaseUrl ?? ''}
                  onChange={(e) => updateAgent({ jevBaseUrl: e.target.value })}
                  placeholder="留空使用官方地址 api.typesafe.ai"
                  className={inputClass}
                />
                <p className="text-xs text-zinc-500">
                  只在走代理、私有网关或本地 mock 时填。路径 /v1/systemone 是固定拼上去的——对方文档给的基址若末尾带 /v1（如 https://api.commandcode.ai/provider/v1），要把那段去掉，否则会拼成 …/v1/v1/systemone 而 404。留空 = 保持官方地址。
                </p>
                {needsUrlScheme(agent.jevBaseUrl) && (
                  <p className="text-xs text-amber-400/90">
                    地址看起来缺了 http:// 或 https://，照这样请求会失败并把每条 bash 拦下。
                  </p>
                )}
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-zinc-400">Jev 判据</span>
                  <button
                    type="button"
                    onClick={() => updateAgent({ jevApprovalPrompt: '' })}
                    className="text-xs text-zinc-500 active:text-zinc-300"
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
                  className="w-full resize-none rounded-lg border border-edge bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-indigo-500"
                />
                <p className="text-xs text-zinc-500">
                  {agent.jevBaseUrl?.trim()
                    ? `判定结果与理由会连同对话上下文和这条命令一起发送到你上面填的地址（${agent.jevBaseUrl.trim().replace(/\/+$/, '')}）。那要是一个第三方中转，命令里若带 token 或密码请注意。`
                    : '判定结果与理由会连同对话上下文和这条命令一起发送到 TypeSafe（api.typesafe.ai）——这是一台第三方服务器，命令里若带 token 或密码请注意。'}
                </p>
                <MobileSettingRow
                  label="人审时追问原因"
                  description="第一轮探针可能一个都没命中，用户看不到解释。打开后这类命令多打一次请求专门问「为什么」；追问失败不影响判定。"
                  trailing={
                    <Toggle
                      checked={agent.jevReasonFollowup ?? false}
                      onChange={(checked) =>
                        updateAgent({ jevReasonFollowup: checked })
                      }
                    />
                  }
                />
              </>
            ) : (
              <>
            <button
              type="button"
              onClick={() => setApprovalModelPickerOpen(true)}
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-edge bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 outline-none active:bg-state-mid"
            >
              <span className="truncate">
                {settings.llmRegistry?.slots?.modelApprovalModelId
                  ? modelFullLabel(
                      settings.llmRegistry,
                      settings.llmRegistry.slots.modelApprovalModelId,
                    )
                  : '跟随会话模型'}
              </span>
              <ChevronDown className="h-4 w-4 flex-shrink-0 text-zinc-500" />
            </button>
            <p className="text-xs text-zinc-500">
              选择轻量模型可降低审批延迟和成本，留空跟随本会话正在使用的模型
            </p>
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs text-zinc-400">审批提示词</span>
              <button
                type="button"
                onClick={() => updateAgent({ modelApprovalPrompt: '' })}
                className="text-xs text-zinc-500 active:text-zinc-300"
              >
                恢复默认
              </button>
            </div>
            <textarea
              value={agent.modelApprovalPrompt || defaultApprovalPrompt}
              onChange={(e) => {
                const v = e.target.value;
                updateAgent({
                  modelApprovalPrompt: v === defaultApprovalPrompt ? '' : v,
                });
              }}
              rows={6}
              placeholder={DEFAULT_APPROVAL_PROMPT_FALLBACK}
              className="w-full resize-none rounded-lg border border-edge bg-zinc-800 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-indigo-500"
            />
              </>
            )}
          </div>
        )}
      </MobileSettingRow>

      {/* 受保护路径 */}
      <MobileSettingRow
        label="受保护路径"
        description="在这些路径下写入会触发审批"
      >
        <div className="mt-2">
          <ProtectedPathsEditor
            rule={catalog?.rules.find((r) => r.id === PROTECTED_PATHS_RULE) ?? null}
            overrides={riskOverrides}
            customPaths={customPaths}
            onChange={(patch) => update(patch)}
            compact
          />
        </div>
      </MobileSettingRow>

      {/* 需要审批的工具 */}
      <MobileSettingRow
        label="需要审批的工具"
        description="这些工具执行前按所选档位处理；命令由规则决定"
      >
        <div className="mt-2">
          <ToolApprovalEditor
            levels={agent.toolApprovalLevels ?? {}}
            onChange={(next) => updateAgent({ toolApprovalLevels: next })}
            onOpenCommandRules={scrollToCustomRules}
            available={approvableTools}
            compact
          />
        </div>
      </MobileSettingRow>

      {/* 内置风险规则：二级页入口 */}
      <button
        type="button"
        onClick={openPage}
        className="flex items-center gap-3 rounded-xl border border-edge-subtle bg-zinc-900 px-3 py-3 text-left transition-transform duration-100 active:scale-[0.99]"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-zinc-100">内置风险规则</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-zinc-500">
            rm -rf /、pkill、curl | sh 等 {catalog?.rules.length ?? ''} 条
          </span>
        </span>
        {modifiedCount > 0 && (
          <span className="flex-shrink-0 rounded-full border border-indigo-700/50 bg-indigo-500/10 px-2 py-px text-xs text-indigo-200">
            已改 {modifiedCount}
          </span>
        )}
        <ChevronRight className="h-4 w-4 flex-shrink-0 text-zinc-600" />
      </button>

      {/* 测试命令 */}
      <MobileSettingRow label="测试命令" description="看一条命令会不会被拦">
        <div className="mt-2 space-y-2">
          <input
            type="text"
            value={check.command}
            onChange={(e) => check.setCommand(e.target.value)}
            placeholder="例如：rm -rf /tmp/test"
            aria-label="测试命令"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            className={inputClass}
          />
          {check.error && <p className="text-xs text-red-400">{check.error}</p>}
          {check.results && (
            <CommandCheckResultCard results={check.results} onJump={jumpToRule} compact />
          )}
        </div>
      </MobileSettingRow>

      {/* Max rounds */}
      <MobileSettingRow
        label="最大执行轮数"
        description="单次任务最多执行的工具调用轮数，超限自动停止"
        trailing={
          <span className="w-14 text-right font-mono text-sm text-indigo-300">
            {agent.maxToolRounds ?? 500}
          </span>
        }
      >
        <input
          type="range"
          min={AGENT_MAX_TOOL_ROUNDS_MIN}
          max={AGENT_MAX_TOOL_ROUNDS_MAX}
          step={1}
          value={agent.maxToolRounds ?? 500}
          onChange={(e) =>
            updateAgent({ maxToolRounds: Number(e.target.value) })
          }
          className="mt-1 h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-700 accent-indigo-500"
        />
      </MobileSettingRow>

      {/* User system prompt — appended to the agent system prompt (desktop parity) */}
      <MobileSettingRow
        label="用户附加指令"
        description="Agent 调用 LLM 时追加到系统提示词末尾，留空则不注入"
      >
        <textarea
          value={agent.systemPrompt ?? ''}
          onChange={(e) => updateAgent({ systemPrompt: e.target.value })}
          rows={5}
          placeholder="在此输入需要附加到系统提示词中的内容，将在每次 Agent 任务调用 LLM 时生效"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="mt-2 w-full resize-none rounded-lg border border-edge bg-zinc-800 px-3 py-2.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-500"
        />
      </MobileSettingRow>

      {/* 审批模型选择 */}
      <MobileSheet
        open={approvalModelPickerOpen}
        onClose={() => setApprovalModelPickerOpen(false)}
        title="选择审批模型"
      >
        <div className="px-4 pb-4">
          <button
            type="button"
            onClick={() => {
              update({
                llmRegistry: {
                  ...(settings.llmRegistry ?? emptyRegistry()),
                  slots: {
                    ...(settings.llmRegistry?.slots ?? emptyRegistry().slots),
                    modelApprovalModelId: '',
                  },
                },
              });
              setApprovalModelPickerOpen(false);
            }}
            className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left text-sm active:bg-state-soft"
          >
            <span className="text-zinc-200">跟随会话模型</span>
            {!settings.llmRegistry?.slots?.modelApprovalModelId && (
              <span className="text-indigo-400 text-xs">当前</span>
            )}
          </button>
          {/* 按提供商（渠道）分组 */}
          {(settings.llmRegistry?.channels ?? []).map((ch) => {
            const reg = settings.llmRegistry ?? emptyRegistry();
            const channelModels = reg.models.filter((m) => m.channelId === ch.id);
            if (channelModels.length === 0) return null;
            const channelDisabled = !ch.enabled;
            return (
              <div key={ch.id} className="mt-1">
                <div className="flex items-center gap-2 px-3 pb-1 pt-2">
                  <span className="truncate text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    {ch.name}
                  </span>
                  {channelDisabled && (
                    <span className="flex-shrink-0 rounded bg-zinc-700 px-1 py-0.5 text-[10px] text-zinc-400">
                      已禁用
                    </span>
                  )}
                </div>
                <div className="divide-y divide-edge-subtle/70">
                  {channelModels.map((m) => {
                    const selected = settings.llmRegistry?.slots?.modelApprovalModelId === m.id;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        disabled={channelDisabled}
                        onClick={() => {
                          const registry = settings.llmRegistry ?? emptyRegistry();
                          update({
                            llmRegistry: {
                              ...registry,
                              slots: { ...registry.slots, modelApprovalModelId: m.id },
                            },
                          });
                          setApprovalModelPickerOpen(false);
                        }}
                        className={`flex w-full items-center justify-between gap-2 px-3 py-3 text-left active:bg-state-soft ${
                          channelDisabled ? "opacity-40" : ""
                        }`}
                      >
                        <span className="min-w-0 truncate text-sm text-zinc-200">
                          {modelLabel(m)}
                        </span>
                        {selected && <span className="flex-shrink-0 text-xs text-indigo-400">当前</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {(settings.llmRegistry?.models ?? []).length === 0 && (
            <p className="py-6 text-center text-sm text-zinc-500">
              还没有可用的模型，请先在「模型服务」中添加
            </p>
          )}
        </div>
      </MobileSheet>
    </div>
  );
}
