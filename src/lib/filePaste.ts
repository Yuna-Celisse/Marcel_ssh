import { sftpPasteEntry } from '@/lib/tauri';
import { getErrorMessage } from '@/lib/errors';
import { joinRemotePath } from '@/lib/sftpFileOpen';
import type { FileClipboard } from '@/stores/fileClipboardStore';

/** 剪贴板的一句话描述：「已复制「a.txt」」「已剪切 3 项」。 */
export function clipboardLabel(clip: FileClipboard): string {
  const verb = clip.cut ? '已剪切' : '已复制';
  return clip.items.length === 1
    ? `${verb}「${clip.items[0].name}」`
    : `${verb} ${clip.items.length} 项`;
}

/** 当前会话能否粘贴这份剪贴板；不能时给出原因（用于按钮置灰的提示）。 */
export function pasteBlockedReason(
  clip: FileClipboard | null,
  sessionId: string | null | undefined,
): string | null {
  if (!clip) return '剪贴板为空';
  if (!sessionId || clip.sessionId !== sessionId) {
    return '剪贴板来自另一台服务器，暂不支持跨服务器粘贴';
  }
  return null;
}

export interface PasteResult {
  /** 成功项（原名 → 落地名；重名时落地名带序号）。 */
  done: { from: string; to: string }[];
  /** 失败项的原名（与 errors 一一对应），剪切时据此保留未搬走的项。 */
  failed: string[];
  errors: string[];
}

/**
 * 把剪贴板逐项粘贴进 `destDir`，聚合每项成败（与删除的聚合方式一致）。
 * 剪切在原目录原地粘贴是后端的空操作，这里不特判。
 */
export async function pasteClipboard(
  clip: FileClipboard,
  destDir: string,
  onProgress?: (index: number, total: number, name: string) => void,
  paste: typeof sftpPasteEntry = sftpPasteEntry,
): Promise<PasteResult> {
  const result: PasteResult = { done: [], failed: [], errors: [] };
  for (let i = 0; i < clip.items.length; i++) {
    const item = clip.items[i];
    onProgress?.(i + 1, clip.items.length, item.name);
    try {
      const to = await paste(
        clip.sessionId,
        joinRemotePath(clip.dir, item.name),
        destDir,
        clip.cut,
      );
      result.done.push({ from: item.name, to });
    } catch (err) {
      result.failed.push(item.name);
      result.errors.push(`${item.name}: ${getErrorMessage(err)}`);
    }
  }
  return result;
}

export function pasteProgressText(
  index: number,
  total: number,
  cut: boolean,
): string {
  const verb = cut ? '移动' : '复制';
  return total > 1 ? `正在${verb}（${index}/${total}）…` : `正在${verb}…`;
}

/** 有改名落地（重名自动加序号）时给用户一句说明，免得他疑惑多出来的「(1)」。 */
export function renamedNotice(result: PasteResult): string | null {
  const renamed = result.done.filter((d) => d.from !== d.to);
  if (renamed.length === 0) return null;
  return `目标已有同名项，已另存为：${renamed.map((d) => `「${d.to}」`).join('、')}`;
}
