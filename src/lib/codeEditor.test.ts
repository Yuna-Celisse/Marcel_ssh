import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { detectLineSeparator, getFileExtension, readDocText } from './codeEditor';

describe('detectLineSeparator', () => {
  it('纯 LF / 无换行 → 默认', () => {
    expect(detectLineSeparator('a\nb\n')).toBeNull();
    expect(detectLineSeparator('abc')).toBeNull();
  });

  it('纯 CRLF → \\r\\n', () => {
    expect(detectLineSeparator('a\r\nb\r\n')).toBe('\r\n');
  });

  it('混合换行（有孤立 \\n）→ 默认归一化，不冒险把孤立 \\n 留在行内', () => {
    expect(detectLineSeparator('a\r\nb\nc')).toBeNull();
  });
});

describe('readDocText', () => {
  it('按文档自己的换行符拼回，CRLF 往返不变', () => {
    const content = 'a\r\nb\r\n';
    const state = EditorState.create({
      doc: content,
      extensions: [EditorState.lineSeparator.of('\r\n')],
    });
    expect(readDocText(state)).toBe(content);
  });
});

describe('getFileExtension', () => {
  it('取小写扩展名，无扩展名返回空串', () => {
    expect(getFileExtension('A.JSON')).toBe('.json');
    expect(getFileExtension('Makefile')).toBe('');
  });
});
