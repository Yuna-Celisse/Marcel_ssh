import { beforeEach, describe, expect, it, vi } from 'vitest';

const tauriMock = vi.hoisted(() => ({
  saveWebSearchApiKey: vi.fn(),
  deleteWebSearchApiKey: vi.fn(),
  saveDeepseekToolsApiKey: vi.fn(),
  deleteDeepseekToolsApiKey: vi.fn(),
}));
vi.mock('@/lib/tauri', () => tauriMock);

import { useSettingsStore } from '@/stores/settingsStore';
import { clearToolApiKey, saveToolApiKey, searchProviderKeySlot } from './toolApiKeys';

beforeEach(() => {
  for (const fn of Object.values(tauriMock)) fn.mockReset().mockResolvedValue(undefined);
  useSettingsStore.setState({ hasWebSearchApiKey: false, hasDeepseekToolsApiKey: false });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('searchProviderKeySlot', () => {
  it('gives DeepSeek its own slot and keeps Brave/Tavily on the legacy one', () => {
    expect(searchProviderKeySlot('deepseek')).toBe('deepseek');
    expect(searchProviderKeySlot('brave')).toBe('search');
    expect(searchProviderKeySlot('tavily')).toBe('search');
  });
});

describe('saveToolApiKey', () => {
  it('stores a DeepSeek key in the DeepSeek slot only', async () => {
    expect(await saveToolApiKey('deepseek', '  sk-abc \n')).toBe(true);

    expect(tauriMock.saveDeepseekToolsApiKey).toHaveBeenCalledWith('sk-abc');
    expect(tauriMock.saveWebSearchApiKey).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().hasDeepseekToolsApiKey).toBe(true);
    expect(useSettingsStore.getState().hasWebSearchApiKey).toBe(false);
  });

  it('stores a Brave/Tavily key in the legacy slot only', async () => {
    expect(await saveToolApiKey('search', 'brave-key')).toBe(true);

    expect(tauriMock.saveWebSearchApiKey).toHaveBeenCalledWith('brave-key');
    expect(tauriMock.saveDeepseekToolsApiKey).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().hasWebSearchApiKey).toBe(true);
    expect(useSettingsStore.getState().hasDeepseekToolsApiKey).toBe(false);
  });

  it('ignores blanks and the masked placeholder, which blur events deliver untouched', async () => {
    for (const slot of ['search', 'deepseek'] as const) {
      expect(await saveToolApiKey(slot, '')).toBe(false);
      expect(await saveToolApiKey(slot, '   ')).toBe(false);
      expect(await saveToolApiKey(slot, '********')).toBe(false);
    }
    expect(tauriMock.saveWebSearchApiKey).not.toHaveBeenCalled();
    expect(tauriMock.saveDeepseekToolsApiKey).not.toHaveBeenCalled();
  });

  it('does not claim a key is saved when the backend refused it', async () => {
    tauriMock.saveDeepseekToolsApiKey.mockRejectedValueOnce(new Error('keychain locked'));

    expect(await saveToolApiKey('deepseek', 'sk-abc')).toBe(false);
    expect(useSettingsStore.getState().hasDeepseekToolsApiKey).toBe(false);
  });
});

describe('clearToolApiKey', () => {
  it('clears only the requested slot', async () => {
    useSettingsStore.setState({ hasWebSearchApiKey: true, hasDeepseekToolsApiKey: true });

    expect(await clearToolApiKey('deepseek')).toBe(true);

    expect(tauriMock.deleteDeepseekToolsApiKey).toHaveBeenCalledTimes(1);
    expect(tauriMock.deleteWebSearchApiKey).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().hasDeepseekToolsApiKey).toBe(false);
    expect(useSettingsStore.getState().hasWebSearchApiKey).toBe(true);
  });

  it('keeps the saved flag when the backend failed to delete', async () => {
    useSettingsStore.setState({ hasWebSearchApiKey: true });
    tauriMock.deleteWebSearchApiKey.mockRejectedValueOnce(new Error('nope'));

    expect(await clearToolApiKey('search')).toBe(false);
    expect(useSettingsStore.getState().hasWebSearchApiKey).toBe(true);
  });
});
