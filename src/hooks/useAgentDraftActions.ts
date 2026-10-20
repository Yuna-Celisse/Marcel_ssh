import { useCallback, useRef, type MutableRefObject } from "react";
import type { AgentMessage } from "@/lib/types";
import { getErrorMessage } from "@/lib/errors";
import { useTaskStore } from "@/stores/taskStore";
import {
  conversationHasRunningTask,
  conversationIsBusy,
  conversationIsCompacting,
  useConversationStore,
} from "@/stores/conversationStore";
import {
  MAX_QUEUED_MESSAGES,
  drainQueue,
  useAgentQueueStore,
} from "@/stores/agentQueueStore";
import {
  beginDraftImport,
  draftImportTarget,
  endDraftImport,
  draftKeyFor,
  useAgentDraftStore,
} from "@/stores/agentDraftStore";
import type { AgentAttachments } from "./useAgentAttachments";

interface Args {
  attachments: AgentAttachments;
  sessionId: string | null;
  connectionId?: string;
  conversationId: string | null;
  canInteract: boolean;
  userJustSentRef: MutableRefObject<boolean>;
  onRollback?: (removedCount: number) => void;
  onSend?: () => void;
}

/** 两端共用发送快照与撤回恢复；异步结果始终回到发起操作的草稿。 */
export function useAgentDraftActions({
  attachments,
  sessionId,
  connectionId,
  conversationId,
  canInteract,
  userJustSentRef,
  onRollback,
  onSend,
}: Args) {
  const sending = useAgentDraftStore((s) => !!s.sending[attachments.draftKey]);
  const latestSendIdRef = useRef<string | null>(null);

  /**
   * 任务还在跑（或队列里已有排着的、未暂停）时，输入进发送队列而不是被吞掉：
   * 这一轮自然结束后由 `agentQueueStore` 自动发出。队列非空时哪怕恰好撞上空窗也进队尾，
   * 保持先进先出。手动压缩期间照旧不可发送（压缩卡会盖住期间写入的消息）。
   */
  const enqueue = useCallback((targetConversationId: string, targetSessionId: string) => {
    const detached = attachments.takeDetachedDraft();
    if (!detached) return;
    onSend?.();
    const queued = useAgentQueueStore.getState().enqueue({
      conversationId: targetConversationId,
      sessionId: targetSessionId,
      connectionId,
      draft: detached,
    });
    if (!queued) {
      const drafts = useAgentDraftStore.getState();
      drafts.restoreDetached(attachments.draftKey, detached);
      drafts.setNotice(
        attachments.draftKey,
        `排队的消息已达 ${MAX_QUEUED_MESSAGES} 条上限，输入已保留，请等待发出或清理队列`,
      );
      return;
    }
    // 入队与回合结束之间可能刚好错过了空窗；空闲且未暂停时由它立刻发出（忙则无事发生）。
    void drainQueue(targetConversationId);
  }, [attachments, connectionId, onSend]);

  const send = useCallback(async () => {
    if (!canInteract || !sessionId) return;
    if (conversationId) {
      if (conversationIsCompacting(conversationId)) return;
      const queue = useAgentQueueStore.getState();
      if (
        conversationHasRunningTask(conversationId) ||
        (!!queue.items[conversationId]?.length && !queue.paused[conversationId])
      ) {
        enqueue(conversationId, sessionId);
        return;
      }
    }
    const snapshot = attachments.takeSendSnapshot();
    if (!snapshot) return;
    latestSendIdRef.current = snapshot.id;
    userJustSentRef.current = true;
    onSend?.();
    try {
      const taskId = await useTaskStore.getState().startTask(
        sessionId,
        snapshot.text,
        connectionId,
        snapshot.images.map((item) => item.dataUrl),
        snapshot.images.flatMap((item) =>
          item.persistedPath ? [item.persistedPath] : [],
        ),
        {
          conversationId: conversationId ?? undefined,
          userInput:
            snapshot.textAttachments.length > 0 || snapshot.skills.length > 0
              ? snapshot.userInput
              : undefined,
        },
      );
      const targetId =
        useTaskStore.getState().tasks[taskId]?.conversationId ?? conversationId;
      attachments.finishSend(snapshot, {
        status: "committed",
        draftKey: targetId ? draftKeyFor(targetId, sessionId) : undefined,
      });
    } catch (error) {
      const detail =
        error && typeof error === "object"
          ? (error as { stage?: string; conversationId?: string })
          : {};
      const committed = detail.stage === "start_task";
      const targetKey = detail.conversationId
        ? draftKeyFor(detail.conversationId, sessionId)
        : snapshot.draftKey;
      attachments.finishSend(snapshot, {
        status: committed ? "committed" : "rejected",
        draftKey: targetKey,
        notice: committed
          ? undefined
          : `未发送：${getErrorMessage(error)}。输入与附件已保留。`,
      });
      // 双端跨会话复用滚动 ref；旧发送不能清掉后来发送的滚动意图。
      if (!committed && latestSendIdRef.current === snapshot.id) {
        userJustSentRef.current = false;
      }
    }
  }, [
    attachments,
    sessionId,
    connectionId,
    conversationId,
    canInteract,
    userJustSentRef,
    onSend,
    enqueue,
  ]);

  const rollback = useCallback(
    async (message: AgentMessage) => {
      if (!conversationId || conversationIsBusy(conversationId) || sending)
        return;
      const importId = beginDraftImport(attachments.draftKey);
      try {
        const result = await useConversationStore
          .getState()
          .rollbackToMessage(conversationId, message.id);
        const targetKey = draftImportTarget(importId);
        if (!targetKey) return;
        await useAgentDraftStore.getState().restoreMessage(targetKey, {
          text: result.prompt,
          textAttachments: result.userInput?.textAttachments,
          skills: result.userInput?.skills,
          imagePaths: result.imagePaths?.length
            ? result.imagePaths
            : message.imagePaths,
        });
        if (
          draftImportTarget(importId) &&
          useConversationStore.getState().activeConversationId ===
            conversationId
        ) {
          onRollback?.(result.removedCount);
        }
      } catch (error) {
        const targetKey = draftImportTarget(importId);
        if (targetKey) {
          useAgentDraftStore
            .getState()
            .setNotice(targetKey, `撤回失败：${getErrorMessage(error)}`);
        }
      } finally {
        endDraftImport(importId);
      }
    },
    [attachments.draftKey, conversationId, sending, onRollback],
  );

  return { send, rollback, sending };
}
