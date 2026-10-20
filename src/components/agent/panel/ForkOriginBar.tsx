type ForkOriginBarProps = {
  /** 来源会话的标题。 */
  originTitle: string;
  onBack: () => void;
  /** 触屏端：命中区加高到 44px。 */
  mobile?: boolean;
};

/**
 * 分叉会话的来路提示：贴在对话区上方，告诉用户「你现在在一个分支里」并给一个回去的入口。
 *
 * 常驻而不是一闪而过的提示——分叉的意义就是「以后还要回来」，而用户隔了几天再打开
 * 这条会话时，最需要知道的正是它从哪来、原会话还在。只在来源仍在会话列表里时才渲染
 * （来源被删后没有可回的地方，调用方不渲染）。
 */
export function ForkOriginBar({ originTitle, onBack, mobile = false }: ForkOriginBarProps) {
  return (
    <div
      data-testid="fork-origin-bar"
      className="flex-shrink-0 border-b border-zinc-800 bg-zinc-900/90 backdrop-blur"
    >
      <div
        className={`flex items-center gap-2 px-3 text-xs ${mobile ? 'min-h-11' : 'py-1.5'}`}
      >
        <svg
          className="h-3.5 w-3.5 flex-shrink-0 text-indigo-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 3v12m0 0a3 3 0 103 3 3 3 0 00-3-3zm12-6a3 3 0 10-3-3 3 3 0 003 3zm0 0a9 9 0 01-9 9"
          />
        </svg>
        <span className="min-w-0 flex-1 truncate text-zinc-400">
          分叉自 <span className="text-zinc-300">{originTitle}</span>
          <span className="text-zinc-600"> · 这里的改动不会影响原会话</span>
        </span>
        <button
          type="button"
          onClick={onBack}
          className={`flex flex-shrink-0 items-center gap-1 rounded-md font-medium text-indigo-400 transition-colors hover:text-indigo-300 active:bg-zinc-800 ${
            mobile ? 'min-h-11 px-2' : 'px-1.5 py-0.5 hover:bg-zinc-800'
          }`}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          返回原会话
        </button>
      </div>
    </div>
  );
}
