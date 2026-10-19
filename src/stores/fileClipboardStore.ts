import { create } from 'zustand';

/** 剪贴板里的一项：只记名字与是否目录，完整路径由 `dir` + `name` 拼出。 */
export interface FileClipboardItem {
  name: string;
  isDir: boolean;
}

/**
 * 文件管理器的远端「复制 / 剪切」剪贴板（桌面与移动端共用）。
 *
 * 记录来源会话与来源目录：粘贴只在**同一条连接**内生效（远端 cp / mv，数据不经本机），
 * 跨服务器需要走传输，不在此范围——UI 靠 `canPasteInto` 判定并给出原因。
 * 放在 store 而非组件 state：切标签页 / 切目录 / 面板卸载后剪贴板仍在。
 */
export interface FileClipboard {
  sessionId: string;
  dir: string;
  items: FileClipboardItem[];
  cut: boolean;
}

interface FileClipboardState {
  clipboard: FileClipboard | null;
  set: (clipboard: FileClipboard) => void;
  clear: () => void;
}

export const useFileClipboardStore = create<FileClipboardState>((set) => ({
  clipboard: null,
  set: (clipboard) => set({ clipboard }),
  clear: () => set({ clipboard: null }),
}));
