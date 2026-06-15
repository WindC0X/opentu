import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskType } from '../../types/shared/core.types';
import { TaskExecutionPhase, TaskStatus } from '../../types/task.types';
import type { Task } from '../../types/shared/core.types';

const createTaskMock = vi.fn(async () => undefined);
const trackExternalTaskMock = vi.fn();
const syncTaskFromStorageMock = vi.fn();
const generateImageMock = vi.fn(async () => undefined);
const waitForTaskCompletionMock = vi.fn();
const waitForInitializationMock = vi.fn(async () => undefined);
const hasInvocationRouteCredentialsMock = vi.fn(() => true);
const getFallbackExecutorMock = vi.fn(() => ({
  generateImage: generateImageMock,
}));

vi.mock('../media-executor/task-storage-writer', () => ({
  taskStorageWriter: {
    createTask: createTaskMock,
  },
}));

vi.mock('../media-executor', () => ({
  executorFactory: {
    getFallbackExecutor: getFallbackExecutorMock,
    getExecutor: vi.fn(),
  },
  waitForTaskCompletion: waitForTaskCompletionMock,
}));

vi.mock('../../utils/settings-manager', () => ({
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'default',
  settingsManager: {
    waitForInitialization: waitForInitializationMock,
    addListener: vi.fn(() => undefined),
  },
  hasInvocationRouteCredentials: hasInvocationRouteCredentialsMock,
  createModelRef: (profileId: string, modelId: string) => ({
    profileId,
    modelId,
  }),
  resolveInvocationRoute: (
    operation: string,
    requestedModel?: string | { profileId?: string; modelId?: string } | null
  ) => {
    const modelRef =
      requestedModel && typeof requestedModel === 'object'
        ? requestedModel
        : null;
    const modelId =
      modelRef?.modelId ||
      (typeof requestedModel === 'string' ? requestedModel : '') ||
      'gpt-image-2';
    return {
      operation,
      profileId: modelRef?.profileId || 'default',
      modelId,
      modelRef: modelRef
        ? { profileId: modelRef.profileId || 'default', modelId }
        : null,
      baseUrl: '/creative/relay/v1',
      apiKey: '',
      authType: 'session-broker',
      providerType: 'openai-compatible',
      binding: null,
    };
  },
  providerPricingCacheSettings: {
    get: vi.fn(() => []),
    update: vi.fn(async () => undefined),
  },
  providerCatalogsSettings: {
    get: vi.fn(() => []),
    update: vi.fn(async () => undefined),
    addListener: vi.fn(() => undefined),
  },
  providerProfilesSettings: {
    get: vi.fn(() => []),
    update: vi.fn(async () => undefined),
  },
  invocationPresetsSettings: {
    get: vi.fn(() => []),
    update: vi.fn(async () => undefined),
    addListener: vi.fn(() => undefined),
  },
}));

vi.mock('../task-queue-service', () => ({
  taskQueueService: {
    trackExternalTask: trackExternalTaskMock,
    syncTaskFromStorage: syncTaskFromStorageMock,
  },
}));

vi.mock('../../utils/task-utils', () => ({
  generateTaskId: () => 'task-image-1',
}));

describe('image-generation-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    waitForTaskCompletionMock.mockResolvedValue({
      success: true,
      task: {
        id: 'task-image-1',
        type: TaskType.IMAGE,
        status: TaskStatus.COMPLETED,
        params: { prompt: 'Edit this' },
        createdAt: 1,
        updatedAt: 1,
        result: {
          url: 'https://example.com/out.png',
          format: 'png',
          size: 1,
        },
      } satisfies Task,
    });
  });

  it('persists the full image contract for edit-capable GPT requests', async () => {
    const { generateImage } = await import(
      '../media-generation/image-generation-service'
    );

    await generateImage('Edit this', {
      forceMainThread: true,
      model: 'gpt-image-2',
      size: '16x9',
      resolution: '2k',
      quality: 'high',
      generationMode: 'image_to_image',
      referenceImages: ['https://example.com/reference.png'],
      maskImage: 'https://example.com/mask.png',
      inputFidelity: 'high',
      background: 'transparent',
      outputFormat: 'png',
      outputCompression: 80,
      uploadedImages: [{ url: 'https://example.com/reference.png' }],
      count: 2,
    });

    expect(createTaskMock).toHaveBeenCalledWith(
      'task-image-1',
      'image',
      expect.objectContaining({
        prompt: 'Edit this',
        model: 'gpt-image-2',
        size: '16x9',
        resolution: '2k',
        quality: 'high',
        generationMode: 'image_to_image',
        referenceImages: ['https://example.com/reference.png'],
        maskImage: 'https://example.com/mask.png',
        inputFidelity: 'high',
        background: 'transparent',
        outputFormat: 'png',
        outputCompression: 80,
        uploadedImages: [{ url: 'https://example.com/reference.png' }],
        count: 2,
        params: {
          resolution: '2k',
          quality: 'high',
          n: 2,
        },
      }),
      expect.any(Object)
    );

    expect(trackExternalTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-image-1',
        type: TaskType.IMAGE,
        status: TaskStatus.PROCESSING,
        executionPhase: TaskExecutionPhase.SUBMITTING,
        params: expect.objectContaining({
          resolution: '2k',
          quality: 'high',
          generationMode: 'image_to_image',
          referenceImages: ['https://example.com/reference.png'],
          maskImage: 'https://example.com/mask.png',
          params: {
            resolution: '2k',
            quality: 'high',
            n: 2,
          },
        }),
      })
    );

    expect(generateImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-image-1',
      }),
      expect.objectContaining({
        signal: undefined,
      })
    );
  });

  it('passes schema-backed userParams to executor without legacy adapter params', async () => {
    const { generateImage } = await import(
      '../media-generation/image-generation-service'
    );

    await generateImage('Draw a cat', {
      forceMainThread: true,
      model: 'mock:gpt-image-2:preview',
      size: '16x9',
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

    expect(createTaskMock).toHaveBeenCalledWith(
      'task-image-1',
      'image',
      expect.objectContaining({
        model: 'mock:gpt-image-2:preview',
        size: undefined,
        resolution: undefined,
        quality: undefined,
        params: undefined,
        userParams: {
          size: '1024x1024',
          seed: 42,
          oversea: true,
        },
      }),
      expect.any(Object)
    );

    expect(generateImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-image-1',
        model: 'mock:gpt-image-2:preview',
        size: undefined,
        resolution: undefined,
        quality: undefined,
        params: undefined,
        userParams: {
          size: '1024x1024',
          seed: 42,
          oversea: true,
        },
      }),
      expect.any(Object)
    );
  });
});
