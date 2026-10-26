import type { HTMLAttributes } from 'react';

/**
 * 对话级条幅的共用外壳：外层全宽（背景、分隔线贯穿整个面板，当「横条」用），内容收进
 * 与消息区、输入区同一根内容列（`.agent-content-column`，宽度由 AgentPanel 发布的
 * `--agent-content-max` 决定）。
 *
 * 凡是夹在消息区与输入区之间、语义上属于「这段对话」的条幅（计划、分叉来源、子 agent、
 * 撤回提示……）都必须经它，别自己写铺满面板的 `px-3`——否则内容列限宽后条幅的按钮会
 * 落进两侧留白，被宽度把手盖住，也和下面的消息对不齐。头部属于窗口 chrome，不走这里。
 *
 * 左右 12px 与消息区滚动容器的 `p-3` 同口径：窄到内容列撑满时，条幅内容与消息左缘一致。
 */
export function AgentContentBand({
  className = '',
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`px-3 ${className}`} {...rest}>
      <div className="agent-content-column">{children}</div>
    </div>
  );
}
