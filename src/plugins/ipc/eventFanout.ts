/**
 * Event fanout: subscribes to the single backend `plugin://events` listener
 * and forwards to per-plugin `plugin-event-<id>` channels based on pattern
 * subscriptions.
 *
 * Pattern matching: `prefix/*` matches any event starting with `prefix/`;
 * otherwise exact string match.
 *
 * Frontend bridges (e.g. session-active) should call `dispatchPluginEvent`
 * directly — do not rely on emit→listen round-trip in the same webview.
 */

import { invoke } from '@tauri-apps/api/core';
import { listen, emit, type UnlistenFn } from '@tauri-apps/api/event';

import { matchPattern } from '../pattern';

// Re-export so existing importers don't break; the single source of truth is
// `plugins/pattern.ts`.
export { matchPattern };

/** Per-plugin subscription tracking: pluginId → Set<eventPattern>. */
const pluginSubscriptions = new Map<string, Set<string>>();

/** 上次上报给后端的订阅总数；-1 = 尚未上报（页面初始化也要报一次现值）。 */
let reportedSubscriberCount = -1;

function totalSubscriberCount(): number {
  let total = 0;
  for (const patterns of pluginSubscriptions.values()) total += patterns.size;
  return total;
}

/**
 * 把当前订阅总数上报给后端：归零后后端 `emit_event` 停发 `plugin://events`
 * 镜像（省掉无人监听时每个事件一次 JSON 包装 + 全 webview 广播），恢复订阅
 * 时重新开闸。失败静默——镜像多留/晚关一瞬无害，订阅集下次变化会再报。
 */
function syncBackendSubscriberCount(): void {
  const count = totalSubscriberCount();
  if (count === reportedSubscriberCount) return;
  reportedSubscriberCount = count;
  try {
    void invoke('plugin_events_report_subscribers', { count }).catch(() => {});
  } catch {
    // 非 Tauri 宿主（测试环境）invoke 同步抛错——忽略
  }
}

/** Single listener for all plugin events from the backend. */
let pluginEventsListener: Promise<UnlistenFn> | null = null;

export async function ensurePluginEventsListener(): Promise<void> {
  if (!pluginEventsListener) {
    pluginEventsListener = listen<{ event: string; data: unknown }>('plugin://events', (e) => {
      const p = e.payload;
      if (!p || typeof p.event !== 'string') return;
      forwardToPlugins(p.event, p.data);
    }).catch((err) => {
      pluginEventsListener = null;
      throw err;
    });
  }
  await pluginEventsListener;
  // 页面（重）加载后后端计数是旧值，初始化时对齐一次现值。
  syncBackendSubscriberCount();
}

function forwardToPlugins(event: string, data: unknown): void {
  for (const [pluginId, patterns] of pluginSubscriptions) {
    for (const pattern of patterns) {
      if (matchPattern(pattern, event)) {
        emit(`plugin-event-${pluginId}`, { event, data }).catch(console.error);
        break;
      }
    }
  }
}

/**
 * In-process fanout to subscribed plugins (emits `plugin-event-<id>`).
 * Additive path for frontend-originated events (e.g. session-active).
 * Does not change backend `plugin://events` routing or existing payload shapes.
 */
export function dispatchPluginEvent(event: string, data: unknown): void {
  if (typeof event !== 'string' || !event) return;
  forwardToPlugins(event, data);
}

/** Subscribe a plugin to a set of event patterns. Returns the subscribed list. */
export function subscribeEvents(pluginId: string, events: string[]): string[] {
  if (!pluginSubscriptions.has(pluginId)) {
    pluginSubscriptions.set(pluginId, new Set());
  }
  const subs = pluginSubscriptions.get(pluginId)!;
  const subscribed: string[] = [];

  for (const ev of events) {
    subs.add(ev);
    subscribed.push(ev);
  }
  syncBackendSubscriberCount();

  if (subscribed.length > 0) {
    void ensurePluginEventsListener().catch((err) => {
      console.error('[eventFanout] failed to listen for plugin events', err);
    });
  }

  return subscribed;
}

/** Unsubscribe a plugin from event patterns. Returns the unsubscribed list. */
export function unsubscribeEvents(pluginId: string, events: string[]): string[] {
  const subs = pluginSubscriptions.get(pluginId);
  if (!subs) return [];
  const unsubscribed: string[] = [];
  for (const ev of events) {
    if (subs.delete(ev)) {
      unsubscribed.push(ev);
    }
  }
  syncBackendSubscriberCount();
  return unsubscribed;
}

/** Remove all subscriptions for a plugin (e.g. on plugin disable/unload). */
export function removePluginSubscriptions(pluginId: string): void {
  pluginSubscriptions.delete(pluginId);
  syncBackendSubscriberCount();
}
