import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  InvocationPlan,
  ProviderModelBinding,
  ResolvedProviderContext,
} from '../provider-routing/types';

const loggerMocks = vi.hoisted(() => ({
  startLLMApiLog: vi.fn(() => 'audio-log-1'),
  completeLLMApiLog: vi.fn(),
  failLLMApiLog: vi.fn(),
  updateLLMApiLogMetadata: vi.fn(),
}));

vi.mock('../media-executor/llm-api-logger', () => ({
  startLLMApiLog: loggerMocks.startLLMApiLog,
  completeLLMApiLog: loggerMocks.completeLLMApiLog,
  failLLMApiLog: loggerMocks.failLLMApiLog,
  updateLLMApiLogMetadata: loggerMocks.updateLLMApiLogMetadata,
}));

type FetchMock = ReturnType<typeof vi.fn<typeof fetch>>;
type FetchCall = Parameters<typeof fetch>;

function getFetchCall(fetcher: FetchMock, index = 0): FetchCall {
  const call = fetcher.mock.calls[index];
  if (!call) {
    throw new Error(`Expected fetch call #${index + 1}`);
  }
  return call;
}

function createAudioBinding(
  overrides: Partial<ProviderModelBinding> = {}
): ProviderModelBinding {
  return {
    id: 'new-api-creative:suno_music:audio',
    profileId: 'new-api-creative',
    modelId: 'suno_music',
    operation: 'audio',
    protocol: 'tuzi.suno.music',
    requestSchema: 'tuzi.suno.music.submit',
    responseSchema: 'tuzi.suno.task',
    submitPath: '/suno/submit/music',
    pollPathTemplate: '/suno/fetch/{taskId}',
    priority: 100,
    confidence: 'high',
    source: 'template',
    metadata: {
      audio: {
        action: 'music',
        defaultAction: 'music',
        submitPathByAction: {
          music: '/suno/submit/music',
          lyrics: '/suno/submit/lyrics',
        },
      },
    },
    ...overrides,
  };
}

function createSessionBrokerAudioPlan(
  binding: ProviderModelBinding = createAudioBinding()
): InvocationPlan {
  const provider: ResolvedProviderContext = {
    profileId: 'new-api-creative',
    profileName: 'Creative',
    providerType: 'openai-compatible',
    baseUrl: '/creative/relay/v1',
    apiKey: '',
    authType: 'session-broker',
    extraHeaders: {
      Authorization: 'Bearer audio-header-leak',
      'X-API-Key': 'audio-api-key-header-leak',
      'X-Provider': 'audio-provider-header-leak',
      'X-Channel-Id': 'audio-channel-header-leak',
      'X-Base-URL': 'audio-base-url-header-leak',
      'X-Model': 'audio-model-header-leak',
      'X-Safe-Trace': 'trace-ok',
    },
  };

  return {
    provider,
    modelRef: {
      profileId: 'new-api-creative',
      modelId: 'suno_music',
    },
    binding,
  };
}

function mockResolveInvocationRoute(route: Record<string, unknown>): void {
  vi.doMock('../../utils/settings-manager', () => {
    const readOnlySettings = <T,>(value: T) => ({
      get: () => value,
      update: vi.fn(),
      subscribe: vi.fn(() => () => undefined),
    });

    return {
      DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY: 'openai',
      LEGACY_DEFAULT_PROVIDER_IMAGE_API_COMPATIBILITY: 'openai',
      LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
      TUZI_DEFAULT_PROVIDER_NAME: 'Tuzi',
      TUZI_PROVIDER_DEFAULT_BASE_URL: 'https://api.tu-zi.com/v1',
      createModelRef: (
        profileId?: string | null,
        modelId?: string | null
      ) => {
        const normalizedModelId = modelId?.trim();
        if (!normalizedModelId) {
          return null;
        }
        return {
          profileId: profileId?.trim() || null,
          modelId: normalizedModelId,
        };
      },
      geminiSettings: readOnlySettings({
        apiKey: '',
        baseUrl: 'https://api.tu-zi.com/v1',
        textModelName: 'gpt-4o-mini',
        imageModelName: 'gpt-image-1',
        videoModelName: 'veo3',
        audioModelName: 'suno_music',
      }),
      providerCatalogsSettings: readOnlySettings([]),
      providerProfilesSettings: readOnlySettings([]),
      providerPricingCacheSettings: readOnlySettings({ providers: {} }),
      resolveInvocationRoute: () => route,
    };
  });
}

