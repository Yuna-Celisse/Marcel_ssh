const fieldClass =
  'w-full resize-y rounded-lg border border-edge bg-zinc-800 text-zinc-100 outline-none placeholder:text-zinc-500 focus:border-indigo-500';

/**
 * 「拒绝说明」输入框：档位是「直接拒绝」时才出现（别的档位没有要回给模型的话）。
 * 内置规则与自定义规则共用，桌面与手机同一个组件。
 *
 * 写进去的话会原样回给 Agent，替换这条规则自带的说明，让它知道为什么被拒、该改走哪条路；
 * 留空 = 用默认说明。长度不设限，写多长占多少上下文由用户自己把握。
 */
export function DenyMessageField({
  value,
  onChange,
  ariaLabel,
  compact,
}: {
  value: string;
  onChange: (next: string) => void;
  /** 这个输入框管哪条规则（读屏用）。 */
  ariaLabel: string;
  /** 手机。 */
  compact?: boolean;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-zinc-500">
        拒绝说明（可选）：会原样回给 Agent，告诉它为什么被拒、该怎么做
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        aria-label={ariaLabel}
        placeholder="例如：生产库禁止清理，请先让用户确认并备份。留空 = 用默认说明"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        className={`${fieldClass} ${compact ? 'px-3 py-2.5 text-base' : 'px-3 py-2 text-sm'}`}
      />
    </label>
  );
}
