/**
 * 长期记忆的后端命令（`src-tauri/src/commands/memory.rs`）。
 *
 * 单独成模块而不放进 `tauri.ts`：记忆的界面挂在消息列表、Agent 面板头部这些
 * 到处都有的地方，放进 `tauri.ts` 会让所有 mock 了它的测试都得补一遍记忆命令。
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  AssistantReply,
  AssistantTurn,
  InjectedMemories,
  MemoryOpRecord,
  MemoryOverview,
  MemoryWriteOp,
  ReflectionNote,
  ScopeRef,
} from "./memory";

/** 记忆管理页：全部记忆 + 各作用域计数。 */
export async function memoryOverview(): Promise<MemoryOverview> {
  return invoke<MemoryOverview>("memory_overview");
}

/** 用户在管理页的一批增删改 / 置顶（全有或全无）。 */
export async function memoryApply(ops: MemoryWriteOp[]): Promise<MemoryOpRecord[]> {
  return invoke<MemoryOpRecord[]>("memory_apply", { ops });
}

export async function memoryRevertOp(opId: number): Promise<MemoryOpRecord> {
  return invoke<MemoryOpRecord>("memory_revert_op", { opId });
}

export async function memoryRevertBatch(batchId: string): Promise<MemoryOpRecord[]> {
  return invoke<MemoryOpRecord[]>("memory_revert_batch", { batchId });
}

export async function memoryBatchOps(batchId: string): Promise<MemoryOpRecord[]> {
  return invoke<MemoryOpRecord[]>("memory_batch_ops", { batchId });
}

export async function memoryMarkSeen(ids: string[]): Promise<void> {
  return invoke("memory_mark_seen", { ids });
}

export async function memoryReflectionNotes(conversationId: string): Promise<ReflectionNote[]> {
  return invoke<ReflectionNote[]>("memory_reflection_notes", { conversationId });
}

/** 这段对话带着哪些记忆（还没开始的对话：开始时会带上的）。 */
export async function memoryConversationInjected(
  conversationId: string | null,
  sessionId: string | null,
): Promise<InjectedMemories> {
  return invoke<InjectedMemories>("memory_conversation_injected", {
    conversationId,
    sessionId,
  });
}

export async function memoryCountForConnection(connectionId: string): Promise<number> {
  return invoke<number>("memory_count_for_connection", { connectionId });
}

export async function memoryDeleteScope(
  scope: ScopeRef,
): Promise<{ batchId: string; count: number }> {
  return invoke<{ batchId: string; count: number }>("memory_delete_scope", { scope });
}

/** 整理助手跑一次（进度经 `memory-assistant-progress` 事件推送）。 */
export async function memoryAssistantRun(
  runId: string,
  history: AssistantTurn[],
  prompt: string,
  focus: ScopeRef | null,
): Promise<AssistantReply> {
  return invoke<AssistantReply>("memory_assistant_run", {
    runId,
    history,
    prompt,
    focus,
  });
}

export async function memoryAssistantCancel(runId: string): Promise<boolean> {
  return invoke<boolean>("memory_assistant_cancel", { runId });
}
