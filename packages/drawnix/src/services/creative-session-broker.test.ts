import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCreativeSessionAuthMaterial,
  CREATIVE_MANAGED_PROFILE_ID,
  CREATIVE_RELAY_BASE_URL,
  getCreativeAssetSyncConfig,
  getCreativeSessionAuthMaterial,
  resetCreativeAssetSyncConfigForTests,
  setCreativeSessionAuthMaterial,
} from './creative-mode';
import {
  AI_MODEL_SELECTION_CACHE_KEY,
  AI_MODEL_UNAVAILABLE_SELECTION_MARKERS_KEY,
} from '../constants/storage';

const mocks = vi.hoisted(() => ({
  waitForInitialization: vi.fn(async () => undefined),
  providerProfilesGet: vi.fn(() => []),
  providerProfilesUpdate: vi.fn(async () => undefined),
  providerCatalogsGet: vi.fn(() => []),
  providerCatalogsUpdate: vi.fn(async () => undefined),
  hasInvocationRouteCredentials: vi.fn(() => true),
  updateActiveInvocationRouteModel: vi.fn(async () => undefined),
  initializeCreativeModelPreferenceSync: vi.fn(async () => undefined),
}));

vi.mock('../utils/settings-manager', () => ({
  settingsManager: {
    waitForInitialization: mocks.waitForInitialization,
  },
  providerProfilesSettings: {
    get: mocks.providerProfilesGet,
    update: mocks.providerProfilesUpdate,
  },
  providerCatalogsSettings: {
    get: mocks.providerCatalogsGet,
    update: mocks.providerCatalogsUpdate,
  },
  hasInvocationRouteCredentials: mocks.hasInvocationRouteCredentials,
  updateActiveInvocationRouteModel: mocks.updateActiveInvocationRouteModel,
  createModelRef: (profileId: string, modelId: string) => ({ profileId, modelId }),
}));

vi.mock('./creative-model-preference-sync', () => ({
  initializeCreativeModelPreferenceSync:
    mocks.initializeCreativeModelPreferenceSync,
}));

import {
  initializeCreativeManagedSessionBroker,
  resetCreativeManagedSessionBrokerForTests,
} from './creative-session-broker';
import {
  getCreativeDefaultVisibleModels,
  getCreativeMoreModels,
} from './creative-display-policy';

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createBootstrapFetcher(bootstrapPayload: unknown): typeof fetch {
  return vi.fn(async (endpoint: RequestInfo | URL) => {
    if (String(endpoint) === '/creative/api/bootstrap') {
      return jsonResponse(bootstrapPayload);
    }
    if (String(endpoint) === '/creative/api/models') {
      return jsonResponse({
        defaultModel: 'server-policy-must-not-apply',
        uiPolicy: { hidden: true },
        data: [
          {
            id: 'broker-text-model',
            type: 'text',
            defaultVisibleModels: ['server-policy-must-not-apply'],
          },
        ],
      });
    }
    throw new Error(`unexpected endpoint ${String(endpoint)}`);
  }) as unknown as typeof fetch;
}

