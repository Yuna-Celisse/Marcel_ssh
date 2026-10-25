import { describe, expect, it } from 'vitest';
import {
  TOOL_LEVELS,
  addTool,
  addableTools,
  isListed,
  listedTools,
  removeTool,
  setToolLevel,
  toolLabel,
} from './toolApproval';

describe('toolApproval', () => {
  const defaults = { edit_file: 'Approval', write_file: 'Approval' } as const;

  it('lists the named tools in catalog order, unknown ones after', () => {
    expect(
      listedTools({
        write_file: 'Approval',
        edit_file: 'Deny',
        zz_plugin: 'Approval',
      }),
    ).toEqual(['edit_file', 'write_file', 'zz_plugin']);
  });

  it('an `Allow` entry is the same as not listed (matches the backend)', () => {
    const levels = { ...defaults, read_file: 'Allow' } as const;
    expect(isListed(levels, 'read_file')).toBe(false);
    expect(listedTools(levels)).toEqual(['edit_file', 'write_file']);
    expect(addableTools(levels).map((t) => t.name)).toContain('read_file');
  });

  it('adding defaults to 请求审批, removing drops the key, level change keeps the rest', () => {
    const added = addTool(defaults, 'read_file');
    expect(added.read_file).toBe('Approval');
    expect(removeTool(added, 'read_file')).toEqual(defaults);
    expect(setToolLevel(defaults, 'edit_file', 'Deny')).toEqual({
      edit_file: 'Deny',
      write_file: 'Approval',
    });
  });

  it('offers no 放行 option: not wanting approval means removing the tool', () => {
    expect(TOOL_LEVELS).not.toContain('Allow');
  });

  it('falls back to the raw name for tools it has no label for', () => {
    expect(toolLabel('edit_file')).toBe('编辑文件');
    expect(toolLabel('mcp__x__y')).toBe('mcp__x__y');
  });
});
