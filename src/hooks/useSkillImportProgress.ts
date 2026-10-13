import { useCallback, useEffect, useRef, useState } from 'react';
import * as tauri from '@/lib/tauri';
import { parseAppError } from '@/lib/errors';
import { subscribeTauriEvent } from '@/lib/tauriEvent';

export interface SkillImportProgress {
  received: number;
  total: number;
}

/** 是不是用户主动取消造成的错误（后端 `AppError::Cancelled`）。 */
export const isCancelledError = (err: unknown) => parseAppError(err).kind === 'Cancelled';

/**
 * GitHub 导入 skill 的下载进度 / 取消（桌面与手机共用）。
 *
 * 一次用户操作（拉取，或批量导入多个）对应一个 importId：`begin()` 开始、`end()`
 * 收尾。批量时每个后端调用都带同一个 id；仓库 zip 有后端缓存，第 2 个起不再下载、
 * 也不发进度。`cancel()` 同时置位前端标志，批量循环据 `isCancelled()` 跳出 ——
 * 两次后端调用之间的空档里后端没有可取消的目标。
 */
export function useSkillImportProgress() {
  const [importId, setImportId] = useState<string | null>(null);
  const [progress, setProgress] = useState<SkillImportProgress | null>(null);
  const idRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!importId) return;
    return subscribeTauriEvent<{ importId: string; received: number; total: number }>(
      'skill-import-progress',
      (p) => {
        if (p.importId !== importId) return;
        setProgress({ received: p.received, total: p.total });
      },
    );
  }, [importId]);

  const begin = useCallback(() => {
    const id = crypto.randomUUID();
    idRef.current = id;
    cancelledRef.current = false;
    setProgress(null);
    setImportId(id);
    return id;
  }, []);

  const end = useCallback(() => {
    idRef.current = null;
    setImportId(null);
    setProgress(null);
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    const id = idRef.current;
    if (id) void tauri.skillImportCancel(id).catch(() => {});
  }, []);

  const isCancelled = useCallback(() => cancelledRef.current, []);

  return { active: importId !== null, progress, begin, end, cancel, isCancelled };
}
