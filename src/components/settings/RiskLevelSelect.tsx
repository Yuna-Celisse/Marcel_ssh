import type { Disposition } from '@/lib/types';
import {
  LEVEL_HINT,
  RULE_LEVEL_DOT,
  RULE_LEVEL_LABELS,
  RULE_LEVEL_TONE,
} from '@/lib/riskRules';
import Select from '@/components/ui/Select';

/**
 * 档位下拉。桌面用共享的 `ui/Select`；手机没有共享下拉，沿用项目里手机端的做法（原生 select，调系统选择器）。
 *
 * 桌面的每个选项下面带一行"选了会怎样"，已是默认的那个再标一句「默认」，不用翻文档就知道四档
 * 差别、也知道自己动没动过。
 */
export function LevelSelect({
  value,
  options,
  onChange,
  ariaLabel,
  compact,
  defaultLevel,
}: {
  value: Disposition;
  options: Disposition[];
  onChange: (v: Disposition) => void;
  /** 这个下拉管哪条规则（读屏用，例如「按名字批量杀进程：处置档位」）。 */
  ariaLabel: string;
  /** 手机。 */
  compact?: boolean;
  /** 这一项的默认档位（有就在对应选项上标「默认」）。 */
  defaultLevel?: Disposition;
}) {
  if (compact) {
    return (
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value as Disposition)}
        className={`min-h-11 flex-shrink-0 rounded-lg border bg-zinc-800 px-3 text-sm text-zinc-100 outline-none focus:border-indigo-500 ${RULE_LEVEL_TONE[value]}`}
      >
        {options.map((l) => (
          <option key={l} value={l} className="bg-zinc-800 text-zinc-100">
            {RULE_LEVEL_LABELS[l]}
          </option>
        ))}
      </select>
    );
  }
  return (
    <Select<Disposition>
      className="w-32 flex-shrink-0"
      menuClassName="left-auto right-0 w-60"
      ariaLabel={`${ariaLabel}（当前${RULE_LEVEL_LABELS[value]}）`}
      value={value}
      onChange={onChange}
      options={options.map((l) => ({
        value: l,
        label: (
          <span className="inline-flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${RULE_LEVEL_DOT[l]}`}
            />
            {RULE_LEVEL_LABELS[l]}
          </span>
        ),
        hint: l === defaultLevel ? `${LEVEL_HINT[l]} · 默认` : LEVEL_HINT[l],
      }))}
    />
  );
}
