import { afterEach, describe, expect, it } from 'vitest';
import {
  buildCreativeModelPreferencePatch,
  CreativeModelPreferenceSyncService,
  sanitizeCreativeModelPreference,
} from './creative-model-preference-sync';
import {
  clearCreativeSessionAuthMaterial,
  setCreativeSessionAuthMaterial,
} from './creative-mode';

describe('creative model preference sync sanitization', () => {
  afterEach(() => {
    clearCreativeSessionAuthMaterial();
  });

  it('allowlists cloud preference fields and strips secrets/provider settings', () => {
    const sanitized = sanitizeCreativeModelPreference({
      default: {
        text: {
          modelId: 'gpt-5.5',
          profileId: 'new-api-creative',
          apiKey: 'leak',
          baseUrl: 'https://leak.example',
          channel_id: 7,
        },
      },
      pinned: [
        { modelId: 'deepseek-v3.2', profileId: 'new-api-creative', Authorization: 'Bearer leak' },
      ],
      recent: [
        {
          modelId: 'gemini-3.1-pro-preview',
          token: 'leak',
          accessToken: 'leak',
          refreshToken: 'leak',
          idToken: 'leak',
          providerOverride: 'leak',
        },
      ],
      displayMode: 'compact',
      customOrder: ['gpt-5.5'],
      revision: 1,
      apiKey: 'top-level-leak',
      providerProfiles: [{ apiKey: 'leak' }],
      upstreamKey: 'leak',
      internalToken: 'leak',
      channelId: 'leak',
      baseUrl: 'https://leak.example',
    });

    expect(sanitized).toEqual({
      default: {
        text: {
          modelId: 'gpt-5.5',
          profileId: 'new-api-creative',
        },
      },
      pinned: [{ modelId: 'deepseek-v3.2', profileId: 'new-api-creative' }],
      recent: [{ modelId: 'gemini-3.1-pro-preview' }],
      displayMode: 'compact',
      customOrder: ['gpt-5.5'],
      revision: 1,
    });
    expect(JSON.stringify(sanitized)).not.toMatch(
      /apiKey|baseUrl|Authorization|token|channel_id|channelId|providerOverride|upstreamKey|internalToken|providerProfiles|leak/i
    );
  });

  it('builds wrapped safe patch fields with numeric baseRevision', () => {
    const patch = buildCreativeModelPreferencePatch(
      {
        default: { text: { modelId: 'gpt-5.5', apiKey: 'leak' } },
        baseUrl: 'https://leak.example',
      },
      '7'
    );

    expect(patch).toEqual({
      baseRevision: 7,
      preference: { default: { text: { modelId: 'gpt-5.5' } } },
    });
    expect(JSON.stringify(patch)).not.toContain('leak');
  });

  it('unwraps backend preference wrappers and patches with stored numeric revision', async () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-pref',
      nonce: 'nonce-pref',
    });
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              revision: 4,
              preference: {
                default: { text: { modelId: 'gpt-5.5' } },
              },
            },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            revision: 3,
            preference: {
              default: { text: { modelId: 'gpt-4.1', apiKey: 'leak' } },
            },
          },
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const service = new CreativeModelPreferenceSyncService(fetcher);
    const preference = await service.fetchPreference();
    const patched = await service.patchPreference({
      default: { text: { modelId: 'gpt-5.5', apiKey: 'leak' } },
      revision: 99,
    });

    expect(preference).toEqual({
      revision: 3,
      default: { text: { modelId: 'gpt-4.1' } },
    });
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      baseRevision: 3,
      preference: { default: { text: { modelId: 'gpt-5.5' } } },
    });
    expect(calls[1].init?.headers).toMatchObject({
      'X-Creative-CSRF': 'csrf-pref',
      'X-Creative-Nonce': 'nonce-pref',
    });
    expect(JSON.stringify(calls[1])).not.toContain('leak');
    expect(patched.revision).toBe(4);
  });

  it('rebases one revision conflict onto the latest remote preference without persisting server policy or auth material', async () => {
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-rebase',
      nonce: 'nonce-rebase',
    });
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      if (init?.method === 'PATCH' && calls.filter((call) => call.init?.method === 'PATCH').length === 1) {
        return new Response(
          JSON.stringify({
            success: false,
            message: 'revision conflict',
          }),
          { status: 409 }
        );
      }
      if (init?.method === 'PATCH') {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              revision: 6,
              preference: {
                default: {
                  text: { modelId: 'gpt-5.5' },
                  image: { modelId: 'gpt-image-2-vip' },
                },
              },
            },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            revision: 5,
            preference: {
              default: {
                image: {
                  modelId: 'gpt-image-2-vip',
                  defaultModel: 'server-policy-must-strip',
                  apiKey: 'remote-secret',
                },
              },
              pinned: [{ modelId: 'remote-pinned' }],
              recent: [{ modelId: 'remote-recent' }],
              displayMode: 'compact',
              customOrder: ['remote-first'],
              uiPolicy: { defaultModelId: 'server-policy-must-strip' },
              providerProfiles: [{ apiKey: 'remote-secret' }],
              baseUrl: 'https://remote-secret.example',
            },
          },
        }),
        { status: 200 }
      );
    }) as typeof fetch;

    const service = new CreativeModelPreferenceSyncService(fetcher);
    const patched = await service.patchPreference({
      default: {
        text: {
          modelId: 'gpt-5.5',
          profileId: 'new-api-creative',
          baseUrl: 'https://local-secret.example',
        },
      },
      pinned: [
        {
          modelId: 'deepseek-v3.2',
          profileId: 'new-api-creative',
          Authorization: 'Bearer local-secret',
        },
      ],
      recent: [
        {
          modelId: 'gemini-3.1-pro-preview',
          apiKey: 'local-secret',
        },
      ],
      displayMode: 'advanced',
      customOrder: ['gpt-5.5', 'deepseek-v3.2'],
      providerOverride: 'local-secret',
      uiPolicy: { defaultVisibleModels: ['server-policy-must-strip'] },
    });

    const patchBodies = calls
      .filter((call) => call.init?.method === 'PATCH')
      .map((call) => JSON.parse(String(call.init?.body)));
    expect(patchBodies).toHaveLength(2);
    expect(calls.map((call) => [String(call.input), call.init?.method])).toEqual([
      ['/creative/api/preferences/model', 'PATCH'],
      ['/creative/api/preferences/model', 'GET'],
      ['/creative/api/preferences/model', 'PATCH'],
    ]);
    expect(patchBodies[1]).toEqual({
      baseRevision: 5,
      preference: {
        default: {
          image: { modelId: 'gpt-image-2-vip' },
          text: {
            modelId: 'gpt-5.5',
            profileId: 'new-api-creative',
          },
        },
        pinned: [{ modelId: 'deepseek-v3.2', profileId: 'new-api-creative' }],
        recent: [{ modelId: 'gemini-3.1-pro-preview' }],
        displayMode: 'advanced',
        customOrder: ['gpt-5.5', 'deepseek-v3.2'],
      },
    });
    expect(JSON.stringify(calls)).not.toMatch(
      /local-secret|remote-secret|baseUrl|apiKey|Authorization|providerProfiles|providerOverride|uiPolicy|defaultModel|defaultVisibleModels|server-policy-must-strip/i
    );
    expect(patched.revision).toBe(6);
  });
});
