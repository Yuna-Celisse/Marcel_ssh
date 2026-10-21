/**
 * 「Beta」小标：标在还在测试、默认不开启的功能名字后面。
 * 只说明状态，不承诺什么时候转正；悬停时多一句解释。
 */
export default function BetaTag({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-none text-zinc-500 ring-1 ring-inset ring-zinc-700 ${className}`}
      title="测试中的功能：默认关闭，行为和界面后续可能调整"
    >
      Beta
    </span>
  );
}
