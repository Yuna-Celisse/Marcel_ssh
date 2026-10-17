import type { WebSearchApiProvider } from './types';

/**
 * 「搜索 API」模式可选的提供商——桌面设置页与移动端设置页共用这一份，
 * 新增提供商只改这里（以及后端 `WebSearchApiProvider` 枚举，线上取值须一致；
 * 它用哪个 Key 槽位见 `toolApiKeys.searchProviderKeySlot`）。
 */
export const WEB_SEARCH_API_PROVIDERS: readonly { value: WebSearchApiProvider; label: string }[] = [
  { value: 'brave', label: 'Brave Search' },
  { value: 'tavily', label: 'Tavily' },
  { value: 'deepseek', label: 'DeepSeek 搜索' },
];

/** DeepSeek Key 输入框的说明——搜索与网页获取两处共用，免得两边各写各的。 */
export const DEEPSEEK_KEY_DESCRIPTION =
  '加密保存在本设备，不会写入配置文件。填 DeepSeek 开放平台的 API Key（与对话用的是同一种）；网页搜索与网页获取共用这一份，各自按成功请求计费，详见 DeepSeek 官方定价。';

/** 「获取方式 = DeepSeek 抓取」的说明：数据去向、需要 Key、计费、内网例外都要讲清。 */
export const DEEPSEEK_FETCH_DESCRIPTION =
  '由 DeepSeek 服务器代为抓取公网网页并转成 Markdown，需要 DeepSeek API Key，按成功请求计费。内网 / 本机地址不会发给 DeepSeek，始终在本机读取。';

/** 获取方式的 DeepSeek Key 行补充一句：它和搜索那一行是同一把 Key，别让人以为要填两遍。 */
export const DEEPSEEK_KEY_SHARED_NOTE = '与「搜索 API = DeepSeek 搜索」共用同一把 Key。';

/**
 * 搜索 API Key 的说明文案。
 *
 * Brave 与 Tavily 共用本机的同一份 Key，所以切换后旧 Key 仍显示「已保存」却会被新提供商
 * 拒绝——这里明说，免得用户对着 401 发懵。DeepSeek 有独立槽位，不受此限。
 */
export function searchKeyDescription(provider: WebSearchApiProvider): string {
  if (provider === 'deepseek') return DEEPSEEK_KEY_DESCRIPTION;
  return '加密保存在本设备，不会写入配置文件；Brave 与 Tavily 共用这一份，切换后请重新填写。';
}
