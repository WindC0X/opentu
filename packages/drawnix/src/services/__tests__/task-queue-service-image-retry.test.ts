import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskExecutionPhase,
  TaskStatus,
  TaskType,
} from '../../types/task.types';
import type { Task } from '../../types/task.types';
import type { ModelConfig } from '../../constants/model-config';
import type { PollingOptions, PollingResult } from '../media-executor';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function flushAsyncWork(turns = 16): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function createCreativeRuntimeImageModel(
  overrides: Pick<ModelConfig, 'id'> & Partial<ModelConfig>
): ModelConfig {
  const { id, ...rest } = overrides;
  return {
    id,
    label: id,
    type: 'image',
    vendor: 'GPT' as ModelConfig['vendor'],
    sourceProfileId: 'new-api-creative',
    creativeManaged: true,
    ...rest,
  };
}

async function setupTaskQueueServiceHarness(
  statusSequence: TaskStatus[],
  options: {
    runtimeModels?: ModelConfig[];
    saveTaskImpl?: (task: any, storedTasks: Map<string, any>) => Promise<void>;
  } = {}
) {
  const storedTasks = new Map<string, any>();

  const mocks = {
    saveTask: vi.fn(async (task: any) => {
      if (options.saveTaskImpl) {
        await options.saveTaskImpl(task, storedTasks);
        return;
      }
      storedTasks.set(task.id, clone(task));
    }),
    getStoredTask: vi.fn(async (taskId: string) => {
      const task = storedTasks.get(taskId);
      return task ? clone(task) : null;
    }),
    deleteTask: vi.fn(async (taskId: string) => {
      storedTasks.delete(taskId);
    }),
    archiveTasks: vi.fn(async () => undefined),
    invalidateCache: vi.fn(),
    generateImage: vi.fn(async (_params?: any, _options?: any) => undefined),
    generateAudio: vi.fn(async (_context?: any, _request?: any) => ({
      url: '',
      resultKind: 'lyrics',
      format: 'lyrics',
      lyricsText: 'generated lyrics',
      providerTaskId: 'audio-generated-1',
    })),
    resumePendingTasks: vi.fn(
      async (
        _onTaskUpdate?: (
          taskId: string,
          status: TaskStatus,
          updates?: Partial<Task>
        ) => void,
        _tasksFromMemory?: Task[]
      ) => undefined
    ),
    resumeAudioPolling: vi.fn(async (_taskId: string, _options?: any) => ({
      taskId: 'remote-audio-resume-1',
      status: 'complete',
      action: 'lyrics',
      lyrics: {
        text: 'resumed lyrics',
        title: 'Resumed',
      },
      clips: [],
      raw: {
        id: 'remote-audio-resume-1',
        status: 'complete',
        lyrics: {
          text: 'resumed lyrics',
          title: 'Resumed',
        },
      },
    })),
  };

  let waitForTaskCompletionCallCount = 0;
  const waitForTaskCompletion = vi.fn(
    async (
      taskId: string,
      options?: PollingOptions
    ): Promise<PollingResult> => {
      const currentTask = storedTasks.get(taskId);
      if (!currentTask) {
        return { success: false, error: 'missing-task' };
      }

      const callIndex = waitForTaskCompletionCallCount;
      waitForTaskCompletionCallCount += 1;
      const nextStatus: TaskStatus =
        statusSequence[callIndex] ??
        statusSequence[statusSequence.length - 1] ??
        TaskStatus.FAILED;
      const now = Date.now();
      const updatedTask =
        nextStatus === TaskStatus.COMPLETED
          ? {
              ...clone(currentTask),
              status: TaskStatus.COMPLETED,
              updatedAt: now,
              completedAt: now,
              progress: 100,
              result: {
                url: 'https://example.com/out.png',
                format: 'png',
                size: 1,
              },
            }
          : {
              ...clone(currentTask),
              status: TaskStatus.FAILED,
              updatedAt: now,
              completedAt: now,
              error: {
                code: 'EXECUTION_ERROR',
                message: 'Image generation failed',
              },
            };

      storedTasks.set(taskId, clone(updatedTask));
      options?.onProgress?.(clone(updatedTask));

      return nextStatus === TaskStatus.COMPLETED
        ? { success: true, task: clone(updatedTask) }
        : {
            success: false,
            task: clone(updatedTask),
            error: updatedTask.error?.message || 'failed',
          };
    }
  );

  vi.doMock('../media-executor/task-storage-writer', () => ({
    taskStorageWriter: {
      saveTask: mocks.saveTask,
      getTask: mocks.getStoredTask,
      deleteTask: mocks.deleteTask,
      archiveTasks: mocks.archiveTasks,
    },
  }));

  vi.doMock('../task-storage-reader', () => ({
    taskStorageReader: {
      invalidateCache: mocks.invalidateCache,
      getTask: vi.fn(async (taskId: string) => {
        const task = storedTasks.get(taskId);
        return task ? clone(task) : null;
      }),
      getAllTasks: vi.fn(async () => []),
    },
  }));

  vi.doMock('../media-executor', () => ({
    executorFactory: {
      getExecutor: vi.fn(async () => ({
        generateImage: mocks.generateImage,
        generateVideo: vi.fn(),
      })),
    },
    fallbackMediaExecutor: {
      resumePendingTasks: mocks.resumePendingTasks,
    },
    waitForTaskCompletion,
  }));

  vi.doMock('../audio-api-service', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../audio-api-service')>();
    return {
      ...actual,
      audioAPIService: {
        ...actual.audioAPIService,
        resumePolling: mocks.resumeAudioPolling,
      },
    };
  });

  vi.doMock('../media-executor/fallback-utils', () => ({
    cacheRemoteUrl: vi.fn(
      async (
        url: string,
        taskId: string,
        mediaType: string,
        format: string,
        index?: number
      ) =>
        `/__aitu_cache__/${mediaType}/${taskId}${
          typeof index === 'number' ? `-${index}` : ''
        }.${format || 'bin'}`
    ),
  }));

  vi.doMock('../../utils/settings-manager', () => ({
    LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
    hasInvocationRouteCredentials: vi.fn(() => true),
    createModelRef: (profileId?: string | null, modelId?: string | null) =>
      profileId || modelId
        ? {
            profileId: profileId || null,
            modelId: modelId || null,
          }
        : null,
    resolveInvocationRoute: vi.fn((operation: string, routeModel?: any) => ({
      routeType: operation,
      modelId:
        typeof routeModel === 'string'
          ? routeModel
          : routeModel?.modelId || 'default-model',
      profileId:
        typeof routeModel === 'object' ? routeModel?.profileId || null : null,
      profileName: null,
      providerType: null,
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'test-key',
      source: 'legacy',
    })),
    providerProfilesSettings: {
      get: vi.fn(() => []),
    },
    providerPricingCacheSettings: {
      get: vi.fn(() => []),
      set: vi.fn(),
    },
    providerCatalogsSettings: {
      get: vi.fn(() => []),
      set: vi.fn(),
      addListener: vi.fn(() => vi.fn()),
    },
    invocationPresetsSettings: {
      get: vi.fn(() => []),
      set: vi.fn(),
      addListener: vi.fn(() => vi.fn()),
    },
    settingsManager: {
      addListener: vi.fn(() => vi.fn()),
      reloadFromStorage: vi.fn(),
    },
  }));

  vi.doMock('../creative-mode', () => ({
    CREATIVE_MANAGED_PROFILE_ID: 'new-api-creative',
    isCreativeEmbeddedMode: () => false,
  }));

  vi.doMock('../provider-routing', () => ({
    resolveInvocationPlanFromRoute: vi.fn(
      (operation: string, routeModel?: any) => {
        const profileId =
          typeof routeModel === 'object' ? routeModel?.profileId : null;
        if (!profileId) {
          return null;
        }

        const modelId =
          typeof routeModel === 'string'
            ? routeModel
            : routeModel?.modelId || 'default-model';
        return {
          provider: {
            profileId,
            profileName: profileId,
            providerType: 'custom',
            baseUrl: 'https://api.example.com/v1',
            apiKey: 'test-key',
            authType: 'bearer',
          },
          modelRef: {
            profileId,
            modelId,
          },
          binding: {
            id: `${profileId}:${modelId}:${operation}`,
            profileId,
            modelId,
            operation,
            protocol: 'openai.async.video',
            requestSchema: 'openai.video.form-input-reference',
            responseSchema: 'openai.async.task',
            submitPath: '/videos',
            pollPathTemplate: '/videos/{taskId}',
            priority: 100,
            confidence: 'high',
            source: 'template',
          },
        };
      }
    ),
  }));

  vi.doMock('../../utils/posthog-analytics', () => ({
    analytics: {
      track: vi.fn(),
      trackModelCall: vi.fn(),
      trackModelSuccess: vi.fn(),
      trackModelFailure: vi.fn(),
      trackTaskCancellation: vi.fn(),
    },
  }));

  vi.doMock('../model-adapters', () => ({
    getAdapterContextFromSettings: vi.fn(),
    resolveAdapterForInvocation: vi.fn(),
  }));

  vi.doMock('../unified-cache-service', () => ({
    unifiedCacheService: {
      getImageForAI: vi.fn(),
      isCached: vi.fn(async () => false),
      cacheMediaFromBlob: vi.fn(async () => undefined),
    },
  }));

  vi.doMock('../analysis-core', () => ({
    buildGenerateContentConfig: vi.fn(() => ({})),
  }));

  vi.doMock('../video-analysis-service', () => ({
    executeVideoAnalysis: vi.fn(),
  }));

  vi.doMock('../music-analysis-service', () => ({
    DEFAULT_MUSIC_ANALYSIS_PROMPT: 'default',
    executeMusicAnalysis: vi.fn(),
    MAX_AUDIO_ANALYZE_FILE_SIZE: 1024,
  }));

  vi.doMock('../../utils/gemini-api/services', () => ({
    sendChatWithGemini: vi.fn(),
  }));

  vi.doMock('../../utils/gemini-api/message-utils', () => ({
    buildInlineDataPart: vi.fn(),
  }));

  vi.doMock('../../utils/gemini-api/logged-calls', () => ({
    callGoogleGenerateContentWithLog: vi.fn(),
  }));

  vi.doMock('../../components/video-analyzer/storage', () => ({
    loadRecords: vi.fn(async () => []),
  }));

  vi.doMock('../../components/video-analyzer/utils', () => ({
    applyRewriteShotUpdates: vi.fn(),
    parseRewriteShotUpdates: vi.fn(),
  }));

  vi.doMock('../../components/music-analyzer/storage', () => ({
    loadRecords: vi.fn(async () => []),
  }));

  vi.doMock('../../components/music-analyzer/utils', () => ({
    parseLyricsRewriteResult: vi.fn(),
  }));

  vi.doMock('../../utils/task-utils', async (importOriginal) => {
    const actual = await importOriginal<
      typeof import('../../utils/task-utils')
    >();

    return {
      ...actual,
      generateTaskId: () => 'task-image-edit-1',
    };
  });

  const modelConfigModule = await import('../../constants/model-config');
  modelConfigModule.setRuntimeModelConfigs(options.runtimeModels ?? []);

  const { taskQueueService } = await import('../task-queue-service');

  return {
    taskQueueService,
    storedTasks,
    mocks: {
      ...mocks,
      waitForTaskCompletion,
    },
  };
}

