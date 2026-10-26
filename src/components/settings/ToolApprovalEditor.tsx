import { useState } from 'react';
import { ChevronRight, Plus, X } from 'lucide-react';
import {
  COMMAND_TOOL,
  TOOL_LEVELS,
  addTool,
  addableTools,
  listedTools,
  removeTool,
  setToolLevel,
  toolLabel,
  type ToolApprovalLevels,
} from '@/lib/toolApproval';
import { LevelSelect } from './RiskLevelSelect';

/**
 * 「需要审批的工具」（桌面与手机共用）：点名哪些内置工具执行前要审批，并给每个工具选档位。
 *
 * 第一行永远是「执行命令 bash」：它不用在这里选档位 —— 命令要不要问你完全由命令确认方式和
 * 命令规则决定，这一行只负责把它摆出来，并带用户去看那些规则（`onOpenCommandRules`）。
 * 其余工具想不再审批，就从列表里移掉；之后随时能从「添加工具」里加回来。
 * 档位含义与命令风险规则是同一套，所以下拉也是同一个组件。
 */
export function ToolApprovalEditor({
  levels,
  onChange,
  onOpenCommandRules,
  compact,
}: {
  levels: ToolApprovalLevels;
  onChange: (next: ToolApprovalLevels) => void;
  /** 点 bash 那行的「按命令规则」：调用方负责滚到命令规则那一块。 */
  onOpenCommandRules?: () => void;
  compact?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  const listed = listedTools(levels);
  const addable = addableTools(levels);
  const slot = compact ? 'w-8' : 'w-6';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">
          {COMMAND_TOOL.label}
          <span className="ml-1.5 font-mono text-[11px] text-zinc-500">
            {COMMAND_TOOL.name}
          </span>
        </span>
        <button
          type="button"
          onClick={onOpenCommandRules}
          title="命令要不要问你，由命令确认方式和命令规则决定"
          className={`flex flex-shrink-0 items-center justify-between rounded-lg border border-edge bg-zinc-800 text-zinc-300 hover:bg-state-mid active:bg-state-mid ${
            compact ? 'px-2.5 py-2 text-sm' : 'w-32 px-2.5 py-1.5 text-xs'
          }`}
        >
          按命令规则
          <ChevronRight className="ml-1 h-3.5 w-3.5 text-zinc-500" />
        </button>
        <span className={`${slot} flex-shrink-0`} />
      </div>
      {listed.map((name) => (
        <div key={name} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm text-zinc-100">
            {toolLabel(name)}
            <span className="ml-1.5 font-mono text-[11px] text-zinc-500">
              {name}
            </span>
          </span>
          <LevelSelect
            ariaLabel={`${toolLabel(name)}：审批档位`}
            value={levels[name]}
            options={TOOL_LEVELS}
            defaultLevel="Approval"
            compact={compact}
            onChange={(level) => onChange(setToolLevel(levels, name, level))}
          />
          <button
            type="button"
            onClick={() => onChange(removeTool(levels, name))}
            className={`flex flex-shrink-0 items-center justify-center text-zinc-500 hover:text-red-400 active:text-red-400 ${
              compact ? 'p-2' : 'p-1'
            }`}
            aria-label={`${toolLabel(name)}不再审批`}
            title="从列表移除，这个工具不再额外审批"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}

      {adding ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          {addable.length === 0 && (
            <span className="text-xs text-zinc-500">
              没有更多可添加的工具了
            </span>
          )}
          {addable.map((t) => (
            <button
              key={t.name}
              type="button"
              onClick={() => {
                onChange(addTool(levels, t.name));
                setAdding(false);
              }}
              className={`rounded-lg border border-dashed border-edge-strong text-zinc-300 hover:border-solid hover:bg-zinc-800 active:bg-zinc-800 ${
                compact ? 'px-3 py-2 text-sm' : 'px-2.5 py-1 text-xs'
              }`}
            >
              + {t.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAdding(false)}
            className={`text-zinc-500 hover:text-zinc-300 active:text-zinc-300 ${
              compact ? 'px-2 py-2 text-sm' : 'px-1.5 text-xs'
            }`}
          >
            取消
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className={`inline-flex items-center gap-1 rounded-lg bg-zinc-800 text-zinc-200 hover:bg-state-mid active:bg-state-mid ${
            compact ? 'px-3 py-2 text-sm' : 'px-2.5 py-1 text-xs'
          }`}
        >
          <Plus className="h-3.5 w-3.5" />
          添加工具
        </button>
      )}
    </div>
  );
}
