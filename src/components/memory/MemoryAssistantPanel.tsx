import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, Loader2, Square, Wand2 } from 'lucide-react';
import MarkdownBody from '@/components/agent/MarkdownBody';
import { getErrorMessage } from '@/lib/errors';
import { OP_VERBS, opItem, scopeLabel, scopeOf, type ScopeRef } from '@/lib/memory';
import { useConnectionStore } from '@/stores/connectionStore';
import { useMemoryAssistantStore, type AssistantEntry } from '@/stores/memoryAssistantStore';

interface Props {
  /** 管理页当前筛到的作用域：助手默认围绕它整理。 */
  focus: ScopeRef | null;
  mobile?: boolean;
}

/** 输入框最高长到多少 px（约 5 行），再多就在框里滚。 */
const INPUT_MAX_HEIGHT = 120;

function suggestions(focusLabel: string | null): { label: string; prompt: string }[] {
  const where = focusLabel ?? '各台机器';
  const scope = focusLabel ? `${focusLabel}的` : '';
  return [
    {
      label: '从历史会话里整理',
      prompt: `翻一翻${where}以前的会话，把值得长期记住的习惯、环境事实和经验整理进记忆；已经记过的不要重复。`,
    },
    {
      label: '合并重复、删掉过时的',
      prompt: `检查${scope}记忆：合并重复的，删掉已经过时或互相矛盾的，标题改得一眼能认出来。`,
    },
    {
      label: '查查有没有记了不该记的',
      prompt: `检查${scope}记忆里有没有密码、密钥、token 这类不该保存的内容；有的话删掉，或者改成只记它放在哪里。`,
    },
  ];
}

/**
 * 整理助手：在记忆管理页里用一句话批量整理记忆。两端共用（`mobile` 只调尺寸与发送方式）。
 */
export default function MemoryAssistantPanel({ focus, mobile = false }: Props) {
  const entries = useMemoryAssistantStore((s) => s.entries);
  const runningId = useMemoryAssistantStore((s) => s.runningId);
  const connections = useConnectionStore((s) => s.connections);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const focusLabel = focus ? scopeLabel(focus, connections) : null;
  const running = runningId !== null;

  // 跟随到底部——但用户往上翻着读的时候不抢滚动位置。
  const stickToBottom = useRef(true);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [entries]);

  // 输入框随内容长高（到上限后内部滚动）。
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, INPUT_MAX_HEIGHT)}px`;
  }, [draft]);

  const send = (text: string) => {
    if (!text.trim() || running) return;
    setDraft('');
    void useMemoryAssistantStore.getState().send(text, focus);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {entries.length === 0 ? (
        <div className="flex flex-col gap-2.5">
          <p className={`${mobile ? 'text-sm' : 'text-xs'} leading-relaxed text-zinc-400`}>
            不用一条条手动改：告诉它要怎么整理，它会查看记忆、翻以前的会话，然后一次改好。
            每次的改动都能一键撤销。
            {focusLabel && <span className="text-zinc-500">（当前围绕 {focusLabel}）</span>}
          </p>
          <div className="flex flex-wrap gap-2">
            {suggestions(focusLabel).map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => send(s.prompt)}
                className={`rounded-full border border-zinc-700 bg-zinc-800/60 text-zinc-300 hover:border-indigo-500/50 hover:text-zinc-100 active:scale-[0.97] transition ${
                  mobile ? 'px-3 py-2 text-xs' : 'px-3 py-1 text-xs'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
          }}
          className={`flex flex-col gap-3 overflow-y-auto overscroll-contain ${mobile ? 'max-h-[50dvh]' : 'max-h-[28rem]'} pr-1`}
        >
          {entries.map((e) => (
            <EntryView key={e.id} entry={e} mobile={mobile} />
          ))}
        </div>
      )}

      {/* 药丸输入框：外圈圆角 = 内圈按钮半径 + 内边距，按钮是正圆，嵌进去才同心。
          outline 要显式关掉：全局 :focus-visible 的描边会在圆角框里再画出一个方框。 */}
      <div className="flex items-end gap-1 rounded-[1.375rem] border border-zinc-700 bg-zinc-800 p-1.5 pl-4 transition-colors focus-within:border-indigo-500">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (!mobile && e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(draft);
            }
          }}
          rows={1}
          placeholder={focusLabel ? `要怎么整理 ${focusLabel} 的记忆？` : '要怎么整理记忆？'}
          className="min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-sm leading-5 text-zinc-100 placeholder:text-zinc-500 outline-none focus:outline-none focus:ring-0 focus-visible:outline-none"
        />
        {running ? (
          <button
            type="button"
            onClick={() => void useMemoryAssistantStore.getState().cancel()}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-red-600 text-white transition hover:bg-red-500 active:scale-90"
            aria-label="停止"
            title="停止"
          >
            <Square className="h-3 w-3" fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => send(draft)}
            disabled={!draft.trim()}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white transition hover:bg-indigo-500 active:scale-90 disabled:bg-zinc-700 disabled:text-zinc-500 disabled:active:scale-100"
            aria-label="发送"
            title="发送"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        )}
      </div>
      {entries.length > 0 && !running && (
        <button
          type="button"
          onClick={() => useMemoryAssistantStore.getState().clear()}
          className="self-end text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          清空对话
        </button>
      )}
    </div>
  );
}

