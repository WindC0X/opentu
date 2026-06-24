import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskExecutionPhase, TaskStatus, TaskType } from '../../types/task.types';
import type { Task } from '../../types/task.types';

const createTaskMock = vi.fn(async () => undefined);
const trackExternalTaskMock = vi.fn();
const syncTaskFromStorageMock = vi.fn();
const generateVideoMock = vi.fn(async () => undefined);
const waitForTaskCompletionMock = vi.fn();
const waitForInitializationMock = vi.fn(async () => undefined);
const hasInvocationRouteCredentialsMock = vi.fn(() => true);
const getFallbackExecutorMock = vi.fn(() => ({
  generateVideo: generateVideoMock,
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
      'veo3';
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
  generateTaskId: () => 'task-video-1',
}));

describe('video-generation-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    waitForTaskCompletionMock.mockResolvedValue({
      success: true,
      task: {
        id: 'task-video-1',
        type: TaskType.VIDEO,
        status: TaskStatus.COMPLETED,
        params: { prompt: 'Animate this' },
        createdAt: 1,
        updatedAt: 1,
        result: {
          url: 'https://example.com/out.mp4',
          format: 'mp4',
          size: 1,
        },
      } satisfies Task,
    });
  });

  it('persists and tracks video reference inputs needed for retry and refresh resume', async () => {
    const { generateVideo } = await import(
      '../media-generation/video-generation-service'
    );

    await generateVideo('Animate this', {
      forceMainThread: true,
      model: 'veo3',
      duration: 8,
      size: '1280x720',
      inputReference: '/__aitu_cache__/image/primary.png',
      inputReferences: [
        { type: 'image', url: '/__aitu_cache__/image/primary.png' },
      ],
      referenceImages: ['/__aitu_cache__/image/legacy.png'],
      params: {
        aspect_ratio: '16:9',
      },
    });

    expect(createTaskMock).toHaveBeenCalledWith(
      'task-video-1',
      'video',
      expect.objectContaining({
        prompt: 'Animate this',
        model: 'veo3',
        duration: 8,
        size: '1280x720',
        inputReference: '/__aitu_cache__/image/primary.png',
        inputReferences: [
          { type: 'image', url: '/__aitu_cache__/image/primary.png' },
        ],
        referenceImages: ['/__aitu_cache__/image/legacy.png'],
        params: {
          aspect_ratio: '16:9',
        },
      }),
      expect.any(Object)
    );

    expect(trackExternalTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'task-video-1',
        type: TaskType.VIDEO,
        status: TaskStatus.PROCESSING,
        executionPhase: TaskExecutionPhase.SUBMITTING,
        params: expect.objectContaining({
          duration: 8,
          size: '1280x720',
          inputReference: '/__aitu_cache__/image/primary.png',
          inputReferences: [
            { type: 'image', url: '/__aitu_cache__/image/primary.png' },
          ],
          referenceImages: ['/__aitu_cache__/image/legacy.png'],
          params: {
            aspect_ratio: '16:9',
          },
        }),
      })
    );

    expect(generateVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 'task-video-1',
        inputReference: '/__aitu_cache__/image/primary.png',
        inputReferences: [
          { type: 'image', url: '/__aitu_cache__/image/primary.png' },
        ],
        referenceImages: ['/__aitu_cache__/image/legacy.png'],
      }),
      expect.objectContaining({
        signal: undefined,
      })
    );
  });
});
