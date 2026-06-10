import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCreativeSessionAuthMaterial,
  setCreativeSessionAuthMaterial,
} from '../creative-mode';
import type {
  InvocationPlan,
  ProviderModelBinding,
  ResolvedProviderContext,
} from '../provider-routing/types';
import type { ResolvedInvocationRoute } from '../../utils/settings-manager';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn<typeof fetch>(),
  resolveInvocationPlanFromRoute: vi.fn(),
  resolveInvocationRoute: vi.fn(),
  startLLMApiLog: vi.fn(() => 'log-1'),
  completeLLMApiLog: vi.fn(),
  failLLMApiLog: vi.fn(),
  updateLLMApiLogMetadata: vi.fn(),
  cacheMediaFromBlob: vi.fn(),
  getImageForAI: vi.fn(),
}));

vi.mock('../provider-routing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../provider-routing')>();
  return {
    ...actual,
    resolveInvocationPlanFromRoute: mocks.resolveInvocationPlanFromRoute,
  };
});

vi.mock('../../utils/settings-manager', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../utils/settings-manager')
  >();
  return {
    ...actual,
    resolveInvocationRoute: mocks.resolveInvocationRoute,
  };
});

vi.mock('../media-executor/llm-api-logger', () => ({
  startLLMApiLog: mocks.startLLMApiLog,
  completeLLMApiLog: mocks.completeLLMApiLog,
  failLLMApiLog: mocks.failLLMApiLog,
  updateLLMApiLogMetadata: mocks.updateLLMApiLogMetadata,
}));

vi.mock('../unified-cache-service', () => ({
  unifiedCacheService: {
    cacheMediaFromBlob: mocks.cacheMediaFromBlob,
    getImageForAI: mocks.getImageForAI,
  },
}));

type FetchMock = typeof mocks.fetch;
type FetchCall = Parameters<typeof fetch>;

function getFetchCall(fetcher: FetchMock, index = 0): FetchCall {
  const call = fetcher.mock.calls[index];
  if (!call) {
    throw new Error(`Expected fetch call #${index + 1}`);
  }
  return call;
}

function createVideoBinding(
  overrides: Partial<ProviderModelBinding> = {}
): ProviderModelBinding {
  return {
    id: 'new-api-creative:veo3:video',
    profileId: 'new-api-creative',
    modelId: 'veo3',
    operation: 'video',
    protocol: 'openai.async.video',
    requestSchema: 'multipart',
    responseSchema: 'async-task',
    submitPath: '/videos',
    pollPathTemplate: '/videos/{taskId}',
    priority: 100,
    confidence: 'high',
    source: 'template',
    ...overrides,
  };
}

function createSessionBrokerPlan(
  binding: ProviderModelBinding = createVideoBinding()
): InvocationPlan {
  const provider: ResolvedProviderContext = {
    profileId: 'new-api-creative',
    profileName: 'Creative',
    providerType: 'openai-compatible',
    baseUrl: '/creative/relay/v1',
    apiKey: '',
    authType: 'session-broker',
    extraHeaders: {
      Authorization: 'Bearer header-leak',
      'X-API-Key': 'api-key-header-leak',
      'X-Provider': 'provider-header-leak',
      'X-Channel-Id': 'channel-header-leak',
      'X-Base-URL': 'base-url-header-leak',
      'X-Model': 'model-header-leak',
      'X-Safe-Trace': 'trace-ok',
    },
  };

  return {
    provider,
    modelRef: {
      profileId: 'new-api-creative',
      modelId: 'veo3',
    },
    binding,
  };
}

function createDirectRouteWithoutKey(): ResolvedInvocationRoute {
  return {
    routeType: 'video',
    modelId: 'veo3',
    profileId: 'standalone',
    profileName: 'Standalone',
    providerType: 'openai-compatible',
    baseUrl: 'https://video.example.com/v1',
    apiKey: '',
    authType: 'bearer',
    source: 'legacy',
  };
}

