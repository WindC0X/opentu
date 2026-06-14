// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAWNIX_SETTINGS_KEY } from '../../constants/storage';

function installSettingsManagerMocks() {
  const saveConfig = vi.fn(async () => undefined);

  vi.doMock('../crypto-utils', () => ({
    CryptoUtils: {
      testCrypto: async () => false,
      isEncrypted: () => false,
      decrypt: async (value: string) => value,
      encrypt: async (value: string) => value,
    },
  }));

  vi.doMock('../config-indexeddb-writer', () => ({
    configIndexedDBWriter: {
      saveConfig,
    },
  }));

  return { saveConfig };
}

async function flushAsyncSettingsSideEffects(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Gemini auth in embedded creative mode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    document.body.innerHTML = '';
    window.history.pushState({}, '', '/creative');
  });

  it('ignores and strips URL API key/settings material without persisting upstream credentials', async () => {
    const { saveConfig } = installSettingsManagerMocks();
    const settingsParam = encodeURIComponent(
      JSON.stringify({
        key: 'sk-creative-url-secret-abcdefghijklmnopqrstuvwxyz',
        url: 'https://upstream.example/v1',
        Authorization: 'Bearer settings-url-secret',
        providerOverride: 'server-owned-provider',
      })
    );
    window.history.pushState(
      {},
      '',
      `/creative?apiKey=sk-creative-url-secret-abcdefghijklmnopqrstuvwxyz&settings=${settingsParam}&providerOverride=server-owned-provider&Authorization=Bearer+query-secret`
    );

    const { geminiSettings, settingsManager } = await import('../settings-manager');
    await import('./auth');
    await settingsManager.waitForInitialization();
    await flushAsyncSettingsSideEffects();

    const gemini = geminiSettings.get();
    expect(gemini.apiKey).toBe('');
    expect(gemini.baseUrl).not.toBe('https://upstream.example/v1');
    expect(window.location.search).not.toMatch(
      /apiKey|settings|providerOverride|Authorization/i
    );
    expect(localStorage.getItem(DRAWNIX_SETTINGS_KEY) || '').not.toMatch(
      /sk-creative-url-secret|upstream\.example|settings-url-secret|providerOverride|server-owned-provider|query-secret/i
    );
    expect(JSON.stringify(saveConfig.mock.calls)).not.toMatch(
      /sk-creative-url-secret|upstream\.example|settings-url-secret|providerOverride|server-owned-provider|query-secret/i
    );
  });

  it('accepts session-broker runtime config without rendering an API key prompt', async () => {
    installSettingsManagerMocks();
    const { validateAndEnsureConfig } = await import('./auth');

    await expect(
      validateAndEnsureConfig({
        apiKey: '',
        baseUrl: '/creative/relay/v1',
        modelName: 'gpt-5.5',
        authType: 'session-broker',
      })
    ).resolves.toMatchObject({
      apiKey: '',
      baseUrl: '/creative/relay/v1',
      authType: 'session-broker',
    });
    expect(document.body.textContent).not.toMatch(/配置 API Key|请输入您的 API Key/);
    expect(localStorage.getItem(DRAWNIX_SETTINGS_KEY) || '').not.toMatch(
      /apiKey|sk-/
    );
  });

  it('bootstraps a fresh /creative session-broker browser without persisting URL auth overrides', async () => {
    const { saveConfig } = installSettingsManagerMocks();
    vi.doMock('../../services/creative-model-preference-sync', () => ({
      initializeCreativeModelPreferenceSync: vi.fn(async () => undefined),
    }));

    const settingsParam = encodeURIComponent(
      JSON.stringify({
        key: 'sk-settings-secret-abcdefghijklmnopqrstuvwxyz',
        url: 'https://settings-upstream.example/v1',
        authType: 'query',
        providerAuth: 'settings-provider-auth-secret',
      })
    );
    window.history.pushState(
      {},
      '',
      `/creative?apiKey=sk-url-secret-abcdefghijklmnopqrstuvwxyz&settings=${settingsParam}&baseUrl=https%3A%2F%2Fquery-upstream.example%2Fv1&providerOverride=server-provider&authType=bearer&auth_type=query&auth=Bearer+auth-secret&providerAuth=query-provider-auth-secret&Authorization=Bearer+authorization-secret`
    );

    const { settingsManager } = await import('../settings-manager');
    await import('./auth');
    const {
      initializeCreativeManagedSessionBroker,
      resetCreativeManagedSessionBrokerForTests,
    } = await import('../../services/creative-session-broker');
    resetCreativeManagedSessionBrokerForTests();

    await settingsManager.waitForInitialization();
    const fetcher = vi.fn(async (endpoint: RequestInfo | URL) => {
      if (String(endpoint) === '/creative/api/bootstrap') {
        return jsonResponse({
          data: {
            auth: {
              mode: 'session-broker',
              csrfToken: 'csrf-fresh-browser',
              nonce: 'nonce-fresh-browser',
            },
          },
        });
      }
      if (String(endpoint) === '/creative/api/models') {
        return jsonResponse({
          data: [
            { id: 'gpt-5.5', type: 'text' },
            { id: 'gpt-image-2-vip', type: 'image' },
            { id: 'seedance-1.5-pro', type: 'video' },
            { id: 'suno_music', type: 'audio' },
          ],
        });
      }
      throw new Error(`unexpected endpoint ${String(endpoint)}`);
    }) as unknown as typeof fetch;

    const result = await initializeCreativeManagedSessionBroker(fetcher);
    await flushAsyncSettingsSideEffects();

    expect(result.status).toBe('ready');
    expect(window.location.search).not.toMatch(
      /apiKey|settings|baseUrl|providerOverride|authType|auth_type|providerAuth|Authorization|auth=/i
    );
    expect(document.body.textContent).not.toMatch(/配置 API Key|请输入您的 API Key/);

    const storageSnapshot = localStorage.getItem(DRAWNIX_SETTINGS_KEY) || '';
    expect(storageSnapshot).not.toMatch(
      /sk-url-secret|sk-settings-secret|query-upstream|settings-upstream|server-provider|auth-secret|provider-auth-secret|authorization-secret/i
    );
    const allLocalStorageSnapshot = Array.from(
      { length: localStorage.length },
      (_, index) => {
        const key = localStorage.key(index) || '';
        return [key, localStorage.getItem(key)];
      }
    );
    expect(JSON.stringify(allLocalStorageSnapshot)).not.toMatch(
      /sk-url-secret|sk-settings-secret|query-upstream|settings-upstream|server-provider|auth-secret|provider-auth-secret|authorization-secret|providerOverride|Authorization/i
    );

    const savedConfigs = saveConfig.mock.calls.map((call) => call.slice(0, 2));
    expect(JSON.stringify(savedConfigs)).not.toMatch(
      /sk-url-secret|sk-settings-secret|query-upstream|settings-upstream|server-provider|auth-secret|provider-auth-secret|authorization-secret/i
    );
    expect(
      savedConfigs.every(([geminiConfig, videoConfig]) =>
        [geminiConfig, videoConfig].every(
          (config) => !config || (config as { apiKey?: string }).apiKey === ''
        )
      )
    ).toBe(true);
    expect(
      savedConfigs.some(([geminiConfig, videoConfig]) => {
        const imageConfig = geminiConfig as { apiKey?: string; baseUrl?: string };
        const movieConfig = videoConfig as { apiKey?: string; baseUrl?: string };
        return (
          imageConfig.apiKey === '' &&
          movieConfig.apiKey === '' &&
          imageConfig.baseUrl === '/creative/relay/v1' &&
          movieConfig.baseUrl === '/creative/relay/v1'
        );
      })
    ).toBe(true);
  });

  it('routes embedded generation through the managed session-broker despite seeded legacy credentials', async () => {
    const { saveConfig } = installSettingsManagerMocks();
    vi.doMock('../../services/creative-model-preference-sync', () => ({
      initializeCreativeModelPreferenceSync: vi.fn(async () => undefined),
    }));
    localStorage.setItem(
      DRAWNIX_SETTINGS_KEY,
      JSON.stringify({
        gemini: {
          apiKey: 'sk-legacy-direct-abcdefghijklmnopqrstuvwxyz',
          baseUrl: 'https://legacy-upstream.example/v1',
          chatModel: 'legacy-text-model',
          textModelName: 'legacy-text-model',
          imageModelName: 'legacy-image-model',
          videoModelName: 'legacy-video-model',
          audioModelName: 'legacy-audio-model',
        },
        invocationPresets: [
          {
            id: 'default',
            name: 'Legacy default',
            isDefault: true,
            text: {
              defaultModelRef: {
                profileId: 'legacy-default',
                modelId: 'legacy-text-model',
              },
            },
            image: {
              defaultModelRef: {
                profileId: 'legacy-default',
                modelId: 'legacy-image-model',
              },
            },
            video: {
              defaultModelRef: {
                profileId: 'legacy-default',
                modelId: 'legacy-video-model',
              },
            },
            audio: {
              defaultModelRef: {
                profileId: 'legacy-default',
                modelId: 'legacy-audio-model',
              },
            },
          },
        ],
        activePresetId: 'default',
      })
    );

    const { resolveInvocationRoute, settingsManager } = await import(
      '../settings-manager'
    );
    await import('./auth');
    const {
      initializeCreativeManagedSessionBroker,
      resetCreativeManagedSessionBrokerForTests,
    } = await import('../../services/creative-session-broker');
    resetCreativeManagedSessionBrokerForTests();

    await settingsManager.waitForInitialization();
    const fetcher = vi.fn(async (endpoint: RequestInfo | URL) => {
      if (String(endpoint) === '/creative/api/bootstrap') {
        return jsonResponse({
          data: {
            auth: {
              mode: 'session-broker',
              csrfToken: 'csrf-legacy-seed',
              nonce: 'nonce-legacy-seed',
            },
          },
        });
      }
      if (String(endpoint) === '/creative/api/models') {
        return jsonResponse({
          data: [
            { id: 'gpt-5.5', type: 'text' },
            { id: 'gpt-image-2-vip', type: 'image' },
            { id: 'seedance-1.5-pro', type: 'video' },
            { id: 'suno_music', type: 'audio' },
          ],
        });
      }
      throw new Error(`unexpected endpoint ${String(endpoint)}`);
    }) as unknown as typeof fetch;

    const result = await initializeCreativeManagedSessionBroker(fetcher);
    await flushAsyncSettingsSideEffects();

    expect(result.status).toBe('ready');
    for (const routeType of ['text', 'image', 'video', 'audio'] as const) {
      expect(resolveInvocationRoute(routeType)).toMatchObject({
        profileId: 'new-api-creative',
        baseUrl: '/creative/relay/v1',
        apiKey: '',
        authType: 'session-broker',
      });
    }
    expect(JSON.stringify(saveConfig.mock.calls)).not.toMatch(
      /sk-legacy-direct|legacy-upstream\.example/i
    );
  });

  it('fails closed for direct chat calls when the embedded model catalog is empty', async () => {
    installSettingsManagerMocks();
    vi.doMock('../../services/creative-model-preference-sync', () => ({
      initializeCreativeModelPreferenceSync: vi.fn(async () => undefined),
    }));
    const callApiWithRetry = vi.fn(async () => ({
      choices: [{ message: { role: 'assistant', content: 'should not call' } }],
    }));
    vi.doMock('./apiCalls', () => ({
      callApiWithRetry,
      callApiStreamRaw: vi.fn(),
      callGoogleGenerateContentRaw: vi.fn(),
      callVideoApiStreamRaw: vi.fn(),
    }));

    const { settingsManager } = await import('../settings-manager');
    await import('./auth');
    const {
      initializeCreativeManagedSessionBroker,
      resetCreativeManagedSessionBrokerForTests,
    } = await import('../../services/creative-session-broker');
    resetCreativeManagedSessionBrokerForTests();

    await settingsManager.waitForInitialization();
    const fetcher = vi.fn(async (endpoint: RequestInfo | URL) => {
      if (String(endpoint) === '/creative/api/bootstrap') {
        return jsonResponse({
          data: {
            auth: {
              mode: 'session-broker',
              csrfToken: 'csrf-empty-catalog',
              nonce: 'nonce-empty-catalog',
            },
          },
        });
      }
      if (String(endpoint) === '/creative/api/models') {
        return jsonResponse({ data: [] });
      }
      throw new Error(`unexpected endpoint ${String(endpoint)}`);
    }) as unknown as typeof fetch;

    await initializeCreativeManagedSessionBroker(fetcher);
    const { sendChatWithGemini } = await import('./services');

    await expect(
      sendChatWithGemini([
        { role: 'user', content: [{ type: 'text', text: 'hello' }] },
      ])
    ).rejects.toThrow(/Creative text model is unavailable/i);
    expect(callApiWithRetry).not.toHaveBeenCalled();
  });
});
