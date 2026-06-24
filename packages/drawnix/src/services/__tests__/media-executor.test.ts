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
    vi.doUnmock('../media-executor/fallback-utils');
    vi.doUnmock('../../utils/settings-manager');
    vi.doUnmock('../sw-channel/client');
    vi.doUnmock('../task-storage-reader');
    vi.doUnmock('../media-executor/llm-api-logger');
    vi.doUnmock('../creative-mode');
    vi.doUnmock('../unified-cache-service');
    vi.doUnmock('../../utils/api-auth-error-event');
    vi.doUnmock('../model-adapters');
    vi.doUnmock('../provider-routing');
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

    it('does not emit stale resumed video completion callbacks when guarded storage completion is skipped', async () => {
      const completeTask = vi.fn(async () => false);
      const failTask = vi.fn(async () => false);
      const updateStatus = vi.fn(async () => false);
      const updateProgress = vi.fn(async () => false);
      const pollVideoStatus = vi.fn(async () => ({
        url: 'https://cdn.example.com/video.mp4',
      }));
      const cacheRemoteUrl = vi.fn(
        async () => '/__aitu_cache__/video/task-stale-video.mp4'
      );

      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          completeTask,
          failTask,
          updateStatus,
          updateProgress,
        },
      }));
      vi.doMock('../task-storage-reader', () => ({
        taskStorageReader: {
          getAllTasks: vi.fn(async () => []),
        },
      }));
      vi.doMock('../media-executor/fallback-utils', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../media-executor/fallback-utils')
        >();
        return {
          ...actual,
          pollVideoStatus,
          cacheRemoteUrl,
        };
      });
      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          resolveInvocationRoute: vi.fn(() => ({
            apiKey: 'test-key',
            baseUrl: 'https://api.example.com',
            modelId: 'video-model',
            authType: 'bearer',
          })),
        };
      });
      vi.doMock('../provider-routing', async (importOriginal) => {
        const actual = await importOriginal<typeof import('../provider-routing')>();
        return {
          ...actual,
          resolveInvocationPlanFromRoute: vi.fn(() => null),
        };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const { TaskStatus, TaskType } = await import('../../types/task.types');
      const executor = new FallbackMediaExecutor();
      const onTaskUpdate = vi.fn();

      await executor.resumePendingTasks(onTaskUpdate, [
        {
          id: 'task-stale-video',
          type: TaskType.VIDEO,
          status: TaskStatus.PROCESSING,
          params: {
            prompt: 'A stale video',
            model: 'video-model',
            retryAttempt: 1,
          },
          remoteId: 'remote-video-1',
          createdAt: 1,
          updatedAt: 2,
          startedAt: 100,
        },
      ]);

      const expectedGuard = {
        expectedRetryAttempt: 1,
        expectedStartedAt: 100,
      };
      expect(completeTask).toHaveBeenCalledWith(
        'task-stale-video',
        expect.any(Object),
        expectedGuard
      );
      expect(onTaskUpdate).not.toHaveBeenCalled();
    }, 15000);

    it('guards no-callback resumed video progress writes by startedAt and retryAttempt', async () => {
      const completeTask = vi.fn(async () => false);
      const failTask = vi.fn(async () => false);
      const updateStatus = vi.fn(async () => true);
      const updateProgress = vi.fn(async () => true);
      const pollVideoStatus = vi.fn(
        async (
          _videoId: string,
          _config: unknown,
          onProgress: (progress: number) => void
        ) => {
          onProgress(0.5);
          return {
            url: 'https://cdn.example.com/video.mp4',
          };
        }
      );
      const cacheRemoteUrl = vi.fn(
        async () => '/__aitu_cache__/video/task-guarded-video.mp4'
      );

      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          completeTask,
          failTask,
          updateStatus,
          updateProgress,
        },
      }));
      vi.doMock('../task-storage-reader', () => ({
        taskStorageReader: {
          getAllTasks: vi.fn(async () => []),
        },
      }));
      vi.doMock('../media-executor/fallback-utils', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../media-executor/fallback-utils')
        >();
        return {
          ...actual,
          pollVideoStatus,
          cacheRemoteUrl,
        };
      });
      vi.doMock('../../utils/settings-manager', async (importOriginal) => {
        const actual = await importOriginal<
          typeof import('../../utils/settings-manager')
        >();
        return {
          ...actual,
          resolveInvocationRoute: vi.fn(() => ({
            apiKey: 'test-key',
            baseUrl: 'https://api.example.com',
            modelId: 'video-model',
            authType: 'bearer',
          })),
        };
      });
      vi.doMock('../provider-routing', async (importOriginal) => {
        const actual = await importOriginal<typeof import('../provider-routing')>();
        return {
          ...actual,
          resolveInvocationPlanFromRoute: vi.fn(() => null),
        };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const { TaskStatus, TaskType } = await import('../../types/task.types');
      const executor = new FallbackMediaExecutor();

      await executor.resumePendingTasks(undefined, [
        {
          id: 'task-guarded-video',
          type: TaskType.VIDEO,
          status: TaskStatus.PROCESSING,
          params: {
            prompt: 'A guarded video',
            model: 'video-model',
            retryAttempt: 2,
          },
          remoteId: 'remote-video-2',
          createdAt: 1,
          updatedAt: 2,
          startedAt: 300,
        },
      ]);

      const expectedGuard = {
        expectedRetryAttempt: 2,
        expectedStartedAt: 300,
      };
      expect(updateStatus).toHaveBeenCalledWith(
        'task-guarded-video',
        TaskStatus.PROCESSING,
        expectedGuard
      );
      expect(updateProgress).toHaveBeenCalledWith(
        'task-guarded-video',
        50,
        'polling',
        expectedGuard
      );
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

    it('passes and awaits image adapter onSubmitted callbacks before polling can continue', async () => {
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
      let durableRemoteIdSaved = false;
      let adapterContinuedAfterDurableSave = false;
      let callbackReturnedPromise = false;
      const onSubmitted = vi.fn(async () => {
        await Promise.resolve();
        durableRemoteIdSaved = true;
      });
      const adapter: ImageModelAdapter = {
        id: 'mj-image-adapter',
        label: 'MJ Image',
        kind: 'image',
        async generateImage(_context, request) {
          const handleSubmitted = request.onSubmitted as
            | ((remoteId: string) => void | Promise<void>)
            | undefined;
          const submitted = handleSubmitted?.('remote-image-task-1');
          callbackReturnedPromise =
            !!submitted &&
            typeof (submitted as Promise<void>).then === 'function';
          await submitted;
          adapterContinuedAfterDurableSave = durableRemoteIdSaved;
          return {
            url: 'https://example.com/mj.jpg',
            format: 'jpg',
          };
        },
      };

      await executeImageViaAdapter(
        'task-1',
        adapter,
        {
          prompt: 'A cat',
          model: 'mj-imagine',
        },
        { onSubmitted }
      );

      expect(callbackReturnedPromise).toBe(true);
      expect(adapterContinuedAfterDurableSave).toBe(true);
      expect(onSubmitted).toHaveBeenCalledWith(
        'remote-image-task-1',
        expect.objectContaining({
          operation: 'image',
          modelId: 'mj-imagine',
        })
      );
    }, 15000);

    it('does not mark ordinary image adapter requests as schema-backed with empty userParams', async () => {
      const completeTask = vi.fn(async () => undefined);
      const updateStatus = vi.fn(async () => undefined);
      const failTask = vi.fn(async () => undefined);
      const updateProgress = vi.fn(async () => undefined);
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
        const actual = await importOriginal<
          typeof import('../model-adapters')
        >();
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
      const closeBitmap = vi.fn();
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn(async () => ({
          width: 3840,
          height: 1648,
          close: closeBitmap,
        }))
      );
      const resolveAdapterForInvocation = vi.fn();
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith('/creative/relay/v1/images/tasks')) {
            expect(init?.method).toBe('POST');
            expect(init?.credentials).toBe('same-origin');
            const headers = new Headers(init?.headers as HeadersInit);
            expect(headers.get('Idempotency-Key')).toBe(
              'opentu-image-task-schema'
            );
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
                  targetWidth: 3840,
                  targetHeight: 1648,
                },
              }),
              { status: 202, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (
            url.endsWith(
              '/creative/relay/v1/images/tasks/creative-task-1/content'
            )
          ) {
            return new Response(
              new Blob(['png-bytes'], { type: 'image/png' }),
              {
                status: 200,
                headers: { 'Content-Type': 'image/png' },
              }
            );
          }
          throw new Error(`unexpected fetch ${url}`);
        }
      );
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
          updateRemoteId: vi.fn(async () => undefined),
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
        const actual = await importOriginal<
          typeof import('../model-adapters')
        >();
        return {
          ...actual,
          resolveAdapterForInvocation,
        };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const {
        ModelVendor,
        normalizeCreativeParameterSchema,
        setRuntimeModelConfigs,
      } = await import('../../constants/model-config');
      setRuntimeModelConfigs([
        {
          id: 'mock:gpt-image-2:preview',
          label: 'Mock GPT Image 2',
          type: 'image',
          vendor: ModelVendor.OTHER,
          sourceProfileId: 'new-api-creative',
          creativeManaged: true,
          parameterSchema: normalizeCreativeParameterSchema(
            [
              {
                id: 'size',
                label: '尺寸',
                type: 'enum',
                options: [{ value: '1024x1024', label: '1024×1024' }],
              },
              { id: 'seed', label: 'Seed', type: 'integer' },
            ],
            'image',
            'mock:gpt-image-2:preview'
          ),
        },
      ]);
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
        expect.any(Object),
        'image',
        expect.objectContaining({ taskId: 'creative-task-1' })
      );
      expect(completeTask).toHaveBeenCalledWith(
        'task-schema',
        expect.objectContaining({
          url: '/__aitu_cache__/image/creative-task-1.png',
          format: 'png',
          size: expect.any(Number),
          remoteTaskId: 'creative-task-1',
          providerTaskId: 'creative-task-1',
          contentUrl: '/creative/relay/v1/images/tasks/creative-task-1/content',
          mimeType: 'image/png',
          width: 3840,
          height: 1648,
          targetWidth: 3840,
          targetHeight: 1648,
        })
      );
      expect(closeBitmap).toHaveBeenCalled();
    }, 15000);

    it('uses retryAttempt in managed Creative image idempotency keys for fresh retries', async () => {
      const updateRemoteId = vi.fn(async () => undefined);
      const completeTask = vi.fn(async () => undefined);
      const failTask = vi.fn(async () => undefined);
      let receivedIdempotencyKey: string | null = null;
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith('/creative/relay/v1/images/tasks')) {
            const headers = new Headers(init?.headers as HeadersInit);
            receivedIdempotencyKey = headers.get('Idempotency-Key');
            return new Response(
              JSON.stringify({
                task_id: 'remote-retry-key-1',
                status: 'failed',
                fail_reason: 'provider rejected retry',
              }),
              { status: 202, headers: { 'Content-Type': 'application/json' } }
            );
          }
          throw new Error(`unexpected fetch ${url}`);
        }
      );
      vi.stubGlobal('fetch', fetchMock);

      vi.doMock('../creative-mode', () => ({
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
          updateRemoteId,
          completeTask,
          failTask,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          cacheMediaFromBlob: vi.fn(async () => undefined),
        },
      }));

      const { executeCreativeManagedImageTask } = await import(
        '../media-executor/fallback-adapter-routes'
      );

      await expect(
        executeCreativeManagedImageTask('task-retry-key', {
          prompt: 'Fresh retry',
          model: 'mock:gpt-image-2:preview',
          userParams: {},
          retryAttempt: 2,
        })
      ).rejects.toThrow('provider rejected retry');

      expect(updateRemoteId).toHaveBeenCalledWith(
        'task-retry-key',
        'remote-retry-key-1',
        expect.any(Object),
        { expectedRetryAttempt: 2 }
      );
      expect(receivedIdempotencyKey).toBe(
        'opentu-image-task-retry-key-retry-2'
      );
      expect(completeTask).not.toHaveBeenCalled();
      expect(failTask).toHaveBeenCalledWith(
        'task-retry-key',
        {
          code: 'IMAGE_GENERATION_ERROR',
          message: 'provider rejected retry',
        },
        { expectedRetryAttempt: 2 }
      );
    }, 15000);

    it('keeps polling managed Creative image tasks past 120 seconds and persists remote id before completion', async () => {
      vi.useFakeTimers();

      const updateRemoteId = vi.fn(async () => undefined);
      const completeTask = vi.fn(async () => undefined);
      const failTask = vi.fn(async () => undefined);
      const updateProgress = vi.fn(async () => undefined);
      const cacheMediaFromBlob = vi.fn(async () => undefined);
      const pollStartedAt = Date.now();
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith('/creative/relay/v1/images/tasks')) {
            expect(init?.method).toBe('POST');
            return new Response(
              JSON.stringify({
                task_id: 'remote-slow-1',
                status: 'in_progress',
              }),
              { status: 202, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (url.endsWith('/creative/relay/v1/images/tasks/remote-slow-1')) {
            const elapsed = Date.now() - pollStartedAt;
            return new Response(
              JSON.stringify(
                elapsed >= 130_000
                  ? {
                      task_id: 'remote-slow-1',
                      status: 'completed',
                      result: {
                        url: '/creative/relay/v1/images/tasks/remote-slow-1/content',
                        mimeType: 'image/png',
                      },
                    }
                  : {
                      task_id: 'remote-slow-1',
                      status: 'in_progress',
                    }
              ),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (
            url.endsWith(
              '/creative/relay/v1/images/tasks/remote-slow-1/content'
            )
          ) {
            return new Response(
              new Blob(['webp-bytes'], { type: 'image/webp' }),
              {
                status: 200,
                headers: { 'Content-Type': 'image/webp' },
              }
            );
          }
          throw new Error(`unexpected fetch ${url}`);
        }
      );
      vi.stubGlobal('fetch', fetchMock);

      vi.doMock('../creative-mode', () => ({
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
          updateRemoteId,
          completeTask,
          failTask,
          updateProgress,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          cacheMediaFromBlob,
        },
      }));

      const { executeCreativeManagedImageTask } = await import(
        '../media-executor/fallback-adapter-routes'
      );
      const onSubmitted = vi.fn();

      try {
        const execution = executeCreativeManagedImageTask(
          'task-slow',
          {
            prompt: 'A slow cat',
            model: 'mock:gpt-image-2:preview',
            userParams: {},
          },
          { onSubmitted }
        );
        const observedExecution = execution.then(
          () => ({ ok: true as const }),
          (error: Error) => ({ ok: false as const, error })
        );
        await vi.advanceTimersByTimeAsync(130_000);

        const outcome = await observedExecution;
        expect(outcome).toEqual({ ok: true });
        expect(updateRemoteId).toHaveBeenCalledWith(
          'task-slow',
          'remote-slow-1',
          expect.objectContaining({
            operation: 'image',
            modelId: 'mock:gpt-image-2:preview',
          })
        );
        expect(onSubmitted).toHaveBeenCalledWith(
          'remote-slow-1',
          expect.objectContaining({
            operation: 'image',
            modelId: 'mock:gpt-image-2:preview',
          })
        );
        expect(failTask).not.toHaveBeenCalled();
        expect(cacheMediaFromBlob).toHaveBeenCalledWith(
          '/__aitu_cache__/image/remote-slow-1.webp',
          expect.any(Blob),
          'image',
          expect.objectContaining({
            taskId: 'remote-slow-1',
            model: 'mock:gpt-image-2:preview',
            metadata: expect.objectContaining({
              contentUrl:
                '/creative/relay/v1/images/tasks/remote-slow-1/content',
              mimeType: 'image/webp',
              remoteTaskId: 'remote-slow-1',
            }),
          })
        );
        expect(completeTask).toHaveBeenCalledWith(
          'task-slow',
          expect.objectContaining({
            url: '/__aitu_cache__/image/remote-slow-1.webp',
            remoteTaskId: 'remote-slow-1',
            providerTaskId: 'remote-slow-1',
            contentUrl: '/creative/relay/v1/images/tasks/remote-slow-1/content',
            mimeType: 'image/webp',
          })
        );
      } finally {
        vi.useRealTimers();
      }
    }, 15000);

    it('awaits managed Creative image onSubmitted before content fetch and completion', async () => {
      const updateRemoteId = vi.fn(async () => true);
      const completeTask = vi.fn(async () => true);
      const failTask = vi.fn(async () => true);
      const updateProgress = vi.fn(async () => true);
      const cacheMediaFromBlob = vi.fn(async () => undefined);
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith('/creative/relay/v1/images/tasks')) {
            expect(init?.method).toBe('POST');
            return new Response(
              JSON.stringify({
                task_id: 'remote-submit-barrier-1',
                status: 'completed',
                result: {
                  url: '/creative/relay/v1/images/tasks/remote-submit-barrier-1/content',
                  mimeType: 'image/png',
                },
              }),
              { status: 202, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (
            url.endsWith(
              '/creative/relay/v1/images/tasks/remote-submit-barrier-1/content'
            )
          ) {
            return new Response(new Blob(['png-bytes'], { type: 'image/png' }), {
              status: 200,
              headers: { 'Content-Type': 'image/png' },
            });
          }
          throw new Error(`unexpected fetch ${url}`);
        }
      );
      vi.stubGlobal('fetch', fetchMock);

      vi.doMock('../creative-mode', () => ({
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
          updateRemoteId,
          completeTask,
          failTask,
          updateProgress,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          cacheMediaFromBlob,
        },
      }));

      const { executeCreativeManagedImageTask } = await import(
        '../media-executor/fallback-adapter-routes'
      );
      let releaseSubmitted!: () => void;
      const onSubmitted = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseSubmitted = resolve;
          })
      );

      const execution = executeCreativeManagedImageTask(
        'task-submit-barrier',
        {
          prompt: 'A barrier cat',
          model: 'mock:gpt-image-2:preview',
          userParams: {},
        },
        { onSubmitted }
      );
      await vi.waitFor(() => {
        expect(updateRemoteId).toHaveBeenCalled();
        expect(onSubmitted).toHaveBeenCalled();
      });

      expect(updateRemoteId).toHaveBeenCalledWith(
        'task-submit-barrier',
        'remote-submit-barrier-1',
        expect.objectContaining({
          operation: 'image',
          modelId: 'mock:gpt-image-2:preview',
        })
      );
      expect(onSubmitted).toHaveBeenCalledWith(
        'remote-submit-barrier-1',
        expect.objectContaining({
          operation: 'image',
          modelId: 'mock:gpt-image-2:preview',
        })
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(completeTask).not.toHaveBeenCalled();

      releaseSubmitted();
      await execution;

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(completeTask).toHaveBeenCalledWith(
        'task-submit-barrier',
        expect.objectContaining({
          remoteTaskId: 'remote-submit-barrier-1',
          providerTaskId: 'remote-submit-barrier-1',
        })
      );
    }, 15000);

    it('keeps accepted managed Creative image tasks recoverable when aborted after remote id is persisted', async () => {
      const abortController = new AbortController();
      const updateRemoteId = vi.fn(async () => {
        abortController.abort();
      });
      const completeTask = vi.fn(async () => undefined);
      const failTask = vi.fn(async () => undefined);
      const updateProgress = vi.fn(async () => undefined);
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith('/creative/relay/v1/images/tasks')) {
            return new Response(
              JSON.stringify({
                task_id: 'remote-aborted-after-accept-1',
                status: 'completed',
                result: {
                  url: '/creative/relay/v1/images/tasks/remote-aborted-after-accept-1/content',
                  mimeType: 'image/png',
                },
              }),
              { status: 202, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (
            url.endsWith(
              '/creative/relay/v1/images/tasks/remote-aborted-after-accept-1/content'
            )
          ) {
            expect(init?.signal?.aborted).toBe(true);
            throw new DOMException('Aborted', 'AbortError');
          }
          throw new Error(`unexpected fetch ${url}`);
        }
      );
      vi.stubGlobal('fetch', fetchMock);

      vi.doMock('../creative-mode', () => ({
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
          updateRemoteId,
          completeTask,
          failTask,
          updateProgress,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          cacheMediaFromBlob: vi.fn(async () => undefined),
        },
      }));

      const { executeCreativeManagedImageTask } = await import(
        '../media-executor/fallback-adapter-routes'
      );

      await expect(
        executeCreativeManagedImageTask(
          'task-aborted-after-accept',
          {
            prompt: 'A cat accepted remotely before local abort',
            model: 'mock:gpt-image-2:preview',
            userParams: {},
          },
          { signal: abortController.signal }
        )
      ).rejects.toMatchObject({ code: 'TIMEOUT' });

      expect(updateRemoteId).toHaveBeenCalledWith(
        'task-aborted-after-accept',
        'remote-aborted-after-accept-1',
        expect.any(Object)
      );
      expect(completeTask).not.toHaveBeenCalled();
      expect(failTask).not.toHaveBeenCalled();
      expect(updateProgress).toHaveBeenCalledWith(
        'task-aborted-after-accept',
        95,
        'polling'
      );
    }, 15000);

    it('keeps managed Creative image poll-budget expiry recoverable without writing terminal failure', async () => {
      vi.useFakeTimers();

      const updateRemoteId = vi.fn(async () => undefined);
      const completeTask = vi.fn(async () => undefined);
      const failTask = vi.fn(async () => undefined);
      const updateProgress = vi.fn(async () => undefined);
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith('/creative/relay/v1/images/tasks')) {
            expect(init?.method).toBe('POST');
            return new Response(
              JSON.stringify({
                task_id: 'remote-timeout-1',
                status: 'in_progress',
              }),
              { status: 202, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (
            url.endsWith('/creative/relay/v1/images/tasks/remote-timeout-1')
          ) {
            return new Response(
              JSON.stringify({
                task_id: 'remote-timeout-1',
                status: 'in_progress',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          throw new Error(`unexpected fetch ${url}`);
        }
      );
      vi.stubGlobal('fetch', fetchMock);

      vi.doMock('../creative-mode', () => ({
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
          updateRemoteId,
          completeTask,
          failTask,
          updateProgress,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          cacheMediaFromBlob: vi.fn(async () => undefined),
        },
      }));

      const { CREATIVE_REMOTE_IMAGE_TIMEOUT_MS } = await import(
        '../../constants/TASK_CONSTANTS'
      );
      const { executeCreativeManagedImageTask } = await import(
        '../media-executor/fallback-adapter-routes'
      );

      try {
        const execution = executeCreativeManagedImageTask('task-timeout', {
          prompt: 'A very slow cat',
          model: 'mock:gpt-image-2:preview',
          userParams: {},
        });
        const observedExecution = execution.then(
          () => ({ ok: true as const }),
          (error: any) => ({ ok: false as const, error })
        );

        await vi.advanceTimersByTimeAsync(
          CREATIVE_REMOTE_IMAGE_TIMEOUT_MS + 2_000
        );

        const outcome = await observedExecution;
        expect(outcome.ok).toBe(false);
        expect(outcome.ok ? undefined : outcome.error?.code).toBe('TIMEOUT');
        expect(updateRemoteId).toHaveBeenCalledWith(
          'task-timeout',
          'remote-timeout-1',
          expect.any(Object)
        );
        expect(completeTask).not.toHaveBeenCalled();
        expect(failTask).not.toHaveBeenCalled();
        expect(updateProgress).toHaveBeenCalledWith(
          'task-timeout',
          95,
          'polling'
        );
      } finally {
        vi.useRealTimers();
      }
    }, 15000);

    it('marks a hung Creative image submit as retryable submission interruption instead of hanging forever', async () => {
      vi.useFakeTimers();

      const updateRemoteId = vi.fn(async () => undefined);
      const completeTask = vi.fn(async () => undefined);
      const failTask = vi.fn(async () => undefined);
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/creative/relay/v1/images/tasks')) {
          return new Promise<Response>(() => undefined);
        }
        throw new Error(`unexpected fetch ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      vi.doMock('../creative-mode', () => ({
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
          updateRemoteId,
          completeTask,
          failTask,
          updateProgress: vi.fn(async () => undefined),
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          cacheMediaFromBlob: vi.fn(async () => undefined),
        },
      }));

      const { CREATIVE_IMAGE_SUBMIT_TIMEOUT_MS } = await import(
        '../../constants/TASK_CONSTANTS'
      );
      const { executeCreativeManagedImageTask } = await import(
        '../media-executor/fallback-adapter-routes'
      );

      try {
        const execution = executeCreativeManagedImageTask('task-submit-hung', {
          prompt: 'A cat that might already be running upstream',
          model: 'mock:gpt-image-2:preview',
          userParams: {},
        });
        const observedExecution = execution.then(
          () => ({ ok: true as const }),
          (error: any) => ({ ok: false as const, error })
        );

        await vi.advanceTimersByTimeAsync(CREATIVE_IMAGE_SUBMIT_TIMEOUT_MS + 1);

        const outcome = await observedExecution;
        expect(outcome.ok).toBe(false);
        expect(outcome.ok ? undefined : outcome.error?.code).toBe(
          'INTERRUPTED_DURING_SUBMISSION'
        );
        expect(updateRemoteId).not.toHaveBeenCalled();
        expect(completeTask).not.toHaveBeenCalled();
        expect(failTask).toHaveBeenCalledWith('task-submit-hung', {
          code: 'INTERRUPTED_DURING_SUBMISSION',
          message: 'Creative image task submit interrupted',
        });
      } finally {
        vi.useRealTimers();
      }
    }, 15000);

    it('guards recoverable Creative image timeout progress writes by retryAttempt', async () => {
      vi.useFakeTimers();

      const updateRemoteId = vi.fn(async () => undefined);
      const completeTask = vi.fn(async () => undefined);
      const failTask = vi.fn(async () => undefined);
      const updateProgress = vi.fn(async () => undefined);
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith('/creative/relay/v1/images/tasks')) {
            expect(init?.method).toBe('POST');
            return new Response(
              JSON.stringify({
                task_id: 'remote-timeout-retry-1',
                status: 'in_progress',
              }),
              { status: 202, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (
            url.endsWith(
              '/creative/relay/v1/images/tasks/remote-timeout-retry-1'
            )
          ) {
            return new Response(
              JSON.stringify({
                task_id: 'remote-timeout-retry-1',
                status: 'in_progress',
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          throw new Error(`unexpected fetch ${url}`);
        }
      );
      vi.stubGlobal('fetch', fetchMock);

      vi.doMock('../creative-mode', () => ({
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
          updateRemoteId,
          completeTask,
          failTask,
          updateProgress,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          cacheMediaFromBlob: vi.fn(async () => undefined),
        },
      }));

      const { CREATIVE_REMOTE_IMAGE_TIMEOUT_MS } = await import(
        '../../constants/TASK_CONSTANTS'
      );
      const { executeCreativeManagedImageTask } = await import(
        '../media-executor/fallback-adapter-routes'
      );

      try {
        const execution = executeCreativeManagedImageTask('task-timeout-retry', {
          prompt: 'A very slow cat',
          model: 'mock:gpt-image-2:preview',
          userParams: {},
          retryAttempt: 0,
        });
        const observedExecution = execution.then(
          () => ({ ok: true as const }),
          (error: any) => ({ ok: false as const, error })
        );

        await vi.advanceTimersByTimeAsync(
          CREATIVE_REMOTE_IMAGE_TIMEOUT_MS + 2_000
        );

        const outcome = await observedExecution;
        expect(outcome.ok).toBe(false);
        expect(outcome.ok ? undefined : outcome.error?.code).toBe('TIMEOUT');
        const expectedGuard = { expectedRetryAttempt: 0 };
        expect(updateRemoteId).toHaveBeenCalledWith(
          'task-timeout-retry',
          'remote-timeout-retry-1',
          expect.any(Object),
          expectedGuard
        );
        expect(completeTask).not.toHaveBeenCalled();
        expect(failTask).not.toHaveBeenCalled();
        expect(updateProgress).toHaveBeenCalledWith(
          'task-timeout-retry',
          95,
          'polling',
          expectedGuard
        );
      } finally {
        vi.useRealTimers();
      }
    }, 15000);

    it('keeps polling after transient Creative image status fetch network failures', async () => {
      vi.useFakeTimers();

      const updateRemoteId = vi.fn(async () => undefined);
      const completeTask = vi.fn(async () => undefined);
      const failTask = vi.fn(async () => undefined);
      const cacheMediaFromBlob = vi.fn(async () => undefined);
      let statusAttempts = 0;
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith('/creative/relay/v1/images/tasks')) {
            expect(init?.method).toBe('POST');
            return new Response(
              JSON.stringify({
                task_id: 'remote-status-network-retry-1',
                status: 'in_progress',
              }),
              { status: 202, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (
            url.endsWith(
              '/creative/relay/v1/images/tasks/remote-status-network-retry-1'
            )
          ) {
            statusAttempts += 1;
            if (statusAttempts === 1) {
              throw new TypeError('status fetch connection reset');
            }
            return new Response(
              JSON.stringify({
                task_id: 'remote-status-network-retry-1',
                status: 'completed',
                result: {
                  url: '/creative/relay/v1/images/tasks/remote-status-network-retry-1/content',
                  mimeType: 'image/png',
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (
            url.endsWith(
              '/creative/relay/v1/images/tasks/remote-status-network-retry-1/content'
            )
          ) {
            return new Response(
              new Blob(['png-bytes'], { type: 'image/png' }),
              {
                status: 200,
                headers: { 'Content-Type': 'image/png' },
              }
            );
          }
          throw new Error(`unexpected fetch ${url}`);
        }
      );
      vi.stubGlobal('fetch', fetchMock);

      vi.doMock('../creative-mode', () => ({
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
          updateRemoteId,
          completeTask,
          failTask,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          cacheMediaFromBlob,
        },
      }));

      const { executeCreativeManagedImageTask } = await import(
        '../media-executor/fallback-adapter-routes'
      );

      try {
        const execution = executeCreativeManagedImageTask(
          'task-status-network-retry',
          {
            prompt: 'A resilient cat',
            model: 'mock:gpt-image-2:preview',
            userParams: {},
          }
        );

        await vi.advanceTimersByTimeAsync(2_000);

        await expect(execution).resolves.toBeUndefined();
        expect(statusAttempts).toBe(2);
        expect(failTask).not.toHaveBeenCalled();
        expect(completeTask).toHaveBeenCalledWith(
          'task-status-network-retry',
          expect.objectContaining({
            url: '/__aitu_cache__/image/remote-status-network-retry-1.png',
            mimeType: 'image/png',
          })
        );
      } finally {
        vi.useRealTimers();
      }
    }, 15000);

    it('retries transient content fetch failures after remote Creative image completion instead of terminally failing the task', async () => {
      vi.useFakeTimers();

      const updateRemoteId = vi.fn(async () => undefined);
      const completeTask = vi.fn(async () => undefined);
      const failTask = vi.fn(async () => undefined);
      const cacheMediaFromBlob = vi.fn(async () => undefined);
      vi.stubGlobal(
        'createImageBitmap',
        vi.fn(async () => ({
          width: 1024,
          height: 1024,
          close: vi.fn(),
        }))
      );
      let contentAttempts = 0;
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith('/creative/relay/v1/images/tasks')) {
            expect(init?.method).toBe('POST');
            return new Response(
              JSON.stringify({
                task_id: 'remote-content-retry-1',
                status: 'completed',
                result: {
                  url: '/creative/relay/v1/images/tasks/remote-content-retry-1/content',
                  mimeType: 'image/png',
                },
              }),
              { status: 202, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (
            url.endsWith(
              '/creative/relay/v1/images/tasks/remote-content-retry-1/content'
            )
          ) {
            contentAttempts += 1;
            if (contentAttempts === 1) {
              return new Response('upstream warming up', { status: 503 });
            }
            return new Response(
              new Blob(['webp-bytes'], { type: 'image/webp' }),
              {
                status: 200,
                headers: { 'Content-Type': 'image/webp' },
              }
            );
          }
          throw new Error(`unexpected fetch ${url}`);
        }
      );
      vi.stubGlobal('fetch', fetchMock);

      vi.doMock('../creative-mode', () => ({
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
          updateRemoteId,
          completeTask,
          failTask,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          cacheMediaFromBlob,
        },
      }));

      const { executeCreativeManagedImageTask } = await import(
        '../media-executor/fallback-adapter-routes'
      );

      try {
        const execution = executeCreativeManagedImageTask(
          'task-content-retry',
          {
            prompt: 'A resilient cat',
            model: 'mock:gpt-image-2:preview',
            userParams: {},
          }
        );
        const observedExecution = execution.then(
          () => ({ ok: true as const }),
          (error: Error) => ({ ok: false as const, error })
        );

        await vi.advanceTimersByTimeAsync(1_000);

        const outcome = await observedExecution;
        expect(outcome).toEqual({ ok: true });
        expect(contentAttempts).toBe(2);
        expect(updateRemoteId).toHaveBeenCalledWith(
          'task-content-retry',
          'remote-content-retry-1',
          expect.objectContaining({
            operation: 'image',
            modelId: 'mock:gpt-image-2:preview',
          })
        );
        expect(failTask).not.toHaveBeenCalled();
        expect(completeTask).toHaveBeenCalledWith(
          'task-content-retry',
          expect.objectContaining({
            url: '/__aitu_cache__/image/remote-content-retry-1.webp',
            format: 'webp',
            remoteTaskId: 'remote-content-retry-1',
            contentUrl:
              '/creative/relay/v1/images/tasks/remote-content-retry-1/content',
            mimeType: 'image/webp',
            width: 1024,
            height: 1024,
          })
        );
      } finally {
        vi.useRealTimers();
      }
    }, 15000);

    it('retries thrown content fetch errors after remote Creative image completion', async () => {
      vi.useFakeTimers();

      const updateRemoteId = vi.fn(async () => undefined);
      const completeTask = vi.fn(async () => undefined);
      const failTask = vi.fn(async () => undefined);
      const cacheMediaFromBlob = vi.fn(async () => undefined);
      let contentAttempts = 0;
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith('/creative/relay/v1/images/tasks')) {
            expect(init?.method).toBe('POST');
            return new Response(
              JSON.stringify({
                task_id: 'remote-content-network-retry-1',
                status: 'completed',
                result: {
                  url: '/creative/relay/v1/images/tasks/remote-content-network-retry-1/content',
                },
              }),
              { status: 202, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (
            url.endsWith(
              '/creative/relay/v1/images/tasks/remote-content-network-retry-1/content'
            )
          ) {
            contentAttempts += 1;
            if (contentAttempts === 1) {
              throw new TypeError('network connection reset');
            }
            return new Response(
              new Blob(['webp-bytes'], { type: 'image/webp' }),
              {
                status: 200,
                headers: { 'Content-Type': 'image/webp' },
              }
            );
          }
          throw new Error(`unexpected fetch ${url}`);
        }
      );
      vi.stubGlobal('fetch', fetchMock);

      vi.doMock('../creative-mode', () => ({
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
          updateRemoteId,
          completeTask,
          failTask,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          cacheMediaFromBlob,
        },
      }));

      const { executeCreativeManagedImageTask } = await import(
        '../media-executor/fallback-adapter-routes'
      );

      try {
        const execution = executeCreativeManagedImageTask(
          'task-network-retry',
          {
            prompt: 'Retry content network error',
            model: 'mock:gpt-image-2:preview',
            userParams: {},
          }
        );
        await vi.advanceTimersByTimeAsync(1_000);

        await expect(execution).resolves.toBeUndefined();
        expect(contentAttempts).toBe(2);
        expect(failTask).not.toHaveBeenCalled();
        expect(completeTask).toHaveBeenCalledWith(
          'task-network-retry',
          expect.objectContaining({
            url: '/__aitu_cache__/image/remote-content-network-retry-1.webp',
            mimeType: 'image/webp',
          })
        );
      } finally {
        vi.useRealTimers();
      }
    }, 15000);

    it('uses safe backend submit failure messages instead of generic status text', async () => {
      const updateRemoteId = vi.fn(async () => undefined);
      const completeTask = vi.fn(async () => undefined);
      const failTask = vi.fn(async () => undefined);
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/creative/relay/v1/images/tasks')) {
          return new Response(
            JSON.stringify({
              error: {
                message: 'provider temporarily unavailable',
              },
            }),
            { status: 502, headers: { 'Content-Type': 'application/json' } }
          );
        }
        throw new Error(`unexpected fetch ${url}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      vi.doMock('../creative-mode', () => ({
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
          updateRemoteId,
          completeTask,
          failTask,
        },
      }));

      const { executeCreativeManagedImageTask } = await import(
        '../media-executor/fallback-adapter-routes'
      );

      await expect(
        executeCreativeManagedImageTask('task-submit-failure', {
          prompt: 'Fail safely',
          model: 'mock:gpt-image-2:preview',
          userParams: {},
        })
      ).rejects.toThrow('provider temporarily unavailable');
      expect(updateRemoteId).not.toHaveBeenCalled();
      expect(completeTask).not.toHaveBeenCalled();
      expect(failTask).toHaveBeenCalledWith(
        'task-submit-failure',
        expect.objectContaining({
          message: 'provider temporarily unavailable',
        })
      );
    });

    it('uses backend fail_reason for managed Creative image task failures', async () => {
      const failTask = vi.fn(async () => undefined);
      const fetchMock = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            task_id: 'remote-failed-1',
            status: 'failed',
            fail_reason: 'provider rejected prompt',
          }),
          { status: 202, headers: { 'Content-Type': 'application/json' } }
        );
      });
      vi.stubGlobal('fetch', fetchMock);

      vi.doMock('../creative-mode', () => ({
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
          updateRemoteId: vi.fn(async () => undefined),
          completeTask: vi.fn(async () => undefined),
          failTask,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          cacheMediaFromBlob: vi.fn(async () => undefined),
        },
      }));

      const { executeCreativeManagedImageTask } = await import(
        '../media-executor/fallback-adapter-routes'
      );

      await expect(
        executeCreativeManagedImageTask('task-failed', {
          prompt: 'A blocked cat',
          model: 'mock:gpt-image-2:preview',
          userParams: {},
        })
      ).rejects.toThrow('provider rejected prompt');

      expect(failTask).toHaveBeenCalledWith('task-failed', {
        code: 'IMAGE_GENERATION_ERROR',
        message: 'provider rejected prompt',
      });
    }, 15000);

    it('sanitizes sensitive backend fail_reason before persisting managed Creative image task failures', async () => {
      const failTask = vi.fn(async () => undefined);
      const failLLMApiLog = vi.fn();
      const fetchMock = vi.fn(async () => {
        return new Response(
          JSON.stringify({
            task_id: 'remote-sensitive-failure-1',
            status: 'failed',
            fail_reason:
              'provider callback https://internal.example/hook?token=secret failed',
          }),
          { status: 202, headers: { 'Content-Type': 'application/json' } }
        );
      });
      vi.stubGlobal('fetch', fetchMock);

      vi.doMock('../creative-mode', () => ({
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
        failLLMApiLog,
        updateLLMApiLogMetadata: vi.fn(),
      }));
      vi.doMock('../media-executor/task-storage-writer', () => ({
        taskStorageWriter: {
          updateRemoteId: vi.fn(async () => undefined),
          completeTask: vi.fn(async () => undefined),
          failTask,
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          cacheMediaFromBlob: vi.fn(async () => undefined),
        },
      }));

      const { executeCreativeManagedImageTask } = await import(
        '../media-executor/fallback-adapter-routes'
      );

      await expect(
        executeCreativeManagedImageTask('task-sensitive-failed', {
          prompt: 'A blocked cat',
          model: 'mock:gpt-image-2:preview',
          userParams: {},
        })
      ).rejects.toThrow('Creative image task failed');

      expect(failLLMApiLog).toHaveBeenCalledWith(
        'log-id',
        expect.objectContaining({
          errorMessage: 'Creative image task failed',
        })
      );
      expect(failTask).toHaveBeenCalledWith('task-sensitive-failed', {
        code: 'IMAGE_GENERATION_ERROR',
        message: 'Creative image task failed',
      });
    }, 15000);

    it('resumes managed Creative image tasks through NewAPI task status and content routes without a new submit', async () => {
      const cacheMediaFromBlob = vi.fn(async () => undefined);
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          expect(init?.method || 'GET').toBe('GET');
          if (url.endsWith('/creative/relay/v1/images/tasks/remote-resume-1')) {
            return new Response(
              JSON.stringify({
                task_id: 'remote-resume-1',
                status: 'completed',
                result: {
                  url: '/creative/relay/v1/images/tasks/remote-resume-1/content',
                  mimeType: 'image/png',
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          if (
            url.endsWith(
              '/creative/relay/v1/images/tasks/remote-resume-1/content'
            )
          ) {
            return new Response(
              new Blob(['png-bytes'], { type: 'image/png' }),
              {
                status: 200,
                headers: { 'Content-Type': 'image/png' },
              }
            );
          }
          throw new Error(`unexpected fetch ${url}`);
        }
      );
      vi.stubGlobal('fetch', fetchMock);

      vi.doMock('../creative-mode', () => ({
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
          updateRemoteId: vi.fn(async () => undefined),
          completeTask: vi.fn(async () => undefined),
          failTask: vi.fn(async () => undefined),
        },
      }));
      vi.doMock('../unified-cache-service', () => ({
        unifiedCacheService: {
          cacheMediaFromBlob,
        },
      }));

      const { resumeCreativeManagedImageTask } = await import(
        '../media-executor/fallback-adapter-routes'
      );

      const result = await resumeCreativeManagedImageTask(
        'task-resume',
        'remote-resume-1',
        { model: 'mock:gpt-image-2:preview' }
      );

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
        '/creative/relay/v1/images/tasks/remote-resume-1',
        '/creative/relay/v1/images/tasks/remote-resume-1/content',
      ]);
      expect(result).toMatchObject({
        url: '/__aitu_cache__/image/remote-resume-1.png',
        format: 'png',
        remoteTaskId: 'remote-resume-1',
        providerTaskId: 'remote-resume-1',
        contentUrl: '/creative/relay/v1/images/tasks/remote-resume-1/content',
        mimeType: 'image/png',
      });
      expect(cacheMediaFromBlob).toHaveBeenCalledWith(
        '/__aitu_cache__/image/remote-resume-1.png',
        expect.any(Object),
        'image',
        expect.objectContaining({ taskId: 'remote-resume-1' })
      );
    }, 15000);

    it('keeps unknown Creative managed image models without schema on the parameterless legacy path', async () => {
      const completeTask = vi.fn(async () => undefined);
      const updateStatus = vi.fn(async () => undefined);
      const cacheMediaFromBlob = vi.fn(async () => undefined);
      const resolveAdapterForInvocation = vi.fn();
      const fetchMock = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.endsWith('/creative/relay/v1/images/tasks')) {
            throw new Error(
              'unexpected schema-backed Creative image task submit'
            );
          }
          if (url.endsWith('/v1/images/generations')) {
            expect(init?.method).toBe('POST');
            const body = JSON.parse(String(init?.body));
            expect(body).toEqual({
              model: 'mock:gpt-image-2:empty-schema',
              prompt: 'A cat',
              response_format: 'url',
            });
            return new Response(
              JSON.stringify({
                data: [{ url: 'https://cdn.example.com/creative-image.png' }],
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } }
            );
          }
          throw new Error(`unexpected fetch ${url}`);
        }
      );
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
        const actual = await importOriginal<
          typeof import('../model-adapters')
        >();
        return {
          ...actual,
          resolveAdapterForInvocation,
        };
      });

      const { FallbackMediaExecutor } = await import(
        '../media-executor/fallback-executor'
      );
      const { ModelVendor, setRuntimeModelConfigs } = await import(
        '../../constants/model-config'
      );
      setRuntimeModelConfigs([
        {
          id: 'mock:gpt-image-2:empty-schema',
          label: 'Mock GPT Image 2 Empty Schema',
          type: 'image',
          vendor: ModelVendor.OTHER,
          sourceProfileId: 'new-api-creative',
          creativeManaged: true,
        },
      ]);
      const executor = new FallbackMediaExecutor();

      await executor.generateImage({
        taskId: 'task-empty-schema',
        prompt: 'A cat',
        model: 'mock:gpt-image-2:empty-schema',
        size: '16x9',
        params: { webhook: 'https://evil.example/hook' },
      });

      expect(resolveAdapterForInvocation).toHaveBeenCalled();
      expect(cacheMediaFromBlob).not.toHaveBeenCalled();
      expect(completeTask).toHaveBeenCalledWith('task-empty-schema', {
        url: 'https://cdn.example.com/creative-image.png',
        urls: undefined,
        format: 'png',
        size: 0,
      });
    }, 15000);

    it('rejects malicious managed image userParams before the task fetch body is sent', async () => {
      const failTask = vi.fn(async () => undefined);
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

      const { executeCreativeManagedImageTask } = await import(
        '../media-executor/fallback-adapter-routes'
      );
      const {
        ModelVendor,
        normalizeCreativeParameterSchema,
        setRuntimeModelConfigs,
      } = await import('../../constants/model-config');
      setRuntimeModelConfigs([
        {
          id: 'mock:gpt-image-2:preview',
          label: 'Mock GPT Image 2',
          type: 'image',
          vendor: ModelVendor.OTHER,
          sourceProfileId: 'new-api-creative',
          creativeManaged: true,
          parameterSchema: normalizeCreativeParameterSchema(
            [
              {
                id: 'size',
                label: '尺寸',
                type: 'enum',
                options: [{ value: '1024x1024', label: '1024×1024' }],
              },
            ],
            'image',
            'mock:gpt-image-2:preview'
          ),
        },
      ]);

      await expect(
        executeCreativeManagedImageTask('task-malicious', {
          prompt: 'A cat',
          model: 'mock:gpt-image-2:preview',
          userParams: {
            size: '1024x1024',
            callback: 'https://evil.example/hook',
            headers: 'Authorization: Bearer bad',
            sourceProfileId: 'new-api-creative',
            modelRef: 'override',
          },
        })
      ).rejects.toThrow(/Disallowed Creative userParams field: callback/);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(failTask).toHaveBeenCalledWith(
        'task-malicious',
        expect.objectContaining({
          code: 'IMAGE_GENERATION_ERROR',
        })
      );

      fetchMock.mockClear();
      failTask.mockClear();

      await expect(
        executeCreativeManagedImageTask('task-malformed-user-params', {
          prompt: 'A cat',
          model: 'mock:gpt-image-2:preview',
          userParams: false as never,
        })
      ).rejects.toThrow(/Creative userParams must be an object/);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(failTask).toHaveBeenCalledWith(
        'task-malformed-user-params',
        expect.objectContaining({
          code: 'IMAGE_GENERATION_ERROR',
        })
      );
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
        const actual = await importOriginal<
          typeof import('../model-adapters')
        >();
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
      let durableRemoteIdSaved = false;
      let callbackReturnedPromise = false;
      let adapterContinuedAfterDurableSave = false;
      const updateRemoteId = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        durableRemoteIdSaved = true;
      });
      const completeTask = vi.fn(async () => undefined);
      const onProgress = vi.fn();
      const onSubmitted = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      const cacheMediaFromBlob = vi.fn(async () => undefined);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          return new Response(new Blob(['video-bytes'], { type: 'video/mp4' }), {
            status: 200,
            headers: { 'Content-Type': 'video/mp4' },
          });
        })
      );

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
          cacheMediaFromBlob,
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
            | ((videoId: string) => void | Promise<void>)
            | undefined;

          const submitted = handleSubmitted?.('video-task-1');
          callbackReturnedPromise =
            !!submitted && typeof (submitted as Promise<void>).then === 'function';
          await submitted;
          adapterContinuedAfterDurableSave = durableRemoteIdSaved;
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
        { onProgress, onSubmitted }
      );

      expect(receivedIdempotencyKey).toBe('opentu-video-task-1');
      expect(callbackReturnedPromise).toBe(true);
      expect(adapterContinuedAfterDurableSave).toBe(true);
      expect(updateRemoteId).toHaveBeenCalledWith(
        'task-1',
        'video-task-1',
        expect.objectContaining({
          operation: 'video',
          modelId: 'happyhorse-1.0-t2v',
        })
      );
      expect(onSubmitted).toHaveBeenCalledWith(
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
      expect(cacheMediaFromBlob).toHaveBeenCalledWith(
        '/__aitu_cache__/video/task-1.mp4',
        expect.any(Blob),
        'video',
        expect.objectContaining({
          taskId: 'task-1',
          contentUrl: 'https://example.com/out.mp4',
          remoteTaskId: 'video-task-1',
          providerTaskId: 'video-task-1',
        })
      );
      expect(completeTask).toHaveBeenCalledWith(
        'task-1',
        expect.objectContaining({
          url: '/__aitu_cache__/video/task-1.mp4',
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
