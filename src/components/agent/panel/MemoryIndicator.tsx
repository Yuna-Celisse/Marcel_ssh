import { useState } from 'react';
import { Bookmark } from 'lucide-react';
import { useSessionStore } from '@/stores/sessionStore';
import { InjectedMemoryList } from '@/components/memory/InjectedMemories';
import { useInjectedMemories } from '@/components/memory/useInjectedMemories';

/**
 * Agent 面板头部的「记忆 N」：这段对话带着几条记忆，点开看是哪些、去管理。
 *
 * 让「模型这次到底知道什么」看得见 —— 记忆影响 Agent 的判断，用户得能随时核对。
 */
export function MemoryIndicator({ conversationId }: { conversationId: string | null }) {
  const [open, setOpen] = useState(false);
  const session = useSessionStore((s) => (s.activeSessionId ? (s.sessions[s.activeSessionId] ?? null) : null));
  const { data, error } = useInjectedMemories(conversationId, session?.id ?? null);
  const count = data?.items.length ?? 0;
  const disabled = data ? !data.enabled : false;
  const focus = session?.configId ? { scope: 'host' as const, key: session.configId } : undefined;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="这段对话带着的记忆"
        title={disabled ? '长期记忆已关闭' : `这段对话带着 ${count} 条记忆`}
        className={`flex h-7 items-center gap-1 rounded px-1.5 text-xs transition-colors active:scale-95 ${
          open ? 'bg-zinc-700 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100'
        } ${disabled ? 'opacity-50' : ''}`}
      >
        <Bookmark className="h-3.5 w-3.5" aria-hidden />
        {!disabled && count > 0 && <span className="tabular-nums">{count}</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 max-h-[min(28rem,70vh)] w-72 overflow-y-auto rounded-xl border border-zinc-700 bg-zinc-800 p-3 text-xs shadow-2xl animate-fadeIn">
            <div className="mb-2 border-b border-zinc-700 pb-1.5 font-semibold text-zinc-300">记忆</div>
            <InjectedMemoryList data={data} error={error} focus={focus} onNavigate={() => setOpen(false)} />
          </div>
        </>
      )}
    </div>
  );
}
