import { memo, useEffect, useMemo, useState } from 'react';
import { Bookmark } from 'lucide-react';
import type { AgentMessage } from '@/lib/types';
import { getErrorMessage } from '@/lib/errors';
import { collectPlatformHints, isMobilePlatform } from '@/platform';
import type { MemoryItem, MemoryOpKind } from '@/lib/memory';
import { useMemoryStore } from '@/stores/memoryStore';
import MemoryEditDialog from '@/components/memory/MemoryEditDialog';
import ToolCallCard from './ToolCallCard';

/** 后端 `memory` 工具结果里的 `metadata.memory`（`agent/tools/memory.rs::op_metadata`）。 */
interface MemoryToolMeta {
  op: MemoryOpKind;
  opId: number;
  batchId: string;
  memoryId: string;
  scopeLabel: string;
  before: MemoryItem | null;
  after: MemoryItem | null;
}

function readMeta(message: AgentMessage): MemoryToolMeta | null {
  const raw = message.toolResult?.metadata?.memory as Partial<MemoryToolMeta> | undefined;
  if (!raw || typeof raw.opId !== 'number' || typeof raw.batchId !== 'string') return null;
  return raw as MemoryToolMeta;
}

const HEADLINE: Record<MemoryOpKind, string> = {
  add: '已记住',
  update: '已更新记忆',
  delete: '已删除记忆',
};

/**
 * 对话里 agent 写记忆的那张卡片：「已记住 · 机器「web-01」」+ 标题，点开看正文；
 * 右侧「撤销」「编辑」。撤销后卡片划掉并标「已撤销」——而且后台复盘不会再把它
 * 加回来（后端记了拒绝）。
 *
 * 失败的调用（标题重复、作用域不可用……）不走这里，退回通用工具卡片显示原因。
 */
function MemoryToolView({ message }: { message: AgentMessage }) {
  const meta = readMeta(message);
  const success = message.toolResult?.success === true;
  if (!meta || !success) {
    return (
      <div className="flex min-w-0 justify-start">
        <div className="min-w-0 max-w-[85%]">
          <ToolCallCard message={message} />
        </div>
      </div>
    );
  }
  return <MemoryCard meta={meta} />;
}

function MemoryCard({ meta }: { meta: MemoryToolMeta }) {
  const mobile = useMemo(() => isMobilePlatform(collectPlatformHints()), []);
  const batch = useMemoryStore((s) => s.batches[meta.batchId]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [localReverted, setLocalReverted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<MemoryItem | null>(null);

  useEffect(() => {
    if (!batch) void useMemoryStore.getState().loadBatch(meta.batchId);
  }, [batch, meta.batchId]);

  const rec = batch?.find((o) => o.id === meta.opId);
  const reverted = localReverted || rec?.reverted === true;
  const item = meta.after ?? meta.before;
  const title = item?.title ?? meta.memoryId;

  const undo = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await useMemoryStore.getState().revertOp(meta.opId);
      setLocalReverted(true);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const edit = async () => {
    setError(null);
    await useMemoryStore.getState().loadOverview();
    const current = useMemoryStore.getState().overview?.items.find((m) => m.id === meta.memoryId);
    if (current) setEditing(current);
    else setError('这条记忆已经不在了（被删除或撤销）');
  };

  const btn = `rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60 active:scale-[0.96] transition disabled:opacity-40 ${
    mobile ? 'px-2.5 py-1.5 text-xs' : 'px-2 py-0.5 text-[11px]'
  }`;

  return (
    <div className="flex min-w-0 justify-start">
      <div
        className={`min-w-0 max-w-[85%] rounded-lg border px-3 py-2 transition-colors ${
          reverted ? 'border-zinc-800 bg-transparent' : 'border-zinc-700/60 bg-zinc-800/40'
        }`}
      >
        <div className="flex min-w-0 items-center gap-2">
          <Bookmark
            className={`h-3.5 w-3.5 shrink-0 ${reverted ? 'text-zinc-600' : 'text-indigo-400'}`}
            aria-hidden
          />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left text-xs"
          >
            <span className={`shrink-0 font-medium ${reverted ? 'text-zinc-500' : 'text-zinc-300'}`}>
              {reverted ? '已撤销' : HEADLINE[meta.op]}
            </span>
            <span className="shrink-0 text-zinc-500">· {meta.scopeLabel}：</span>
            <span
              className={`min-w-0 truncate ${reverted ? 'text-zinc-500 line-through' : 'text-zinc-200'}`}
              title={title}
            >
              {title}
            </span>
          </button>
          <div className="flex shrink-0 items-center gap-0.5">
            {!reverted && meta.op !== 'delete' && (
              <button type="button" className={btn} onClick={() => void edit()}>
                编辑
              </button>
            )}
            {!reverted && (
              <button type="button" className={btn} disabled={busy} onClick={() => void undo()}>
                {busy ? '撤销中…' : '撤销'}
              </button>
            )}
          </div>
        </div>
        {open && item && (
          <div className="mt-1.5 whitespace-pre-wrap break-words pl-[22px] text-xs leading-relaxed text-zinc-400">
            {meta.op === 'update' && meta.before && meta.before.content !== item.content ? (
              <>
                <span className="text-zinc-600 line-through">{meta.before.content}</span>
                {'\n'}
                {item.content}
              </>
            ) : (
              item.content
            )}
          </div>
        )}
        {error && <p className="mt-1 pl-[22px] text-xs text-red-400">{error}</p>}
      </div>
      <MemoryEditDialog open={!!editing} item={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

export default memo(MemoryToolView);
