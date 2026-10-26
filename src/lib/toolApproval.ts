/**
 * 「需要审批的工具」的前端逻辑：哪些工具可以被点名、点名后的档位选项，以及把界面上的
 * 每一种改动翻译成新的档位表。
 *
 * 档位表本身存在 `agentModeSettings.toolApprovalLevels`，后端按工具名查表
 * （`AgentModeSettings::tool_approval_level`）：本机工具 `local_*` 与远端同名工具共用一条，
 * 所以这里的键永远是不带 `local_` 前缀的名字。
 */
import type { Disposition } from './types';

/**
 * 命令类工具：它的审批完全由命令规则与命令确认方式决定，不读档位表。
 * 「需要审批的工具」里它永远排第一行、只读，点一下去看命令规则（与后端
 * `resolve_call_disposition` 对命令类工具不读档位表一致）。
 */
export const COMMAND_TOOL = { name: 'bash', label: '执行命令' } as const;

export const isCommandTool = (name: string): boolean =>
  toolKey(name) === COMMAND_TOOL.name;

function toolKey(name: string): string {
  return name.replace(/^local_/, '');
}

/** 可以被点名审批的内置工具（命令类工具不在这里，见 `COMMAND_TOOL`）。 */
export const APPROVABLE_TOOLS: readonly { name: string; label: string }[] = [
  { name: 'edit_file', label: '编辑文件' },
  { name: 'write_file', label: '写入文件' },
  { name: 'read_file', label: '读取文件' },
  { name: 'list_directory', label: '浏览目录' },
  { name: 'search_files', label: '搜索文件' },
  { name: 'upload_file', label: '上传文件' },
  { name: 'download_file', label: '下载文件' },
  { name: 'http_get', label: '抓取网页' },
  { name: 'web_search', label: '联网搜索' },
];

/**
 * 工具档位的可选项。不含「放行」：不想审批就把这个工具从表里移除。
 * 顺序与命令规则的档位下拉一致（由松到严）。
 */
export const TOOL_LEVELS: Disposition[] = ['Approval', 'ForceApproval', 'Deny'];

export type ToolApprovalLevels = Record<string, Disposition>;

export function toolLabel(name: string): string {
  return APPROVABLE_TOOLS.find((t) => t.name === name)?.label ?? name;
}

/** 这个工具现在是不是"需要审批"的：表里写了 `Allow` 的等于没写（后端同口径）。 */
export function isListed(levels: ToolApprovalLevels, name: string): boolean {
  const level = levels[name];
  return level !== undefined && level !== 'Allow';
}

/** 需要审批的工具（按「可选清单」的顺序在前，表里多出来的未知工具排后面，保持稳定）。 */
export function listedTools(levels: ToolApprovalLevels): string[] {
  const known = APPROVABLE_TOOLS.map((t) => t.name).filter((n) =>
    isListed(levels, n),
  );
  const extra = Object.keys(levels)
    .filter(
      (n) =>
        !APPROVABLE_TOOLS.some((t) => t.name === n) &&
        !isCommandTool(n) &&
        isListed(levels, n),
    )
    .sort();
  return [...known, ...extra];
}

/** 还没点名、可以添加的工具。 */
export function addableTools(
  levels: ToolApprovalLevels,
): { name: string; label: string }[] {
  return APPROVABLE_TOOLS.filter((t) => !isListed(levels, t.name));
}

export function setToolLevel(
  levels: ToolApprovalLevels,
  name: string,
  level: Disposition,
): ToolApprovalLevels {
  return { ...levels, [name]: level };
}

export function removeTool(
  levels: ToolApprovalLevels,
  name: string,
): ToolApprovalLevels {
  const next = { ...levels };
  delete next[name];
  return next;
}

/** 新点名的工具默认「请求审批」：最常见、也最温和的一档。 */
export function addTool(
  levels: ToolApprovalLevels,
  name: string,
): ToolApprovalLevels {
  return setToolLevel(levels, name, 'Approval');
}
