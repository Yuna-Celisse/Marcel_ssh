import { GitBranch } from 'lucide-react';

/** 会话列表里分叉会话的小标记（桌面抽屉 / 历史弹窗 / 手机列表共用，别各画一份）。 */
export function ForkMark() {
  return (
    <span title="分叉会话" className="mr-1 inline-flex align-[-2px]">
      <GitBranch className="h-3 w-3 text-indigo-400/80" aria-label="分叉会话" />
    </span>
  );
}
