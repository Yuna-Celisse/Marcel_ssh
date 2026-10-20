import { memo, useState } from 'react';
import { ChevronDown, Sparkles } from 'lucide-react';
import { getErrorMessage } from '@/lib/errors';
import { findModel, modelLabel } from '@/lib/llmRegistry';
import { openMemorySettings } from '@/lib/memoryNav';
import {
  OP_VERBS,
  opItem,
  scopeLabel,
  scopeOf,
  summarizeOps,
  type MemoryOpRecord,
  type ReflectionNote,
} from '@/lib/memory';
import { useConnectionStore } from '@/stores/connectionStore';
import { useMemoryStore } from '@/stores/memoryStore';
import { useSettingsStore } from '@/stores/settingsStore';

const INTRO_DISMISSED_KEY = 'marcel.memory.reflectionIntroDismissed';

function readIntroDismissed(): boolean {
  try {
    return localStorage.getItem(INTRO_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function writeIntroDismissed() {
  try {
    localStorage.setItem(INTRO_DISMISSED_KEY, '1');
  } catch {
    /* 存不下就下次再显示一遍，无害 */
  }
}

interface Props {
  notes: readonly ReflectionNote[];
  mobile?: boolean;
}

/**
 * 对话里的复盘提示行：「后台复盘 · 记住 2 条」，点开逐条看、逐条撤销或全部撤销。
 *
 * 第一次后台复盘还带一张说明卡（`note.intro`）：这是什么、花多少、用哪个模型、
 * 怎么关。说明卡「知道了」之后在本机不再出现；「关闭后台复盘」直接改设置。
 */
function ReflectionNotes({ notes, mobile = false }: Props) {
  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {notes.map((note) => (
        <NoteLine key={note.id} note={note} mobile={mobile} />
      ))}
    </div>
  );
}

function NoteLine({ note, mobile }: { note: ReflectionNote; mobile: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [introHidden, setIntroHidden] = useState(readIntroDismissed);
  const summary = summarizeOps(note.ops);
  const allReverted = note.ops.length > 0 && !summary;
  const showIntro = note.intro && !introHidden;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const btn = `rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60 active:scale-[0.96] transition disabled:opacity-40 ${
    mobile ? 'px-2.5 py-1.5 text-xs' : 'px-1.5 py-0.5 text-[11px]'
  }`;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {showIntro && <IntroCard mobile={mobile} onDone={() => { writeIntroDismissed(); setIntroHidden(true); }} />}
      {note.ops.length > 0 && (
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-zinc-500">
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-zinc-500" aria-hidden />
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="flex min-w-0 items-center gap-1 hover:text-zinc-300 transition-colors"
            >
              <span>后台复盘 · {allReverted ? '改动已全部撤销' : summary}</span>
              <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
            </button>
            {!allReverted && note.batchId && (
              <button
                type="button"
                className={btn}
                disabled={!!busy}
                onClick={() => void run('batch', () => useMemoryStore.getState().revertBatch(note.batchId!))}
              >
                {busy === 'batch' ? '撤销中…' : '全部撤销'}
              </button>
            )}
          </div>
          {open && (
            <ul className="mt-1 flex flex-col gap-1 pl-5">
              {note.ops.map((op) => (
                <OpRow
                  key={op.id}
                  op={op}
                  btn={btn}
                  busy={busy === `op:${op.id}`}
                  disabled={!!busy}
                  onUndo={() => void run(`op:${op.id}`, () => useMemoryStore.getState().revertOp(op.id))}
                />
              ))}
              <li>
                <button type="button" className={`${btn} -ml-1.5`} onClick={() => openMemorySettings()}>
                  在记忆管理里查看
                </button>
              </li>
            </ul>
          )}
          {error && <p className="mt-1 pl-5 text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}

function OpRow({
  op, btn, busy, disabled, onUndo,
}: {
  op: MemoryOpRecord;
  btn: string;
  busy: boolean;
  disabled: boolean;
  onUndo: () => void;
}) {
  const connections = useConnectionStore((s) => s.connections);
  const item = opItem(op);
  if (!item) return null;
  return (
    <li className="flex min-w-0 items-baseline gap-1.5 text-xs">
      <span className={`shrink-0 ${op.reverted ? 'text-zinc-600' : 'text-zinc-400'}`}>
        {op.reverted ? '已撤销' : OP_VERBS[op.op]}
      </span>
      <span className="shrink-0 text-zinc-600">· {scopeLabel(scopeOf(item), connections)}：</span>
      <span
        className={`min-w-0 flex-1 truncate ${op.reverted ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}
        title={`${item.title}\n${item.content}`}
      >
        {item.title}
      </span>
      {!op.reverted && (
        <button type="button" className={`${btn} shrink-0`} disabled={disabled} onClick={onUndo}>
          {busy ? '撤销中…' : '撤销'}
        </button>
      )}
    </li>
  );
}

function IntroCard({ mobile, onDone }: { mobile: boolean; onDone: () => void }) {
  const registry = useSettingsStore((s) => s.settings.llmRegistry);
  const autoReflect = useSettingsStore((s) => s.settings.memorySettings?.autoReflect ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const memoryModelId = registry?.slots.memoryModelId ?? '';
  const model = registry && memoryModelId ? modelLabel(findModel(registry, memoryModelId)) : '';

  const turnOff = async () => {
    setBusy(true);
    setError(null);
    try {
      const current = useSettingsStore.getState().settings.memorySettings;
      await useSettingsStore.getState().update({
        memorySettings: { enabled: current?.enabled ?? true, autoReflect: false },
      });
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pad = mobile ? 'px-3.5 py-3' : 'px-4 py-3';
  return (
    <div className={`min-w-0 rounded-xl border border-indigo-500/25 bg-indigo-500/[0.06] ${pad}`}>
      <div className="flex items-center gap-1.5 text-[13px] font-medium text-zinc-100">
        <Sparkles className="h-3.5 w-3.5 text-indigo-300" aria-hidden />
        后台复盘
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-zinc-400">
        对话停下来一会儿后，会用{model ? `「${model}」` : '这段对话正在用的模型'}回顾刚才的内容，
        把值得长期记住的习惯、机器上的事实和踩过的坑记下来，下次在这台机器上自动带给 Agent。
        记下的东西会在对话里列出来，每一条都能撤销。
      </p>
      <p className="mt-1 text-xs leading-relaxed text-zinc-500">
        每次复盘是一次简短的模型调用，花费计入本会话的 token 用量。
        可以在「设置 → 记忆」里换一个便宜的记忆模型，或者关掉它。
      </p>
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
      <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2">
        {autoReflect ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void turnOff()}
            className={`rounded-lg text-zinc-300 hover:bg-zinc-700/60 active:scale-[0.97] transition disabled:opacity-40 ${mobile ? 'px-3 py-2 text-xs' : 'px-3 py-1 text-xs'}`}
          >
            {busy ? '正在关闭…' : '关闭后台复盘'}
          </button>
        ) : (
          <span className="text-xs text-zinc-500">已关闭，可在「设置 → 记忆」重新打开</span>
        )}
        <button
          type="button"
          onClick={() => openMemorySettings()}
          className={`rounded-lg text-zinc-300 hover:bg-zinc-700/60 active:scale-[0.97] transition ${mobile ? 'px-3 py-2 text-xs' : 'px-3 py-1 text-xs'}`}
        >
          记忆设置
        </button>
        <button
          type="button"
          onClick={onDone}
          className={`rounded-lg bg-indigo-600 font-medium text-white hover:bg-indigo-500 active:scale-[0.97] transition ${mobile ? 'px-3.5 py-2 text-xs' : 'px-3 py-1 text-xs'}`}
        >
          知道了
        </button>
      </div>
    </div>
  );
}

export default memo(ReflectionNotes);