describe('initializeCreativeManagedSessionBroker bootstrap auth', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/creative');
    localStorage.clear();
    resetCreativeManagedSessionBrokerForTests();
    resetCreativeAssetSyncConfigForTests();
    clearCreativeSessionAuthMaterial();
    vi.clearAllMocks();
    mocks.providerProfilesGet.mockReturnValue([]);
    mocks.providerCatalogsGet.mockReturnValue([]);
    mocks.hasInvocationRouteCredentials.mockReturnValue(true);
  });

  it('accepts session-broker bootstrap auth, stores in-memory auth, and ignores server UI policy', async () => {
    const fetcher = createBootstrapFetcher({
      defaultModel: 'server-policy-must-not-apply',
      data: {
        uiPolicy: { hidden: true },
        auth: {
          mode: 'session-broker',
          csrfToken: ' csrf-valid ',
          nonce: ' nonce-valid ',
        },
      },
    });

    const result = await initializeCreativeManagedSessionBroker(fetcher);

    expect(result.status).toBe('ready');
    expect(getCreativeSessionAuthMaterial()).toEqual({
      csrfToken: 'csrf-valid',
      nonce: 'nonce-valid',
    });
    expect(mocks.providerProfilesUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.providerCatalogsUpdate).toHaveBeenCalledTimes(1);
    expect(result.models?.[0]).not.toHaveProperty('defaultModel');
    expect(result.models?.[0]).not.toHaveProperty('defaultVisibleModels');
    expect(result.models?.[0]).not.toHaveProperty('uiPolicy');
  });

  it('honors bootstrap assetSyncEnabled rollout state without exposing provider details', async () => {
    const fetcher = createBootstrapFetcher({
      data: {
        auth: {
          mode: 'session-broker',
          csrfToken: 'csrf-assets',
          nonce: 'nonce-assets',
        },
        assetSyncEnabled: true,
        assets: {
          storageBackend: 's3-compatible',
          objectKey: 'must-not-be-used-by-opentu',
          bucketUrl: 'https://bucket.example/private',
        },
      },
    });

    const result = await initializeCreativeManagedSessionBroker(fetcher);

    expect(result.status).toBe('ready');
    expect(getCreativeAssetSyncConfig()).toEqual({
      assetSyncEnabled: true,
    });
    expect(JSON.stringify(getCreativeAssetSyncConfig())).not.toMatch(
      /bucket|objectKey|s3-compatible|private/i
    );
  });

  it('bootstraps a fresh embedded browser without an API key and preserves the full model pool for discovery', async () => {
    mocks.hasInvocationRouteCredentials.mockReturnValue(false);
    const calls: Array<{ endpoint: string; init?: RequestInit }> = [];
    const fetcher = vi.fn(async (endpoint: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ endpoint: String(endpoint), init });
      if (String(endpoint) === '/creative/api/bootstrap') {
        return jsonResponse({
          data: {
            defaultModel: 'server-must-not-win',
            displayPolicy: { defaultVisibleModels: ['server-must-not-win'] },
            auth: {
              mode: 'session-broker',
              csrfToken: 'csrf-fresh',
              nonce: 'nonce-fresh',
            },
          },
        });
      }
      if (String(endpoint) === '/creative/api/models') {
        return jsonResponse({
          uiPolicy: {
            defaultModelId: 'server-must-not-win',
            defaultVisibleModelIds: ['server-must-not-win'],
          },
          data: [
            { id: 'server-must-not-win', type: 'text', baseUrl: 'https://leak.example' },
            { id: 'gpt-5.5', type: 'text' },
            { id: 'deepseek-v3.2', type: 'text' },
            { id: 'gpt-image-2-vip', type: 'image' },
            { id: 'seedance-1.5-pro', type: 'video' },
            { id: 'suno_music', type: 'audio' },
          ],
        });
      }
      throw new Error(`unexpected endpoint ${String(endpoint)}`);
    }) as unknown as typeof fetch;

    const result = await initializeCreativeManagedSessionBroker(fetcher);

    expect(result.status).toBe('ready');
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls)).not.toMatch(
      /Authorization|X-API-Key|api_key|server-api-key|Bearer/i
    );
    expect(mocks.providerProfilesUpdate).toHaveBeenCalledWith([
      expect.objectContaining({
        id: CREATIVE_MANAGED_PROFILE_ID,
        baseUrl: CREATIVE_RELAY_BASE_URL,
        apiKey: '',
        authType: 'session-broker',
      }),
    ]);
    expect(JSON.stringify(mocks.providerProfilesUpdate.mock.calls[0][0])).not.toMatch(
      /server-must-not-win|https:\/\/leak\.example|Authorization|providerOverride|Bearer/i
    );

    const [catalogs] = mocks.providerCatalogsUpdate.mock.calls[0];
    expect(catalogs).toHaveLength(1);
    expect(catalogs[0]).toMatchObject({
      profileId: CREATIVE_MANAGED_PROFILE_ID,
      sourceBaseUrl: '/creative/api/models',
    });
    const expectedFullPoolIds = [
      'gpt-5.5',
      'deepseek-v3.2',
      'gpt-image-2-vip',
      'seedance-1.5-pro',
      'suno_music',
      'server-must-not-win',
    ];
    expect(catalogs[0].selectedModelIds).toHaveLength(expectedFullPoolIds.length);
    expect(catalogs[0].selectedModelIds).toEqual(
      expect.arrayContaining(expectedFullPoolIds)
    );
    expect(catalogs[0].discoveredModels.map((model: { id: string }) => model.id)).toEqual(
      expect.arrayContaining(expectedFullPoolIds)
    );
    expect(JSON.stringify(catalogs)).not.toMatch(
      /defaultModel|defaultVisibleModel|displayPolicy|uiPolicy|https:\/\/leak\.example/i
    );
    expect(mocks.updateActiveInvocationRouteModel).toHaveBeenCalledWith(
      'text',
      { profileId: CREATIVE_MANAGED_PROFILE_ID, modelId: 'gpt-5.5' }
    );
    expect(mocks.updateActiveInvocationRouteModel).toHaveBeenCalledWith(
      'image',
      { profileId: CREATIVE_MANAGED_PROFILE_ID, modelId: 'gpt-image-2-vip' }
    );
    expect(mocks.updateActiveInvocationRouteModel).toHaveBeenCalledWith(
      'video',
      { profileId: CREATIVE_MANAGED_PROFILE_ID, modelId: 'seedance-1.5-pro' }
    );
    expect(mocks.updateActiveInvocationRouteModel).toHaveBeenCalledWith(
      'audio',
      { profileId: CREATIVE_MANAGED_PROFILE_ID, modelId: 'suno_music' }
    );
    expect(result.models).toHaveLength(6);
    expect(mocks.initializeCreativeModelPreferenceSync).toHaveBeenCalledTimes(1);
  });

  it('forces managed session-broker routes even when legacy direct credentials already exist', async () => {
    mocks.hasInvocationRouteCredentials.mockReturnValue(true);
    const fetcher = vi.fn(async (endpoint: RequestInfo | URL) => {
      if (String(endpoint) === '/creative/api/bootstrap') {
        return jsonResponse({
          data: {
            auth: {
              mode: 'session-broker',
              csrfToken: 'csrf-force',
              nonce: 'nonce-force',
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

    expect(result.status).toBe('ready');
    expect(mocks.updateActiveInvocationRouteModel).toHaveBeenCalledWith(
      'text',
      { profileId: CREATIVE_MANAGED_PROFILE_ID, modelId: 'gpt-5.5' }
    );
    expect(mocks.updateActiveInvocationRouteModel).toHaveBeenCalledWith(
      'image',
      { profileId: CREATIVE_MANAGED_PROFILE_ID, modelId: 'gpt-image-2-vip' }
    );
    expect(mocks.updateActiveInvocationRouteModel).toHaveBeenCalledWith(
      'video',
      { profileId: CREATIVE_MANAGED_PROFILE_ID, modelId: 'seedance-1.5-pro' }
    );
    expect(mocks.updateActiveInvocationRouteModel).toHaveBeenCalledWith(
      'audio',
      { profileId: CREATIVE_MANAGED_PROFILE_ID, modelId: 'suno_music' }
    );
  });

  it('stores a 30-model creative pool while opentu owns default visible and active selections', async () => {
    mocks.hasInvocationRouteCredentials.mockReturnValue(false);
    const textModels = [
      'server-owned-default',
      'gpt-5.5',
      'deepseek-v3.2',
      'gemini-3.1-pro-preview',
      'claude-sonnet-4-6',
      'gpt-5.4',
      'grok-4.2',
      ...Array.from({ length: 8 }, (_, index) => `text-extra-${index + 1}`),
    ].map((id) => ({
      id,
      type: 'text',
      defaultModel: 'server-owned-default',
      defaultVisibleModelIds: ['server-owned-default'],
      displayPolicy: { pinned: true },
    }));
    const imageModels = [
      'gpt-image-2-vip',
      'gpt-image-2',
      'gemini-3.1-flash-image-preview',
      'doubao-seedream-4-0-250828',
      'image-extra-1',
      'image-extra-2',
    ].map((id) => ({ id, type: 'image' }));
    const videoModels = [
      'seedance-1.5-pro',
      'seedance-1.0-pro-fast',
      'veo3',
      'sora-2',
      'video-extra-1',
      'video-extra-2',
    ].map((id) => ({ id, type: 'video' }));
    const audioModels = ['suno_music', 'audio-extra-1', 'audio-extra-2'].map(
      (id) => ({ id, type: 'audio' })
    );
    const pool = [...textModels, ...imageModels, ...videoModels, ...audioModels];
    expect(pool).toHaveLength(30);

    const fetcher = vi.fn(async (endpoint: RequestInfo | URL, init?: RequestInit) => {
      expect(init).toMatchObject({
        method: 'GET',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (String(endpoint) === '/creative/api/bootstrap') {
        return jsonResponse({
          data: {
            auth: {
              mode: 'session-broker',
              csrfToken: 'csrf-30',
              nonce: 'nonce-30',
            },
            defaultModel: 'server-owned-default',
            uiPolicy: { defaultVisibleModelIds: ['server-owned-default'] },
          },
        });
      }
      if (String(endpoint) === '/creative/api/models') {
        return jsonResponse({
          defaultModelId: 'server-owned-default',
          defaultVisibleModels: ['server-owned-default'],
          data: pool,
        });
      }
      throw new Error(`unexpected endpoint ${String(endpoint)}`);
    }) as unknown as typeof fetch;

    const result = await initializeCreativeManagedSessionBroker(fetcher);

    expect(result.status).toBe('ready');
    expect(result.models).toHaveLength(30);
    const [catalogs] = mocks.providerCatalogsUpdate.mock.calls[0];
    const creativeCatalog = catalogs.find(
      (catalog: { profileId: string }) =>
        catalog.profileId === CREATIVE_MANAGED_PROFILE_ID
    );
    expect(creativeCatalog.discoveredModels).toHaveLength(30);
    expect(creativeCatalog.selectedModelIds).toHaveLength(30);
    expect(creativeCatalog.selectedModelIds).toEqual(
      expect.arrayContaining(pool.map((model) => model.id))
    );
    expect(JSON.stringify(creativeCatalog)).not.toMatch(
      /defaultModel|defaultVisibleModel|displayPolicy|uiPolicy/i
    );

    const visibleTextIds = getCreativeDefaultVisibleModels(
      'text',
      result.models || []
    ).map((model) => model.id);
    const moreTextIds = getCreativeMoreModels('text', result.models || []).map(
      (model) => model.id
    );
    expect(visibleTextIds).toEqual([
      'gpt-5.5',
      'deepseek-v3.2',
      'gemini-3.1-pro-preview',
      'claude-sonnet-4-6',
      'gpt-5.4',
      'grok-4.2',
    ]);
    expect(visibleTextIds).not.toContain('server-owned-default');
    expect(moreTextIds).toContain('server-owned-default');
    expect(new Set([...visibleTextIds, ...moreTextIds]).size).toBe(
      textModels.length
    );
    expect(mocks.updateActiveInvocationRouteModel).toHaveBeenCalledWith(
      'text',
      { profileId: CREATIVE_MANAGED_PROFILE_ID, modelId: 'gpt-5.5' }
    );
    expect(mocks.updateActiveInvocationRouteModel).not.toHaveBeenCalledWith(
      'text',
      { profileId: CREATIVE_MANAGED_PROFILE_ID, modelId: 'server-owned-default' }
    );
  });

  it('replaces a persisted unavailable creative model with an available opentu default without carrying stale provider or auth data', async () => {
    mocks.hasInvocationRouteCredentials.mockReturnValue(true);
    localStorage.setItem(
      AI_MODEL_SELECTION_CACHE_KEY,
      JSON.stringify({
        text: {
          modelId: 'stale-server-model',
          profileId: 'stale-provider',
          providerIdHint: 'stale-provider',
          vendorHint: 'OTHER',
          updatedAt: 100,
          baseUrl: 'https://stale-secret.example',
          apiKey: 'stale-secret',
          Authorization: 'Bearer stale-secret',
        },
      })
    );
    const fetcher = vi.fn(async (endpoint: RequestInfo | URL) => {
      if (String(endpoint) === '/creative/api/bootstrap') {
        return jsonResponse({
          data: {
            auth: {
              mode: 'session-broker',
              csrfToken: 'csrf-unavailable',
              nonce: 'nonce-unavailable',
            },
          },
        });
      }
      if (String(endpoint) === '/creative/api/models') {
        return jsonResponse({
          data: [
            { id: 'gpt-5.5', type: 'text' },
            { id: 'deepseek-v3.2', type: 'text' },
          ],
        });
      }
      throw new Error(`unexpected endpoint ${String(endpoint)}`);
    }) as unknown as typeof fetch;

    const result = await initializeCreativeManagedSessionBroker(fetcher);

    expect(result.status).toBe('ready');
    const stored = JSON.parse(
      localStorage.getItem(AI_MODEL_SELECTION_CACHE_KEY) || '{}'
    );
    expect(stored.text).toMatchObject({
      modelId: 'gpt-5.5',
      profileId: CREATIVE_MANAGED_PROFILE_ID,
      providerIdHint: CREATIVE_MANAGED_PROFILE_ID,
      vendorHint: 'GPT',
    });
    expect(JSON.stringify(stored)).not.toMatch(
      /stale-server-model|stale-provider|stale-secret|baseUrl|apiKey|Authorization/i
    );
  });

  it('marks and falls back when a cloud-synced model vanishes after the creative pool is loaded', async () => {
    mocks.hasInvocationRouteCredentials.mockReturnValue(true);
    mocks.initializeCreativeModelPreferenceSync.mockImplementationOnce(async () => {
      localStorage.setItem(
        AI_MODEL_SELECTION_CACHE_KEY,
        JSON.stringify({
          text: {
            modelId: 'cloud-vanished-model',
            profileId: 'remote-profile',
            providerIdHint: 'remote-profile',
            vendorHint: 'OTHER',
            updatedAt: 500,
            apiKey: 'sk-cloud-secret-abcdefghijklmnopqrstuvwxyz',
            baseUrl: 'https://cloud-secret.example/v1',
            Authorization: 'Bearer cloud-secret-token-abcdefghijklmnopqrstuvwxyz',
          },
        })
      );
    });
    const fetcher = vi.fn(async (endpoint: RequestInfo | URL) => {
      if (String(endpoint) === '/creative/api/bootstrap') {
        return jsonResponse({
          data: {
            auth: {
              mode: 'session-broker',
              csrfToken: 'csrf-cloud-vanished',
              nonce: 'nonce-cloud-vanished',
            },
          },
        });
      }
      if (String(endpoint) === '/creative/api/models') {
        return jsonResponse({
          data: [
            { id: 'gpt-5.5', type: 'text' },
            { id: 'deepseek-v3.2', type: 'text' },
          ],
        });
      }
      throw new Error(`unexpected endpoint ${String(endpoint)}`);
    }) as unknown as typeof fetch;

    const result = await initializeCreativeManagedSessionBroker(fetcher);

    expect(result.status).toBe('ready');
    const stored = JSON.parse(
      localStorage.getItem(AI_MODEL_SELECTION_CACHE_KEY) || '{}'
    );
    expect(stored.text).toMatchObject({
      modelId: 'gpt-5.5',
      profileId: CREATIVE_MANAGED_PROFILE_ID,
      providerIdHint: CREATIVE_MANAGED_PROFILE_ID,
      vendorHint: 'GPT',
    });
    const markers = JSON.parse(
      localStorage.getItem(AI_MODEL_UNAVAILABLE_SELECTION_MARKERS_KEY) || '{}'
    );
    expect(markers.text).toMatchObject({
      generationType: 'text',
      reason: 'unavailable-in-model-pool',
      original: {
        modelId: 'cloud-vanished-model',
        profileId: 'remote-profile',
        providerIdHint: 'remote-profile',
        vendorHint: 'OTHER',
      },
      fallback: {
        modelId: 'gpt-5.5',
        profileId: CREATIVE_MANAGED_PROFILE_ID,
        providerIdHint: CREATIVE_MANAGED_PROFILE_ID,
        vendorHint: 'GPT',
      },
    });
    expect(JSON.stringify({ stored, markers })).not.toMatch(
      /sk-cloud-secret|cloud-secret\.example|Authorization|Bearer|baseUrl|apiKey/i
    );
  });

  it.each([
    [
      'wrong auth.mode',
      {
        data: {
          auth: {
            mode: 'bearer',
            csrfToken: 'csrf-new',
            nonce: 'nonce-new',
          },
        },
      },
      /auth\.mode.*session-broker/,
    ],
    [
      'missing nonce',
      {
        data: {
          auth: {
            mode: 'session-broker',
            csrfToken: 'csrf-new',
          },
        },
      },
      /auth\.nonce.*required/,
    ],
  ])(
    'returns error and clears stale auth material for %s',
    async (_caseName, bootstrapPayload, expectedError) => {
      setCreativeSessionAuthMaterial({
        csrfToken: 'stale-csrf',
        nonce: 'stale-nonce',
      });
      const fetcher = createBootstrapFetcher(bootstrapPayload);

      const result = await initializeCreativeManagedSessionBroker(fetcher);

      expect(result.status).toBe('error');
      expect(result.error).toMatch(expectedError);
      expect(getCreativeSessionAuthMaterial()).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(mocks.providerProfilesUpdate).not.toHaveBeenCalled();
      expect(mocks.providerCatalogsUpdate).not.toHaveBeenCalled();
    }
  );
});
