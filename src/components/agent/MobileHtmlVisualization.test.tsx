// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentMessage } from "@/lib/types";
import { HTML_VIZ_HEIGHT_MESSAGE } from "@/lib/htmlVisualization";
import { resetBackHandlers } from "@/mobile/backHandler";
import MobileHtmlVisualization from "./MobileHtmlVisualization";

const NO_SCROLL_RULE = "html, body { overflow: hidden; }";

let host: HTMLDivElement;
let root: Root;

function vizMessage(overrides: Partial<AgentMessage> = {}): AgentMessage {
  return {
    id: "m1",
    role: "tool",
    content: "",
    timestamp: "",
    toolResult: {
      toolName: "render_html",
      summary: "",
      result: "",
      success: true,
      blocked: false,
      arguments: { title: "利率对比", fragment: "<div id='x'>chart</div>" },
      toolCallId: "call-1",
    },
    ...overrides,
  };
}

async function render(message: AgentMessage = vizMessage()) {
  await act(async () =>
    root.render(<MobileHtmlVisualization message={message} />),
  );
}

function inlineFrame() {
  return host.querySelector<HTMLIFrameElement>("iframe")!;
}

async function reportHeight(height: number) {
  const frame = inlineFrame();
  await act(async () => {
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: HTML_VIZ_HEIGHT_MESSAGE, token: "call-1", height },
        source: frame.contentWindow,
      }),
    );
  });
}

function button(name: string, scope: ParentNode = host) {
  return scope.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
}

function fullscreenText(): HTMLButtonElement | undefined {
  return [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("全屏查看"),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // 390×844 的竖屏手机：高度上限 round(844 × 0.65) = 549。
  vi.stubGlobal("innerWidth", 390);
  vi.stubGlobal("innerHeight", 844);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  resetBackHandlers();
  vi.unstubAllGlobals();
});

describe("MobileHtmlVisualization", () => {
  it("inline document cannot scroll, so a swipe on it moves the conversation", async () => {
    await render();
    expect(inlineFrame().srcdoc).toContain(NO_SCROLL_RULE);
  });

  it("shows short content in full, with no crop and no fade", async () => {
    await render();
    await reportHeight(300);
    expect(inlineFrame().style.height).toBe("300px");
    expect(fullscreenText()).toBeUndefined();
    // 标题行的图标入口仍在：生成完成后随时可以放大看。
    expect(button("全屏查看")).not.toBeNull();
  });

  it("caps tall content to about one screen and offers fullscreen at the crop", async () => {
    await render();
    await reportHeight(1400);
    expect(inlineFrame().style.height).toBe("549px");
    expect(fullscreenText()).toBeDefined();
  });

  it("does not crop content that only just exceeds the cap", async () => {
    await render();
    await reportHeight(549 + 20);
    expect(inlineFrame().style.height).toBe("569px");
    expect(fullscreenText()).toBeUndefined();
  });

  it("keeps a landscape phone usable instead of a sliver", async () => {
    vi.stubGlobal("innerWidth", 844);
    vi.stubGlobal("innerHeight", 390);
    await render();
    await reportHeight(1400);
    // 390 × 0.65 = 254，低于横屏下限 280。
    expect(inlineFrame().style.height).toBe("280px");
  });

  it("follows rotation without a new report from the frame", async () => {
    await render();
    await reportHeight(1400);
    expect(inlineFrame().style.height).toBe("549px");
    vi.stubGlobal("innerWidth", 844);
    vi.stubGlobal("innerHeight", 390);
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(inlineFrame().style.height).toBe("280px");
  });

  it("offers no fullscreen entry while the visualization is still being built", async () => {
    await render(vizMessage({ isExecuting: true }));
    await reportHeight(1400);
    expect(inlineFrame().style.height).toBe("549px");
    expect(button("全屏查看")).toBeNull();
    expect(fullscreenText()).toBeUndefined();
  });

  it("opens a scrollable fullscreen instance and closes it with the back gesture", async () => {
    await render();
    await reportHeight(1400);
    await act(async () => fullscreenText()!.click());

    const viewer = document.querySelector<HTMLElement>(
      '[data-region="mobile-html-viz-viewer"]',
    )!;
    expect(viewer).not.toBeNull();
    const viewerFrame = viewer.querySelector("iframe")!;
    expect(viewerFrame.srcdoc).toContain("chart");
    expect(viewerFrame.srcdoc).not.toContain(NO_SCROLL_RULE);
    // 新实例：与对话里那份是两个 iframe。
    expect(viewerFrame).not.toBe(inlineFrame());

    // 退出动画在 jsdom 里不会触发 animationend，走查看器自带的兜底定时器。
    vi.useFakeTimers();
    try {
      await act(async () => {
        expect(window.__marcelHandleBack?.()).toBe(true);
      });
      await act(async () => vi.advanceTimersByTime(450));
    } finally {
      vi.useRealTimers();
    }
    expect(
      document.querySelector('[data-region="mobile-html-viz-viewer"]'),
    ).toBeNull();
  });

  it("title-row icon opens the same viewer", async () => {
    await render();
    await act(async () => button("全屏查看")!.click());
    expect(
      document.querySelector('[data-region="mobile-html-viz-viewer"]'),
    ).not.toBeNull();
  });

  it("shows failures as a line of text instead of a frame", async () => {
    await render(
      vizMessage({
        toolResult: {
          ...vizMessage().toolResult!,
          success: false,
          summary: "render_html: 只接受 HTML fragment",
        },
      }),
    );
    expect(host.textContent).toContain("只接受 HTML fragment");
    expect(host.querySelector("iframe")).toBeNull();
  });
});
