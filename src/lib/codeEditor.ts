/**
 * 文件编辑器（桌面 FileEditorModal / 手机 MobileFileEditor）共用的 CodeMirror 内核。
 *
 * 两端的撤销/重做、快捷键、语言包、换行符处理全部出自这里，别在组件里另写一套：
 * 历史记录用 CodeMirror 自带的 `history()`，手机端的撤销/重做按钮也是调用它的
 * `undo` / `redo` 命令。这里只有「怎么配」，没有状态；view 的生命周期在
 * `hooks/useCodeEditorView.ts`。
 */
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine,
  type ViewUpdate,
} from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { oneDark } from '@codemirror/theme-one-dark';
import { searchKeymap } from '@codemirror/search';

export type EditorVariant = 'desktop' | 'mobile';

export const LANGUAGE_LOADERS: Record<string, () => Promise<Extension>> = {
  '.json': () => import('@codemirror/lang-json').then((m) => m.json()),
  '.yaml': () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  '.yml': () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  '.xml': () => import('@codemirror/lang-xml').then((m) => m.xml()),
  '.html': () => import('@codemirror/lang-html').then((m) => m.html()),
  '.htm': () => import('@codemirror/lang-html').then((m) => m.html()),
  '.css': () => import('@codemirror/lang-css').then((m) => m.css()),
  '.js': () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  '.jsx': () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  '.ts': () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  '.tsx': () =>
    import('@codemirror/lang-javascript').then((m) =>
      m.javascript({ jsx: true, typescript: true }),
    ),
  '.py': () => import('@codemirror/lang-python').then((m) => m.python()),
  '.md': () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  '.sql': () => import('@codemirror/lang-sql').then((m) => m.sql()),
  '.sh': () => Promise.resolve(StreamLanguage.define(shell)),
  '.bash': () => Promise.resolve(StreamLanguage.define(shell)),
  '.zsh': () => Promise.resolve(StreamLanguage.define(shell)),
};

export function getFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf('.');
  return idx >= 0 ? fileName.slice(idx).toLowerCase() : '';
}

/** 按文件名加载语法高亮；没有对应语言或加载失败都当纯文本，不阻塞打开文件。 */
export async function loadLanguageExtension(fileName: string): Promise<Extension> {
  const loader = LANGUAGE_LOADERS[getFileExtension(fileName)];
  return loader ? loader().catch(() => []) : [];
}

/**
 * 文件是纯 CRLF 时返回 '\r\n'，否则 null（用 CodeMirror 默认的「任何换行都当作行尾，
 * 内部统一为 \n」）。
 *
 * 为什么要区分：CodeMirror 默认会把 \r\n 归一成 \n，不处理的话 Windows 换行的文件
 * 打开就「已修改」，一保存还会被静默改成 LF。只有「没有孤立 \n」时才能放心地把
 * \r\n 当行尾；混合换行的文件维持默认归一化（与原行为一致）。
 */
export function detectLineSeparator(content: string): '\r\n' | null {
  if (!content.includes('\r\n')) return null;
  return /(?<!\r)\n/.test(content) ? null : '\r\n';
}

/** 取编辑器全文（按文档自己的换行符拼回），保存与脏判断唯一出口——别用 `doc.toString()`（永远是 \n）。 */
export function readDocText(state: EditorState): string {
  return state.sliceDoc();
}

/**
 * 手机端的外观覆盖：背景透明让页面的 zinc-950 透出来，字号字体对齐原来的 textarea。
 * 必须排在 oneDark 之后才能盖掉它的背景。
 */
const mobileTheme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'transparent', fontSize: '13px' },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      lineHeight: '1.625',
    },
    '.cm-content': { padding: '12px 0' },
    '.cm-line': { padding: '0 12px' },
  },
  { dark: true },
);

export interface BuildExtensionsOptions {
  variant: EditorVariant;
  language: Extension;
  content: string;
  onSave: () => void;
  onUpdate?: (update: ViewUpdate) => void;
}

export function buildExtensions({
  variant,
  language,
  content,
  onSave,
  onUpdate,
}: BuildExtensionsOptions): Extension[] {
  const separator = detectLineSeparator(content);
  const desktop = variant === 'desktop';

  return [
    // 桌面独有：行号、当前行高亮、矩形选择、自绘选区。手机端不画选区——
    // 自绘会盖掉系统原生的选择手柄，触屏上拖选就不好用了。
    ...(desktop
      ? [
          lineNumbers(),
          highlightActiveLineGutter(),
          drawSelection(),
          dropCursor(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
        ]
      : []),
    highlightSpecialChars(),
    // history() 自带对 beforeinput 的 historyUndo/historyRedo 的接管（输入法、系统菜单、
    // 右键菜单触发的撤销都会走它自己的历史栈），不用另写；两端各有测试钉住这一点。
    history(),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
      {
        key: 'Mod-s',
        run: () => {
          onSave();
          return true;
        },
        preventDefault: true,
      },
    ]),
    oneDark,
    ...(desktop
      ? [EditorView.theme({ '&': { height: '100%' } })]
      : [
          mobileTheme,
          // 代码文件：关掉输入法的自动大写/纠错/拼写检查（原 textarea 也是关的）
          EditorView.contentAttributes.of({
            autocapitalize: 'off',
            autocorrect: 'off',
            spellcheck: 'false',
          }),
        ]),
    ...(onUpdate ? [EditorView.updateListener.of(onUpdate)] : []),
    language,
    ...(separator ? [EditorState.lineSeparator.of(separator)] : []),
    EditorState.tabSize.of(2),
    EditorView.lineWrapping,
  ];
}
