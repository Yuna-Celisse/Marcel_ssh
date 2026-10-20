/**
 * 长期记忆的前端数据层：与后端 `src-tauri/src/memory/model.rs` 同形的类型、给人看的
 * 标签，以及管理页筛选 / 对话里复盘提示行定位这些纯函数。
 *
 * 作用域（谁能看到这条记忆）：
 * - `user`  全局：关于用户本人，每台机器都适用（key 恒为空串）；
 * - `group` 分组：key = 连接分组名，这一组机器共有；
 * - `host`  机器：key = `SavedConnection.id`。
 *
 * 写入一律经后端（`memory_apply` 等命令），前端不自己拼库里的状态。
 */
import type { ConversationUsage, SavedConnection } from './types';

export type MemoryScope = 'user' | 'group' | 'host';
export type MemoryKind = 'preference' | 'fact' | 'lesson' | 'change';
export type MemorySource = 'user' | 'agent' | 'reflection' | 'assistant';

/** 标题 / 正文上限：与后端 `TITLE_MAX_CHARS` / `CONTENT_MAX_CHARS` 一致（超长后端拒绝，不截断）。 */
export const MEMORY_TITLE_MAX = 60;
export const MEMORY_CONTENT_MAX = 600;

export interface ScopeRef {
  scope: MemoryScope;
  key: string;
}

export interface MemoryItem {
  id: string;
  scope: MemoryScope;
  scopeKey: string;
  kind: MemoryKind;
  title: string;
  content: string;
  pinned: boolean;
  source: MemorySource;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
  /** 还没被用户在管理页看过（agent / 复盘 / 整理助手新写或改的）。 */
  isNew: boolean;
}

export interface ScopeSummary {
  scope: MemoryScope;
  key: string;
  count: number;
  newCount: number;
}

export type MemoryOpKind = 'add' | 'update' | 'delete';

export interface MemoryOpRecord {
  id: number;
  batchId: string;
  memoryId: string;
  op: MemoryOpKind;
  before: MemoryItem | null;
  after: MemoryItem | null;
  source: MemorySource;
  conversationId: string | null;
  createdAt: string;
  reverted: boolean;
}

export interface ReflectionNote {
  id: string;
  conversationId: string;
  /** 被复盘那段的最后一条消息：提示行渲染在它后面。 */
  anchorMessageId: string;
  batchId: string | null;
  /** 第一次后台复盘：带「这是什么、花多少、怎么关」的说明。 */
  intro: boolean;
  createdAt: string;
  ops: MemoryOpRecord[];
}

export interface MemoryPatch {
  title?: string;
  content?: string;
  kind?: MemoryKind;
  scope?: ScopeRef;
  pinned?: boolean;
}

export type MemoryWriteOp =
  | {
      op: 'add';
      scope: MemoryScope;
      scopeKey: string;
      kind: MemoryKind;
      title: string;
      content: string;
      pinned?: boolean;
    }
  | ({ op: 'update'; id: string; expectedVersion?: number } & MemoryPatch)
  | { op: 'delete'; id: string; expectedVersion?: number };

export interface MemoryOverview {
  items: MemoryItem[];
  summaries: ScopeSummary[];
}

export interface InjectedMemories {
  items: MemoryItem[];
  /** 对话已开始、注入内容已冻结；`false` = 列的是「开始时会带上的」。 */
  frozen: boolean;
  /** 冻结之后被删掉的条数（下一轮就不再带）。 */
  removedSince: number;
  /** 这台机器现在有、但这段对话没带上的条数（冻结之后才记下的，下一段对话起带上）。 */
  pending: number;
  /** 管理页里有、但属于别的机器 / 分组，不会带进这段对话的条数。 */
  elsewhere: number;
  enabled: boolean;
}

export interface AssistantTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantReply {
  text: string;
  batchId: string | null;
  ops: MemoryOpRecord[];
}

export interface AssistantProgressEvent {
  runId: string;
  kind: 'text' | 'tool' | 'ops';
  text: string;
  batchId?: string;
  ops?: MemoryOpRecord[];
}

export interface MemoryChangedEvent {
  source: MemorySource;
  conversationId: string | null;
}

export interface ReflectionEvent {
  conversationId: string;
  /** 有改动（或第一次复盘）才有；没有时事件只带用量。 */
  note: ReflectionNote | null;
  usage: ConversationUsage | null;
}

export const EVENT_MEMORY_CHANGED = 'memory-changed';
export const EVENT_MEMORY_REFLECTION = 'memory-reflection';
export const EVENT_MEMORY_ASSISTANT_PROGRESS = 'memory-assistant-progress';

export const KIND_LABELS: Record<MemoryKind, string> = {
  preference: '偏好',
  fact: '事实',
  lesson: '经验',
  change: '变更',
};

