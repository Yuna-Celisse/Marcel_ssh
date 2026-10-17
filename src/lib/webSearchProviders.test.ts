import { describe, expect, it } from 'vitest';
import {
  DEEPSEEK_FETCH_DESCRIPTION,
  DEEPSEEK_KEY_DESCRIPTION,
  WEB_SEARCH_API_PROVIDERS,
  searchKeyDescription,
} from './webSearchProviders';

describe('WEB_SEARCH_API_PROVIDERS', () => {
  it('lists every backend provider once, using the wire names the Rust enum serializes to', () => {
    expect(WEB_SEARCH_API_PROVIDERS.map((p) => p.value)).toEqual(['brave', 'tavily', 'deepseek']);
  });
});

describe('searchKeyDescription', () => {
  it('warns Brave/Tavily users that the key is shared, so a stale key after switching is not a mystery', () => {
    for (const provider of ['brave', 'tavily'] as const) {
      expect(searchKeyDescription(provider)).toContain('切换后请重新填写');
    }
  });

  it('tells DeepSeek users which key to use, that it is shared with fetch, and that it is billed', () => {
    const text = searchKeyDescription('deepseek');
    expect(text).toBe(DEEPSEEK_KEY_DESCRIPTION);
    expect(text).toContain('DeepSeek 开放平台');
    expect(text).toContain('网页获取共用');
    expect(text).toContain('计费');
    // DeepSeek has its own slot: the "re-enter after switching" warning would be wrong.
    expect(text).not.toContain('切换后请重新填写');
  });
});

describe('DEEPSEEK_FETCH_DESCRIPTION', () => {
  it('states where the page goes, what it needs, and the local-only exception', () => {
    expect(DEEPSEEK_FETCH_DESCRIPTION).toContain('DeepSeek 服务器');
    expect(DEEPSEEK_FETCH_DESCRIPTION).toContain('API Key');
    expect(DEEPSEEK_FETCH_DESCRIPTION).toContain('计费');
    expect(DEEPSEEK_FETCH_DESCRIPTION).toContain('内网');
  });
});
