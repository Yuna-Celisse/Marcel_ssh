import { forwardRef, useCallback, useEffect, useLayoutEffect, useRef, type ReactNode, type TextareaHTMLAttributes } from 'react';
import { EMPTY_DRAFT, useAgentDraftStore } from '@/stores/agentDraftStore';
import { celebrateTyping } from '@/lib/typingConfetti';

/** Draft updates belong to the composer, not the transcript or its host. */
export function AgentDraft({ draftKey, children }: { draftKey: string; children: (draft: string) => ReactNode }) {
  const draft = useAgentDraftStore((s) => (s.drafts[draftKey] ?? EMPTY_DRAFT).text);
  return children(draft);
}

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> & {
  draftKey: string;
  maxHeight: number;
  onTyping?: () => void;
};

export const AgentTextarea = forwardRef<HTMLTextAreaElement, Props>(
  function AgentTextarea({ draftKey, maxHeight, onTyping, ...props }, forwardedRef) {
    const draft = useAgentDraftStore((s) => (s.drafts[draftKey] ?? EMPTY_DRAFT).text);
    const setDraft = useAgentDraftStore((s) => s.setText);
    const ref = useRef<HTMLTextAreaElement | null>(null);
    // One measurement after the value is committed, including restore/clear/attachments.
    // 量内容高度用的离屏影子 textarea。**不能**把真实输入框临时设成 height:auto 来量：
    // ① 折叠那一刻内容全可见，浏览器把它的 scrollTop 夹到 0，超过 maxHeight 后每敲一个字
    //    文字都先跳回顶部再被光标拉回（「超过第三行就闪」）；
    // ② 输入框一折叠，上方消息区瞬间变高，浏览器夹住它的 scrollTop，输入框长回去后
    //    消息区底部被顶上去、等跟随逻辑再拽回来（「推上去又拽下来」）。
    // 影子是 absolute + visibility:hidden，不参与任何兄弟布局，真实节点只写一次最终高度。
    const mirrorRef = useRef<HTMLTextAreaElement | null>(null);
    useEffect(() => () => {
      mirrorRef.current?.remove();
      mirrorRef.current = null;
    }, []);
    // One measurement after the value is committed, including restore/clear/attachments.
    const resize = useCallback(() => {
      const node = ref.current;
      if (!node) return;
      let mirror = mirrorRef.current;
      if (!mirror || mirror.parentElement !== node.parentElement) {
        mirror?.remove();
        mirror = node.cloneNode(false) as HTMLTextAreaElement;
        mirror.removeAttribute('id');
        mirror.removeAttribute('name');
        mirror.removeAttribute('placeholder');
        mirror.tabIndex = -1;
        mirror.disabled = true;
        mirror.setAttribute('aria-hidden', 'true');
        node.parentElement?.appendChild(mirror);
        mirrorRef.current = mirror;
      }
      mirror.className = node.className;
      mirror.style.cssText =
        `position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;overflow:hidden;` +
        `height:0;min-height:0;max-height:none;width:${node.offsetWidth}px`;
      mirror.value = node.value;
      // 空内容时 height:0 的 scrollHeight 也含一行；至少保证一行高
      const next = `${Math.min(mirror.scrollHeight, maxHeight)}px`;
      if (node.style.height !== next) node.style.height = next;
    }, [maxHeight]);
    useLayoutEffect(resize, [draft, resize]);
    useEffect(() => {
      const node = ref.current;
      if (!node || typeof ResizeObserver === 'undefined') return;
      let width = node.clientWidth;
      const observer = new ResizeObserver(() => {
        const nextWidth = node.clientWidth;
        if (nextWidth === width) return;
        width = nextWidth;
        resize();
      });
      observer.observe(node);
      return () => observer.disconnect();
    }, [resize]);

    return <textarea
      {...props}
      ref={(node) => {
        ref.current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) forwardedRef.current = node;
      }}
      value={draft}
      onChange={(event) => {
        // 桌面与手机的 Agent 输入框都经这里：「至尊无敌特效」只需接这一处
        celebrateTyping(event.target, draft, event.target.value);
        setDraft(draftKey, event.target.value);
        onTyping?.();
      }}
    />;
  },
);
