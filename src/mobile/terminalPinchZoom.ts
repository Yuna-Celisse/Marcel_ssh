/**
 * 手机终端的两指捏合 → 调终端字号。
 *
 * 与同容器上其它触摸手势的关系（它们本来就只认单指，这里补的是两指这一边）：
 *   - 惯性滚动 / 点按定位：见到多指自己就放弃，无需改动；
 *   - 长按选择：第二根手指落下时 `endSelectingGesture(false)` 会取消未触发的计时器；
 *   - xterm 自己的滚动：只看 touches[0]，两指中点一漂就会把终端带着滚。所以这里在
 *     **捕获阶段**拦住捏合期间的 touchmove，xterm 收不到。
 *
 * 捏合结束后若还剩一根手指按着，它的后续移动同样吞掉，直到手指全部抬起——否则
 * 松开一指的瞬间会被当成单指拖动，终端跳一下。
 */
import { pinchOf } from './gestures';
import { pinchFontSize, type FontZoom } from '@/lib/terminalFontZoom';

export interface AttachPinchZoomOptions {
  container: HTMLElement;
  zoom: Pick<FontZoom, 'request' | 'flush' | 'size'>;
}

export interface PinchZoomHandle {
  dispose: () => void;
}

export function attachPinchZoom(options: AttachPinchZoomOptions): PinchZoomHandle {
  const { container: el, zoom } = options;

  let pinching = false;
  /** 本次触摸序列里出现过两指：到手指全部抬起前，单指移动一律吞掉。 */
  let swallowing = false;
  let startDistance = 0;
  let startSize = 0;

  const distanceOf = (ev: TouchEvent): number => {
    const a = ev.touches[0]!;
    const b = ev.touches[1]!;
    return pinchOf({ x: a.clientX, y: a.clientY }, { x: b.clientX, y: b.clientY }).distance;
  };

  const finish = () => {
    if (!pinching) return;
    pinching = false;
    zoom.flush();
  };

  const onTouchStart = (ev: TouchEvent) => {
    if (ev.touches.length !== 2 || pinching) return;
    pinching = true;
    swallowing = true;
    startDistance = distanceOf(ev);
    startSize = zoom.size();
  };

  const onTouchMove = (ev: TouchEvent) => {
    if (pinching && ev.touches.length === 2) {
      zoom.request(pinchFontSize(startSize, startDistance, distanceOf(ev)));
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    if (swallowing) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  };

  const onTouchEnd = (ev: TouchEvent) => {
    if (ev.touches.length < 2) finish();
    if (ev.touches.length === 0) swallowing = false;
  };

  const onTouchCancel = () => {
    finish();
    swallowing = false;
  };

  // 全部走捕获阶段：长按选择会在捕获阶段 stopPropagation 掉 touchend，冒泡监听会漏收。
  el.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
  el.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
  el.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
  el.addEventListener('touchcancel', onTouchCancel, { passive: true, capture: true });

  return {
    dispose: () => {
      finish();
      el.removeEventListener('touchstart', onTouchStart, { capture: true });
      el.removeEventListener('touchmove', onTouchMove, { capture: true });
      el.removeEventListener('touchend', onTouchEnd, { capture: true });
      el.removeEventListener('touchcancel', onTouchCancel, { capture: true });
    },
  };
}
