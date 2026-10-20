import { useCallback, useRef } from 'react';
import { EditorView, type ViewUpdate } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import {
  buildExtensions,
  loadLanguageExtension,
  readDocText,
  type EditorVariant,
} from '@/lib/codeEditor';

interface Options {
  fileName: string;
  variant: EditorVariant;
  onSave: () => void;
  onUpdate?: (update: ViewUpdate) => void;
}

/**
 * 文件编辑器 EditorView 的生命周期（建 / 销毁 / 防泄漏），桌面与手机共用。
 * 纯功能：只管「把文本放进一个 view」，不懂保存、冲突、脏判断——那些是调用方的事。
 *
 * `onSave` / `onUpdate` 经 ref 读取，调用方每次渲染传新函数也不会让 `create` 变身份，
 * 否则依赖它的「读文件」effect 会重跑、把编辑中的内容冲掉。
 */
export function useCodeEditorView({ fileName, variant, onSave, onUpdate }: Options) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onSaveRef = useRef(onSave);
  const onUpdateRef = useRef(onUpdate);
  onSaveRef.current = onSave;
  onUpdateRef.current = onUpdate;

  const destroy = useCallback(() => {
    if (viewRef.current) {
      viewRef.current.destroy();
      viewRef.current = null;
    }
  }, []);

  /**
   * 建 view 并返回「脏判断的基线文本」（编辑器视角下的原文：换行符已按文档规则处理，
   * 不一定与传入的 content 逐字节相同）。被取消或没有容器时返回 null。
   */
  const create = useCallback(
    async (content: string, isCancelled: () => boolean): Promise<string | null> => {
      if (!containerRef.current) return null;

      destroy();

      const language = await loadLanguageExtension(fileName);

      // 等动态语言包期间组件可能已被卸载/关闭：cleanup 早就跑过 destroy()，
      // 此时若继续往下建 view，它会挂在已脱离文档的容器上且再没人销毁（泄漏）。
      // 判定必须在最后一处 await 之后、`new EditorView` 之前。
      if (isCancelled() || !containerRef.current) return null;

      const view = new EditorView({
        state: EditorState.create({
          doc: content,
          extensions: buildExtensions({
            variant,
            language,
            content,
            onSave: () => onSaveRef.current(),
            onUpdate: (u) => onUpdateRef.current?.(u),
          }),
        }),
        parent: containerRef.current,
      });

      viewRef.current = view;
      return readDocText(view.state);
    },
    [fileName, variant, destroy],
  );

  return { containerRef, viewRef, create, destroy };
}
