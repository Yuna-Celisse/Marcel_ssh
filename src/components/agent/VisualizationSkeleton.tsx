/**
 * 可视化还没量到高度时占位的骨架（桌面 / 手机共用）。盖满父级（父级需 `relative`），
 * 垫在透明的 iframe 后面；iframe 淡入后它就被遮住，随容器一起卸掉。
 * 「减少动态效果」下只留静态底，不脉动。
 */
export default function VisualizationSkeleton() {
  return (
    <div
      aria-hidden="true"
      data-viz-skeleton=""
      className="pointer-events-none absolute inset-0 rounded-lg bg-state-soft/40 motion-safe:animate-pulse"
    />
  );
}
