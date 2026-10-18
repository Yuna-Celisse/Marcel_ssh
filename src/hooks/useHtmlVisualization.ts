import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentMessage } from "@/lib/types";
import {
  buildSettledVisualizationDoc,
  buildStreamingVisualizationDoc,
  HTML_VIZ_HEIGHT_MESSAGE,
  HTML_VIZ_STREAM_MESSAGE,
  resolveVisualizationTheme,
  trimIncompleteStreamingScript,
  visualizationPresentation,
  type HtmlVisualizationTheme,
} from "@/lib/htmlVisualization";

export const VISUALIZATION_MIN_HEIGHT = 48;

/** 宿主主题（含深浅色切换）变化时重新解析，iframe 文档随之重建。 */
export function useVisualizationTheme(): HtmlVisualizationTheme {
  const [theme, setTheme] = useState(resolveVisualizationTheme);
  useEffect(() => {
    const refreshTheme = () => setTheme(resolveVisualizationTheme());
    const observer = new MutationObserver(refreshTheme);
    observer.observe(document.documentElement, { attributes: true });
    observer.observe(document.body, { attributes: true });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", refreshTheme);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", refreshTheme);
    };
  }, []);
  return theme;
}

interface Options {
  /** 内联文档能否在 iframe 内滚动；手机端对话内版本传 false。默认 true。 */
  scrollable?: boolean;
}

/**
 * 对话内可视化 iframe 的共用逻辑：展示数据、主题、流式 / 定稿文档、高度上报与
 * 流式推送。两端容器（桌面 `HtmlVisualization`、手机 `MobileHtmlVisualization`）
 * 只负责外框、高度上限与各自的入口，不重复这一套。
 *
 * `contentHeight` 是 iframe 里内容的真实高度（只保证不小于最小值），**不含上限**：
 * 上限因端而异（桌面按 `mode`，手机按屏高），由容器自己取。
 */
export function useHtmlVisualization(
  message: AgentMessage,
  { scrollable = true }: Options = {},
) {
  const presentation = visualizationPresentation(message);
  const { title, fragment } = presentation;
  const token = message.toolResult?.toolCallId ?? message.id;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [contentHeight, setContentHeight] = useState(VISUALIZATION_MIN_HEIGHT);
  const theme = useVisualizationTheme();

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as {
        type?: unknown;
        token?: unknown;
        height?: unknown;
      } | null;
      if (data?.type !== HTML_VIZ_HEIGHT_MESSAGE || data.token !== token)
        return;
      if (typeof data.height !== "number" || !Number.isFinite(data.height))
        return;
      setContentHeight(
        Math.max(VISUALIZATION_MIN_HEIGHT, Math.ceil(data.height)),
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [token]);

  const streamingDoc = useMemo(
    () => buildStreamingVisualizationDoc(theme, token, { scrollable }),
    [theme, token, scrollable],
  );
  const settledDoc = useMemo(
    () =>
      buildSettledVisualizationDoc(fragment, title, theme, token, {
        scrollable,
      }),
    [fragment, title, theme, token, scrollable],
  );
  const doc = message.isExecuting ? streamingDoc : settledDoc;

  useEffect(() => {
    if (!message.isExecuting || !loaded || !fragment.trim()) return;
    frameRef.current?.contentWindow?.postMessage(
      {
        type: HTML_VIZ_STREAM_MESSAGE,
        token,
        fragment: trimIncompleteStreamingScript(fragment),
      },
      "*",
    );
  }, [fragment, loaded, message.isExecuting, token]);

  return {
    ...presentation,
    token,
    frameRef,
    theme,
    doc,
    contentHeight,
    onLoad: () => setLoaded(true),
  };
}
