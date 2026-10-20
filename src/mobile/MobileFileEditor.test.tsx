// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { resetBackHandlers } from './backHandler';

const mocks = vi.hoisted(() => ({
  sftpReadFile: vi.fn(),
  sftpWriteFile: vi.fn(async () => {}),
  sftpGetMtime: vi.fn(async () => 1),
}));

vi.mock('@/lib/tauri', () => ({
  sftpReadFile: mocks.sftpReadFile,
  sftpWriteFile: mocks.sftpWriteFile,
  sftpGetMtime: mocks.sftpGetMtime,
}));

const MobileFileEditor = (await import('./MobileFileEditor')).default;

let host: HTMLDivElement;
let root: Root;

const flush = () => act(async () => {});

async function renderEditor() {
  await act(async () => {
    root.render(
      <MobileFileEditor
        open
        sessionId="sess-1"
        filePath="/a.txt"
        fileName="a.txt"
        fileSize={5}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
  });
  await flush();
}

const button = (label: string) =>
  [...document.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === label || b.textContent === label,
  ) as HTMLButtonElement;

const view = () => {
  const dom = document.querySelector('.cm-editor') as HTMLElement;
  expect(dom, 'CodeMirror 编辑器').not.toBeNull();
  return EditorView.findFromDOM(dom)!;
};
const docText = () => view().state.sliceDoc();

/** 以「用户输入」在末尾追加文本（短时间内连续调用会合并成一个撤销组） */
async function typeAtEnd(text: string) {
  await act(async () => {
    const v = view();
    v.dispatch({
      changes: { from: v.state.doc.length, insert: text },
      userEvent: 'input.type',
    });
  });
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom 没实现 Range 的测量 API，CodeMirror 布局时会打一堆报错（与断言无关）
  Range.prototype.getClientRects = () =>
    ({ length: 0, item: () => null }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
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
  resetBackHandlers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MobileFileEditor 保存', () => {
  it.each([true, false])('读到的 hasBom=%s 原样回传给写回命令', async (hasBom) => {
    mocks.sftpReadFile.mockResolvedValue({ content: 'hello', mtime: 1, hasBom });
    await renderEditor();

    await typeAtEnd('!');
    await click(button('保存'));
    await flush();

    expect(mocks.sftpWriteFile).toHaveBeenCalledWith('sess-1', '/a.txt', 'hello!', hasBom);
  });

  it('纯 CRLF 文件：打开不算已修改，保存后仍是 CRLF', async () => {
    mocks.sftpReadFile.mockResolvedValue({ content: 'a\r\nb\r\n', mtime: 1, hasBom: false });
    await renderEditor();
    expect(button('保存').disabled).toBe(true);

    await typeAtEnd('c');
    await click(button('保存'));
    await flush();

    expect(mocks.sftpWriteFile).toHaveBeenCalledWith('sess-1', '/a.txt', 'a\r\nb\r\nc', false);
  });
});

describe('MobileFileEditor 撤销 / 重做', () => {
  beforeEach(() => {
    mocks.sftpReadFile.mockResolvedValue({ content: 'hello', mtime: 1, hasBom: false });
  });

  it('刚打开时两个按钮都置灰，初始内容不可被撤销成空', async () => {
    await renderEditor();
    expect(docText()).toBe('hello');
    expect(button('撤销').disabled).toBe(true);
    expect(button('重做').disabled).toBe(true);
  });

  it('按钮撤销回原文后不再算未保存，重做能恢复', async () => {
    await renderEditor();
    await typeAtEnd('!');
    await typeAtEnd('!');
    expect(button('撤销').disabled).toBe(false);
    expect(button('保存').disabled).toBe(false);

    // 短时间内的连续输入合并成一组：一次撤销直接回到原文
    await click(button('撤销'));
    expect(docText()).toBe('hello');
    expect(button('撤销').disabled).toBe(true);
    expect(button('重做').disabled).toBe(false);
    expect(button('保存').disabled).toBe(true);

    await click(button('重做'));
    expect(docText()).toBe('hello!!');
    expect(button('重做').disabled).toBe(true);
    expect(button('保存').disabled).toBe(false);
  });

  it('外接键盘 Ctrl+Z / Ctrl+Y 走同一份历史', async () => {
    await renderEditor();
    await typeAtEnd('!');

    const press = async (init: KeyboardEventInit) => {
      const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
      await act(async () => {
        view().contentDOM.dispatchEvent(ev);
      });
      return ev;
    };

    const undoEv = await press({ key: 'z', code: 'KeyZ', keyCode: 90, ctrlKey: true });
    expect(undoEv.defaultPrevented).toBe(true);
    expect(docText()).toBe('hello');

    await press({ key: 'y', code: 'KeyY', keyCode: 89, ctrlKey: true });
    expect(docText()).toBe('hello!');
  });

  it('输入法 / 系统菜单的 historyUndo / historyRedo 被接管，不走浏览器原生撤销', async () => {
    await renderEditor();
    await typeAtEnd('!');

    const fire = async (inputType: string) => {
      const ev = new Event('beforeinput', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'inputType', { value: inputType });
      await act(async () => {
        view().contentDOM.dispatchEvent(ev);
      });
      return ev;
    };

    expect((await fire('historyUndo')).defaultPrevented).toBe(true);
    expect(docText()).toBe('hello');
    expect((await fire('historyRedo')).defaultPrevented).toBe(true);
    expect(docText()).toBe('hello!');
  });
});
