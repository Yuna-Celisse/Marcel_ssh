/**
 * 对话内可视化「上次量到的内容高度」的本机记忆（**可视化起步高度的唯一来源**）。
 *
 * 为什么要记：iframe 里的内容高度只有页面加载完才量得出来，之前它只能从最小高度起步，
 * 加载完一次性撑开，把下面的内容整块顶下去。记住上次量到的高度后，再次出现（重开会话、
 * 重启应用、虚拟列表重建）就直接从这个高度起步，不再跳变。
 *
 * 只是视图状态，不进后端、不进设置：按 toolCallId 存一个数字，LRU 限条数，写盘合并
 * 防抖。localStorage 不可用 / 数据损坏时静默退化为「没有记忆」。宽度变了高度可能略有
 * 出入，这里只当起步值，真实高度上报后照常以实测为准。
 */

const STORAGE_KEY = 'marcel-viz-height-memory';
const MAX_ENTRIES = 300;
const FLUSH_DELAY_MS = 600;

/** 供测试 / 排查用：这份数据落在 localStorage 的哪个 key 下。 */
export const VIZ_HEIGHT_MEMORY_STORAGE_KEY = STORAGE_KEY;

// Map 的插入顺序即新旧顺序：最近用到的挪到末尾，超限从头部淘汰。
let entries: Map<string, number> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function load(): Map<string, number> {
  if (entries) return entries;
  const loaded = new Map<string, number>();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (!Array.isArray(item)) continue;
        const [key, height] = item as [unknown, unknown];
        if (typeof key === 'string' && typeof height === 'number' && height > 0 && Number.isFinite(height)) {
          loaded.set(key, height);
        }
      }
    }
  } catch {
    // 损坏 / 不可用：当作没有记忆，不清盘。
  }
  entries = loaded;
  return loaded;
}

function flush() {
  flushTimer = null;
  if (!entries) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...entries]));
  } catch {
    // 写不进去不影响功能。
  }
}

export function readVizHeight(key: string): number | null {
  return load().get(key) ?? null;
}

export function rememberVizHeight(key: string, height: number): void {
  if (!(height > 0) || !Number.isFinite(height)) return;
  const map = load();
  if (map.get(key) === height) return;
  map.delete(key);
  map.set(key, height);
  while (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  if (flushTimer === null) flushTimer = setTimeout(flush, FLUSH_DELAY_MS);
}

/** 仅测试用：丢掉内存副本与待写盘的定时器，下次读取重新从 localStorage 加载。 */
export function resetVizHeightMemoryForTest(): void {
  if (flushTimer !== null) clearTimeout(flushTimer);
  flushTimer = null;
  entries = null;
}
