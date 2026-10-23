// 会话分叉的前端锚点解析：把「收尾条挂的那条 live 消息」翻译成后端能定位的
// 锚点引用。这里只做纯翻译，切到分叉由 sessionConversationBindingManager
// 走与点历史列表同一条路径。
import type { AgentMessage } from '@/lib/types';
import { isTurnStart } from '@/lib/agentTurnFold';

/** 交给后端的分叉锚点。 */
export interface ForkAnchorRef {
  /** 库内消息行 id。live 消息回填过 `dbId` 就是它；没有则退回前端临时 id
   * （后端解析不到时会拿 `turnStartedAt` 兜底）。 */
  readonly messageId: string;
  /** 锚点所在回合**首条 user/notice 消息的发送时间**（RFC3339）。live 回合的
   * 前端 id 在库里不存在，时间戳两个域通用——与撤回的定位同思路。 */
  readonly turnStartedAt?: string;
}

/**
 * 由锚点消息解析分叉锚点。`messages` 是当前会话的完整消息列（live store 或
 * 重载后的都行）；找不到 `anchorMessageId` 时退化为只传 id（后端给不出
 * 时间戳兜底，与旧版行为一致）。
 */
export function resolveForkAnchor(
  messages: readonly AgentMessage[],
  anchorMessageId: string,
): ForkAnchorRef {
  const at = messages.findIndex((m) => m.id === anchorMessageId);
  if (at === -1) return { messageId: anchorMessageId };
  const messageId = messages[at].dbId ?? messages[at].id;
  // 往前找本回合的首条消息（user/notice）——它的 timestamp 就是回合起点。
  // 与回合折叠（agentTurnFold）同一套边界判据，不另起一套。
  let start = at;
  while (start > 0 && !isTurnStart(messages[start])) start -= 1;
  const turnStartedAt = isTurnStart(messages[start]) ? messages[start].timestamp : undefined;
  return turnStartedAt ? { messageId, turnStartedAt } : { messageId };
}