describe('audio-api-service', () => {
  beforeEach(() => {
    vi.resetModules();
    loggerMocks.startLLMApiLog.mockClear();
    loggerMocks.completeLLMApiLog.mockClear();
    loggerMocks.failLLMApiLog.mockClear();
    loggerMocks.updateLLMApiLogMetadata.mockClear();
  });

  afterEach(async () => {
    const creativeMode = await import('../creative-mode');
    creativeMode.clearCreativeSessionAuthMaterial();
    vi.unstubAllGlobals();
  });

  it('polls Suno tasks when submit returns the task id as data string', async () => {
    const taskId = '01f7e7fd-8d57-4305-a3e5-fcc7e2783956';
    const sendMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'success', data: taskId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task_id: taskId,
            action: 'MUSIC',
            status: 'SUCCESS',
            data: [
              {
                id: 'clip-1',
                clip_id: 'clip-1',
                title: 'Starry',
                status: 'complete',
                batch_index: 0,
                audio_url: 'https://cdn1.suno.ai/clip-1.mp3',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () => null,
        providerTransport: {
          ...(actual as { providerTransport: object }).providerTransport,
          send: sendMock,
        },
      };
    });

    mockResolveInvocationRoute({
      profileId: 'runtime',
      profileName: 'Runtime',
      providerType: 'custom',
      baseUrl: 'https://api.tu-zi.com/v1',
      apiKey: 'test-key',
      authType: 'bearer',
    });

    const { audioAPIService, extractAudioGenerationResult } = await import(
      '../audio-api-service'
    );

    const result = await audioAPIService.generateAudioWithPolling(
      {
        model: 'suno_music',
        prompt: 'write a heavy metal song',
      },
      {
        interval: 1,
        maxAttempts: 2,
      }
    );

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0]?.[1]).toMatchObject({
      path: '/suno/submit/music',
      baseUrlStrategy: 'trim-v1',
      method: 'POST',
    });
    expect(sendMock.mock.calls[1]?.[1]).toMatchObject({
      path: `/suno/fetch/${taskId}`,
      baseUrlStrategy: 'trim-v1',
      method: 'GET',
    });
    expect(result.taskId).toBe(taskId);
    expect(result.clips[0]?.audio_url).toBe('https://cdn1.suno.ai/clip-1.mp3');
    const extracted = extractAudioGenerationResult(result);
    expect(extracted.providerTaskId).toBe(taskId);
    expect(extracted.primaryClipId).toBe('clip-1');
    expect(extracted.clipIds).toEqual(['clip-1']);
  });

  it('fails early when task id is empty instead of querying an invalid fetch path', async () => {
    const sendMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ code: 'success', data: '' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () => null,
        providerTransport: {
          ...(actual as { providerTransport: object }).providerTransport,
          send: sendMock,
        },
      };
    });

    mockResolveInvocationRoute({
      profileId: 'runtime',
      profileName: 'Runtime',
      providerType: 'custom',
      baseUrl: 'https://api.tu-zi.com/v1',
      apiKey: 'test-key',
      authType: 'bearer',
    });

    const { audioAPIService } = await import('../audio-api-service');

    await expect(
      audioAPIService.generateAudioWithPolling({
        model: 'suno_music',
        prompt: 'write a heavy metal song',
      })
    ).rejects.toThrow('音乐生成提交成功，但未返回任务 ID');

    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it('treats nested success with completed clips as terminal even when wrapper status stays IN_PROGRESS', async () => {
    const taskId = 'd9d2378b-ff5e-4a2e-b0f9-01e85e9d7b72';
    const sendMock = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 'success',
          message: '',
          data: {
            task_id: taskId,
            action: 'MUSIC',
            status: 'IN_PROGRESS',
            progress: '100%',
            data: {
              task_id: taskId,
              action: 'MUSIC',
              status: 'SUCCESS',
              data: [
                {
                  clip_id: 'clip-1',
                  batch_index: 0,
                  status: 'complete',
                  audio_url: 'https://cdn1.suno.ai/clip-1.mp3',
                },
                {
                  clip_id: 'clip-2',
                  batch_index: 1,
                  status: 'complete',
                  audio_url: 'https://cdn1.suno.ai/clip-2.mp3',
                },
              ],
            },
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () => null,
        providerTransport: {
          ...(actual as { providerTransport: object }).providerTransport,
          send: sendMock,
        },
      };
    });

    mockResolveInvocationRoute({
      profileId: 'runtime',
      profileName: 'Runtime',
      providerType: 'custom',
      baseUrl: 'https://api.tu-zi.com/v1',
      apiKey: 'test-key',
      authType: 'bearer',
    });

    const { audioAPIService, extractAudioGenerationResult } = await import(
      '../audio-api-service'
    );

    const result = await audioAPIService.resumePolling(taskId, {
      interval: 1,
      maxAttempts: 1,
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('completed');
    expect(result.progress).toBe(100);
    expect(result.clips).toHaveLength(2);
    expect(result.clips[0]?.audio_url).toBe('https://cdn1.suno.ai/clip-1.mp3');
    const extracted = extractAudioGenerationResult(result);
    expect(extracted.providerTaskId).toBe(taskId);
    expect(extracted.primaryClipId).toBe('clip-1');
    expect(extracted.clipIds).toEqual(['clip-1', 'clip-2']);
    expect(extracted.clips).toHaveLength(2);
  });

  it('sends continue and infill parameters in Suno music submit body', async () => {
    const taskId = 'b16bca7d-17ee-41fd-a218-31ca5fda0ac9';
    const sendMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'success', data: taskId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task_id: taskId,
            action: 'MUSIC',
            status: 'SUCCESS',
            data: [
              {
                clip_id: 'clip-continue-1',
                batch_index: 0,
                status: 'complete',
                audio_url: 'https://cdn1.suno.ai/clip-continue-1.mp3',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () => null,
        providerTransport: {
          ...(actual as { providerTransport: object }).providerTransport,
          send: sendMock,
        },
      };
    });

    mockResolveInvocationRoute({
      profileId: 'runtime',
      profileName: 'Runtime',
      providerType: 'custom',
      baseUrl: 'https://api.tu-zi.com/v1',
      apiKey: 'test-key',
      authType: 'bearer',
    });

    const { audioAPIService } = await import('../audio-api-service');

    await audioAPIService.generateAudioWithPolling(
      {
        model: 'suno_music',
        prompt: '继续完善副歌',
        continueClipId: 'clip-continue-1',
        continueTaskId: 'task-continue-1',
        continueAt: 32,
        infillStartS: 8,
        infillEndS: 16,
      },
      {
        interval: 1,
        maxAttempts: 2,
      }
    );

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0]?.[1]).toMatchObject({
      path: '/suno/submit/music',
      method: 'POST',
    });
    expect(
      JSON.parse(sendMock.mock.calls[0]?.[1]?.body as string)
    ).toMatchObject({
      prompt: '继续完善副歌',
      continue_clip_id: 'clip-continue-1',
      task_id: 'task-continue-1',
      continue_at: 32,
      infill_start_s: 8,
      infill_end_s: 16,
    });
  });

  it('remembers clip_id discovered during polling and reuses it for continuation ids', async () => {
    const taskId = 'a1a214aa-b4b2-4744-9d05-7977b9fcf6b9';
    const sendMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'success', data: taskId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'success',
            data: {
              task_id: taskId,
              action: 'MUSIC',
              status: 'IN_PROGRESS',
              progress: '30%',
              data: [
                {
                  id: 'song-row-1',
                  clip_id: 'continue-clip-1',
                  batch_index: 0,
                  status: 'queued',
                },
                {
                  id: 'song-row-2',
                  clip_id: 'continue-clip-2',
                  batch_index: 1,
                  status: 'queued',
                },
              ],
            },
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
            code: 'success',
            data: {
              task_id: taskId,
              action: 'MUSIC',
              status: 'SUCCESS',
              data: [
                {
                  id: 'final-row-1',
                  batch_index: 0,
                  status: 'complete',
                  audio_url: 'https://cdn1.suno.ai/final-1.mp3',
                },
                {
                  id: 'final-row-2',
                  batch_index: 1,
                  status: 'complete',
                  audio_url: 'https://cdn1.suno.ai/final-2.mp3',
                },
              ],
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () => null,
        providerTransport: {
          ...(actual as { providerTransport: object }).providerTransport,
          send: sendMock,
        },
      };
    });

    mockResolveInvocationRoute({
      profileId: 'runtime',
      profileName: 'Runtime',
      providerType: 'custom',
      baseUrl: 'https://api.tu-zi.com/v1',
      apiKey: 'test-key',
      authType: 'bearer',
    });

    const { audioAPIService, extractAudioGenerationResult } = await import(
      '../audio-api-service'
    );

    const result = await audioAPIService.generateAudioWithPolling(
      {
        model: 'suno_music',
        prompt: '写一首儿歌',
      },
      {
        interval: 1,
        maxAttempts: 3,
      }
    );

    const extracted = extractAudioGenerationResult(result);
    expect(extracted.primaryClipId).toBe('continue-clip-1');
    expect(extracted.clipIds).toEqual(['continue-clip-1', 'continue-clip-2']);
    expect(extracted.clips?.map((clip) => clip.clipId)).toEqual([
      'continue-clip-1',
      'continue-clip-2',
    ]);
  });

  it('submits Suno lyrics generation and extracts text results from fetch payloads', async () => {
    const taskId = 'fc415768-51b9-4fb0-89f9-31b6863a736e';
    const sendMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'success', data: taskId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'success',
            data: {
              task_id: taskId,
              action: 'LYRICS',
              status: 'SUCCESS',
              progress: '100%',
              data: {
                tags: ['EDM, 激烈的'],
                text: '[Chorus]\\n我想象他们看我微笑着',
                title: '战斗进行时',
                status: 'complete',
                error_message: '',
              },
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () => null,
        providerTransport: {
          ...(actual as { providerTransport: object }).providerTransport,
          send: sendMock,
        },
      };
    });

    mockResolveInvocationRoute({
      profileId: 'runtime',
      profileName: 'Runtime',
      providerType: 'custom',
      baseUrl: 'https://api.tu-zi.com/v1',
      apiKey: 'test-key',
      authType: 'bearer',
    });

    const { audioAPIService, extractAudioGenerationResult } = await import(
      '../audio-api-service'
    );

    const result = await audioAPIService.generateAudioWithPolling(
      {
        model: 'suno_music',
        prompt: '编写一首儿歌',
        sunoAction: 'lyrics',
      },
      {
        interval: 1,
        maxAttempts: 2,
      }
    );

    expect(sendMock).toHaveBeenCalledTimes(2);
    expect(sendMock.mock.calls[0]?.[1]).toMatchObject({
      path: '/suno/submit/lyrics',
      baseUrlStrategy: 'trim-v1',
      method: 'POST',
    });
    expect(result.taskId).toBe(taskId);
    expect(result.action).toBe('LYRICS');
    expect(result.status).toBe('completed');
    expect(result.lyrics?.title).toBe('战斗进行时');
    expect(result.lyrics?.tags).toEqual(['EDM, 激烈的']);

    const extracted = extractAudioGenerationResult(result);
    expect(extracted.resultKind).toBe('lyrics');
    expect(extracted.url).toBe('');
    expect(extracted.format).toBe('lyrics');
    expect(extracted.title).toBe('战斗进行时');
    expect(extracted.lyricsTitle).toBe('战斗进行时');
    expect(extracted.lyricsText).toContain('我想象他们看我微笑着');
    expect(extracted.lyricsTags).toEqual(['EDM, 激烈的']);
    expect(extracted.providerTaskId).toBe(taskId);
  });

  it('extracts lyrics text from nested data wrappers without losing compatibility', async () => {
    const taskId = '9c02be46-2393-4867-b993-4c6722868481';
    const sendMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'success', data: taskId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'success',
            message: '',
            data: {
              task_id: taskId,
              action: 'LYRICS',
              status: 'IN_PROGRESS',
              progress: '100%',
              data: {
                data: {
                  tags: ['traditional Chinese instrumentation, epic, rock'],
                  text: '[Verse]\\n太陽從西方升起',
                  title: '战斗神曲',
                  status: 'complete',
                  error_message: '',
                },
                action: 'LYRICS',
                status: 'SUCCESS',
                task_id: taskId,
              },
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () => null,
        providerTransport: {
          ...(actual as { providerTransport: object }).providerTransport,
          send: sendMock,
        },
      };
    });

    mockResolveInvocationRoute({
      profileId: 'runtime',
      profileName: 'Runtime',
      providerType: 'custom',
      baseUrl: 'https://api.tu-zi.com/v1',
      apiKey: 'test-key',
      authType: 'bearer',
    });

    const { audioAPIService, extractAudioGenerationResult } = await import(
      '../audio-api-service'
    );

    const result = await audioAPIService.generateAudioWithPolling(
      {
        model: 'suno_lyrics',
        prompt: '写一首战斗神曲',
      },
      {
        interval: 1,
        maxAttempts: 2,
      }
    );

    expect(result.status).toBe('completed');
    expect(result.lyrics?.title).toBe('战斗神曲');
    expect(result.lyrics?.text).toContain('太陽從西方升起');
    expect(result.lyrics?.tags).toEqual([
      'traditional Chinese instrumentation, epic, rock',
    ]);

    const extracted = extractAudioGenerationResult(result);
    expect(extracted.resultKind).toBe('lyrics');
    expect(extracted.lyricsTitle).toBe('战斗神曲');
    expect(extracted.lyricsText).toContain('太陽從西方升起');
    expect(extracted.lyricsTags).toEqual([
      'traditional Chinese instrumentation, epic, rock',
    ]);
  });

  it('treats the suno_lyrics model alias as a lyrics action even without explicit params', async () => {
    const taskId = '91f6eb95-6ce5-4e35-b4ae-67dca3a5dc27';
    const sendMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'success', data: taskId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            code: 'success',
            data: {
              task_id: taskId,
              action: 'LYRICS',
              status: 'SUCCESS',
              data: {
                text: '[Verse]\\n测试歌词',
                title: '别名歌词',
                tags: ['pop'],
              },
            },
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () => null,
        providerTransport: {
          ...(actual as { providerTransport: object }).providerTransport,
          send: sendMock,
        },
      };
    });

    mockResolveInvocationRoute({
      profileId: 'runtime',
      profileName: 'Runtime',
      providerType: 'custom',
      baseUrl: 'https://api.tu-zi.com/v1',
      apiKey: 'test-key',
      authType: 'bearer',
    });

    const { audioAPIService, extractAudioGenerationResult } = await import(
      '../audio-api-service'
    );

    const result = await audioAPIService.generateAudioWithPolling(
      {
        model: 'suno_lyrics',
        prompt: '写一首流行歌歌词',
      },
      {
        interval: 1,
        maxAttempts: 2,
      }
    );

    expect(sendMock.mock.calls[0]?.[1]).toMatchObject({
      path: '/suno/submit/lyrics',
      method: 'POST',
    });
    expect(result.action).toBe('LYRICS');

    const extracted = extractAudioGenerationResult(result);
    expect(extracted.resultKind).toBe('lyrics');
    expect(extracted.lyricsTitle).toBe('别名歌词');
    expect(extracted.lyricsText).toContain('测试歌词');
  });

  it('allows empty apiKey for session-broker Suno music and sends canonical idempotent same-origin requests without credential leakage', async () => {
    const taskId = 'creative-suno-task-1';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ code: 'success', data: taskId }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            task_id: taskId,
            action: 'MUSIC',
            status: 'SUCCESS',
            data: [
              {
                clip_id: 'creative-clip-1',
                batch_index: 0,
                status: 'complete',
                audio_url: 'https://cdn1.suno.ai/creative-clip-1.mp3',
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    const { setCreativeSessionAuthMaterial } = await import('../creative-mode');
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-audio',
      nonce: 'nonce-audio',
    });

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () =>
          createSessionBrokerAudioPlan(
            createAudioBinding({
              baseUrlStrategy: 'trim-v1',
              submitPath:
                '/v1/suno/submit/music?apiKey=submit-query-leak&provider=submit-provider-leak',
              pollPathTemplate:
                '/v1/suno/fetch/{taskId}?apiKey=poll-query-leak&provider=poll-provider-leak&model=poll-model-leak',
              metadata: {
                audio: {
                  action: 'music',
                  defaultAction: 'music',
                  submitPathByAction: {
                    music:
                      '/v1/suno/submit/music?apiKey=submit-query-leak&provider=submit-provider-leak',
                    lyrics:
                      '/v1/suno/submit/lyrics?apiKey=lyrics-query-leak&provider=lyrics-provider-leak',
                  },
                },
              },
            })
          ),
      };
    });

    const { audioAPIService } = await import('../audio-api-service');

    const result = await audioAPIService.generateAudioWithPolling(
      {
        model: 'suno_music',
        modelRef: { profileId: 'new-api-creative', modelId: 'suno_music' },
        prompt: 'prompt-secret-must-not-enter-idempotency',
        taskId: 'local-audio-task-1',
      },
      {
        interval: 1,
        maxAttempts: 2,
      }
    );

    expect(result.taskId).toBe(taskId);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [submitInput, submitInit] = getFetchCall(fetchMock, 0);
    expect(String(submitInput)).toBe('/creative/relay/v1/suno/submit/music');
    expect(submitInit?.method).toBe('POST');
    expect(submitInit?.credentials).toBe('same-origin');
    const submitHeaders = submitInit?.headers as Record<string, string>;
    expect(submitHeaders['Content-Type']).toBe('application/json');
    expect(submitHeaders['X-Creative-CSRF']).toBe('csrf-audio');
    expect(submitHeaders['X-Creative-Nonce']).toBe('nonce-audio');
    expect(submitHeaders['Idempotency-Key']).toBe(
      'opentu-audio-local-audio-task-1'
    );
    expect(submitHeaders['Idempotency-Key']).not.toContain('prompt-secret');
    expect(submitHeaders['X-Safe-Trace']).toBe('trace-ok');
    expect(
      Object.keys(submitHeaders).map((key) => key.toLowerCase())
    ).not.toContain('authorization');
    expect(
      Object.keys(submitHeaders).map((key) => key.toLowerCase())
    ).not.toContain('x-api-key');
    expect(JSON.stringify(submitHeaders)).not.toMatch(
      /audio-header-leak|audio-api-key|audio-provider|audio-channel|audio-base-url|audio-model/i
    );

    const submitBody = JSON.parse(submitInit?.body as string);
    expect(submitBody).toMatchObject({
      prompt: 'prompt-secret-must-not-enter-idempotency',
      mv: 'chirp-v3-5',
    });
    expect(JSON.stringify(submitBody)).not.toMatch(
      /apiKey|baseUrl|provider|channel|audio-header-leak|audio-api-key/i
    );

    const [pollInput, pollInit] = getFetchCall(fetchMock, 1);
    expect(String(pollInput)).toBe(`/creative/relay/v1/suno/fetch/${taskId}`);
    expect(pollInit?.method).toBe('GET');
    expect(pollInit?.credentials).toBe('same-origin');
    expect(`${submitInput} ${pollInput}`).not.toMatch(
      /v1\/v1|submit-query-leak|poll-query-leak|provider|channel|baseUrl|apiKey|model-leak/i
    );
  });

  it('uses the canonical session-broker Suno lyrics submit path with an empty apiKey', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'success', data: 'creative-lyrics-task-1' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const { setCreativeSessionAuthMaterial } = await import('../creative-mode');
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-audio',
      nonce: 'nonce-audio',
    });

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () =>
          createSessionBrokerAudioPlan(
            createAudioBinding({ baseUrlStrategy: 'trim-v1' })
          ),
      };
    });

    const { audioAPIService } = await import('../audio-api-service');

    const result = await audioAPIService.submitAudioGeneration({
      model: 'suno_lyrics',
      modelRef: { profileId: 'new-api-creative', modelId: 'suno_lyrics' },
      prompt: '写一首歌词',
      taskId: 'local-lyrics-task-1',
    });

    expect(result.taskId).toBe('creative-lyrics-task-1');
    const [input, init] = getFetchCall(fetchMock);
    expect(String(input)).toBe('/creative/relay/v1/suno/submit/lyrics');
    expect(init?.credentials).toBe('same-origin');
    expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe(
      'opentu-audio-local-lyrics-task-1'
    );
  });

  it('uses a nested stable idempotency key from adapter task params for session-broker Suno submits', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'success', data: 'creative-nested-idem-task' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    const { setCreativeSessionAuthMaterial } = await import('../creative-mode');
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-audio',
      nonce: 'nonce-audio',
    });

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () =>
          createSessionBrokerAudioPlan(
            createAudioBinding({ baseUrlStrategy: 'trim-v1' })
          ),
      };
    });

    const { audioAPIService } = await import('../audio-api-service');

    await audioAPIService.submitAudioGeneration({
      model: 'suno_music',
      modelRef: { profileId: 'new-api-creative', modelId: 'suno_music' },
      prompt: 'write a song',
      params: {
        idempotencyKey: 'opentu-audio-task-from-adapter',
      },
    });

    const [, init] = getFetchCall(fetchMock);
    expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe(
      'opentu-audio-task-from-adapter'
    );
  });

  it('still rejects direct Suno providers without an API key before fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () => null,
      };
    });

    mockResolveInvocationRoute({
      profileId: 'standalone',
      profileName: 'Standalone',
      providerType: 'custom',
      baseUrl: 'https://api.tu-zi.com/v1',
      apiKey: '',
      authType: 'bearer',
    });

    const { audioAPIService } = await import('../audio-api-service');

    await expect(
      audioAPIService.submitAudioGeneration({
        model: 'suno_music',
        prompt: 'write a song',
      })
    ).rejects.toThrow('API Key 未配置');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces unsupported session-broker Suno polling as a sanitized unsupported-backend error without retrying or leaking credentials', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 'success', data: 'unsupported-task-1' }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
      .mockResolvedValue(
        new Response(
          'unsupported Authorization Bearer secret apiKey upstream credential leak',
          { status: 501 }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    const { setCreativeSessionAuthMaterial } = await import('../creative-mode');
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-audio',
      nonce: 'nonce-audio',
    });

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () =>
          createSessionBrokerAudioPlan(
            createAudioBinding({ baseUrlStrategy: 'trim-v1' })
          ),
      };
    });

    const { audioAPIService } = await import('../audio-api-service');

    let caught: unknown;
    try {
      await audioAPIService.generateAudioWithPolling(
        {
          model: 'suno_music',
          modelRef: { profileId: 'new-api-creative', modelId: 'suno_music' },
          prompt: 'write a song',
          taskId: 'local-unsupported-task',
        },
        { interval: 1, maxAttempts: 2 }
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: 'unsupported-backend',
      httpStatus: 501,
    });
    expect((caught as Error).message).toMatch(/暂不支持嵌入式 Suno/);
    expect((caught as Error).message).not.toMatch(
      /Authorization|apiKey|upstream|credential|secret/i
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [submitInput] = getFetchCall(fetchMock, 0);
    const [pollInput] = getFetchCall(fetchMock, 1);
    expect(String(submitInput)).toBe('/creative/relay/v1/suno/submit/music');
    expect(String(pollInput)).toBe(
      '/creative/relay/v1/suno/fetch/unsupported-task-1'
    );
    expect(`${submitInput} ${pollInput}`).not.toMatch(
      /Authorization|apiKey|upstream|credential|provider|channel|baseUrl/i
    );
  });

  it('sanitizes unsupported session-broker Suno submit responses without exposing backend bodies', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          'unsupported Authorization Bearer secret apiKey upstream credential leak',
          { status: 404 }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    const { setCreativeSessionAuthMaterial } = await import('../creative-mode');
    setCreativeSessionAuthMaterial({
      csrfToken: 'csrf-audio',
      nonce: 'nonce-audio',
    });

    vi.doMock('../provider-routing', async () => {
      const actual = await vi.importActual<object>('../provider-routing');
      return {
        ...actual,
        resolveInvocationPlanFromRoute: () =>
          createSessionBrokerAudioPlan(
            createAudioBinding({ baseUrlStrategy: 'trim-v1' })
          ),
      };
    });

    const { audioAPIService } = await import('../audio-api-service');

    let caught: unknown;
    try {
      await audioAPIService.submitAudioGeneration({
        model: 'suno_music',
        modelRef: { profileId: 'new-api-creative', modelId: 'suno_music' },
        prompt: 'write a song',
        taskId: 'local-submit-unsupported',
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      code: 'unsupported-backend',
      httpStatus: 404,
    });
    expect((caught as Error).message).toMatch(/暂不支持嵌入式 Suno/);
    expect((caught as Error).message).not.toMatch(
      /Authorization|apiKey|upstream|credential|secret/i
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
