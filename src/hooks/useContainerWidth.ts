import { useState, useEffect, useRef, type RefObject } from 'react';

/**
 * 容器宽度（ResizeObserver → rAF 合帧）。
 *
 * 窗口拖拽/面板过渡期间 ResizeObserver 每帧都回调，直接 setState 会让订阅方
 * （文件管理器整表、工具卡）跟着每帧重渲染；这里每帧只提交一次最新值，且
 * 亚像素抖动（<1px）不提交——布局决策都按整数像素走。
 */
export function useContainerWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  // raf 句柄存 ref 而非 state：它只是调度细节，不该触发渲染。
  const rafRef = useRef<number | null>(null);
  const latestRef = useRef(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const flush = () => {
      rafRef.current = null;
      const next = latestRef.current;
      setWidth((prev) => (Math.abs(next - prev) < 1 ? prev : Math.round(next)));
    };

    const observer = new ResizeObserver(([entry]) => {
      latestRef.current = entry.contentRect.width;
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(flush);
      }
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [ref]);

  return width;
}
