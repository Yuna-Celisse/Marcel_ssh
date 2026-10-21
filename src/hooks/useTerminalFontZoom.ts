import { useEffect, useRef } from 'react';
import { createFontZoom, isFontZooming, type FontZoom } from '@/lib/terminalFontZoom';
import { useSettingsStore } from '@/stores/settingsStore';

interface UseTerminalFontZoomOptions {
  /** 最后一次请求后多久自动提交；触摸捏合传 0，由手势结束显式 flush。 */
  commitDelayMs?: number;
  /**
   * 提交后让终端按最终字号重新 fit 并通知远端 resize。
   * 手势途中外观 effect 会跳过远端 resize（见 `isFontZooming`），所以这一步必须有人补上。
   */
  onSettled: () => void;
}

/** 预览里只摘掉 fontSize，别误清设置页正在预览的配色 / 字体。 */
function dropFontSizePreview(): void {
  const { preview, setPreview, clearPreview } = useSettingsStore.getState();
  if (preview?.fontSize === undefined) return;
  const { fontSize: _fontSize, ...rest } = preview;
  if (Object.keys(rest).length === 0) clearPreview();
  else setPreview(rest);
}

/**
 * 终端字号手势缩放的宿主接线：预览走设置 store 的 `preview`（外观 effect 已经会响应它），
 * 手势结束 `update({ fontSize })` 落盘一次。桌面和手机共用，差别只在 `onSettled`。
 */
export function useTerminalFontZoom(options: UseTerminalFontZoomOptions): FontZoom {
  const onSettledRef = useRef(options.onSettled);
  onSettledRef.current = options.onSettled;

  const zoomRef = useRef<FontZoom | null>(null);
  if (zoomRef.current === null) {
    zoomRef.current = createFontZoom({
      commitDelayMs: options.commitDelayMs,
      getBase: () => {
        const { settings, preview } = useSettingsStore.getState();
        return preview?.fontSize ?? settings.fontSize;
      },
      preview: (fontSize) => {
        const { preview, setPreview } = useSettingsStore.getState();
        setPreview({ ...preview, fontSize });
      },
      commit: (fontSize) => {
        void useSettingsStore
          .getState()
          .update({ fontSize })
          .catch((err) => {
            console.warn('[terminalFontZoom] 保存字号失败:', err);
          })
          .finally(() => {
            const zoom = zoomRef.current;
            // 存档期间又开始了新的缩放：update 清掉了预览，补回去免得字号跳回旧值。
            if (zoom?.isActive()) zoom.reapply();
            // 保存失败 / 设置还没加载完时 update 不会清预览，别让它卡住。
            else dropFontSizePreview();
          });
        requestAnimationFrame(() => onSettledRef.current());
      },
    });
  }
  const zoom = zoomRef.current;

  useEffect(() => () => zoom.dispose(), [zoom]);
  return zoom;
}

export { isFontZooming };
