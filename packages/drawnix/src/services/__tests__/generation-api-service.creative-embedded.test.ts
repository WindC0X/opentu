import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskType } from '../../types/task.types';
import { ModelVendor, type ModelConfig } from '../../constants/model-config';

const mocks = vi.hoisted(() => ({
  adapterGenerateImage: vi.fn(),
  resolveAdapterForInvocation: vi.fn(),
  getAdapterContextFromSettings: vi.fn(),
  getSelectableModels: vi.fn<() => ModelConfig[]>(() => []),
  getPinnedSelectableModel: vi.fn(() => null),
  trackModelCall: vi.fn(),
  trackModelSuccess: vi.fn(),
  trackModelFailure: vi.fn(),
  trackTaskCancellation: vi.fn(),
  updateTaskProgress: vi.fn(),
  updateTaskStatus: vi.fn(),
  getTask: vi.fn(),
}));

vi.mock('../creative-mode', () => ({
  CREATIVE_MANAGED_PROFILE_ID: 'new-api-creative',
  isCreativeEmbeddedMode: () => true,
}));

vi.mock('../../utils/runtime-model-discovery', () => ({
  getSelectableModels: mocks.getSelectableModels,
  getPinnedSelectableModel: mocks.getPinnedSelectableModel,
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
    modelId: 'newapi-image',
  })),
  shouldUseStrictTaskInvocationRoute: vi.fn(() => false),
}));

const managedImageModel: ModelConfig = {
  id: 'newapi-image',
  label: 'New API Image',
  type: 'image',
  vendor: ModelVendor.GPT,
  sourceProfileId: 'new-api-creative',
  selectionKey: 'new-api-creative::newapi-image',
};

describe('generation-api-service embedded Creative model guard', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.getSelectableModels.mockReturnValue([]);
    mocks.getPinnedSelectableModel.mockReturnValue(null);
    mocks.resolveAdapterForInvocation.mockReturnValue({
      id: 'image-adapter',
      label: 'Image Adapter',
      kind: 'image',
      generateImage: mocks.adapterGenerateImage,
    });
    mocks.getAdapterContextFromSettings.mockReturnValue({
      baseUrl: '/creative/relay/v1',
      apiKey: '',
      authType: 'session-broker',
    });
    mocks.adapterGenerateImage.mockResolvedValue({
      url: 'https://cdn.example.com/image.png',
      format: 'png',
    });
  });

  it('fails locally before adapter/provider calls when embedded image pool is empty', async () => {
    const { generationAPIService } = await import('../generation-api-service');

    await expect(
      generationAPIService.generate(
        'empty-image-pool',
        {
          prompt: 'draw a cat',
        },
        TaskType.IMAGE
      )
    ).rejects.toThrow(/Creative image model is unavailable/);

    expect(mocks.resolveAdapterForInvocation).not.toHaveBeenCalled();
    expect(mocks.adapterGenerateImage).not.toHaveBeenCalled();
  });



  it('rejects schema-backed userParams on the legacy adapter path', async () => {
    mocks.getSelectableModels.mockReturnValue([managedImageModel]);
    mocks.getPinnedSelectableModel.mockImplementation((_type, modelId) =>
      modelId === managedImageModel.id ? managedImageModel : null
    );
    const { generationAPIService } = await import('../generation-api-service');

    await expect(
      generationAPIService.generate(
        'schema-legacy-path',
        {
          prompt: 'draw a cat',
          model: 'newapi-image',
          userParams: { size: '1024x1024', seed: 42 },
          params: { webhook: 'https://evil.example/hook' },
        },
        TaskType.IMAGE
      )
    ).rejects.toThrow(/managed image task route/);

    expect(mocks.resolveAdapterForInvocation).not.toHaveBeenCalled();
    expect(mocks.adapterGenerateImage).not.toHaveBeenCalled();
  });
  it('replaces a missing request model with the managed default instead of a static fallback', async () => {
    mocks.getSelectableModels.mockReturnValue([managedImageModel]);
    mocks.getPinnedSelectableModel.mockImplementation((_type, modelId) =>
      modelId === managedImageModel.id ? managedImageModel : null
    );
    const { generationAPIService } = await import('../generation-api-service');

    await generationAPIService.generate(
      'default-image-model',
      {
        prompt: 'draw a cat',
      },
      TaskType.IMAGE
    );

    expect(mocks.resolveAdapterForInvocation).toHaveBeenCalledWith(
      'image',
      'newapi-image',
      {
        profileId: 'new-api-creative',
        modelId: 'newapi-image',
      },
      expect.any(Object)
    );
    expect(mocks.adapterGenerateImage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        model: 'newapi-image',
        modelRef: {
          profileId: 'new-api-creative',
          modelId: 'newapi-image',
        },
      })
    );
  });
});
