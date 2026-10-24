// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useSettingsStore } from "@/stores/settingsStore";
import { getUiThemePreset, applyUiTheme } from "@/lib/uiTheme";
import type { UiThemeSettings } from "@/lib/types";
import { useUiTheme } from "./useUiTheme";

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  useUiTheme();
  return null;
}

const daylight = (): UiThemeSettings => ({
  presetId: "daylight",
  zones: { ...getUiThemePreset("daylight")!.zones },
});
const obsidian = (): UiThemeSettings => ({
  presetId: "obsidian",
  zones: { ...getUiThemePreset("obsidian")!.zones },
});

let container: HTMLDivElement;
let root: Root;
let transitions: number;
const doc = document as unknown as { startViewTransition?: unknown };

beforeEach(() => {
  document.documentElement.removeAttribute("style");
  delete document.documentElement.dataset.marcelTheme;
  localStorage.clear();
  transitions = 0;
  doc.startViewTransition = vi.fn((update: () => void) => {
    transitions += 1;
    update();
    return { ready: Promise.resolve() };
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete doc.startViewTransition;
  useSettingsStore.setState({ loaded: false, preview: null });
});

describe("useUiTheme 启动与切换", () => {
  it("启动：设置没加载完不应用（不把缓存主题盖成默认），加载完第一次应用不带动画", async () => {
    // 启动早期缓存已把浅色应用上去
    applyUiTheme(daylight(), false);
    expect(document.documentElement.dataset.marcelTheme).toBe("light");

    // store 里此时还是默认值（曜石），未加载
    useSettingsStore.setState({ loaded: false });
    await act(async () => {
      root.render(<Probe />);
    });
    expect(document.documentElement.dataset.marcelTheme).toBe("light");

    // 加载完成：真实设置是晨雾，落位不应播放揭开
    await act(async () => {
      useSettingsStore.setState({
        loaded: true,
        settings: {
          ...useSettingsStore.getState().settings,
          uiTheme: daylight(),
        },
      });
    });
    expect(document.documentElement.dataset.marcelTheme).toBe("light");
    expect(transitions).toBe(0);
  });

  it("加载完之后用户切换预设才带揭开动画", async () => {
    useSettingsStore.setState({
      loaded: true,
      settings: {
        ...useSettingsStore.getState().settings,
        uiTheme: daylight(),
      },
    });
    await act(async () => {
      root.render(<Probe />);
    });
    expect(transitions).toBe(0);
    await act(async () => {
      useSettingsStore.setState({
        settings: {
          ...useSettingsStore.getState().settings,
          uiTheme: obsidian(),
        },
      });
    });
    expect(transitions).toBe(1);
  });
});
