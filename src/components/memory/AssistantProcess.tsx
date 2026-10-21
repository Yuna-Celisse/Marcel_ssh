import { useState } from 'react';
import { Check, ChevronRight, Loader2, X } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import {
  OP_VERBS,
  opItem,
  scopeLabel,
  scopeOf,
  summarizeSteps,
  type AssistantStep,
  type MemoryOpRecord,
} from '@/lib/memory';
import { useConnectionStore } from '@/stores/connectionStore';
import { useMemoryAssistantStore } from '@/stores/memoryAssistantStore';

/**
 * 整理过程：助手每一步看了什么、读了哪段会话、结果如何。
 *
 * 助手会翻很多记忆和历史会话、最后才改几处——只看最终那几行改动，用户不知道它凭什么这么改、
 * 有没有漏看。所以过程摆出来：运行中实时展开，结束后收成一行汇总，点开能看每一步
 * 和它发起这一步之前说的话。
 */
export function StepLog({ steps, running }: { steps: readonly AssistantStep[]; running: boolean }) {
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? running;
  const current = steps.find((s) => s.running);
  const done = steps.filter((s) => !s.running).length;
  const failed = steps.filter((s) => !s.running && !s.ok).length;

  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={() => setUserOpen(!open)}
        aria-expanded={open}
        className="group flex min-w-0 max-w-full items-center gap-1.5 text-left text-xs text-zinc-500 transition-colors hover:text-zinc-300"
      >
        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
        {running ? (
          <>
            <Loader2 className="h-3 w-3 shrink-0 animate-spin" aria-hidden />
            <span className="min-w-0 truncate">
              {current ? `正在${current.label}${current.detail ? ` · ${current.detail}` : ''}…` : '正在想…'}
              {done > 0 && <span className="text-zinc-600"> · 已做 {done} 步</span>}
            </span>
          </>
        ) : (
          <span className="min-w-0 truncate">
            整理过程 · {steps.length} 步 · {summarizeSteps(steps)}
            {failed > 0 && <span className="text-red-400"> · {failed} 步失败</span>}
          </span>
        )}
      </button>
      {open && steps.length > 0 && (
        <ol className="mt-1.5 flex flex-col gap-2 border-l border-zinc-700/50 pl-3">
          {steps.map((s) => (
            <li key={s.id} className="flex min-w-0 gap-2 text-xs">
              <span className="mt-0.5 shrink-0" aria-hidden>
                {s.running ? (
                  <Loader2 className="h-3 w-3 animate-spin text-zinc-500" />
                ) : s.ok ? (
                  <Check className="h-3 w-3 text-emerald-400/80" />
                ) : (
                  <X className="h-3 w-3 text-red-400" />
                )}
              </span>
              <div className="min-w-0 flex-1 leading-relaxed">
                {s.note && <p className="mb-0.5 break-words text-zinc-500">{s.note}</p>}
                <div className="break-words">
                  <span className="text-zinc-300">{s.label}</span>
                  {s.detail && <span className="text-zinc-500"> · {s.detail}</span>}
                </div>
                {s.outcome && (
                  <div className={`break-words ${s.ok ? 'text-zinc-500' : 'text-red-400'}`}>→ {s.outcome}</div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** 这次改了哪些：逐条可展开看正文（更新的显示改前改后），也能只撤销其中一条。 */
export function OpList({
  entryId,
  ops,
  reverted,
  mobile,
}: {
  entryId: string;
  ops: readonly MemoryOpRecord[];
  reverted: boolean;
  mobile: boolean;
}) {
  return (
    <ul className="mt-1.5 flex flex-col gap-0.5">
      {ops.map((op) => (
        <OpRow key={op.id} entryId={entryId} op={op} reverted={reverted} mobile={mobile} />
      ))}
    </ul>
  );
}

function OpRow({
  entryId,
  op,
  reverted,
  mobile,
}: {
  entryId: string;
  op: MemoryOpRecord;
  reverted: boolean;
  mobile: boolean;
}) {
  const connections = useConnectionStore((s) => s.connections);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const item = opItem(op);
  if (!item) return null;
  const gone = reverted || op.reverted;
  const changed = op.op === 'update' && op.before && op.after && op.before.content !== op.after.content;

  const undo = async () => {
    setBusy(true);
    setError(null);
    try {
      await useMemoryAssistantStore.getState().undoOp(entryId, op.id);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="min-w-0 text-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full min-w-0 items-baseline gap-1.5 text-left transition-colors hover:text-zinc-100"
      >
        <ChevronRight
          className={`h-3 w-3 shrink-0 self-center text-zinc-600 transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        />
        <span className={`shrink-0 ${gone ? 'text-zinc-600' : 'text-zinc-400'}`}>{OP_VERBS[op.op]}</span>
        <span className="shrink-0 text-zinc-600">· {scopeLabel(scopeOf(item), connections)}：</span>
        <span className={`min-w-0 truncate ${gone ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}>{item.title}</span>
      </button>
      {open && (
        <div className="ml-[18px] mt-1 border-l border-zinc-700/50 pl-3">
          <div className="whitespace-pre-wrap break-words leading-relaxed text-zinc-400">
            {changed ? (
              <>
                <span className="text-zinc-600 line-through">{op.before!.content}</span>
                <br />
                {op.after!.content}
              </>
            ) : (
              item.content
            )}
          </div>
          {!gone && (
            <div className="-ml-1.5 mt-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => void undo()}
                className={`rounded-md text-zinc-400 transition hover:bg-zinc-700/60 hover:text-zinc-100 active:scale-[0.96] disabled:opacity-40 ${
                  mobile ? 'px-2.5 py-1.5' : 'px-2 py-0.5'
                }`}
              >
                {busy ? '撤销中…' : '只撤销这一条'}
              </button>
            </div>
          )}
          {error && <p className="mt-1 text-red-400">{error}</p>}
        </div>
      )}
    </li>
  );
}
