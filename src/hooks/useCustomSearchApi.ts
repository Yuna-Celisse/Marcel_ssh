import { useState } from 'react';
import type { CustomSearchApi, SearchApiProtocol } from '@/lib/types';
import { checkCustomSearchUrl, type CustomUrlCheck } from '@/lib/webSearchProviders';

export interface CustomSearchApiForm {
  /** 输入框里的当前文本（可能还没提交）。 */
  urlDraft: string;
  setUrlDraft: (text: string) => void;
  /** 对当前草稿的检查结果；空草稿 = 还没填，`ok=false` 但没有 `error`。 */
  check: CustomUrlCheck;
  /** 失焦时调用：合法或清空就提交，不合法的留在输入框里等用户改，不写进配置。 */
  commitUrl: () => void;
  protocol: SearchApiProtocol;
  setProtocol: (protocol: SearchApiProtocol) => void;
}

/**
 * 「自定义搜索 API」地址 + 协议的表单状态——桌面与移动端设置页共用。
 *
 * 地址按失焦提交而不是逐字写入：`settings.update` 每次都整份序列化落盘，打一个 URL 会写几十次；
 * 而且写到一半的 `https://exa` 也没有存的价值。协议是点选，立即提交。
 * 配置从外部变了（首次加载、另一窗口改了）时，草稿跟着对齐，免得输入框显示旧值。
 */
export function useCustomSearchApi(
  committed: CustomSearchApi,
  onChange: (next: CustomSearchApi) => void,
): CustomSearchApiForm {
  const [urlDraft, setUrlDraft] = useState(committed.url);
  const [seen, setSeen] = useState(committed.url);
  if (seen !== committed.url) {
    // 渲染期同步外部变化（React 推荐的「由 props 派生 state」写法，不用 effect）。
    setSeen(committed.url);
    setUrlDraft(committed.url);
  }

  const check = checkCustomSearchUrl(urlDraft);

  const commitUrl = () => {
    const text = urlDraft.trim();
    if (text === committed.url) {
      if (text !== urlDraft) setUrlDraft(text);
      return;
    }
    if (text === '' || check.ok) {
      setUrlDraft(text);
      onChange({ ...committed, url: text });
    }
  };

  return {
    urlDraft,
    setUrlDraft,
    check,
    commitUrl,
    protocol: committed.protocol,
    setProtocol: (protocol) => {
      if (protocol !== committed.protocol) onChange({ ...committed, protocol });
    },
  };
}