export const KIND_HINTS: Record<MemoryKind, string> = {
  preference: '你的习惯和规矩，如「回复用中文」「重启服务前先问我」',
  fact: '环境事实，如「nginx 配置在 /opt/nginx」',
  lesson: '踩过的坑和最后管用的解法',
  change: '对机器做过的改动（带日期）',
};

export const KIND_ORDER: readonly MemoryKind[] = ['preference', 'fact', 'lesson', 'change'];

export const SOURCE_LABELS: Record<MemorySource, string> = {
  user: '你',
  agent: 'Agent',
  reflection: '后台复盘',
  assistant: '整理助手',
};

export const GLOBAL_SCOPE: ScopeRef = { scope: 'user', key: '' };

export function scopeOf(item: Pick<MemoryItem, 'scope' | 'scopeKey'>): ScopeRef {
  return { scope: item.scope, key: item.scope === 'user' ? '' : item.scopeKey };
}

export function scopeId(ref: ScopeRef): string {
  return ref.scope === 'user' ? 'user' : `${ref.scope}:${ref.key}`;
}

export function sameScope(a: ScopeRef, b: ScopeRef): boolean {
  return scopeId(a) === scopeId(b);
}

function normalizedGroup(group: string | undefined | null): string | null {
  const g = group?.trim();
  return g ? g : null;
}

/** 给人看的作用域名：「全局」「分组「prod」」「web-01」「已删除的连接」。 */
export function scopeLabel(ref: ScopeRef, connections: readonly SavedConnection[]): string {
  if (ref.scope === 'user') return '全局';
  if (ref.scope === 'group') return `分组「${ref.key}」`;
  return connections.find((c) => c.id === ref.key)?.name ?? '已删除的连接';
}

/** 一个连接能看到的作用域：全局 → 分组 → 这台机器（与后端 `ScopeContext::scopes` 同序）。 */
export function scopesForConnection(connection: SavedConnection | undefined): ScopeRef[] {
  const out: ScopeRef[] = [GLOBAL_SCOPE];
  if (!connection) return out;
  const group = normalizedGroup(connection.group);
  if (group) out.push({ scope: 'group', key: group });
  out.push({ scope: 'host', key: connection.id });
  return out;
}

// ── 管理页筛选 ──

export type MemoryFilter =
  | { kind: 'all' }
  | { kind: 'scope'; ref: ScopeRef }
  /** 连接已删除的机器记忆（逐个作用域列在里面）。 */
  | { kind: 'orphan-hosts' }
  /** 分组已不存在（改名没被认出 / 整组拆散）的分组记忆。 */
  | { kind: 'orphan-groups' };

export interface ScopeEntry {
  ref: ScopeRef;
  label: string;
  count: number;
  newCount: number;
}

export interface ScopeDirectory {
  global: ScopeEntry;
  groups: ScopeEntry[];
  hosts: ScopeEntry[];
  orphanHosts: ScopeEntry[];
  orphanGroups: ScopeEntry[];
  total: number;
  totalNew: number;
}

/**
 * 管理页左侧的作用域目录。现有分组 / 连接按连接表顺序全部列出（没有记忆的也列，
 * 方便直接往上加）；已删除连接与已不存在分组只列有记忆的。
 */
export function buildScopeDirectory(
  summaries: readonly ScopeSummary[],
  connections: readonly SavedConnection[],
): ScopeDirectory {
  const byId = new Map(summaries.map((s) => [scopeId({ scope: s.scope, key: s.scope === 'user' ? '' : s.key }), s]));
  const entry = (ref: ScopeRef, label: string): ScopeEntry => {
    const s = byId.get(scopeId(ref));
    return { ref, label, count: s?.count ?? 0, newCount: s?.newCount ?? 0 };
  };
  const groupNames: string[] = [];
  for (const c of connections) {
    const g = normalizedGroup(c.group);
    if (g && !groupNames.includes(g)) groupNames.push(g);
  }
  const connectionIds = new Set(connections.map((c) => c.id));
  const orphanHosts: ScopeEntry[] = [];
  const orphanGroups: ScopeEntry[] = [];
  for (const s of summaries) {
    if (s.count <= 0) continue;
    if (s.scope === 'host' && !connectionIds.has(s.key)) {
      orphanHosts.push(entry({ scope: 'host', key: s.key }, '已删除的连接'));
    } else if (s.scope === 'group' && !groupNames.includes(s.key)) {
      orphanGroups.push(entry({ scope: 'group', key: s.key }, `分组「${s.key}」`));
    }
  }
  return {
    global: entry(GLOBAL_SCOPE, '全局'),
    groups: groupNames.map((g) => entry({ scope: 'group', key: g }, `分组「${g}」`)),
    hosts: connections.map((c) => entry({ scope: 'host', key: c.id }, c.name)),
    orphanHosts,
    orphanGroups,
    total: summaries.reduce((n, s) => n + s.count, 0),
    totalNew: summaries.reduce((n, s) => n + s.newCount, 0),
  };
}

