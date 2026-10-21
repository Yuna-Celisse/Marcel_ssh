import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import AgentMessageList, { type AgentMessageListHandle } from '@/components/agent/AgentMessageList';
import { RunStatusLine } from '@/components/agent/AgentRunStatus';
import type { AgentMessage } from '@/lib/types';
import { getErrorMessage } from '@/lib/errors';
import { scopeLabel, type ScopeRef } from '@/lib/memory';
import { useConnectionStore } from '@/stores/connectionStore';
import { useMemoryAssistantStore, type AssistantReplyEntry } from '@/stores/memoryAssistantStore';
import AssistantModelPicker from './AssistantModelPicker';
import { assistantMessages } from './assistantMessages';
import { assistantSuggestions } from './assistantSuggestions';

interface Props {
  /** 管理页当前筛到的作用域：助手默认围绕它整理。 */
  focus: ScopeRef | null;
  mobile?: boolean;
}

/** 输入框最高长到多少 px（约 5 行），再多就在框里滚。 */
const INPUT_MAX_HEIGHT = 120;

/**
 * 整理助手的对话视图：上面是对话记录，下面是输入框。两端共用（`mobile` 只调尺寸与发送方式）。
 *
 * **滚动只有一层**：对话记录是这个视图里唯一的滚动容器，输入框钉在它下面，不参与滚动；
 * 视图自己填满宿主给的高度（桌面是弹窗、手机是底部面板），不再有「页面一个滚动条、
 * 里面又一个」。
 *
 * **对话记录直接用 Agent 的消息列表渲染**（`assistantMessages` 把记录翻译成 Agent 的消息）：
 * 气泡、工具卡、记忆卡、分组、展开、流式跟随都是同一套，不另画一份。跟随规则也由它负责：
 * 在底部就跟着新内容走，往上翻着读就不抢位置；这里只在自己发送时叫它回到底部。
 */
export default function MemoryAssistantPanel({ focus, mobile = false }: Props) {
  const entries = useMemoryAssistantStore((s) => s.entries);
  const runningId = useMemoryAssistantStore((s) => s.runningId);
  const connections = useConnectionStore((s) => s.connections);
  const [draft, setDraft] = useState('');
  const listRef = useRef<AgentMessageListHandle | null>(null);
  const focusLabel = focus ? scopeLabel(focus, connections) : null;
  const running = runningId !== null;

  const messages = useMemo(() => assistantMessages(entries, connections), [entries, connections]);
  // 撤销整次改动的入口挂在最近一次有改动的回复上；更早的每张记忆卡自己有「撤销」。
  const lastChange = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.role === 'assistant' && e.ops.length > 0) return e;
    }
    return null;
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
    listRef.current?.followBottom();
    void useMemoryAssistantStore.getState().send(text, focus);
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <AssistantModelPicker mobile={mobile} />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {entries.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className={`${mobile ? 'text-sm' : 'text-[13px]'} leading-relaxed text-zinc-400`}>
              不用一条条手动改：告诉它要怎么整理，它会查看记忆、翻以前的会话，然后一次改好。
              每次的改动都能一键撤销。
              {focusLabel && <span className="text-zinc-500">（当前围绕 {focusLabel}）</span>}
            </p>
            <div className="flex flex-wrap gap-2">
              {assistantSuggestions(focusLabel).map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => send(s.prompt)}
                  className={`rounded-full border border-zinc-700 bg-zinc-800/60 text-zinc-300 transition hover:border-indigo-500/50 hover:text-zinc-100 active:scale-[0.97] ${
                    mobile ? 'px-3 py-2 text-xs' : 'px-3 py-1 text-xs'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <AgentMessageList
              messages={messages}
              listRef={listRef}
              foldTurns={false}
              onCopy={copyMessage}
              alwaysShowActions={mobile}
            />
            {running && <RunStatusLine label="整理中" />}
            {lastChange && <BatchUndoBar entry={lastChange} mobile={mobile} />}
          </>
        )}
      </div>

      <div className={`flex-shrink-0 border-t px-3 pb-3 pt-2.5 ${mobile ? 'border-zinc-800' : 'border-zinc-700/70'}`}>
        {/* 药丸输入框：外圈圆角 = 内圈按钮半径 + 内边距，按钮是正圆，嵌进去才同心。
            全局 :focus-visible 的描边会在圆角框里再画出一个方框，且盖得过 Tailwind 的 outline-none
            （它在 layer 里），所以靠 `.agent-input` 这条全局规则关掉，外框的 border 是唯一的焦点提示。
            底色与宿主面板错开一档（弹窗 zinc-800 → 输入框 zinc-900；手机面板 zinc-900 → zinc-800）。 */}
        <div
          className={`agent-input flex items-end gap-1 rounded-[1.375rem] border border-zinc-700 p-1.5 pl-4 transition-colors focus-within:border-indigo-500 ${
            mobile ? 'bg-zinc-800' : 'bg-zinc-900'
          }`}
        >
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
            className="min-h-8 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-sm leading-5 text-zinc-100 placeholder:text-zinc-500 outline-none focus:ring-0"
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
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              onClick={() => useMemoryAssistantStore.getState().clear()}
              className="text-xs text-zinc-500 transition-colors hover:text-zinc-300"
            >
              清空对话
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function copyMessage(message: AgentMessage) {
  void navigator.clipboard?.writeText(message.content).catch(() => undefined);
}

/** 「这次改了 N 处 · 撤销这次」：一键回退这次请求的全部改动。 */
function BatchUndoBar({
  entry,
  mobile,
}: {
  entry: AssistantReplyEntry;
  mobile: boolean;
}) {
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
    <div className="mt-1 flex min-w-0 flex-col gap-1 text-xs">
      <div className="flex items-center gap-2 px-1 text-zinc-500">
        <span>{entry.reverted ? `已撤销这次的 ${entry.ops.length} 处改动` : `这次改了 ${entry.ops.length} 处`}</span>
        {canUndo && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void undo()}
            className={`rounded-md text-zinc-300 transition hover:bg-zinc-700/60 active:scale-[0.96] disabled:opacity-40 ${
              mobile ? 'px-2.5 py-1.5' : 'px-2 py-0.5'
            }`}
          >
            {busy ? '撤销中…' : '撤销这次'}
          </button>
        )}
      </div>
      {error && <p className="px-1 text-red-400">{error}</p>}
    </div>
  );
}