const EntryView = memo(function EntryView({ entry, mobile }: { entry: AssistantEntry; mobile: boolean }) {
  if (entry.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-indigo-600/80 px-3 py-2 text-sm text-white">
          {entry.text}
        </div>
      </div>
    );
  }
  return <ReplyView entry={entry} mobile={mobile} />;
});

function ReplyView({ entry, mobile }: { entry: Extract<AssistantEntry, { role: 'assistant' }>; mobile: boolean }) {
  const connections = useConnectionStore((s) => s.connections);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = entry.ops.filter((o) => !o.reverted);
  const canUndo = !!entry.batchId && entry.status !== 'running' && !entry.reverted && live.length > 0;

  const undo = async () => {
    setBusy(true);
    setError(null);
    try {
      await useMemoryAssistantStore.getState().undo(entry.id);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-start gap-2">
        <Wand2 className="mt-0.5 h-4 w-4 shrink-0 text-indigo-300" aria-hidden />
        <div className="min-w-0 flex-1 text-sm text-zinc-200">
          {entry.text ? (
            <MarkdownBody content={entry.text} sync />
          ) : entry.status === 'running' ? null : (
            <span className="text-zinc-500">{entry.status === 'cancelled' ? '已停止。' : ''}</span>
          )}
          {entry.status === 'running' && (
            <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-500">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              {entry.activity ? `正在${entry.activity}…` : '正在想…'}
            </div>
          )}
          {entry.status === 'cancelled' && entry.text && <div className="mt-1 text-xs text-zinc-500">已停止。</div>}
          {entry.error && <div className="mt-1 text-xs text-red-400">{entry.error}</div>}
        </div>
      </div>
      {entry.ops.length > 0 && (
        <div className="ml-6 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="text-zinc-400">
              {entry.reverted ? `已撤销这次的 ${entry.ops.length} 处改动` : `这次改了 ${entry.ops.length} 处`}
            </span>
            {canUndo && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void undo()}
                className={`rounded-md text-zinc-300 hover:bg-zinc-700/60 active:scale-[0.96] transition disabled:opacity-40 ${
                  mobile ? 'px-2.5 py-1.5' : 'px-2 py-0.5'
                }`}
              >
                {busy ? '撤销中…' : '撤销这次'}
              </button>
            )}
          </div>
          <ul className="mt-1.5 flex flex-col gap-0.5">
            {entry.ops.map((op) => {
              const item = opItem(op);
              if (!item) return null;
              const gone = entry.reverted || op.reverted;
              return (
                <li key={op.id} className="flex min-w-0 items-baseline gap-1.5 text-xs" title={item.content}>
                  <span className={`shrink-0 ${gone ? 'text-zinc-600' : 'text-zinc-400'}`}>{OP_VERBS[op.op]}</span>
                  <span className="shrink-0 text-zinc-600">· {scopeLabel(scopeOf(item), connections)}：</span>
                  <span className={`min-w-0 truncate ${gone ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}>
                    {item.title}
                  </span>
                </li>
              );
            })}
          </ul>
          {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
        </div>
      )}
    </div>
  );
}
