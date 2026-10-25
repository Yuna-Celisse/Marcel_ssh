import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { onThemeWritten } from '@/lib/uiTheme';

/** 没等到主题写 DOM（只改了终端色、没换主题）时的兜底：比揭开动画取快照的延迟长，比人能察觉的短。 */
const ADOPT_FALLBACK_MS = 150;

/**
 * 让「来自 React 状态、不是 CSS 变量」的颜色跟着主题切换的揭开动画走。
 *
 * 主题切换用 View Transitions：旧页面快照在 applyUiTheme 里、DOM 写入之前拍下。界面颜色是
 * CSS 变量，在写入回调里才变，所以被圆形揭开带着换；而终端配色这类颜色直接来自状态，
 * 状态一变 React 当场就重绘，旧快照里它已经是新色——于是它在揭开开始前就瞬间变了，
 * 和周围慢慢扩散的新主题对不上。
 *
 * 这个 hook 把新值先扣住，等主题真正写进 DOM（此时快照已拍完、新页面在渲染）再采用，
 * 于是它和别的元素一起被圆圈扫过。没有等到主题写入（只改了终端色、没换主题，或不走过渡）
 * 则 ADOPT_FALLBACK_MS 后直接采用。
 */
export function useThemeSynced<T>(value: T): T {
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (Object.is(shown, value)) return;
    let done = false;
    const adopt = () => {
      if (done) return;
      done = true;
      // 微任务里同步提交：写入回调返回后浏览器马上取「新页面」快照，状态必须已落到 DOM。
      // 不直接在监听器里 flushSync：非动画路径下它跑在 effect 里，会触发 React 的生命周期警告。
      queueMicrotask(() => flushSync(() => setShown(value)));
    };
    const off = onThemeWritten(adopt);
    const timer = setTimeout(adopt, ADOPT_FALLBACK_MS);
    return () => {
      done = true;
      off();
      clearTimeout(timer);
    };
    // shown 不进依赖：采用之后 shown 变了不该重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return shown;
}
