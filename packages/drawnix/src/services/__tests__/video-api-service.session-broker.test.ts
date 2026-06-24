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
    vi.restoreAllMocks();
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

  it('rejects session-broker video submit without a stable idempotency key before logging, image processing, or fetch', async () => {
    mocks.resolveInvocationPlanFromRoute.mockReturnValue(
      createSessionBrokerPlan(createVideoBinding())
    );
    mocks.getImageForAI.mockResolvedValue({
      type: 'url',
      value: 'https://cdn.example/reference.png',
    });

    const { videoAPIService } = await import('../video-api-service');

    await expect(
      videoAPIService.submitVideoGeneration({
        model: 'veo3',
        modelRef: { profileId: 'new-api-creative', modelId: 'veo3' },
        prompt: 'make a safe video',
        inputReferences: [
          {
            slot: 0,
            url: '/__aitu_cache__/asset/reference.png',
            name: 'reference.png',
          },
        ],
      })
    ).rejects.toThrow(/idempotency/i);

    expect(mocks.startLLMApiLog).not.toHaveBeenCalled();
    expect(mocks.getImageForAI).not.toHaveBeenCalled();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('sanitizes unsupported session-broker video submit responses before logging or exposing raw bodies', async () => {
    mocks.resolveInvocationPlanFromRoute.mockReturnValue(
      createSessionBrokerPlan(createVideoBinding())
    );
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        'unsupported Authorization Bearer secret apiKey upstream credential leak',
        { status: 405 }
      )
    );
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const { videoAPIService } = await import('../video-api-service');

    let caught: unknown;
    try {
      await videoAPIService.submitVideoGeneration({
        model: 'veo3',
        modelRef: { profileId: 'new-api-creative', modelId: 'veo3' },
        prompt: 'make a safe video',
        idempotencyKey: 'opentu-video-submit-unsupported',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      unsupportedCreativeVideo: true,
      httpStatus: 405,
    });
    expect((caught as Error).message).toMatch(/暂不支持嵌入式视频生成/);
    expect((caught as Error).message).not.toMatch(
      /Authorization|Bearer|apiKey|upstream|credential|secret/i
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.failLLMApiLog.mock.calls)).toContain(
      'unsupported creative video relay status 405'
    );
    expect(JSON.stringify(mocks.failLLMApiLog.mock.calls)).not.toMatch(
      /Authorization|Bearer|apiKey|upstream|credential|secret/i
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it('sanitizes non-unsupported session-broker video submit errors before logging or exposing raw bodies', async () => {
    mocks.resolveInvocationPlanFromRoute.mockReturnValue(
      createSessionBrokerPlan(createVideoBinding())
    );
    mocks.fetch.mockResolvedValueOnce(
      new Response('Authorization Bearer secret apiKey upstream credential leak', {
        status: 500,
      })
    );
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const { videoAPIService } = await import('../video-api-service');

    let caught: unknown;
    try {
      await videoAPIService.submitVideoGeneration({
        model: 'veo3',
        modelRef: { profileId: 'new-api-creative', modelId: 'veo3' },
        prompt: 'make a safe video',
        idempotencyKey: 'opentu-video-submit-error',
      });
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).toBe('视频生成提交失败: 500');
    expect((caught as any).apiErrorBody).toBe('creative video relay status 500');
    expect((caught as Error).message).not.toMatch(
      /Authorization|Bearer|apiKey|upstream|credential|secret/i
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.failLLMApiLog.mock.calls)).toContain(
      'creative video relay status 500'
    );
    expect(JSON.stringify(mocks.failLLMApiLog.mock.calls)).not.toMatch(
      /Authorization|Bearer|apiKey|upstream|credential|secret/i
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
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

  it('fails fast without querying when resume polling signal is already aborted', async () => {
    mocks.resolveInvocationPlanFromRoute.mockReturnValue(
      createSessionBrokerPlan(createVideoBinding())
    );
    const abortController = new AbortController();
    abortController.abort();

    const { videoAPIService } = await import('../video-api-service');

    await expect(
      videoAPIService.resumePolling('task-aborted-before-query', {
        routeModel: { profileId: 'new-api-creative', modelId: 'veo3' },
        signal: abortController.signal,
      } as any)
    ).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(mocks.fetch).not.toHaveBeenCalled();
  });


  it('stops polling when signal aborts after video submit enters polling', async () => {
    vi.useFakeTimers();
    mocks.resolveInvocationPlanFromRoute.mockReturnValue(
      createSessionBrokerPlan(createVideoBinding())
    );
    mocks.fetch
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task-abort-after-submit',
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
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'task-abort-after-submit',
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

    const abortController = new AbortController();
    const { videoAPIService } = await import('../video-api-service');

    const promise = videoAPIService.generateVideoWithPolling(
      {
        model: 'veo3',
        modelRef: { profileId: 'new-api-creative', modelId: 'veo3' },
        prompt: 'make a safe video',
        idempotencyKey: 'opentu-video-abort-after-submit',
      },
      {
        interval: 100,
        maxAttempts: 1,
        signal: abortController.signal,
        onProgress: () => {
          setTimeout(() => abortController.abort(), 0);
        },
      }
    );

    await vi.waitFor(() => expect(mocks.fetch).toHaveBeenCalledTimes(1));
    const rejection = expect(promise).rejects.toMatchObject({
      name: 'AbortError',
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(100);

    await rejection;
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
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

  it('sanitizes unsupported session-broker video status responses without logging raw bodies', async () => {
    mocks.resolveInvocationPlanFromRoute.mockReturnValue(
      createSessionBrokerPlan(createVideoBinding())
    );
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        'unsupported Authorization Bearer secret apiKey upstream credential leak',
        { status: 501 }
      )
    );
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const { videoAPIService } = await import('../video-api-service');

    let caught: unknown;
    try {
      await videoAPIService.resumePolling('task-unsupported-secret', {
        routeModel: { profileId: 'new-api-creative', modelId: 'veo3' },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      unsupportedCreativeVideo: true,
      httpStatus: 501,
    });
    expect((caught as Error).message).toMatch(/暂不支持嵌入式视频生成/);
    expect((caught as Error).message).not.toMatch(
      /Authorization|Bearer|apiKey|upstream|credential|secret/i
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it('sanitizes non-unsupported session-broker video status errors without exposing raw bodies', async () => {
    mocks.resolveInvocationPlanFromRoute.mockReturnValue(
      createSessionBrokerPlan(createVideoBinding())
    );
    mocks.fetch.mockResolvedValueOnce(
      new Response('Authorization Bearer secret apiKey upstream credential leak', {
        status: 500,
      })
    );
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const { videoAPIService } = await import('../video-api-service');

    let caught: unknown;
    try {
      await videoAPIService.resumePolling('task-error-secret', {
        routeModel: { profileId: 'new-api-creative', modelId: 'veo3' },
      });
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).toBe('视频状态查询失败: 500');
    expect((caught as any).apiErrorBody).toBe('creative video relay status 500');
    expect((caught as Error).message).not.toMatch(
      /Authorization|Bearer|apiKey|upstream|credential|secret/i
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it('sanitizes session-broker video task failure payloads before exposing them', async () => {
    mocks.resolveInvocationPlanFromRoute.mockReturnValue(
      createSessionBrokerPlan(createVideoBinding())
    );
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'task-failed-secret',
          status: 'failed',
          error: {
            message:
              'Authorization Bearer secret apiKey upstream https://provider.example/private.mp4',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const { videoAPIService } = await import('../video-api-service');

    let caught: unknown;
    try {
      await videoAPIService.resumePolling('task-failed-secret', {
        routeModel: { profileId: 'new-api-creative', modelId: 'veo3' },
      });
    } catch (error) {
      caught = error;
    }

    expect((caught as Error).message).toBe('视频生成失败');
    expect((caught as Error).message).not.toMatch(
      /Authorization|Bearer|apiKey|upstream|secret|provider\.example/i
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('sanitizes session-broker video submit failed payloads before returning or logging them', async () => {
    mocks.resolveInvocationPlanFromRoute.mockReturnValue(
      createSessionBrokerPlan(createVideoBinding())
    );
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'task-submit-failed-redacted',
          object: 'video',
          model: 'veo3',
          status: 'failed',
          progress: 100,
          created_at: 1,
          seconds: '8',
          error: {
            code: 'policy',
            message:
              'Authorization Bearer secret apiKey upstream https://provider.example/private.mp4',
          },
          notifyHook: 'notifyHook callback relay metadata',
          callback: 'callback relay metadata',
          data: {
            webhook: 'webhook relay metadata',
            detail:
              'Authorization Bearer apiKey upstream https://provider.example/raw',
          },
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
      idempotencyKey: 'opentu-video-submit-failed-redacted',
    });

    expect(result.status).toBe('failed');
    expect(JSON.stringify(result)).not.toMatch(
      /Authorization|Bearer|apiKey|upstream|secret|provider\.example|callback|webhook|notifyHook/i
    );
    expect(JSON.stringify(result)).toContain('视频生成失败');
    expect(JSON.stringify(mocks.failLLMApiLog.mock.calls)).not.toMatch(
      /Authorization|Bearer|apiKey|upstream|secret|provider\.example/i
    );
    expect(JSON.stringify(mocks.failLLMApiLog.mock.calls)).toContain(
      '视频生成失败'
    );
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it('sanitizes session-broker video query failed payloads before returning them', async () => {
    mocks.resolveInvocationPlanFromRoute.mockReturnValue(
      createSessionBrokerPlan(createVideoBinding())
    );
    mocks.fetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 'task-query-failed-redacted',
          object: 'video',
          model: 'veo3',
          status: 'failed',
          progress: 100,
          created_at: 1,
          seconds: '8',
          error: {
            code: 'provider_failure',
            message:
              'Authorization Bearer secret apiKey upstream https://provider.example/private.mp4',
          },
          raw: {
            notify_hook: 'notify_hook relay metadata',
            webhook: 'webhook relay metadata',
            detail:
              'Authorization Bearer apiKey upstream https://provider.example/raw',
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    const { videoAPIService } = await import('../video-api-service');

    const result = await videoAPIService.queryVideoStatus('task-query-failed-redacted', {
      profileId: 'new-api-creative',
      modelId: 'veo3',
    });

    expect(result.status).toBe('failed');
    expect(JSON.stringify(result)).not.toMatch(
      /Authorization|Bearer|apiKey|upstream|secret|provider\.example|callback|webhook|notify_hook/i
    );
    expect(JSON.stringify(result)).toContain('视频生成失败');
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
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
        new Response(
          'unsupported Authorization Bearer secret apiKey upstream credential leak',
          { status: 501 }
        )
      );

    const { videoAPIService } = await import('../video-api-service');

    let caught: unknown;
    try {
      await videoAPIService.resumePolling('task-content-unsupported', {
        routeModel: { profileId: 'new-api-creative', modelId: 'veo3' },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      unsupportedCreativeVideo: true,
      httpStatus: 501,
    });
    expect((caught as Error).message).toMatch(/暂不支持嵌入式视频生成/);
    expect((caught as Error).message).not.toMatch(
      /Authorization|Bearer|apiKey|upstream|credential|secret/i
    );

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
