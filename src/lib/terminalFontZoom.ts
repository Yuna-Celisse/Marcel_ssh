/**
 * 手势缩放终端字号的共用核心（桌面 Ctrl+滚轮 / 触控板捏合，手机两指捏合）。
 *
 * 只动终端字号 `settings.fontSize`，别的字号一概不碰。分三块：
 *
 * 1. 换算纯函数：两指间距 → 字号、滚轮 delta → 档位。
 * 2. `createFontZoom` 控制器：一次缩放手势从头到尾的状态。过程中只做"本地预览"
 *    （改字号、本地 fit），**不发远端 resize、不落盘**；手势结束才提交一次。
 *    原因同底栏过渡（terminalPanelTransition）：捏合途中每变一档就发一次 SIGWINCH，
 *    tmux / vim 会跟着重绘十几次。
 * 3. `isFontZooming`：外观 effect 据此在手势途中跳过远端 resize。
 * 4. 提示气泡的发布订阅（`TerminalZoomHint` 订阅它）。
 */
import { clampTerminalFontSize } from './terminalFont';

// ---------------------------------------------------------------------------
// 换算
// ---------------------------------------------------------------------------

/** 两指间距相对起始间距的比例 × 起始字号，取整后夹进合法范围。 */
export function pinchFontSize(
  startSize: number,
  startDistance: number,
  distance: number,
): number {
  if (!(startDistance > 0) || !Number.isFinite(distance)) {
    return clampTerminalFontSize(startSize);
  }
  return clampTerminalFontSize((startSize * distance) / startDistance);
}

/**
 * 离散滚轮一格的判据：|deltaY| 达到它就算"一格"，恒为一档。
 * Chromium / WebView2 里鼠标滚轮一格是 100 像素；行 / 页模式也一律算一格。
 */
const WHEEL_NOTCH_PX = 40;
/** 触控板捏合会被报成一串很小的 ctrl+wheel：累计到这么多像素才走一档。 */
const WHEEL_PINCH_PX_PER_STEP = 12;

export interface WheelZoomResult {
  /** 正数放大、负数缩小；0 = 还没攒够一档。 */
  steps: number;
  /** 带到下一个事件的余量（仅小 delta 累计用）。 */
  residual: number;
}

/**
 * ctrl+wheel 事件 → 要走几档。向上滚（deltaY < 0）放大，与浏览器 / VS Code 一致。
 */
export function wheelZoomSteps(
  deltaY: number,
  deltaMode: number,
  residual: number,
): WheelZoomResult {
  if (!Number.isFinite(deltaY) || deltaY === 0) return { steps: 0, residual };
  const sign = deltaY < 0 ? 1 : -1;
  if (deltaMode !== 0 || Math.abs(deltaY) >= WHEEL_NOTCH_PX) {
    return { steps: sign, residual: 0 };
  }
  // 方向反了就丢掉旧余量，不然来回捏会先"还债"。
  const base = residual !== 0 && Math.sign(residual) !== Math.sign(deltaY) ? 0 : residual;
  const acc = base + deltaY;
  const whole = Math.trunc(acc / WHEEL_PINCH_PX_PER_STEP);
  return { steps: whole === 0 ? 0 : -whole, residual: acc - whole * WHEEL_PINCH_PX_PER_STEP };
}

// ---------------------------------------------------------------------------
// 控制器
// ---------------------------------------------------------------------------

export interface FontZoomOptions {
  /** 当前生效字号（预览优先于存档）。手势开始时读一次。 */
  getBase: () => number;
  /** 本地即时应用：改字号、本地 fit。不得发远端 resize、不得落盘。 */
  preview: (size: number) => void;
  /** 手势结束且字号确有变化时调用一次：落盘并让远端 resize。 */
  commit: (size: number) => void;
  /** 最后一次 `request` 之后多久自动提交；0 = 只在 `flush` 时提交（触摸手势）。 */
  commitDelayMs?: number;
}

export interface FontZoom {
  /** 请求把字号设为 size（会夹进合法范围）；首次调用即开始一次缩放。 */
  request: (size: number) => void;
  /** 在当前字号上加减若干档。 */
  step: (delta: number) => void;
  /** 当前字号：缩放中是预览值，否则是 getBase()。 */
  size: () => number;
  /** 结束这次缩放；字号有变化就提交。 */
  flush: () => void;
  /** 缩放中且字号与起始不同时，重新应用预览（存档写回清掉了预览后补回）。 */
  reapply: () => void;
  isActive: () => boolean;
  dispose: () => void;
}

let activeZooms = 0;

/** 是否有缩放手势在进行。外观 effect 用它在手势途中跳过远端 resize。 */
export function isFontZooming(): boolean {
  return activeZooms > 0;
}

export function createFontZoom(options: FontZoomOptions): FontZoom {
  const delay = options.commitDelayMs ?? 0;
  let active = false;
  let startSize = 0;
  let current = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const begin = () => {
    if (active) return;
    active = true;
    activeZooms += 1;
    startSize = current = clampTerminalFontSize(options.getBase());
  };

  const flush = () => {
    clearTimer();
    if (!active) return;
    active = false;
    activeZooms -= 1;
    if (current !== startSize) options.commit(current);
  };

  const request = (size: number) => {
    begin();
    const next = clampTerminalFontSize(size);
    if (next !== current) {
      current = next;
      options.preview(next);
    }
    // 到顶 / 到底时也提示，用户才知道是撞到了边界而不是手势没识别。
    emitFontZoomHint(current);
    if (delay > 0) {
      clearTimer();
      timer = setTimeout(flush, delay);
    }
  };

  return {
    request,
    step: (delta) => request((active ? current : clampTerminalFontSize(options.getBase())) + delta),
    size: () => (active ? current : clampTerminalFontSize(options.getBase())),
    flush,
    reapply: () => {
      if (active && current !== startSize) options.preview(current);
    },
    isActive: () => active,
    dispose: flush,
  };
}

// ---------------------------------------------------------------------------
// 提示气泡
// ---------------------------------------------------------------------------

type HintListener = (size: number) => void;
const hintListeners = new Set<HintListener>();

export function subscribeFontZoomHint(listener: HintListener): () => void {
  hintListeners.add(listener);
  return () => {
    hintListeners.delete(listener);
  };
}

function emitFontZoomHint(size: number): void {
  for (const listener of hintListeners) listener(size);
}
