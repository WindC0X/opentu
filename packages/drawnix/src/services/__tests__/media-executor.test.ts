/**
 * Media Executor Tests
 * 媒体执行器模块测试
 *
 * 测试场景：
 * 1. 执行器接口验证
 * 2. 执行器工厂基本功能
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type {
  IMediaExecutor,
  ImageGenerationParams,
  VideoGenerationParams,
  AIAnalyzeParams,
} from '../media-executor/types';
import type {
  ImageModelAdapter,
  VideoModelAdapter,
} from '../model-adapters/types';

describe('Media Executor Module', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.doUnmock('../media-executor/task-storage-writer');
    vi.doUnmock('../../utils/settings-manager');
    vi.doUnmock('../sw-channel/client');
    vi.doUnmock('../task-storage-reader');
    vi.doUnmock('../media-executor/llm-api-logger');
    vi.doUnmock('../creative-mode');
    vi.doUnmock('../unified-cache-service');
    vi.doUnmock('../../utils/api-auth-error-event');
    vi.doUnmock('../model-adapters');
  });

  describe('IMediaExecutor Interface', () => {
    it('should define correct interface structure', () => {
      // 验证接口类型定义存在
      const imageParams: ImageGenerationParams = {
        taskId: 'test-1',
        prompt: 'A cat',
      };

      const videoParams: VideoGenerationParams = {
        taskId: 'test-2',
        prompt: 'A dancing cat',
      };

      const analyzeParams: AIAnalyzeParams = {
        taskId: 'test-3',
        prompt: 'Analyze this image',
        images: ['http://example.com/image.png'],
      };

      expect(imageParams.taskId).toBe('test-1');
      expect(videoParams.prompt).toBe('A dancing cat');
      expect(analyzeParams.images).toHaveLength(1);
    });

    it('should support optional parameters for image generation', () => {
      const params: ImageGenerationParams = {
        taskId: 'test-1',
        prompt: 'A landscape',
        model: 'imagen-3.0-generate-002',
        size: '1024x1024',
        count: 4,
        referenceImages: ['http://example.com/ref.png'],
      };

      expect(params.model).toBe('imagen-3.0-generate-002');
      expect(params.size).toBe('1024x1024');
      expect(params.count).toBe(4);
      expect(params.referenceImages).toHaveLength(1);
    });

    it('should support optional parameters for video generation', () => {
      const params: VideoGenerationParams = {
        taskId: 'test-1',
        prompt: 'A video',
        model: 'veo-2.0-generate-001',
        duration: '10',
        size: '1280x720',
      };

      expect(params.model).toBe('veo-2.0-generate-001');
      expect(params.duration).toBe('10');
      expect(params.size).toBe('1280x720');
    });
  });

  // SWMediaExecutor tests removed - sw-executor.ts has been deleted
  // All task execution now happens on the main thread via FallbackMediaExecutor

  describe('FallbackMediaExecutor', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('should have correct executor name', async () => {
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          isAvailable: async () => true,
          createTask: async () => undefined,
          updateTaskStatus: async () => undefined,
          completeTask: async () => undefined,
          failTask: async () => undefined,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => undefined),
        },
      }));

      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          geminiSettings: {
            get: () => ({
              apiKey: 'test-key',
              baseUrl: 'https://api.example.com',
            }),
          },
        };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const executor = new FallbackMediaExecutor();

      expect(executor.name).toBe('FallbackMediaExecutor');
    }, 15000);

    it('should implement IMediaExecutor interface', async () => {
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          isAvailable: async () => true,
          createTask: async () => undefined,
          updateTaskStatus: async () => undefined,
          completeTask: async () => undefined,
          failTask: async () => undefined,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => undefined),
        },
      }));

      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          geminiSettings: {
            get: () => ({
              apiKey: 'test-key',
              baseUrl: 'https://api.example.com',
            }),
          },
        };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const executor: IMediaExecutor = new FallbackMediaExecutor();

      expect(typeof executor.name).toBe('string');
      expect(typeof executor.isAvailable).toBe('function');
      expect(typeof executor.generateImage).toBe('function');
      expect(typeof executor.generateVideo).toBe('function');
      expect(typeof executor.aiAnalyze).toBe('function');
      expect(typeof executor.generateText).toBe('function');
    }, 15000);

    it('passes GPT Image edit schema through fallback adapter routes', async () => {
      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
        updateLLMApiLogMetadata: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          completeTask: vi.fn(async () => undefined),
          failTask: vi.fn(async () => undefined),
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(async () => ({
            type: 'image',
            value: 'data:image/png;base64,abc',
          })),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => undefined),
        },
      }));
      vi.doMock('../../utils/api-auth-error-event', () => ({
        isAuthError: vi.fn(() => false),
        classifyApiCredentialError: vi.fn(() => null),
        dispatchApiAuthError: vi.fn(),
      }));
      vi.doMock('../model-adapters', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../model-adapters')
        >();

        return {
          ...actual,
          getAdapterContextFromSettings: vi.fn(() => ({
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'test-key',
            authType: 'bearer',
            binding: {
              requestSchema: 'openai.image.gpt-edit-form',
              submitPath: '/images/edits',
            },
          })),
        };
      });

      const modelAdapters = await import('../model-adapters');
      const { executeImageViaAdapter } = await import(
        '../media-executor/fallback-adapter-routes'
      );
      const adapter: ImageModelAdapter = {
        id: 'gpt-image-adapter',
        label: 'GPT Image',
        kind: 'image',
        async generateImage() {
          return {
            url: 'https://example.com/out.png',
            format: 'png',
          };
        },
      };
      const generateSpy = vi.spyOn(adapter, 'generateImage');

      await executeImageViaAdapter('task-1', adapter, {
        prompt: 'Edit this',
        model: 'gpt-image-2',
        referenceImages: ['data:image/png;base64,source'],
        generationMode: 'image_edit',
        maskImage: 'data:image/png;base64,mask',
        outputFormat: 'png',
      });

      expect(modelAdapters.getAdapterContextFromSettings).toHaveBeenCalledWith(
        'image',
        'gpt-image-2',
        {
          preferredRequestSchema: [
            'openai.image.gpt-edit-form',
            'tuzi.image.gpt-edit-json',
          ],
        }
      );
      expect(generateSpy).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          generationMode: 'image_edit',
          referenceImages: ['data:image/png;base64,abc'],
          maskImage: 'data:image/png;base64,mask',
          outputFormat: 'png',
        })
      );
    }, 15000);

    it('passes image adapter idempotency through fallback adapter routes from the local task id', async () => {
      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
        updateLLMApiLogMetadata: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          completeTask: vi.fn(async () => undefined),
          failTask: vi.fn(async () => undefined),
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => undefined),
        },
      }));
      vi.doMock('../../utils/api-auth-error-event', () => ({
        isAuthError: vi.fn(() => false),
        classifyApiCredentialError: vi.fn(() => null),
        dispatchApiAuthError: vi.fn(),
      }));
      vi.doMock('../model-adapters', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../model-adapters')
        >();

        return {
          ...actual,
          getAdapterContextFromSettings: vi.fn(() => ({
            baseUrl: '/creative/relay/v1',
            apiKey: '',
            authType: 'session-broker',
          })),
        };
      });

      const { executeImageViaAdapter } = await import(
        '../media-executor/fallback-adapter-routes'
      );
      let receivedIdempotencyKey: string | undefined;
      let receivedNestedIdempotencyKey: unknown;
      const adapter: ImageModelAdapter = {
        id: 'mj-image-adapter',
        label: 'MJ Image',
        kind: 'image',
        async generateImage(_context, request) {
          receivedIdempotencyKey = (
            request as typeof request & { idempotencyKey?: string }
          ).idempotencyKey;
          receivedNestedIdempotencyKey = request.params?.idempotencyKey;
          return {
            url: 'https://example.com/mj.jpg',
            format: 'jpg',
          };
        },
      };

      await executeImageViaAdapter('task-1', adapter, {
        prompt: 'A cat',
        model: 'mj-imagine',
        params: {
          idempotencyKey: 'caller-must-not-override-local-task-id',
        },
      });

      expect(receivedIdempotencyKey).toBe('opentu-image-task-1');
      expect(receivedNestedIdempotencyKey).toBe('opentu-image-task-1');
    }, 15000);

    it('does not mark ordinary image adapter requests as schema-backed with empty userParams', async () => {
      const completeTask = vi.fn(async () => undefined);
      const updateStatus = vi.fn(async () => undefined);
      const failTask = vi.fn(async () => undefined);
      const generateImage = vi.fn(async () => ({
        url: 'https://example.com/mj.jpg',
        format: 'jpg',
      }));
      const resolveAdapterForInvocation = vi.fn(() => ({
        id: 'mj-image-adapter',
        label: 'MJ Image',
        kind: 'image',
        generateImage,
      }));

      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
        updateLLMApiLogMetadata: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateStatus,
          completeTask,
          failTask,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => undefined),
        },
      }));
      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          geminiSettings: {
            get: () => ({ apiKey: '', baseUrl: '/creative/relay/v1' }),
          },
        };
      });
      vi.doMock('../model-adapters', async (importOriginal) => {
        const actual = await importOriginal<typeof import('../model-adapters')>();
        return {
          ...actual,
          resolveAdapterForInvocation,
          getAdapterContextFromSettings: vi.fn(() => ({
            baseUrl: '/creative/relay/v1',
            apiKey: '',
            authType: 'session-broker',
          })),
        };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const executor = new FallbackMediaExecutor();

      await executor.generateImage({
        taskId: 'task-ordinary-adapter',
        prompt: 'A cat',
        model: 'mj-imagine',
        params: { aspect_ratio: '1:1' },
        userParams: {},
      });

      expect(resolveAdapterForInvocation).toHaveBeenCalled();
      expect(generateImage).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          model: 'mj-imagine',
          params: expect.objectContaining({
            aspect_ratio: '1:1',
            idempotencyKey: 'opentu-image-task-ordinary-adapter',
          }),
        })
      );
      expect(completeTask).toHaveBeenCalledWith(
        'task-ordinary-adapter',
        expect.objectContaining({ url: 'https://example.com/mj.jpg' })
      );
      expect(failTask).not.toHaveBeenCalled();
    }, 15000);

    it('passes schema-backed image userParams without legacy adapter params', async () => {
      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
        updateLLMApiLogMetadata: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          completeTask: vi.fn(async () => undefined),
          failTask: vi.fn(async () => undefined),
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => undefined),
        },
      }));
      vi.doMock('../../utils/api-auth-error-event', () => ({
        isAuthError: vi.fn(() => false),
        classifyApiCredentialError: vi.fn(() => null),
        dispatchApiAuthError: vi.fn(),
      }));
      vi.doMock('../model-adapters', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../model-adapters')
        >();

        return {
          ...actual,
          getAdapterContextFromSettings: vi.fn(() => ({
            baseUrl: '/creative/relay/v1',
            apiKey: '',
            authType: 'session-broker',
          })),
        };
      });

      const { executeImageViaAdapter } = await import(
        '../media-executor/fallback-adapter-routes'
      );
      let receivedRequest: unknown;
      const adapter: ImageModelAdapter = {
        id: 'mock-schema-image-adapter',
        label: 'Mock Schema Image',
        kind: 'image',
        supportsCreativeUserParams: true,
        async generateImage(_context, request) {
          receivedRequest = request;
          return {
            url: 'https://example.com/schema.jpg',
            format: 'jpg',
          };
        },
      };

      await executeImageViaAdapter('task-schema', adapter, {
        prompt: 'A cat',
        model: 'mock:gpt-image-2:preview',
        resolution: '4k',
        quality: 'high',
        params: {
          webhook: 'https://evil.example/hook',
        },
        userParams: {
          size: '1024x1024',
          seed: 42,
          oversea: true,
        },
      });

      expect(receivedRequest).toMatchObject({
        model: 'mock:gpt-image-2:preview',
        size: undefined,
        idempotencyKey: 'opentu-image-task-schema',
        userParams: {
          size: '1024x1024',
          seed: 42,
          oversea: true,
        },
      });
      expect(
        (receivedRequest as { params?: Record<string, unknown> }).params
      ).toBeUndefined();
    }, 15000);

    it('submits schema-backed image userParams through the managed Creative task route', async () => {
      const completeTask = vi.fn(async () => undefined);
      const updateStatus = vi.fn(async () => undefined);
      const cacheMediaFromBlob = vi.fn(async () => undefined);
      const resolveAdapterForInvocation = vi.fn();
      const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith('/creative/relay/v1/images/tasks')) {
          expect(init?.method).toBe('POST');
          expect(init?.credentials).toBe('same-origin');
          const headers = new Headers(init?.headers as HeadersInit);
          expect(headers.get('Idempotency-Key')).toBe('opentu-image-task-schema');
          expect(headers.get('X-Creative-CSRF')).toBe('csrf-token');
          expect(headers.get('X-Creative-Nonce')).toBe('nonce-token');
          const body = JSON.parse(String(init?.body));
          expect(body).toEqual({
            model: 'mock:gpt-image-2:preview',
            prompt: 'A cat',
            userParams: { size: '1024x1024', seed: 42 },
          });
          expect(body.params).toBeUndefined();
          expect(body.idempotencyKey).toBeUndefined();
          expect(body.onProgress).toBeUndefined();
          expect(body.onSubmitted).toBeUndefined();
          expect(body.images).toBeUndefined();
          return new Response(
            JSON.stringify({
              task_id: 'creative-task-1',
              status: 'succeeded',
              result: {
                url: '/creative/relay/v1/images/tasks/creative-task-1/content',
                mimeType: 'image/png',
              },
            }),
            { status: 202, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (url.endsWith('/creative/relay/v1/images/tasks/creative-task-1/content')) {
          return new Response(new Blob(['png-bytes'], { type: 'image/png' }), {
            status: 200,
            headers: { 'Content-Type': 'image/png' },
          });
        }
        throw new Error(`unexpected fetch ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      vi.doMock('../creative-mode', () => ({
        CREATIVE_MANAGED_PROFILE_ID: 'new-api-creative',
        CREATIVE_RELAY_BASE_URL: '/creative/relay/v1',
        isCreativeEmbeddedMode: () => false,
        requireCreativeSessionAuthHeaders: () => ({
          'X-Creative-CSRF': 'csrf-token',
          'X-Creative-Nonce': 'nonce-token',
        }),
      }));
      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
        updateLLMApiLogMetadata: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateStatus,
          completeTask,
          failTask: vi.fn(async () => undefined),
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob,
        },
      }));
      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          geminiSettings: {
            get: () => ({ apiKey: '', baseUrl: '/creative/relay/v1' }),
          },
        };
      });
      vi.doMock('../model-adapters', async (importOriginal) => {
        const actual = await importOriginal<typeof import('../model-adapters')>();
        return {
          ...actual,
          resolveAdapterForInvocation,
        };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const executor = new FallbackMediaExecutor();

      await executor.generateImage({
        taskId: 'task-schema',
        prompt: 'A cat',
        model: 'mock:gpt-image-2:preview',
        params: { webhook: 'https://evil.example/hook' },
        userParams: { size: '1024x1024', seed: 42 },
      });

      expect(updateStatus).toHaveBeenCalledWith('task-schema', 'processing');
      expect(resolveAdapterForInvocation).not.toHaveBeenCalled();
      expect(cacheMediaFromBlob).toHaveBeenCalledWith(
        '/__aitu_cache__/image/creative-task-1.png',
        expect.any(Blob),
        'image',
        expect.objectContaining({ taskId: 'creative-task-1' })
      );
      expect(completeTask).toHaveBeenCalledWith('task-schema', {
        url: '/__aitu_cache__/image/creative-task-1.png',
        format: 'png',
        size: 9,
      });
    }, 15000);

    it('fails schema-backed managed image tasks with reference images before submit', async () => {
      const failTask = vi.fn(async () => undefined);
      const updateStatus = vi.fn(async () => undefined);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      vi.doMock('../creative-mode', () => ({
        CREATIVE_MANAGED_PROFILE_ID: 'new-api-creative',
        CREATIVE_RELAY_BASE_URL: '/creative/relay/v1',
        isCreativeEmbeddedMode: () => false,
        requireCreativeSessionAuthHeaders: () => ({
          'X-Creative-CSRF': 'csrf-token',
          'X-Creative-Nonce': 'nonce-token',
        }),
      }));
      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
        updateLLMApiLogMetadata: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateStatus,
          completeTask: vi.fn(async () => undefined),
          failTask,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => undefined),
        },
      }));
      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          geminiSettings: {
            get: () => ({ apiKey: '', baseUrl: '/creative/relay/v1' }),
          },
        };
      });
      vi.doMock('../model-adapters', async (importOriginal) => {
        const actual = await importOriginal<typeof import('../model-adapters')>();
        return {
          ...actual,
          resolveAdapterForInvocation: vi.fn(),
        };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const executor = new FallbackMediaExecutor();

      await expect(
        executor.generateImage({
          taskId: 'task-schema-ref',
          prompt: 'Edit this cat',
          model: 'mock:gpt-image-2:preview',
          referenceImages: ['https://provider.example/input.png'],
          userParams: { size: '1024x1024' },
        })
      ).rejects.toThrow(/does not support reference images/);

      expect(updateStatus).toHaveBeenCalledWith(
        'task-schema-ref',
        'processing'
      );
      expect(fetchMock).not.toHaveBeenCalled();
      expect(failTask).toHaveBeenCalledWith(
        'task-schema-ref',
        expect.objectContaining({
          code: 'IMAGE_GENERATION_ERROR',
          message: expect.stringMatching(/does not support reference images/),
        })
      );
    }, 15000);

    it('fails schema-backed image userParams before unsupported adapters can call providers', async () => {
      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
        updateLLMApiLogMetadata: vi.fn(),
      }));
      const failTask = vi.fn(async () => undefined);
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          completeTask: vi.fn(async () => undefined),
          failTask,
        },
      }));
      vi.doMock('../../utils/api-auth-error-event', () => ({
        isAuthError: vi.fn(() => false),
        classifyApiCredentialError: vi.fn(() => null),
        dispatchApiAuthError: vi.fn(),
      }));

      const { executeImageViaAdapter } = await import(
        '../media-executor/fallback-adapter-routes'
      );
      const generateImage = vi.fn();
      const adapter: ImageModelAdapter = {
        id: 'gpt-image-adapter',
        label: 'GPT Image',
        kind: 'image',
        generateImage,
      };

      await expect(
        executeImageViaAdapter('task-schema', adapter, {
          prompt: 'A cat',
          model: 'mock:gpt-image-2:preview',
          userParams: {
            size: '1024x1024',
          },
        })
      ).rejects.toThrow(/userParams adapter/);

      expect(generateImage).not.toHaveBeenCalled();
      expect(failTask).toHaveBeenCalledWith(
        'task-schema',
        expect.objectContaining({
          code: 'IMAGE_GENERATION_ERROR',
        })
      );
    }, 15000);

    it('passes video adapter progress through fallback adapter routes', async () => {
      const updateRemoteId = vi.fn(async () => undefined);
      const completeTask = vi.fn(async () => undefined);
      const onProgress = vi.fn();

      vi.doMock('../media-executor/llm-api-logger', () => ({
        startLLMApiLog: vi.fn(() => 'log-id'),
        completeLLMApiLog: vi.fn(),
        failLLMApiLog: vi.fn(),
        updateLLMApiLogMetadata: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateRemoteId,
          completeTask,
          failTask: vi.fn(async () => undefined),
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => undefined),
        },
      }));
      vi.doMock('../../utils/api-auth-error-event', () => ({
        isAuthError: vi.fn(() => false),
        classifyApiCredentialError: vi.fn(() => null),
        dispatchApiAuthError: vi.fn(),
      }));
      vi.doMock('../model-adapters', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../model-adapters')
        >();

        return {
          ...actual,
          getAdapterContextFromSettings: vi.fn(() => ({
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'test-key',
            authType: 'bearer',
          })),
        };
      });

      const { executeVideoViaAdapter } = await import(
        '../media-executor/fallback-adapter-routes'
      );
      let receivedIdempotencyKey: string | undefined;
      const adapter: VideoModelAdapter = {
        id: 'happyhorse-adapter',
        label: 'HappyHorse',
        kind: 'video',
        async generateVideo(_context, request) {
          receivedIdempotencyKey = request.idempotencyKey;
          const handleProgress = request.params?.onProgress as
            | ((progress: number, status?: string) => void)
            | undefined;
          const handleSubmitted = request.params?.onSubmitted as
            | ((videoId: string) => void)
            | undefined;

          handleSubmitted?.('video-task-1');
          handleProgress?.(30, 'in_progress');

          return {
            url: 'https://example.com/out.mp4',
            format: 'mp4',
          };
        },
      };

      await executeVideoViaAdapter(
        'task-1',
        adapter,
        {
          prompt: 'A dancing cat',
          model: 'happyhorse-1.0-t2v',
        },
        { onProgress }
      );

      expect(receivedIdempotencyKey).toBe('opentu-video-task-1');
      expect(updateRemoteId).toHaveBeenCalledWith(
        'task-1',
        'video-task-1',
        expect.objectContaining({
          operation: 'video',
          modelId: 'happyhorse-1.0-t2v',
        })
      );
      expect(onProgress).toHaveBeenCalledWith({
        progress: 30,
        phase: 'polling',
      });
      expect(completeTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          url: 'https://example.com/out.mp4',
          format: 'mp4',
        })
      );
    }, 15000);
  });

  describe('ExecutorFactory', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    it('should export getExecutor function', async () => {
      vi.doMock('../sw-channel/client', () => ({
        swChannelClient: {
          isInitialized: () => false,
          ping: async () => false,
        },
      }));

      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          isAvailable: async () => true,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          getImageForAI: vi.fn(),
          isCached: vi.fn(async () => false),
          cacheMediaFromBlob: vi.fn(async () => undefined),
        },
      }));

      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          geminiSettings: {
            get: () => ({
              apiKey: 'test-key',
              baseUrl: 'https://api.example.com',
            }),
          },
        };
      });

      const { executorFactory } = await import('../media-executor/factory');

      expect(typeof executorFactory.getExecutor).toBe('function');
    }, 15000);
  });

  describe('Task Polling Types', () => {
    it('should export waitForTaskCompletion function', async () => {
      vi.doMock('../task-storage-reader', () => ({
        taskStorageReader: {
          isAvailable: async () => true,
          getTask: async () => null,
        },
      }));

      const { waitForTaskCompletion } = await import(
        '../media-executor/task-polling'
      );

      expect(typeof waitForTaskCompletion).toBe('function');
    });
  });
});
