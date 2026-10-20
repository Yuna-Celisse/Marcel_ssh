// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cm = vi.hoisted(() => ({ constructed: 0 }));
const lang = vi.hoisted(() => ({
  deferred: null as null | { promise: Promise<unknown>; resolve: () => void },
}));
const mocks = vi.hoisted(() => ({
  sftpReadFile: vi.fn(),
  sftpWriteFile: vi.fn(async () => {}),
  sftpGetMtime: vi.fn(async () => 1),
}));

/** 计数用子类：语言包 resolve 之后是否还会 new 出 EditorView（泄漏与否的判据） */
vi.mock('@codemirror/view', async () => {
  const actual = (await vi.importActual('@codemirror/view')) as unknown as {
    EditorView: new (config: unknown) => object;
  } & Record<string, unknown>;
  const Base = actual.EditorView;
  class EditorViewCounted extends Base {
    constructor(config: unknown) {
      super(config);
      cm.constructed += 1;
    }
  }
  return { ...actual, EditorView: EditorViewCounted };
});

/** 语言包加载可控：测试在 resolve 之前关闭弹窗，复现卸载竞态 */
vi.mock('@codemirror/lang-json', () => ({
  json: () => {
    if (!lang.deferred) throw new Error('lang.deferred 未初始化');
    return lang.deferred.promise;
  },
}));

vi.mock('@/lib/tauri', () => ({
  sftpReadFile: mocks.sftpReadFile,
  sftpWriteFile: mocks.sftpWriteFile,
  sftpGetMtime: mocks.sftpGetMtime,
}));

const FileEditorModal = (await import('@/components/sftp/FileEditorModal')).default;
// 同一个被 mock 的 '@codemirror/view' 模块：findFromDOM 是静态方法，原样透传
const { EditorView } = await import('@codemirror/view');

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<unknown>((r) => {
    resolve = () => r([]);
  });
  return { promise, resolve };
}

let host: HTMLDivElement;
let root: Root;

const flush = () => act(async () => {});

const baseProps = {
  sessionId: 'sess-1',
  filePath: '/a.json',
  fileName: 'a.json',
  fileSize: 2,
  onClose: () => {},
  onSaved: () => {},
};

async function renderModal(open: boolean, props: Partial<typeof baseProps> = {}) {
  await act(async () => {
    root.render(<FileEditorModal {...baseProps} {...props} open={open} />);
  });
  await flush();
}

