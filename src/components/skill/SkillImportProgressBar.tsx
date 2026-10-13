import type { SkillImportProgress } from '@/hooks/useSkillImportProgress';

interface Props {
  progress: SkillImportProgress | null;
  onCancel: () => void;
  /** 触屏尺寸（手机端） */
  touch?: boolean;
}

const fmtMB = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

/** GitHub 导入下载进度条：已知总量显示百分比，否则不确定进度（流动条）。桌面与手机共用。 */
export default function SkillImportProgressBar({ progress, onCancel, touch = false }: Props) {
  const known = progress && progress.total > 0;
  const pct = known ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0;
  return (
    <div className='space-y-1.5'>
      <div
        role='progressbar'
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? pct : undefined}
        className='h-1.5 w-full overflow-hidden rounded-full bg-zinc-800'
      >
        {known ? (
          <div
            className='h-full rounded-full bg-indigo-500 transition-[width] duration-150'
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div className='h-full w-1/3 animate-pulse rounded-full bg-indigo-500/70' />
        )}
      </div>
      <div className='flex items-center justify-between text-[11px] text-zinc-500'>
        <span>
          {progress
            ? known
              ? `${fmtMB(progress.received)} / ${fmtMB(progress.total)}（${pct}%）`
              : `已下载 ${fmtMB(progress.received)}`
            : '正在连接…'}
        </span>
        <button
          type='button'
          onClick={onCancel}
          className={
            'rounded-md text-zinc-300 hover:text-white active:text-white ' +
            (touch ? 'px-3 py-1.5 text-xs' : 'px-2 py-0.5')
          }
        >
          取消
        </button>
      </div>
    </div>
  );
}