export function filterMatches(
  item: MemoryItem,
  filter: MemoryFilter,
  directory: ScopeDirectory,
): boolean {
  const ref = scopeOf(item);
  switch (filter.kind) {
    case 'all':
      return true;
    case 'scope':
      return sameScope(ref, filter.ref);
    case 'orphan-hosts':
      return directory.orphanHosts.some((e) => sameScope(e.ref, ref));
    case 'orphan-groups':
      return directory.orphanGroups.some((e) => sameScope(e.ref, ref));
  }
}

/** 搜索：空格分隔的每个词都要出现在标题或正文里（不区分大小写）。 */
export function queryMatches(item: MemoryItem, query: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = `${item.title}\n${item.content}`.toLowerCase();
  return terms.every((t) => text.includes(t));
}

/** 管理页列表排序：置顶 → 新 → 最近改动。 */
export function sortForList(items: readonly MemoryItem[]): MemoryItem[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

// ── 时间 ──

/** 「刚刚 / 5 分钟前 / 3 天前 / 2026-05-01」。 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return '';
  const diff = Math.max(0, now.getTime() - t.getTime());
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ── 一次改动给人看的样子 ──

/** 一条操作记录对应的记忆（删除看 before，其余看 after）。 */
export function opItem(rec: MemoryOpRecord): MemoryItem | null {
  return rec.after ?? rec.before;
}

export const OP_VERBS: Record<MemoryOpKind, string> = {
  add: '记住',
  update: '更新',
  delete: '删除',
};

/** 「记住 2 条、更新 1 条」；全撤销了返回空串。 */
export function summarizeOps(ops: readonly MemoryOpRecord[]): string {
  const live = ops.filter((o) => !o.reverted);
  const parts: string[] = [];
  for (const op of ['add', 'update', 'delete'] as const) {
    const n = live.filter((o) => o.op === op).length;
    if (n > 0) parts.push(`${OP_VERBS[op]} ${n} 条`);
  }
  return parts.join('、');
}

// ── 复盘提示行放在哪一行后面 ──

interface PlaceableRow {
  key: string;
  /** 这一行代表的消息 id（单条消息 / 折叠组 / 折叠回合的成员）。 */
  messageIds: readonly string[];
}

/**
 * 把复盘提示行挂到消息列表的某一行后面。
 *
 * 锚点是「被复盘那段的最后一条消息」，它可能被折叠起来（已完成回合的过程、工具组），
 * 所以挂到**位置不晚于锚点的最后一个可见行**：锚点自己可见就挂它后面，被折叠就挂
 * 在代表它的那一行（回合折叠条 / 工具组）后面。
 *
 * 锚点 id 找不到时按时间定位：本次运行里实时生成的消息在前端用的是临时 id（重新
 * 加载会话才换成库里的 id），而复盘恰恰常发生在用户刚聊完、还没离开这段对话时。
 * 复盘写入时间晚于被复盘的那一段，所以「复盘时间之前的最后一条消息」就是锚点或
 * 紧挨着它。窗口里没有任何更早的消息（锚点在还没加载的更早历史里）就不挂：窗口外
 * 的东西不往窗口里塞。
 */
export function placeReflectionNotes<N extends { anchorMessageId: string; createdAt: string }>(
  messages: readonly { id: string; timestamp: string }[],
  rows: readonly PlaceableRow[],
  notes: readonly N[],
): Map<string, N[]> {
  const out = new Map<string, N[]>();
  if (notes.length === 0 || rows.length === 0) return out;
  const index = new Map(messages.map((m, i) => [m.id, i]));
  const rowReach = rows.map((row) => {
    let max = -1;
    for (const id of row.messageIds) max = Math.max(max, index.get(id) ?? -1);
    return max;
  });
  const byTime = (iso: string): number | undefined => {
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return undefined;
    let found: number | undefined;
    for (let i = 0; i < messages.length; i++) {
      const mt = Date.parse(messages[i].timestamp);
      if (!Number.isNaN(mt) && mt <= t) found = i;
    }
    return found;
  };
  for (const note of notes) {
    const anchor = index.get(note.anchorMessageId) ?? byTime(note.createdAt);
    if (anchor === undefined) continue;
    let target = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rowReach[i] >= 0 && rowReach[i] <= anchor) target = i;
    }
    if (target < 0) continue;
    const key = rows[target].key;
    const list = out.get(key);
    if (list) list.push(note);
    else out.set(key, [note]);
  }
  return out;
}