describe('video-api-service session-broker routing', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mocks.fetch);
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-video',
      nonce: 'nonce-video',
    });
    mocks.fetch.mockReset();
    mocks.resolveInvocationPlanFromRoute.mockReset();
    mocks.resolveInvocationRoute.mockReset();
    mocks.startLLMApiLog.mockClear();
    mocks.completeLLMApiLog.mockClear();
    mocks.failLLMApiLog.mockClear();
    mocks.updateLLMApiLogMetadata.mockClear();
    mocks.cacheMediaFromBlob.mockReset();
    mocks.getImageForAI.mockReset();
  });

  afterEach(() => {
    clearCreativeSessionAuthMaterial();
    vi.unstubAllGlobals();
  });

  it('allows empty apiKey for session-broker video submit and sends canonical same-origin request with idempotency', async () => {
    mocks.resolveInvocationPlanFromRoute.mockReturnValue(
      createSessionBrokerPlan(
        createVideoBinding({ baseUrlStrategy: 'trim-v1' })
      )
    );
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'video-task-1',
          object: 'video',
          model: 'veo3',
          status: 'queued',
          progress: 0,
          created_at: 1,
          seconds: '8',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const { videoAPIService } = await import('../video-api-service');

    const result = await videoAPIService.submitVideoGeneration({
      model: 'veo3',
      modelRef: { profileId: 'new-api-creative', modelId: 'veo3' },
      prompt: 'make a safe video',
      params: {
        provider: 'provider-param-leak',
        channel: 'channel-param-leak',
        baseUrl: 'base-param-leak',
      },
      idempotencyKey: 'opentu-video-task-1',
    });

    expect(result.id).toBe('video-task-1');
    const [input, init] = getFetchCall(mocks.fetch);
    expect(String(input)).toBe('/creative/relay/v1/videos');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('same-origin');

    const headers = init?.headers as Record<string, string>;
    expect(headers['X-Creative-CSRF']).toBe('csrf-video');
    expect(headers['X-Creative-Nonce']).toBe('nonce-video');
    expect(headers['Idempotency-Key']).toBe('opentu-video-task-1');
    expect(headers['X-Safe-Trace']).toBe('trace-ok');

    const headerNames = Object.keys(headers).map((key) => key.toLowerCase());
    expect(headerNames).not.toContain('authorization');
    expect(headerNames).not.toContain('x-api-key');
    expect(JSON.stringify(headers)).not.toMatch(
      /header-leak|provider-header|channel-header|base-url-header|model-header/i
    );

    expect(init?.body).toBeInstanceOf(FormData);
    const formData = init?.body as FormData;
    expect(formData.get('model')).toBe('veo3');
    expect(formData.get('prompt')).toBe('make a safe video');
    const formFieldNames: string[] = [];
    formData.forEach((_value, key) => {
      formFieldNames.push(key);
    });
    expect(JSON.stringify(formFieldNames)).not.toMatch(
      /apiKey|baseUrl|provider|channel/i
    );
    expect(String(input)).not.toMatch(
      /provider-param-leak|channel-param-leak|base-param-leak|apiKey|baseUrl|provider|channel/i
    );
  });

  it('queries session-broker video status through canonical /videos/:taskId without binding override query material', async () => {
    mocks.resolveInvocationPlanFromRoute.mockReturnValue(
      createSessionBrokerPlan(
        createVideoBinding({
          baseUrlStrategy: 'trim-v1',
          pollPathTemplate:
            '/v1/videos/{taskId}?provider=provider-query-leak&channel=channel-query-leak&model=model-query-leak&api_key=api-query-leak',
        })
      )
    );
    mocks.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'task-123',
          object: 'video',
          model: 'veo3',
          status: 'completed',
          progress: 100,
          created_at: 1,
          seconds: '8',
          video_url: 'https://cdn.example/video.mp4',
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const { videoAPIService } = await import('../video-api-service');

    const result = await videoAPIService.queryVideoStatus(
      'task-123',
      { profileId: 'new-api-creative', modelId: 'veo3' },
      {
        provider: 'provider-param-leak',
        channel: 'channel-param-leak',
        model: 'model-param-leak',
      }
    );

    expect(result.id).toBe('task-123');
    const [input, init] = getFetchCall(mocks.fetch);
    expect(String(input)).toBe('/creative/relay/v1/videos/task-123');
    expect(init?.method).toBe('GET');
    expect(init?.credentials).toBe('same-origin');
    expect(String(input)).not.toMatch(
      /v1\/v1|provider|channel|model|api_key|param-leak|query-leak/i
    );
  });

  it('downloads session-broker completed video content through canonical /videos/:taskId/content', async () => {
    mocks.resolveInvocationPlanFromRoute.mockReturnValue(
      createSessionBrokerPlan(
        createVideoBinding({
          baseUrlStrategy: 'trim-v1',
          metadata: {
            video: {
              resultMode: 'download-content',
              downloadPathTemplate:
                '/v1/videos/{taskId}/content?provider=download-provider-leak&channel=download-channel-leak&model=download-model-leak',
            },
          },
        })
      )
    );
    mocks.cacheMediaFromBlob.mockResolvedValue(undefined);
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task-456',
            object: 'video',
            model: 'veo3',
            status: 'completed',
            progress: 100,
            created_at: 1,
            seconds: '8',
            video_url: 'https://upstream.example/leak.mp4',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(new Blob(['video-data'], { type: 'video/mp4' }), {
          status: 200,
          headers: { 'Content-Type': 'video/mp4' },
        })
      );

    const { videoAPIService } = await import('../video-api-service');

    const result = await videoAPIService.resumePolling('task-456', {
      routeModel: { profileId: 'new-api-creative', modelId: 'veo3' },
    });

    expect(result.url).toBe('/__aitu_cache__/video/task-456.mp4');
    expect(result.video_url).toBe('/__aitu_cache__/video/task-456.mp4');
    expect(mocks.cacheMediaFromBlob).toHaveBeenCalledOnce();

    const [statusInput, statusInit] = getFetchCall(mocks.fetch, 0);
    expect(String(statusInput)).toBe('/creative/relay/v1/videos/task-456');
    expect(statusInit?.method).toBe('GET');
    expect(statusInit?.credentials).toBe('same-origin');

    const [contentInput, contentInit] = getFetchCall(mocks.fetch, 1);
    expect(String(contentInput)).toBe(
      '/creative/relay/v1/videos/task-456/content'
    );
    expect(contentInit?.method).toBe('GET');
    expect(contentInit?.credentials).toBe('same-origin');
    expect((contentInit?.headers as Record<string, string>).Accept).toBe(
      'video/*,application/octet-stream'
    );

    expect(`${statusInput} ${contentInput}`).not.toMatch(
      /v1\/v1|download-provider-leak|download-channel-leak|download-model-leak|provider|channel|model|upstream\.example/i
    );
  });

  it('fails unsupported session-broker video capability without retrying direct providers', async () => {
    mocks.resolveInvocationPlanFromRoute.mockReturnValue(
      createSessionBrokerPlan(createVideoBinding())
    );
    mocks.fetch.mockResolvedValueOnce(
      new Response('unsupported creative video', { status: 501 })
    );

    const { videoAPIService } = await import('../video-api-service');

    await expect(
      videoAPIService.resumePolling('task-unsupported', {
        routeModel: { profileId: 'new-api-creative', modelId: 'veo3' },
      })
    ).rejects.toThrow(/暂不支持嵌入式视频生成/);

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [input, init] = getFetchCall(mocks.fetch);
    expect(String(input)).toBe('/creative/relay/v1/videos/task-unsupported');
    expect(init?.credentials).toBe('same-origin');
  });

  it('fails unsupported session-broker video content download without direct fallback', async () => {
    mocks.resolveInvocationPlanFromRoute.mockReturnValue(
      createSessionBrokerPlan(createVideoBinding())
    );
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task-content-unsupported',
            object: 'video',
            model: 'veo3',
            status: 'completed',
            progress: 100,
            created_at: 1,
            seconds: '8',
            video_url: 'https://upstream.example/leak.mp4',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response('unsupported creative video content', { status: 501 })
      );

    const { videoAPIService } = await import('../video-api-service');

    await expect(
      videoAPIService.resumePolling('task-content-unsupported', {
        routeModel: { profileId: 'new-api-creative', modelId: 'veo3' },
      })
    ).rejects.toThrow(/暂不支持嵌入式视频生成/);

    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    const [statusInput] = getFetchCall(mocks.fetch, 0);
    const [contentInput, contentInit] = getFetchCall(mocks.fetch, 1);
    expect(String(statusInput)).toBe(
      '/creative/relay/v1/videos/task-content-unsupported'
    );
    expect(String(contentInput)).toBe(
      '/creative/relay/v1/videos/task-content-unsupported/content'
    );
    expect(contentInit?.credentials).toBe('same-origin');
    expect(`${statusInput} ${contentInput}`).not.toMatch(
      /upstream\.example|provider|channel|apiKey|Authorization/i
    );
  });

  it('still rejects direct video routes without an API key', async () => {
    mocks.resolveInvocationPlanFromRoute.mockReturnValue(null);
    mocks.resolveInvocationRoute.mockReturnValue(createDirectRouteWithoutKey());

    const { videoAPIService } = await import('../video-api-service');

    await expect(
      videoAPIService.submitVideoGeneration({
        model: 'veo3',
        prompt: 'make a direct video',
      })
    ).rejects.toThrow(/API Key 未配置/);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
