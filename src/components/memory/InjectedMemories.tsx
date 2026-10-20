import { useMemo } from 'react';
import {
  KIND_LABELS,
  scopeId,
  scopeLabel,
  scopeOf,
  type InjectedMemories,
  type MemoryItem,
  type ScopeRef,
} from '@/lib/memory';
import { openMemorySettings } from '@/lib/memoryNav';
import { useConnectionStore } from '@/stores/connectionStore';

interface ListProps {
  data: InjectedMemories | null;
  error: string | null;
  /** 「管理记忆」跳到这台机器的作用域。 */
  focus?: ScopeRef;
  mobile?: boolean;
  onNavigate?: () => void;
}

/** 弹层 / 底部面板里的列表：按作用域分组，只列标题，点「管理记忆」去管理页。 */
export function InjectedMemoryList({ data, error, focus, mobile = false, onNavigate }: ListProps) {
  const connections = useConnectionStore((s) => s.connections);
  const groups = useMemo(() => {
    const out: { ref: ScopeRef; items: MemoryItem[] }[] = [];
    for (const m of data?.items ?? []) {
      const ref = scopeOf(m);
      const hit = out.find((g) => scopeId(g.ref) === scopeId(ref));
      if (hit) hit.items.push(m);
      else out.push({ ref, items: [m] });
    }
    return out;
  }, [data]);

  if (error) return <p className="text-red-400">{error}</p>;
  if (!data) return <p className="text-zinc-500">读取中…</p>;
  if (!data.enabled) {
    return (
      <div className="flex flex-col gap-2">
        <p className="leading-relaxed text-zinc-400">长期记忆已关闭，对话不会带上任何记忆，Agent 也不会再记新的。</p>
        <ManageLink focus={focus} mobile={mobile} onNavigate={onNavigate} label="去打开" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2.5">
      <p className="leading-relaxed text-zinc-500">
        {data.frozen
          ? '这段对话开始时带给 Agent 的记忆。之后新记的从下一段对话起生效；你手动改的下一轮就生效。'
          : '开始对话时会带给 Agent 的记忆。'}
      </p>
      {groups.length === 0 ? (
        <p className="leading-relaxed text-zinc-400">
          {data.frozen && data.pending > 0
            ? '这段对话开始时还没有记忆，所以一条都没带。'
            : data.elsewhere > 0
              ? '这台机器（和它所在的分组）还没有记忆。'
              : '还没有记忆。Agent 会在对话中记下值得长期记住的东西，你也可以在记忆管理里手动添加。'}
        </p>
      ) : (
        groups.map((g) => (
          <div key={scopeId(g.ref)} className="flex flex-col gap-1">
            <div className="font-medium text-zinc-300">
              {scopeLabel(g.ref, connections)}
              <span className="ml-1.5 font-normal text-zinc-500">{g.items.length}</span>
            </div>
            <ul className="flex flex-col gap-0.5">
              {g.items.map((m) => (
                <li key={m.id} className="flex min-w-0 items-baseline gap-1.5" title={m.content}>
                  <span className="shrink-0 text-zinc-600">{KIND_LABELS[m.kind]}</span>
                  <span className="min-w-0 truncate text-zinc-300">{m.title}</span>
                  {m.pinned && <span className="shrink-0 text-indigo-400/80">置顶</span>}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
      {data.pending > 0 && (
        <p className="leading-relaxed text-zinc-500">
          另有 {data.pending} 条是这段对话开始后才记下的，下一段对话起会带上（压缩上下文后也会刷新）。
        </p>
      )}
      {data.elsewhere > 0 && (
        <p className="leading-relaxed text-zinc-500">
          记忆管理里另有 {data.elsewhere} 条属于别的机器或分组，不会带进这段对话。
        </p>
      )}
      {data.removedSince > 0 && (
        <p className="text-zinc-500">另有 {data.removedSince} 条已被删除，下一轮起不再带。</p>
      )}
      <ManageLink focus={focus} mobile={mobile} onNavigate={onNavigate} label="管理记忆" />
    </div>
  );
}

function ManageLink({
  focus, mobile, onNavigate, label,
}: { focus?: ScopeRef; mobile: boolean; onNavigate?: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        onNavigate?.();
        openMemorySettings(focus);
      }}
      className={`self-start rounded-lg text-indigo-300 hover:bg-indigo-500/10 active:scale-[0.97] transition ${
        mobile ? '-ml-2 px-2 py-1.5' : '-ml-1.5 px-1.5 py-0.5'
      }`}
    >
      {label} →
    </button>
  );
}
