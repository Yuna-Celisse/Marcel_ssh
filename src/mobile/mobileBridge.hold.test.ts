// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  holdForeground,
  releaseForeground,
  stopForegroundService,
} from './mobileBridge';

const start = vi.fn();
const stop = vi.fn();

beforeEach(() => {
  start.mockClear();
  stop.mockClear();
  window.AndroidBridge = {
    startForegroundService: start,
    stopForegroundService: stop,
  } as unknown as typeof window.AndroidBridge;
});

afterEach(() => {
  // 清掉模块级登记，避免用例之间串味
  releaseForeground('mcp-server', false);
  releaseForeground('other', false);
  delete window.AndroidBridge;
});

describe('前台服务保活登记', () => {
  it('登记会拉起服务并带上通知文案', () => {
    holdForeground('mcp-server', 'MCP 服务', '127.0.0.1:8765');
    expect(start).toHaveBeenCalledWith('MCP 服务', '127.0.0.1:8765');
  });

  it('登记期间，用户关掉保活开关 / 临时保活收尾都停不掉服务', () => {
    holdForeground('mcp-server', 'MCP 服务', '127.0.0.1:8765');
    stop.mockClear();
    stopForegroundService();
    expect(stop).not.toHaveBeenCalled();
  });

  it('释放后无人需要且用户没开保活：真正停服务', () => {
    holdForeground('mcp-server', 'MCP 服务', '127.0.0.1:8765');
    releaseForeground('mcp-server', false);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('释放后用户自己开着保活：服务保留，通知文案恢复默认', () => {
    holdForeground('mcp-server', 'MCP 服务', '127.0.0.1:8765');
    start.mockClear();
    releaseForeground('mcp-server', true);
    expect(stop).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith('Marcel SSH', '运行中');
  });

  it('还有别的登记时释放一项不停服务', () => {
    holdForeground('mcp-server', 'MCP 服务', 'a');
    holdForeground('other', '其它', 'b');
    releaseForeground('other', false);
    expect(stop).not.toHaveBeenCalled();
  });

  it('释放没登记过的 key 是 no-op（重复点关闭不会误停）', () => {
    releaseForeground('never-held', false);
    expect(stop).not.toHaveBeenCalled();
  });
});
