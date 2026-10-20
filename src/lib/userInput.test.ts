import { describe, expect, it } from 'vitest';
import type { UserInputMetadata } from './types';
import { composeUserInput, validateUserInput } from './userInput';

const input: UserInputMetadata = {
  version: 1,
  text: '请检查配置',
  textAttachments: [
    { id: 'f1', name: '配置.conf', content: '  第一行\r\n第二行\n\n', size: 32 },
    { id: 'f2', name: 'empty.txt', content: '', size: 0 },
  ],
};

describe('user input metadata', () => {
  it('composes all files in order without trimming their contents', () => {
    const content = composeUserInput(input);
    expect(content).toBe('请检查配置\n\n===== 文件名: 配置.conf =====\n  第一行\r\n第二行\n\n'
      + '\n\n===== 文件名: empty.txt =====\n');
    expect(validateUserInput(content, input)).toEqual(input);
  });

  it('accepts attachment-only input, including an empty file', () => {
    const filesOnly: UserInputMetadata = { ...input, text: '' };
    expect(composeUserInput(filesOnly)).not.toBe('');
    expect(validateUserInput(composeUserInput(filesOnly), filesOnly)).toEqual(filesOnly);
  });

  it('preserves user text and file contents that resemble attachment delimiters', () => {
    const nested: UserInputMetadata = {
      version: 1,
      text: '  ===== 文件名: 用户自己写的 =====\n  ',
      textAttachments: [{ id: 'f', name: 'log.txt', content: '\n===== 文件名: nested =====\n🧪\n' }],
    };
    expect(validateUserInput(composeUserInput(nested), nested)).toEqual(nested);
    expect(validateUserInput(composeUserInput(nested), undefined)).toBeUndefined();
  });

  it.each([
    undefined, null, '', [], {}, { ...input, version: 2 },
    { ...input, text: null }, { ...input, textAttachments: null },
    { ...input, textAttachments: [null] },
    { ...input, textAttachments: [{ ...input.textAttachments[0], id: '' }] },
    { ...input, textAttachments: [input.textAttachments[0], input.textAttachments[0]] },
    { ...input, textAttachments: [{ ...input.textAttachments[0], name: '' }] },
    { ...input, textAttachments: [{ ...input.textAttachments[0], content: 42 }] },
    { ...input, textAttachments: [{ ...input.textAttachments[0], size: -1 }] },
    { ...input, textAttachments: [{ ...input.textAttachments[0], size: Infinity }] },
    { ...input, textAttachments: [{ ...input.textAttachments[0], size: 1.5 }] },
  ])('rejects absent or invalid structures without guessing from content: %j', (value) => {
    expect(validateUserInput(composeUserInput(input), value)).toBeUndefined();
  });

  it('rejects mismatched content so metadata cannot hide any original text', () => {
    expect(validateUserInput(composeUserInput(input) + 'extra', input)).toBeUndefined();
    expect(validateUserInput(composeUserInput(input).trim(), input)).toBeUndefined();
  });

  it('allows a metadata-bearing plain message without manufacturing attachments', () => {
    const plain: UserInputMetadata = { version: 1, text: '保留原文\n', textAttachments: [] };
    expect(composeUserInput(plain)).toBe(plain.text);
    expect(validateUserInput(plain.text, plain)).toEqual(plain);
  });

  it('composes skills after text and files, and validates round-trip', () => {
    const withSkills: UserInputMetadata = {
      ...input,
      skills: [
        { id: 's1', skillId: 'sk-a', name: '排错', content: '先看日志' },
        { id: 's2', skillId: 'sk-b', name: '部署', content: '先备份' },
      ],
    };
    const content = composeUserInput(withSkills);
    expect(content.startsWith(composeUserInput(input))).toBe(true);
    expect(content.endsWith(
      '\n\n===== 用户指定使用的 Skill: 排错 =====\n先看日志'
      + '\n\n===== 用户指定使用的 Skill: 部署 =====\n先备份',
    )).toBe(true);
    expect(validateUserInput(content, withSkills)).toEqual(withSkills);
  });

  it('accepts skill-only input and legacy metadata without skills', () => {
    const only: UserInputMetadata = {
      version: 1, text: '', textAttachments: [],
      skills: [{ id: 's1', skillId: 'sk-a', name: '排错', content: '先看日志' }],
    };
    expect(validateUserInput(composeUserInput(only), only)).toEqual(only);
    expect(validateUserInput(composeUserInput(input), input)).toEqual(input);
  });

  it('rejects skills that do not recompose into the content or are malformed', () => {
    const withSkill: UserInputMetadata = {
      ...input,
      skills: [{ id: 's1', skillId: 'sk-a', name: '排错', content: '先看日志' }],
    };
    expect(validateUserInput(composeUserInput(input), withSkill)).toBeUndefined();
    expect(validateUserInput(composeUserInput(withSkill), {
      ...withSkill, skills: [{ id: 's1', name: '排错', content: '先看日志' }],
    })).toBeUndefined();
    expect(validateUserInput(composeUserInput(withSkill), {
      ...withSkill, skills: 'oops',
    })).toBeUndefined();
  });
});
