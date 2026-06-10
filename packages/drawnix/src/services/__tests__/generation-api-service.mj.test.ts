import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskType } from '../../types/task.types';
import type { ImageModelAdapter } from '../model-adapters/types';

const mocks = vi.hoisted(() => ({
  adapterGenerateImage: vi.fn(),
  resolveAdapterForInvocation: vi.fn(),
  getAdapterContextFromSettings: vi.fn(),
  trackModelCall: vi.fn(),
  trackModelSuccess: vi.fn(),
  trackModelFailure: vi.fn(),
  trackTaskCancellation: vi.fn(),
  updateTaskProgress: vi.fn(),
  updateTaskStatus: vi.fn(),
  getTask: vi.fn(),
}));

vi.mock('../model-adapters', () => ({
  GPT_IMAGE_EDIT_REQUEST_SCHEMAS: [
    'openai.image.gpt-edit-form',
    'tuzi.image.gpt-edit-json',
  ],
  resolveAdapterForInvocation: mocks.resolveAdapterForInvocation,
  getAdapterContextFromSettings: mocks.getAdapterContextFromSettings,
}));

vi.mock('../task-queue', () => ({
  legacyTaskQueueService: {
    updateTaskProgress: mocks.updateTaskProgress,
    updateTaskStatus: mocks.updateTaskStatus,
    getTask: mocks.getTask,
  },
}));

vi.mock('../../utils/posthog-analytics', () => ({
  analytics: {
    trackModelCall: mocks.trackModelCall,
    trackModelSuccess: mocks.trackModelSuccess,
    trackModelFailure: mocks.trackModelFailure,
    trackTaskCancellation: mocks.trackTaskCancellation,
  },
}));

vi.mock('../unified-cache-service', () => ({
  unifiedCacheService: {
    getImageForAI: vi.fn(),
  },
}));

vi.mock('../async-image-api-service', () => ({
  asyncImageAPIService: {
    resumePolling: vi.fn(),
    extractUrlAndFormat: vi.fn(),
  },
}));

vi.mock('../video-api-service', () => ({
  videoAPIService: {},
}));

vi.mock('../audio-api-service', () => ({
  audioAPIService: {},
  extractAudioGenerationResult: vi.fn(),
}));

vi.mock('../task-invocation-route', () => ({
  assertTaskInvocationRouteAvailable: vi.fn(),
  createTaskInvocationRouteSnapshot: vi.fn(() => ({
    operation: 'image',
    modelId: 'mj-imagine',
  })),
  shouldUseStrictTaskInvocationRoute: vi.fn(() => false),
}));

describe('generation-api-service MJ image idempotency', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    const adapter: ImageModelAdapter = {
      id: 'mj-image-adapter',
      label: 'MJ',
      kind: 'image',
      generateImage: mocks.adapterGenerateImage,
    };

    mocks.resolveAdapterForInvocation.mockReturnValue(adapter);
    mocks.getAdapterContextFromSettings.mockReturnValue({
      baseUrl: '/creative/relay/v1',
      apiKey: '',
      authType: 'session-broker',
    });
    mocks.adapterGenerateImage.mockResolvedValue({
      url: 'https://cdn.example.com/mj.jpg',
      format: 'jpg',
    });
  });

  it('passes a stable opentu-image idempotency key from the local task id into the MJ adapter request', async () => {
    const { generationAPIService } = await import(
      '../generation-api-service'
    );

    await generationAPIService.generate(
      'local-image-task-1',
      {
        prompt: 'draw a cat',
        model: 'mj-imagine',
        params: {
          idempotencyKey: 'caller-must-not-override-local-task-id',
        },
      },
      TaskType.IMAGE
    );

    expect(mocks.adapterGenerateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        authType: 'session-broker',
        baseUrl: '/creative/relay/v1',
      }),
      expect.objectContaining({
        prompt: 'draw a cat',
        model: 'mj-imagine',
        idempotencyKey: 'opentu-image-local-image-task-1',
        params: expect.objectContaining({
          idempotencyKey: 'opentu-image-local-image-task-1',
        }),
      })
    );
  });
});