describe('task-queue-service image edit retry persistence', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('keeps stripped image edit params in IndexedDB so retry can rehydrate them', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([
        TaskStatus.FAILED,
        TaskStatus.COMPLETED,
      ]);

    const task = taskQueueService.createTask(
      {
        prompt: 'Edit this image',
        model: 'gpt-image-2',
        size: '1x1',
        generationMode: 'image_to_image',
        referenceImages: ['data:image/png;base64,source'],
        maskImage: 'data:image/png;base64,mask',
        outputFormat: 'png',
      },
      TaskType.IMAGE
    );

    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(
      taskQueueService.getTask(task.id)?.params.referenceImages
    ).toBeUndefined();
    expect(storedTasks.get(task.id)?.params.referenceImages).toEqual([
      'data:image/png;base64,source',
    ]);

    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(2);
    expect(mocks.generateImage.mock.calls[1]?.[0]).toMatchObject({
      generationMode: 'image_to_image',
      referenceImages: ['data:image/png;base64,source'],
      maskImage: 'data:image/png;base64,mask',
      outputFormat: 'png',
    });
    expect(storedTasks.get(task.id)?.params.referenceImages).toEqual([
      'data:image/png;base64,source',
    ]);
  }, 15000);

  it('rehydrates schema-backed image userParams without legacy params on retry', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.FAILED,
      TaskStatus.COMPLETED,
    ]);

    const task = taskQueueService.createTask(
      {
        prompt: 'Schema-backed cat',
        model: 'mock:gpt-image-2:preview',
        size: '16x9',
        resolution: '4k',
        quality: 'high',
        count: 2,
        params: { webhook: 'https://evil.example/hook' },
        userParams: {
          size: '1024x1024',
          seed: 42,
          oversea: true,
        },
      },
      TaskType.IMAGE
    );

    await flushAsyncWork();
    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(2);
    expect(mocks.generateImage.mock.calls[1]?.[0]).toMatchObject({
      taskId: task.id,
      prompt: 'Schema-backed cat',
      model: 'mock:gpt-image-2:preview',
      userParams: {
        size: '1024x1024',
        seed: 42,
        oversea: true,
      },
      size: undefined,
      resolution: undefined,
      quality: undefined,
      count: undefined,
      params: undefined,
    });
  });

  it('syncs executor remoteId submission into the in-memory image task before completion', async () => {
    const managedBinding = createCreativeRuntimeImageModel({
      id: 'managed-live-image-binding',
      providerModelId: 'gpt-image-2',
      priceModelId: 'billing-gpt-image-2',
      parameterSchema: [
        {
          id: 'aspectRatio',
          label: '图片尺寸',
          valueType: 'enum',
          defaultValue: '1:1',
          compatibleModels: ['managed-live-image-binding'],
          modelType: 'image',
          runtimeSchema: true,
          runtimeValueType: 'enum',
          options: [{ value: '1:1', label: '1:1' }],
        },
      ],
    });
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED], {
        runtimeModels: [managedBinding],
      });
    mocks.generateImage.mockImplementationOnce(async (_params, options) => {
      options?.onSubmitted?.('remote-live-image-1', {
        operation: 'image',
        providerProfileId: 'new-api-creative',
        modelId: managedBinding.id,
        binding: {
          protocol: 'session-broker',
          requestSchema: 'new-api.creative.image.task',
          submitPath: '/images/tasks',
          pollPathTemplate: '/images/tasks/{taskId}',
        },
      });
    });

    const task = taskQueueService.createTask(
      {
        prompt: 'Managed live cat',
        model: managedBinding.id,
        modelRef: {
          profileId: 'new-api-creative',
          modelId: managedBinding.id,
        },
        userParams: {
          aspectRatio: '1:1',
        },
      },
      TaskType.IMAGE
    );

    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(taskQueueService.getTask(task.id)?.remoteId).toBe(
      'remote-live-image-1'
    );
    expect(
      taskQueueService.getTask(task.id)?.invocationRoute?.providerProfileId
    ).toBe('new-api-creative');
    expect(storedTasks.get(task.id)?.remoteId).toBe('remote-live-image-1');
  });

  it('preserves legacy image params for managed no-schema bindings with providerModelId static fallback on retry', async () => {
    const managedBinding = createCreativeRuntimeImageModel({
      id: 'managed-gpt-image-2-binding',
      providerModelId: 'gpt-image-2',
      priceModelId: 'billing-gpt-image-2',
    });
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness(
      [TaskStatus.FAILED, TaskStatus.COMPLETED],
      { runtimeModels: [managedBinding] }
    );

    const task = taskQueueService.createTask(
      {
        prompt: 'Managed static fallback cat',
        model: managedBinding.id,
        modelRef: {
          profileId: 'new-api-creative',
          modelId: managedBinding.id,
        },
        size: '1x1',
        resolution: '4k',
        quality: 'high',
        count: 2,
        params: {
          style: 'vivid',
        },
        creativeParameterFallbackModelId: 'gpt-image-2',
      },
      TaskType.IMAGE
    );

    await flushAsyncWork();
    const modelConfigModule = await import('../../constants/model-config');
    modelConfigModule.clearRuntimeModelConfigs();
    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    const retryPayload = mocks.generateImage.mock.calls[1]?.[0];
    expect(retryPayload).toMatchObject({
      taskId: task.id,
      prompt: 'Managed static fallback cat',
      model: managedBinding.id,
      modelRef: {
        profileId: 'new-api-creative',
        modelId: managedBinding.id,
      },
      size: '1x1',
      resolution: '4k',
      quality: 'high',
      count: 2,
    });
    expect(retryPayload.params).toEqual({
      style: 'vivid',
      resolution: '4k',
      quality: 'high',
      n: 2,
    });
    expect(retryPayload.userParams).toBeUndefined();
    expect(retryPayload.creativeManaged).toBeUndefined();
    expect(retryPayload.creativeParameterFallbackModelId).toBe('gpt-image-2');
  });

  it('keeps unknown managed no-schema bindings parameterless even when priceModelId matches a static image model on retry', async () => {
    const managedBinding = createCreativeRuntimeImageModel({
      id: 'managed-unknown-image-binding',
      priceModelId: 'gpt-image-2',
    });
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness(
      [TaskStatus.FAILED, TaskStatus.COMPLETED],
      { runtimeModels: [managedBinding] }
    );

    const task = taskQueueService.createTask(
      {
        prompt: 'Managed billing-only cat',
        model: managedBinding.id,
        modelRef: {
          profileId: 'new-api-creative',
          modelId: managedBinding.id,
        },
        size: '1x1',
        resolution: '4k',
        quality: 'high',
        count: 2,
        params: {
          style: 'vivid',
        },
      },
      TaskType.IMAGE
    );

    await flushAsyncWork();
    const modelConfigModule = await import('../../constants/model-config');
    modelConfigModule.clearRuntimeModelConfigs();
    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    const retryPayload = mocks.generateImage.mock.calls[1]?.[0];
    expect(retryPayload).toMatchObject({
      taskId: task.id,
      prompt: 'Managed billing-only cat',
      model: managedBinding.id,
      modelRef: {
        profileId: 'new-api-creative',
        modelId: managedBinding.id,
      },
    });
    expect(retryPayload.size).toBeUndefined();
    expect(retryPayload.resolution).toBeUndefined();
    expect(retryPayload.quality).toBeUndefined();
    expect(retryPayload.count).toBeUndefined();
    expect(retryPayload.params).toBeUndefined();
    expect(retryPayload.userParams).toBeUndefined();
    expect(retryPayload.creativeManaged).toBeUndefined();
  });

  it('rehydrates managed image tasks with empty userParams without legacy params on retry', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.FAILED,
      TaskStatus.COMPLETED,
    ]);

    const task = taskQueueService.createTask(
      {
        prompt: 'Managed defaults cat',
        model: 'mock:gpt-image-2:preview',
        size: '16x9',
        quality: 'high',
        params: { webhook: 'https://evil.example/hook' },
        userParams: {},
        creativeManaged: true,
      },
      TaskType.IMAGE
    );

    await flushAsyncWork();
    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(2);
    expect(mocks.generateImage.mock.calls[1]?.[0]).toMatchObject({
      taskId: task.id,
      prompt: 'Managed defaults cat',
      model: 'mock:gpt-image-2:preview',
      userParams: {},
      creativeManaged: true,
      size: undefined,
      quality: undefined,
      params: undefined,
    });
  });

  it('increments retryAttempt and uses an attempt-scoped image idempotency key when regenerating', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.FAILED,
      TaskStatus.COMPLETED,
    ]);

    const task = taskQueueService.createTask(
      {
        prompt: 'Retry with a fresh provider attempt',
        model: 'mock:gpt-image-2:preview',
        userParams: {
          size: '1024x1024',
        },
        creativeManaged: true,
      },
      TaskType.IMAGE
    );

    await flushAsyncWork();

    expect(taskQueueService.getTask(task.id)?.status).toBe(TaskStatus.FAILED);

    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    expect(taskQueueService.getTask(task.id)?.params.retryAttempt).toBe(1);
    expect(mocks.generateImage).toHaveBeenCalledTimes(2);
    expect(mocks.generateImage.mock.calls[1]?.[0]).toMatchObject({
      taskId: task.id,
      idempotencyKey: `opentu-image-${task.id}-retry-1`,
      userParams: {
        size: '1024x1024',
      },
    });
  });

  it('does not regenerate or increment retryAttempt for an existing processing task with remoteId', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task: Task = {
      id: 'task-processing-remote-1',
      type: TaskType.IMAGE,
      status: TaskStatus.PROCESSING,
      remoteId: 'remote-processing-1',
      executionPhase: TaskExecutionPhase.POLLING,
      params: {
        prompt: 'Resume provider task',
        model: 'managed-image-binding',
        retryAttempt: 2,
        creativeManaged: true,
      },
      createdAt: 1,
      updatedAt: 1,
    };

    taskQueueService.trackExternalTask(clone(task));
    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.PROCESSING
    );
    expect(taskQueueService.getTask(task.id)?.params.retryAttempt).toBe(2);
    expect(taskQueueService.getTask(task.id)?.remoteId).toBe(
      'remote-processing-1'
    );
    expect(mocks.generateImage).not.toHaveBeenCalled();
  });

  it('resumes a recoverable failed Creative remote image task instead of regenerating', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task: Task = {
      id: 'task-failed-remote-timeout-1',
      type: TaskType.IMAGE,
      status: TaskStatus.FAILED,
      remoteId: 'remote-timeout-1',
      executionPhase: undefined,
      error: {
        code: 'TIMEOUT',
        message: 'creative image task timed out',
      },
      params: {
        prompt: 'Resume provider timeout',
        model: 'managed-image-binding',
        retryAttempt: 2,
        creativeManaged: true,
      },
      invocationRoute: {
        operation: 'image',
        providerProfileId: 'new-api-creative',
        modelId: 'managed-image-binding',
        binding: {
          protocol: 'session-broker',
          requestSchema: 'new-api.creative.image.task',
          submitPath: '/images/tasks',
          pollPathTemplate: '/images/tasks/{taskId}',
        },
      },
      createdAt: 1,
      updatedAt: 1,
      completedAt: 2,
    };

    taskQueueService.trackExternalTask(clone(task));
    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    const resumed = taskQueueService.getTask(task.id);
    expect(resumed?.status).toBe(TaskStatus.PROCESSING);
    expect(resumed?.remoteId).toBe('remote-timeout-1');
    expect(resumed?.params.retryAttempt).toBe(2);
    expect(resumed?.executionPhase).toBe(TaskExecutionPhase.POLLING);
    expect(resumed?.error).toBeUndefined();
    expect(mocks.generateImage).not.toHaveBeenCalled();
  });

  it('reuses the original image idempotency key after a submit interruption without remoteId', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task: Task = {
      id: 'task-submit-interrupted-no-remote-1',
      type: TaskType.IMAGE,
      status: TaskStatus.FAILED,
      executionPhase: TaskExecutionPhase.SUBMITTING,
      error: {
        code: 'INTERRUPTED_DURING_SUBMISSION',
        message: 'creative image submit was interrupted',
      },
      params: {
        prompt: 'Resume ambiguous submit',
        model: 'managed-image-binding',
        creativeManaged: true,
      },
      invocationRoute: {
        operation: 'image',
        providerProfileId: 'new-api-creative',
        modelId: 'managed-image-binding',
        binding: {
          protocol: 'session-broker',
          requestSchema: 'new-api.creative.image.task',
          submitPath: '/images/tasks',
          pollPathTemplate: '/images/tasks/{taskId}',
        },
      },
      createdAt: 1,
      updatedAt: 2,
      completedAt: 3,
    };

    taskQueueService.trackExternalTask(clone(task));
    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    const resumed = taskQueueService.getTask(task.id);
    expect(resumed?.params.retryAttempt).toBeUndefined();
    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(mocks.generateImage.mock.calls[0]?.[0]).toMatchObject({
      taskId: task.id,
      idempotencyKey: `opentu-image-${task.id}`,
    });
    expect(mocks.generateImage.mock.calls[0]?.[0]).not.toMatchObject({
      idempotencyKey: `opentu-image-${task.id}-retry-1`,
    });
  });

  it('preserves submit interruption errors from the executor so retry replays the original image idempotency key', async () => {
    const managedBinding = createCreativeRuntimeImageModel({
      id: 'managed-submit-interrupted-binding',
      providerModelId: 'gpt-image-2',
      priceModelId: 'billing-gpt-image-2',
      parameterSchema: [
        {
          id: 'aspectRatio',
          label: '图片尺寸',
          valueType: 'enum',
          defaultValue: '1:1',
          compatibleModels: ['managed-submit-interrupted-binding'],
          modelType: 'image',
          runtimeSchema: true,
          runtimeValueType: 'enum',
          options: [{ value: '1:1', label: '1:1' }],
        },
      ],
    });
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([], {
      runtimeModels: [managedBinding],
    });
    const submitInterrupted = Object.assign(
      new Error('Creative image task submit interrupted'),
      {
        code: 'INTERRUPTED_DURING_SUBMISSION',
        name: 'INTERRUPTED_DURING_SUBMISSION',
      }
    );
    mocks.generateImage.mockRejectedValueOnce(submitInterrupted);

    const task = taskQueueService.createTask(
      {
        prompt: 'Provider accepts after browser timeout',
        model: managedBinding.id,
        modelRef: {
          profileId: 'new-api-creative',
          modelId: managedBinding.id,
        },
        userParams: {
          aspectRatio: '1:1',
        },
      },
      TaskType.IMAGE
    );

    await flushAsyncWork();

    const failed = taskQueueService.getTask(task.id);
    expect(failed?.status).toBe(TaskStatus.FAILED);
    expect(failed?.executionPhase).toBe(TaskExecutionPhase.SUBMITTING);
    expect(failed?.remoteId).toBeUndefined();
    expect(failed?.error?.code).toBe('INTERRUPTED_DURING_SUBMISSION');

    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(2);
    expect(mocks.generateImage.mock.calls[1]?.[0]).toMatchObject({
      taskId: task.id,
      idempotencyKey: `opentu-image-${task.id}`,
      retryAttempt: 0,
    });
  });

  it('actively resumes a recoverable failed remote video task on manual retry', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task: Task = {
      id: 'task-failed-video-resume-1',
      type: TaskType.VIDEO,
      status: TaskStatus.FAILED,
      remoteId: 'remote-video-resume-1',
      executionPhase: undefined,
      error: {
        code: 'RESUME_FAILED',
        message: 'temporary polling failure',
      },
      params: {
        prompt: 'Resume remote video',
        model: 'video-binding',
        retryAttempt: 3,
      },
      invocationRoute: {
        operation: 'video',
        providerProfileId: 'new-api-creative',
        modelId: 'video-binding',
        binding: {
          protocol: 'openai.async.video',
          requestSchema: 'openai.video.form-input-reference',
          submitPath: '/videos',
          pollPathTemplate: '/videos/{taskId}',
        },
      },
      createdAt: 1,
      updatedAt: 1,
      completedAt: 2,
    };

    taskQueueService.trackExternalTask(clone(task));
    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    const resumed = taskQueueService.getTask(task.id);
    expect(resumed?.status).toBe(TaskStatus.PROCESSING);
    expect(resumed?.remoteId).toBe('remote-video-resume-1');
    expect(resumed?.params.retryAttempt).toBe(3);
    expect(resumed?.executionPhase).toBe(TaskExecutionPhase.POLLING);
    expect(resumed?.error).toBeUndefined();
    expect(mocks.generateImage).not.toHaveBeenCalled();
    expect(mocks.resumePendingTasks).toHaveBeenCalledTimes(1);
    expect(mocks.resumePendingTasks.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({
        id: task.id,
        type: TaskType.VIDEO,
        status: TaskStatus.PROCESSING,
        remoteId: 'remote-video-resume-1',
      }),
    ]);
  });

  it('actively resumes a timed-out remote video task instead of submitting a fresh provider task', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task: Task = {
      id: 'task-failed-video-timeout-1',
      type: TaskType.VIDEO,
      status: TaskStatus.FAILED,
      remoteId: 'remote-video-timeout-1',
      executionPhase: undefined,
      error: {
        code: 'TIMEOUT',
        message: 'video task timed out locally',
      },
      params: {
        prompt: 'Resume timed-out remote video',
        model: 'video-binding',
        retryAttempt: 2,
      },
      invocationRoute: {
        operation: 'video',
        providerProfileId: 'new-api-creative',
        modelId: 'video-binding',
        binding: {
          protocol: 'openai.async.video',
          requestSchema: 'openai.video.form-input-reference',
          submitPath: '/videos',
          pollPathTemplate: '/videos/{taskId}',
        },
      },
      createdAt: 1,
      updatedAt: 1,
      completedAt: 2,
    };

    taskQueueService.trackExternalTask(clone(task));
    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    const resumed = taskQueueService.getTask(task.id);
    expect(resumed?.status).toBe(TaskStatus.PROCESSING);
    expect(resumed?.remoteId).toBe('remote-video-timeout-1');
    expect(resumed?.params.retryAttempt).toBe(2);
    expect(resumed?.executionPhase).toBe(TaskExecutionPhase.POLLING);
    expect(resumed?.error).toBeUndefined();
    expect(mocks.generateImage).not.toHaveBeenCalled();
    expect(mocks.resumePendingTasks).toHaveBeenCalledTimes(1);
    expect(mocks.resumePendingTasks.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({
        id: task.id,
        type: TaskType.VIDEO,
        status: TaskStatus.PROCESSING,
        remoteId: 'remote-video-timeout-1',
      }),
    ]);
  });

  it('actively resumes a timed-out remote audio task instead of submitting a fresh provider task', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const modelAdapters = await import('../model-adapters');
    vi.mocked(modelAdapters.resolveAdapterForInvocation).mockReturnValue({
      id: 'suno-audio-adapter',
      label: 'Suno Audio',
      kind: 'audio',
      generateAudio: mocks.generateAudio,
    } as any);

    const task: Task = {
      id: 'task-failed-audio-timeout-1',
      type: TaskType.AUDIO,
      status: TaskStatus.FAILED,
      remoteId: 'remote-audio-timeout-1',
      executionPhase: undefined,
      error: {
        code: 'TIMEOUT',
        message: 'audio task timed out locally',
      },
      params: {
        prompt: 'Resume timed-out remote audio',
        model: 'suno_music',
        retryAttempt: 2,
      },
      invocationRoute: {
        operation: 'audio',
        providerProfileId: 'new-api-creative',
        modelId: 'suno_music',
        binding: {
          protocol: 'tuzi.suno.music',
          requestSchema: 'tuzi.suno.music.submit',
          submitPath: '/suno/submit/music',
          pollPathTemplate: '/suno/fetch/{taskId}',
        },
      },
      createdAt: 1,
      updatedAt: 1,
      completedAt: 2,
    };

    taskQueueService.trackExternalTask(clone(task));
    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    const resumed = taskQueueService.getTask(task.id);
    expect(resumed?.status).toBe(TaskStatus.COMPLETED);
    expect(resumed?.remoteId).toBe('remote-audio-timeout-1');
    expect(resumed?.params.retryAttempt).toBe(2);
    expect(resumed?.error).toBeUndefined();
    expect(resumed?.result).toMatchObject({
      resultKind: 'lyrics',
      lyricsText: 'resumed lyrics',
      providerTaskId: 'remote-audio-timeout-1',
    });
    expect(mocks.generateAudio).not.toHaveBeenCalled();
    expect(mocks.resumeAudioPolling).toHaveBeenCalledWith(
      'remote-audio-timeout-1',
      expect.objectContaining({
        routeModel: expect.objectContaining({
          profileId: 'new-api-creative',
          modelId: 'suno_music',
        }),
      })
    );
  });

  it('waits for durable audio remoteId persistence before finalizing after onSubmitted', async () => {
    let releaseRemoteSave: (() => void) | undefined;
    let remoteSaveStarted = false;
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED], {
        saveTaskImpl: async (task, storage) => {
          if (
            task.id === 'task-image-edit-1' &&
            task.status === TaskStatus.PROCESSING &&
            task.remoteId === 'remote-audio-barrier-1' &&
            !remoteSaveStarted
          ) {
            remoteSaveStarted = true;
            await new Promise<void>((resolve) => {
              releaseRemoteSave = resolve;
            });
          }
          storage.set(task.id, clone(task));
        },
      });
    const modelAdapters = await import('../model-adapters');
    vi.mocked(modelAdapters.resolveAdapterForInvocation).mockReturnValue({
      id: 'suno-audio-adapter',
      label: 'Suno Audio',
      kind: 'audio',
      generateAudio: mocks.generateAudio,
    } as any);
    mocks.generateAudio.mockImplementationOnce(async (_context, request) => {
      await request.onSubmitted?.('remote-audio-barrier-1');
      return {
        url: '',
        resultKind: 'lyrics',
        format: 'lyrics',
        lyricsText: 'generated lyrics',
        providerTaskId: 'remote-audio-barrier-1',
      };
    });

    const task = taskQueueService.createTask(
      {
        prompt: 'Audio durable barrier',
        model: 'suno_music',
      },
      TaskType.AUDIO
    );

    await flushAsyncWork();

    expect(remoteSaveStarted).toBe(true);
    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.PROCESSING
    );
    expect(taskQueueService.getTask(task.id)?.result).toBeUndefined();
    expect(storedTasks.get(task.id)?.remoteId).toBeUndefined();

    releaseRemoteSave?.();
    await flushAsyncWork();

    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.COMPLETED
    );
    expect(taskQueueService.getTask(task.id)?.remoteId).toBe(
      'remote-audio-barrier-1'
    );
    expect(storedTasks.get(task.id)?.remoteId).toBe('remote-audio-barrier-1');
  });

  it('serializes fire-and-forget persistence so an older slow save cannot overwrite terminal storage', async () => {
    let releaseProcessingSave: (() => void) | undefined;
    const { taskQueueService, storedTasks } = await setupTaskQueueServiceHarness(
      [TaskStatus.COMPLETED],
      {
        saveTaskImpl: async (task, storage) => {
          if (task.status === TaskStatus.PROCESSING && !releaseProcessingSave) {
            await new Promise<void>((resolve) => {
              releaseProcessingSave = resolve;
            });
          }
          storage.set(task.id, clone(task));
        },
      }
    );

    const taskId = 'task-save-order-1';
    taskQueueService.updateTaskStatus(taskId, TaskStatus.PROCESSING, {
      type: TaskType.IMAGE,
      params: {
        prompt: 'Slow processing save',
        model: 'gpt-image-2',
        size: '1x1',
      },
      createdAt: 1,
      startedAt: 1,
    });
    taskQueueService.updateTaskStatus(taskId, TaskStatus.COMPLETED, {
      result: {
        url: 'https://example.com/out.png',
        format: 'png',
        size: 1,
      },
      completedAt: 2,
    });

    await flushAsyncWork();
    expect(releaseProcessingSave).toBeTypeOf('function');

    releaseProcessingSave?.();
    await flushAsyncWork();

    expect(storedTasks.get(taskId)?.status).toBe(TaskStatus.COMPLETED);
    expect(storedTasks.get(taskId)?.result).toMatchObject({
      url: 'https://example.com/out.png',
    });
  }, 15000);

  it('serializes automatic task persistence around slow processing writes', async () => {
    let releaseProcessingSave: (() => void) | undefined;
    const { taskQueueService, storedTasks } = await setupTaskQueueServiceHarness(
      [TaskStatus.COMPLETED],
      {
        saveTaskImpl: async (task, storage) => {
          if (task.status === TaskStatus.PROCESSING && !releaseProcessingSave) {
            storage.set(task.id, clone(task));
            await new Promise<void>((resolve) => {
              releaseProcessingSave = resolve;
            });
            return;
          }
          storage.set(task.id, clone(task));
        },
      }
    );

    const task = taskQueueService.createTask(
      {
        prompt: 'Slow processing save',
        model: 'gpt-image-2',
        size: '1x1',
      },
      TaskType.IMAGE
    );

    await flushAsyncWork();
    expect(releaseProcessingSave).toBeTypeOf('function');

    releaseProcessingSave?.();
    await flushAsyncWork();

    expect(storedTasks.get(task.id)?.status).toBe(TaskStatus.COMPLETED);
    expect(storedTasks.get(task.id)?.result).toMatchObject({
      url: 'https://example.com/out.png',
    });
  }, 15000);

  it('allows explicit manual retry for completed image tasks and clears stale results', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
      TaskStatus.COMPLETED,
    ]);

    const task = taskQueueService.createTask(
      {
        prompt: 'Regenerate completed image',
        model: 'gpt-image-2',
        size: '1x1',
      },
      TaskType.IMAGE
    );

    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.COMPLETED
    );
    expect(taskQueueService.getTask(task.id)?.result).toBeTruthy();

    taskQueueService.retryTask(task.id, { allowCompleted: true });

    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.PROCESSING
    );
    expect(taskQueueService.getTask(task.id)?.result).toBeUndefined();
    expect(taskQueueService.getTask(task.id)?.insertedToCanvas).toBe(false);

    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(2);
    expect(mocks.generateImage.mock.calls[1]?.[0]).toMatchObject({
      prompt: 'Regenerate completed image',
      model: 'gpt-image-2',
      size: '1x1',
    });
  });

  it('rehydrates stripped edit params after restoreTasks before retry execution', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);

    const restoredTask: Task = {
      id: 'task-image-edit-1',
      type: TaskType.IMAGE,
      status: TaskStatus.FAILED,
      params: {
        prompt: 'Retry restored edit',
        model: 'gpt-image-2',
        size: '1x1',
        generationMode: 'image_to_image',
        referenceImages: ['data:image/png;base64,restored-source'],
        maskImage: 'data:image/png;base64,restored-mask',
      },
      createdAt: 1,
      updatedAt: 1,
      error: {
        code: 'EXECUTION_ERROR',
        message: 'Image generation failed',
      },
    };

    storedTasks.set(restoredTask.id, clone(restoredTask));

    taskQueueService.restoreTasks([clone(restoredTask)]);

    expect(
      taskQueueService.getTask(restoredTask.id)?.params.referenceImages
    ).toBeUndefined();

    taskQueueService.retryTask(restoredTask.id);
    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(mocks.generateImage.mock.calls[0]?.[0]).toMatchObject({
      generationMode: 'image_to_image',
      referenceImages: ['data:image/png;base64,restored-source'],
      maskImage: 'data:image/png;base64,restored-mask',
    });
  });

  it('emits taskCreated for every restored active image task so each can resume', async () => {
    const { taskQueueService } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const restoredA: Task = {
      id: 'task-restore-active-a',
      type: TaskType.IMAGE,
      status: TaskStatus.PROCESSING,
      remoteId: 'remote-a',
      executionPhase: TaskExecutionPhase.POLLING,
      params: {
        prompt: 'Resume A',
        model: 'gpt-image-2',
        creativeManaged: true,
        userParams: {},
      },
      createdAt: 1,
      updatedAt: 1,
      startedAt: 1,
    };
    const restoredB: Task = {
      ...clone(restoredA),
      id: 'task-restore-active-b',
      remoteId: 'remote-b',
      params: {
        ...restoredA.params,
        prompt: 'Resume B',
      },
    };
    const createdTaskIds: string[] = [];
    const subscription = taskQueueService
      .observeTaskUpdates()
      .subscribe((event) => {
        if (event.type === 'taskCreated') {
          createdTaskIds.push(event.task.id);
        }
      });

    taskQueueService.restoreTasks([clone(restoredA), clone(restoredB)]);

    expect(createdTaskIds).toEqual([
      'task-restore-active-a',
      'task-restore-active-b',
    ]);

    subscription.unsubscribe();
  });

  it('replays a submit-interrupted Creative managed image task with the original idempotency key', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const restored: Task = {
      id: 'task-submit-refresh-managed',
      type: TaskType.IMAGE,
      status: TaskStatus.PROCESSING,
      executionPhase: TaskExecutionPhase.SUBMITTING,
      params: {
        prompt: 'Resume submit',
        model: 'managed-image-binding',
        creativeManaged: true,
        userParams: {},
      },
      invocationRoute: {
        operation: 'image',
        modelId: 'managed-image-binding',
        providerProfileId: 'new-api-creative',
        binding: {
          protocol: 'session-broker',
          requestSchema: 'new-api.creative.image.task',
          submitPath: '/images/tasks',
          pollPathTemplate: '/images/tasks/{taskId}',
        },
      },
      createdAt: 1,
      updatedAt: 1,
      startedAt: 1,
    };

    taskQueueService.restoreTasks([clone(restored)]);
    taskQueueService.resumeSubmitInterruptedTask(restored.id);
    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(mocks.generateImage.mock.calls[0]?.[0]).toMatchObject({
      taskId: restored.id,
      prompt: 'Resume submit',
      model: 'managed-image-binding',
      creativeManaged: true,
      userParams: {},
      idempotencyKey: `opentu-image-${restored.id}`,
      retryAttempt: 0,
    });
    expect(taskQueueService.getTask(restored.id)?.status).toBe(
      TaskStatus.COMPLETED
    );
  });

  it('keeps a cancelled active task from being overwritten by late executor completion', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    let finishExecutor!: () => void;
    let capturedSignal: AbortSignal | undefined;

    mocks.generateImage.mockImplementationOnce(async (_params, options) => {
      capturedSignal = options?.signal;
      await new Promise<void>((resolve) => {
        finishExecutor = resolve;
      });

      const storedTask = storedTasks.get('task-image-edit-1');
      storedTasks.set('task-image-edit-1', {
        ...storedTask,
        status: TaskStatus.COMPLETED,
        progress: 100,
        result: {
          url: 'https://example.com/late.png',
          format: 'png',
          size: 1,
        },
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
    });

    const task = taskQueueService.createTask(
      {
        prompt: 'Cancel this image',
        model: 'gpt-image-2',
        size: '1x1',
      },
      TaskType.IMAGE
    );

    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(capturedSignal?.aborted).toBe(false);

    taskQueueService.cancelTask(task.id);

    expect(capturedSignal?.aborted).toBe(true);
    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.CANCELLED
    );

    finishExecutor();
    await flushAsyncWork();

    expect(mocks.waitForTaskCompletion).not.toHaveBeenCalled();
    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.CANCELLED
    );
    expect(storedTasks.get(task.id)?.status).toBe(TaskStatus.CANCELLED);
  });

  it('keeps a timed-out failed task from being overwritten by late executor completion', async () => {
    const { taskQueueService, storedTasks, mocks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    let finishExecutor!: () => void;
    let capturedSignal: AbortSignal | undefined;

    mocks.generateImage.mockImplementationOnce(async (_params, options) => {
      capturedSignal = options?.signal;
      await new Promise<void>((resolve) => {
        finishExecutor = resolve;
      });
    });

    const task = taskQueueService.createTask(
      {
        prompt: 'Timeout this image',
        model: 'gpt-image-2',
        size: '1x1',
      },
      TaskType.IMAGE
    );

    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(capturedSignal?.aborted).toBe(false);

    taskQueueService.abortTaskExecution(task.id);
    taskQueueService.updateTaskStatus(task.id, TaskStatus.FAILED, {
      error: {
        code: 'TIMEOUT',
        message: '任务执行超时',
      },
    });

    expect(capturedSignal?.aborted).toBe(true);
    expect(taskQueueService.getTask(task.id)?.status).toBe(TaskStatus.FAILED);

    finishExecutor();
    await flushAsyncWork();

    expect(mocks.waitForTaskCompletion).not.toHaveBeenCalled();
    expect(taskQueueService.getTask(task.id)?.status).toBe(TaskStatus.FAILED);
    expect(storedTasks.get(task.id)?.status).toBe(TaskStatus.FAILED);
  }, 15000);

  it('starts a fresh execution when retrying before the old timed-out executor releases its slot', async () => {
    const { taskQueueService, mocks } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    let releaseOldExecutor!: () => void;
    let capturedOldSignal: AbortSignal | undefined;

    mocks.generateImage.mockImplementationOnce(async (_params, options) => {
      capturedOldSignal = options?.signal;
      await new Promise<void>((resolve) => {
        releaseOldExecutor = resolve;
      });
    });

    const task = taskQueueService.createTask(
      {
        prompt: 'Retry while old timeout is still unwinding',
        model: 'gpt-image-2',
        size: '1x1',
      },
      TaskType.IMAGE
    );

    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(capturedOldSignal?.aborted).toBe(false);

    taskQueueService.abortTaskExecution(task.id);
    taskQueueService.updateTaskStatus(task.id, TaskStatus.FAILED, {
      error: {
        code: 'TIMEOUT',
        message: '任务执行超时',
      },
    });

    expect(capturedOldSignal?.aborted).toBe(true);
    expect(taskQueueService.getTask(task.id)?.status).toBe(TaskStatus.FAILED);

    taskQueueService.retryTask(task.id);
    await flushAsyncWork();

    expect(mocks.generateImage).toHaveBeenCalledTimes(2);
    expect(mocks.generateImage.mock.calls[1]?.[0]).toMatchObject({
      prompt: 'Retry while old timeout is still unwinding',
      retryAttempt: 1,
    });

    releaseOldExecutor();
    await flushAsyncWork();

    expect(taskQueueService.getTask(task.id)?.status).toBe(
      TaskStatus.COMPLETED
    );
  }, 15000);

  it('emits storage sync updates when completed result or insertion flag changes without status progress changes', async () => {
    const { taskQueueService } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task: Task = {
      id: 'task-storage-sync-1',
      type: TaskType.IMAGE,
      status: TaskStatus.COMPLETED,
      progress: 100,
      params: {
        prompt: 'Sync completed storage task',
        autoInsertToCanvas: true,
      },
      createdAt: 1,
      updatedAt: 1,
    };
    const updatedTasks: Task[] = [];

    taskQueueService.trackExternalTask(clone(task));
    const subscription = taskQueueService
      .observeTaskUpdates()
      .subscribe((event) => {
        if (event.type === 'taskUpdated') {
          updatedTasks.push(event.task);
        }
      });

    taskQueueService.syncTaskFromStorage(task.id, {
      status: TaskStatus.COMPLETED,
      progress: 100,
      completedAt: 2,
      result: {
        url: 'https://example.com/storage-result.png',
        format: 'png',
        size: 1,
      },
    });
    taskQueueService.syncTaskFromStorage(task.id, {
      status: TaskStatus.COMPLETED,
      progress: 100,
      insertedToCanvas: true,
    });

    expect(updatedTasks).toHaveLength(2);
    expect(taskQueueService.getTask(task.id)?.result?.url).toBe(
      'https://example.com/storage-result.png'
    );
    expect(taskQueueService.getTask(task.id)?.insertedToCanvas).toBe(true);

    subscription.unsubscribe();
  });

  it('ignores stale storage sync updates from an older retry attempt', async () => {
    const { taskQueueService } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task: Task = {
      id: 'task-storage-sync-stale-attempt-1',
      type: TaskType.IMAGE,
      status: TaskStatus.PROCESSING,
      remoteId: 'remote-new-attempt',
      params: {
        prompt: 'Retry should not be overwritten by old storage',
        retryAttempt: 1,
      },
      createdAt: 1,
      updatedAt: 200,
      startedAt: 200,
      executionPhase: TaskExecutionPhase.SUBMITTING,
    };
    const updatedTasks: Task[] = [];

    taskQueueService.trackExternalTask(clone(task));
    const subscription = taskQueueService
      .observeTaskUpdates()
      .subscribe((event) => {
        if (event.type === 'taskUpdated') {
          updatedTasks.push(event.task);
        }
      });

    taskQueueService.syncTaskFromStorage(task.id, {
      status: TaskStatus.COMPLETED,
      remoteId: 'remote-old-attempt',
      startedAt: 100,
      completedAt: 150,
      params: {
        prompt: 'Retry should not be overwritten by old storage',
        retryAttempt: 0,
      },
      result: {
        url: 'https://example.com/stale-result.png',
        format: 'png',
        size: 1,
      },
    });

    const current = taskQueueService.getTask(task.id);
    expect(updatedTasks).toHaveLength(0);
    expect(current?.status).toBe(TaskStatus.PROCESSING);
    expect(current?.remoteId).toBe('remote-new-attempt');
    expect(current?.startedAt).toBe(200);
    expect(current?.params.retryAttempt).toBe(1);
    expect(current?.result).toBeUndefined();

    subscription.unsubscribe();
  }, 15000);

  it('ignores stale storage sync updates from an older updatedAt in the same retry attempt', async () => {
    const { taskQueueService } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task: Task = {
      id: 'task-storage-sync-stale-updated-at-1',
      type: TaskType.IMAGE,
      status: TaskStatus.PROCESSING,
      remoteId: 'remote-current-attempt',
      params: {
        prompt: 'Old storage snapshot should not overwrite current task',
        retryAttempt: 1,
      },
      createdAt: 1,
      updatedAt: 300,
      startedAt: 200,
      executionPhase: TaskExecutionPhase.POLLING,
    };
    const updatedTasks: Task[] = [];

    taskQueueService.trackExternalTask(clone(task));
    const subscription = taskQueueService
      .observeTaskUpdates()
      .subscribe((event) => {
        if (event.type === 'taskUpdated') {
          updatedTasks.push(event.task);
        }
      });

    taskQueueService.syncTaskFromStorage(task.id, {
      status: TaskStatus.COMPLETED,
      remoteId: 'remote-old-snapshot',
      startedAt: 200,
      updatedAt: 100,
      completedAt: 150,
      params: {
        prompt: 'Old storage snapshot should not overwrite current task',
        retryAttempt: 1,
      },
      result: {
        url: 'https://example.com/old-snapshot.png',
        format: 'png',
        size: 1,
      },
    });

    const current = taskQueueService.getTask(task.id);
    expect(updatedTasks).toHaveLength(0);
    expect(current?.status).toBe(TaskStatus.PROCESSING);
    expect(current?.remoteId).toBe('remote-current-attempt');
    expect(current?.updatedAt).toBe(300);
    expect(current?.result).toBeUndefined();

    subscription.unsubscribe();
  }, 15000);

  it('does not let restoreTasks overwrite an in-memory newer retry attempt with a stale stored attempt', async () => {
    const { taskQueueService } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const currentTask: Task = {
      id: 'task-restore-stale-attempt-1',
      type: TaskType.IMAGE,
      status: TaskStatus.PROCESSING,
      remoteId: 'remote-current-retry',
      params: {
        prompt: 'Restore should not overwrite a newer retry',
        retryAttempt: 1,
      },
      createdAt: 1,
      updatedAt: 200,
      startedAt: 200,
      executionPhase: TaskExecutionPhase.POLLING,
    };
    const staleStoredTask: Task = {
      ...clone(currentTask),
      status: TaskStatus.COMPLETED,
      remoteId: 'remote-old-retry',
      params: {
        prompt: 'Restore should not overwrite a newer retry',
        retryAttempt: 0,
      },
      updatedAt: 300,
      startedAt: 100,
      completedAt: 150,
      progress: 100,
      result: {
        url: 'https://example.com/old-restore.png',
        format: 'png',
        size: 1,
      },
    };
    const createdTaskIds: string[] = [];

    taskQueueService.trackExternalTask(clone(currentTask));
    const subscription = taskQueueService
      .observeTaskUpdates()
      .subscribe((event) => {
        if (event.type === 'taskCreated') {
          createdTaskIds.push(event.task.id);
        }
      });

    taskQueueService.restoreTasks([clone(staleStoredTask)]);

    const current = taskQueueService.getTask(currentTask.id);
    expect(createdTaskIds).toHaveLength(0);
    expect(current?.status).toBe(TaskStatus.PROCESSING);
    expect(current?.remoteId).toBe('remote-current-retry');
    expect(current?.params.retryAttempt).toBe(1);
    expect(current?.startedAt).toBe(200);
    expect(current?.result).toBeUndefined();

    subscription.unsubscribe();
  }, 15000);

  it('persists invocation route for externally tracked video tasks', async () => {
    const { taskQueueService, storedTasks } =
      await setupTaskQueueServiceHarness([TaskStatus.COMPLETED]);
    const task: Task = {
      id: 'task-video-route-1',
      type: TaskType.VIDEO,
      status: TaskStatus.PROCESSING,
      remoteId: 'remote-video-1',
      executionPhase: TaskExecutionPhase.POLLING,
      params: {
        prompt: 'Resume original provider',
        model: 'happyhorse-1.0-t2v',
        modelRef: {
          profileId: 'happyhorse-profile',
          modelId: 'happyhorse-1.0-t2v',
        },
      },
      createdAt: 1,
      updatedAt: 1,
    };

    taskQueueService.trackExternalTask(clone(task));
    await flushAsyncWork();

    const stored = storedTasks.get(task.id);
    expect(stored?.remoteId).toBe('remote-video-1');
    expect(stored?.executionPhase).toBe('polling');
    expect(stored?.params.modelRef).toEqual({
      profileId: 'happyhorse-profile',
      modelId: 'happyhorse-1.0-t2v',
    });
    expect(stored?.invocationRoute).toMatchObject({
      operation: 'video',
      providerProfileId: 'happyhorse-profile',
      modelId: 'happyhorse-1.0-t2v',
      binding: {
        id: 'happyhorse-profile:happyhorse-1.0-t2v:video',
        pollPathTemplate: '/videos/{taskId}',
      },
    });
  });

  it('emits storage sync updates when invocation route changes', async () => {
    const { taskQueueService } = await setupTaskQueueServiceHarness([
      TaskStatus.COMPLETED,
    ]);
    const task: Task = {
      id: 'task-video-route-sync-1',
      type: TaskType.VIDEO,
      status: TaskStatus.PROCESSING,
      params: {
        prompt: 'Sync route',
        model: 'happyhorse-1.0-t2v',
      },
      createdAt: 1,
      updatedAt: 1,
    };
    const updatedTasks: Task[] = [];

    taskQueueService.trackExternalTask(clone(task));
    const subscription = taskQueueService
      .observeTaskUpdates()
      .subscribe((event) => {
        if (event.type === 'taskUpdated') {
          updatedTasks.push(event.task);
        }
      });

    taskQueueService.syncTaskFromStorage(task.id, {
      invocationRoute: {
        operation: 'video',
        providerProfileId: 'happyhorse-profile',
        modelId: 'happyhorse-1.0-t2v',
        binding: {
          id: 'happyhorse-profile:happyhorse-1.0-t2v:video',
          pollPathTemplate: '/videos/{taskId}',
        },
      },
    });

    expect(updatedTasks).toHaveLength(1);
    expect(
      taskQueueService.getTask(task.id)?.invocationRoute?.providerProfileId
    ).toBe('happyhorse-profile');

    subscription.unsubscribe();
  });
});