async function clickSave() {
  const button = [...document.querySelectorAll('button')].find((b) =>
    b.textContent?.includes('保存 ('),
  );
  expect(button, '保存按钮').toBeDefined();
  await act(async () => {
    button!.click();
  });
  await flush();
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom 没实现 Range 的测量 API，CodeMirror 布局时会打一堆报错（与断言无关）
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  cm.constructed = 0;
  lang.deferred = null;
  mocks.sftpReadFile.mockReset();
  mocks.sftpWriteFile.mockClear();
  mocks.sftpGetMtime.mockClear();
  mocks.sftpGetMtime.mockResolvedValue(1);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  host.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('FileEditorModal', () => {
  it('语言包 resolve 前被关闭：不再创建 EditorView（无泄漏）', async () => {
    lang.deferred = deferred();
    mocks.sftpReadFile.mockResolvedValue({ content: '{}', mtime: 1, hasBom: false });

    await renderModal(true);
    // 文件已读出，正卡在 await loader()（动态语言包）
    expect(cm.constructed).toBe(0);

    await renderModal(false);
    // 卸载/关闭的 cleanup 已跑过 destroyEditor()，此后不能再建 view
    await act(async () => {
      lang.deferred!.resolve();
    });
    await flush();

    expect(cm.constructed).toBe(0);
  });

  it.each([true, false])('读到的 hasBom=%s 原样回传给写回命令', async (hasBom) => {
    lang.deferred = deferred();
    mocks.sftpReadFile.mockResolvedValue({ content: '{}', mtime: 1, hasBom });

    await renderModal(true);
    await act(async () => {
      lang.deferred!.resolve();
    });
    await flush();
    expect(cm.constructed).toBe(1);

    await clickSave();
    expect(mocks.sftpWriteFile).toHaveBeenCalledWith('sess-1', '/a.json', '{}', hasBom);
  });
});

describe('FileEditorModal 撤销 / 重做', () => {
  // .txt 没有语言包，编辑器在读完文件后同步建好
  const txt = { filePath: '/a.txt', fileName: 'a.txt' };

  const view = () => {
    const dom = document.querySelector('.cm-editor') as HTMLElement;
    expect(dom, 'CodeMirror 编辑器').not.toBeNull();
    return EditorView.findFromDOM(dom)!;
  };

  /** 走真实的 keymap（键盘事件 → historyKeymap），而不是直接调 undo 命令 */
  async function press(init: KeyboardEventInit) {
    const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    await act(async () => {
      view().contentDOM.dispatchEvent(ev);
    });
    return ev;
  }

  /** 以「用户输入」事件追加文本，才会被历史记录（程序化 dispatch 默认也记，但这更贴近真实） */
  async function typeAtEnd(text: string) {
    await act(async () => {
      const v = view();
      v.dispatch({
        changes: { from: v.state.doc.length, insert: text },
        userEvent: 'input.type',
      });
    });
  }

  beforeEach(() => {
    mocks.sftpReadFile.mockResolvedValue({ content: 'hello', mtime: 1, hasBom: false });
  });

  it('Ctrl+Z 撤销、Ctrl+Y / Ctrl+Shift+Z 重做', async () => {
    await renderModal(true, txt);
    await typeAtEnd('!');
    expect(view().state.doc.toString()).toBe('hello!');

    const undoEv = await press({ key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true });
    expect(undoEv.defaultPrevented).toBe(true);
    expect(view().state.doc.toString()).toBe('hello');

    await press({ key: 'y', code: 'KeyY', keyCode: 89, ctrlKey: true });
    expect(view().state.doc.toString()).toBe('hello!');
  });

  it('系统菜单 / 输入法的 historyUndo 被接管，走 CodeMirror 自己的历史', async () => {
    await renderModal(true, txt);
    await typeAtEnd('!');

    const ev = new Event('beforeinput', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'inputType', { value: 'historyUndo' });
    await act(async () => {
      view().contentDOM.dispatchEvent(ev);
    });

    expect(ev.defaultPrevented).toBe(true);
    expect(view().state.doc.toString()).toBe('hello');
  });

  it('纯 CRLF 文件：打开不算已修改', async () => {
    mocks.sftpReadFile.mockResolvedValue({ content: 'a\r\nb\r\n', mtime: 1, hasBom: false });
    await renderModal(true, txt);

    await act(async () => {
      (document.querySelector('button[aria-label="关闭"]') as HTMLButtonElement).click();
    });
    expect(document.body.textContent).not.toContain('未保存的修改');
  });

  it('CRLF 文件改动后保存，换行符原样保留', async () => {
    mocks.sftpReadFile.mockResolvedValue({ content: 'a\r\nb\r\n', mtime: 1, hasBom: false });
    await renderModal(true, txt);
    await typeAtEnd('c');
    await clickSave();
    expect(mocks.sftpWriteFile).toHaveBeenCalledWith('sess-1', '/a.txt', 'a\r\nb\r\nc', false);
  });

  it('刚打开时撤销无效：不会把文件撤成空', async () => {
    await renderModal(true, txt);
    await press({ key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true });
    expect(view().state.doc.toString()).toBe('hello');
  });

  it('撤销回原文后脏标记随之清除：关闭不再弹「未保存的修改」', async () => {
    await renderModal(true, txt);
    const closeButton = () =>
      document.querySelector('button[aria-label="关闭"]') as HTMLButtonElement;
    const clickClose = async () => {
      await act(async () => {
        closeButton().click();
      });
    };

    await typeAtEnd('!');
    await clickClose();
    expect(document.body.textContent).toContain('未保存的修改');

    // 先点「取消」收起确认框，再撤销，再关
    const cancel = [...document.querySelectorAll('button')]
      .filter((b) => b.textContent === '取消')
      .pop()!;
    await act(async () => {
      cancel.click();
    });
    expect(document.body.textContent).not.toContain('未保存的修改');

    await press({ key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true });
    await clickClose();
    expect(document.body.textContent).not.toContain('未保存的修改');
  });
});
