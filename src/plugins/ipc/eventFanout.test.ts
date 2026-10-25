import { beforeEach, describe, it, expect, vi } from 'vitest';

const eventApi = vi.hoisted(() => ({
  listener: null as ((event: { payload: { event: string; data: unknown } }) => void) | null,
  emit: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_event: string, listener: typeof eventApi.listener) => {
    eventApi.listener = listener;
    return () => {};
  }),
  emit: eventApi.emit,
}));

const coreApi = vi.hoisted(() => ({
  invoke: vi.fn(async (_cmd: string, _args: Record<string, unknown>) => {}),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: coreApi.invoke }));

import { subscribeEvents, removePluginSubscriptions, unsubscribeEvents } from './eventFanout';

describe('eventFanout', () => {
  beforeEach(() => {
    removePluginSubscriptions('p1');
    removePluginSubscriptions('p2');
    eventApi.emit.mockClear();
    coreApi.invoke.mockClear();
  });

  it('removePluginSubscriptions clears all patterns for a plugin', () => {
    subscribeEvents('p1', ['ssh://status/*', 'ui:nav']);
    subscribeEvents('p2', ['ssh://status/*']);
    removePluginSubscriptions('p1');
    // p1 gone; unsubscribe on empty set is no-op
    expect(unsubscribeEvents('p1', ['ssh://status/*'])).toEqual([]);
    // p2 still has subscription
    expect(unsubscribeEvents('p2', ['ssh://status/*'])).toEqual(['ssh://status/*']);
  });

  it('reports the subscriber count to the backend on every change', () => {
    subscribeEvents('p1', ['e1', 'e2']);
    expect(lastReportedCount()).toBe(2);

    // 重复订阅同一 pattern 不改变总数 → 不再上报
    coreApi.invoke.mockClear();
    subscribeEvents('p1', ['e1']);
    expect(lastReportedCount()).toBeNull();

    unsubscribeEvents('p1', ['e1']);
    expect(lastReportedCount()).toBe(1);

    removePluginSubscriptions('p1');
    expect(lastReportedCount()).toBe(0);
  });

  it('forwards rapid events with the same name without dropping or reordering them', async () => {
    subscribeEvents('p1', ['agent://stream/*']);
    await vi.waitFor(() => expect(eventApi.listener).not.toBeNull());

    eventApi.listener!({
      payload: { event: 'agent://stream/task-1', data: { text: 'first' } },
    });
    eventApi.listener!({
      payload: { event: 'agent://stream/task-1', data: { text: 'second' } },
    });

    expect(eventApi.emit).toHaveBeenNthCalledWith(1, 'plugin-event-p1', {
      event: 'agent://stream/task-1',
      data: { text: 'first' },
    });
    expect(eventApi.emit).toHaveBeenNthCalledWith(2, 'plugin-event-p1', {
      event: 'agent://stream/task-1',
      data: { text: 'second' },
    });
  });
});

/** 最近一次订阅数上报的 count 值；从未上报返回 null。 */
function lastReportedCount(): number | null {
  const calls = coreApi.invoke.mock.calls.filter(
    (c) => c[0] === 'plugin_events_report_subscribers',
  );
  return calls.length ? (calls[calls.length - 1][1].count as number) : null;
}
