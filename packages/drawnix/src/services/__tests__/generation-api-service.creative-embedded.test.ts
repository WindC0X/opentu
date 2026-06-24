import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskType } from '../../types/task.types';
import {
  ModelVendor,
  type ModelConfig,
  type ModelType,
} from '../../constants/model-config';

const mocks = vi.hoisted(() => ({
  adapterGenerateImage: vi.fn(),
  adapterGenerateAudio: vi.fn(),
  resolveAdapterForInvocation: vi.fn(),
  getAdapterContextFromSettings: vi.fn(),
  resumeAudioPolling: vi.fn(),
  extractAudioGenerationResult: vi.fn(),
  getSelectableModels: vi.fn<(type?: ModelType) => ModelConfig[]>(() => []),
  getPinnedSelectableModel:
    vi.fn<
      (type: ModelType, modelId?: string | null) => ModelConfig | null
    >(() => null),
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
  audioAPIService: {
    resumePolling: mocks.resumeAudioPolling,
  },
  extractAudioGenerationResult: mocks.extractAudioGenerationResult,
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

const managedAudioModel: ModelConfig = {
  id: 'newapi-audio',
  label: 'New API Audio',
  type: 'audio',
  vendor: ModelVendor.SUNO,
  sourceProfileId: 'new-api-creative',
  selectionKey: 'new-api-creative::newapi-audio',
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
    mocks.adapterGenerateAudio.mockResolvedValue({
      url: '',
      format: 'lyrics',
      resultKind: 'lyrics',
      lyricsText: 'hello',
      providerTaskId: 'audio-task-1',
    });
    mocks.resumeAudioPolling.mockResolvedValue({
      taskId: 'remote-audio-1',
      status: 'complete',
      action: 'lyrics',
      clips: [],
      lyrics: { text: 'resumed lyrics' },
      raw: {},
    });
    mocks.extractAudioGenerationResult.mockReturnValue({
      url: '',
      format: 'lyrics',
      resultKind: 'lyrics',
      lyricsText: 'resumed lyrics',
      providerTaskId: 'remote-audio-1',
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

  it('treats an explicit empty runtime parameterSchema as schema-backed on the direct image path', async () => {
    const schemaBackedModel: ModelConfig = {
      ...managedImageModel,
      id: 'schema-empty-image',
      label: 'Schema Empty Image',
      creativeManaged: true,
      parameterSchema: [],
    };
    mocks.getSelectableModels.mockReturnValue([schemaBackedModel]);
    mocks.getPinnedSelectableModel.mockImplementation((_type, modelId) =>
      modelId === schemaBackedModel.id ? schemaBackedModel : null
    );
    const { setRuntimeModelConfigs } = await import(
      '../../constants/model-config'
    );
    setRuntimeModelConfigs([schemaBackedModel]);
    const { generationAPIService } = await import('../generation-api-service');

    await expect(
      generationAPIService.generate(
        'schema-empty-direct-path',
        {
          prompt: 'draw a cat',
          model: schemaBackedModel.id,
          size: '1024x1024',
          quality: 'high',
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

  it('suppresses stale legacy audio generate callbacks after retry attempt changes', async () => {
    let currentTask: any = {
      id: 'audio-stale-generate',
      type: TaskType.AUDIO,
      status: 'processing',
      params: { prompt: 'sing', retryAttempt: 0 },
      createdAt: 1,
      updatedAt: 1,
      startedAt: 100,
    };
    mocks.getSelectableModels.mockImplementation((type?: ModelType) =>
      type === 'audio' ? [managedAudioModel] : [managedImageModel]
    );
    mocks.getPinnedSelectableModel.mockImplementation((_type, modelId) =>
      modelId === managedAudioModel.id ? managedAudioModel : null
    );
    mocks.getTask.mockImplementation(() => currentTask);
    mocks.resolveAdapterForInvocation.mockReturnValue({
      id: 'audio-adapter',
      label: 'Audio Adapter',
      kind: 'audio',
      generateAudio: mocks.adapterGenerateAudio,
    });
    mocks.adapterGenerateAudio.mockImplementationOnce(async (_context, request) => {
      mocks.updateTaskProgress.mockClear();
      mocks.updateTaskStatus.mockClear();
      currentTask = {
        ...currentTask,
        params: { ...currentTask.params, retryAttempt: 1 },
        startedAt: 200,
      };
      const onProgress = request.onProgress || request.params?.onProgress;
      const onSubmitted = request.onSubmitted || request.params?.onSubmitted;
      onProgress?.(45, 'PENDING');
      await onSubmitted?.('remote-audio-stale');
      return {
        url: '',
        format: 'lyrics',
        resultKind: 'lyrics',
        lyricsText: 'hello',
        providerTaskId: 'remote-audio-stale',
      };
    });
    const { generationAPIService } = await import('../generation-api-service');

    await generationAPIService.generate(
      'audio-stale-generate',
      { prompt: 'sing', model: managedAudioModel.id },
      TaskType.AUDIO
    );

    expect(mocks.updateTaskProgress).not.toHaveBeenCalled();
    expect(mocks.updateTaskStatus).not.toHaveBeenCalled();
  });

  it('suppresses stale legacy audio resume progress after retry attempt changes', async () => {
    let currentTask: any = {
      id: 'audio-stale-resume',
      type: TaskType.AUDIO,
      status: 'processing',
      remoteId: 'remote-audio-1',
      params: { prompt: 'sing', retryAttempt: 0 },
      createdAt: 1,
      updatedAt: 1,
      startedAt: 100,
    };
    mocks.getTask.mockImplementation(() => currentTask);
    mocks.resumeAudioPolling.mockImplementationOnce(async (_remoteId, options) => {
      currentTask = {
        ...currentTask,
        params: { ...currentTask.params, retryAttempt: 1 },
        startedAt: 200,
      };
      options.onProgress?.(55, 'PENDING');
      return {
        taskId: 'remote-audio-1',
        status: 'complete',
        action: 'lyrics',
        clips: [],
        lyrics: { text: 'resumed lyrics' },
        raw: {},
      };
    });
    const { generationAPIService } = await import('../generation-api-service');

    await generationAPIService.resumeAudioGeneration(
      'audio-stale-resume',
      'remote-audio-1',
      {
        profileId: 'new-api-creative',
        modelId: managedAudioModel.id,
      }
    );

    expect(mocks.updateTaskProgress).not.toHaveBeenCalled();
  });

  it('preserves TIMEOUT code when legacy audio resume reaches the local timeout', async () => {
    vi.useFakeTimers();
    mocks.resumeAudioPolling.mockImplementationOnce(
      () => new Promise(() => undefined)
    );
    const { generationAPIService } = await import('../generation-api-service');

    try {
      const resumed = generationAPIService.resumeAudioGeneration(
        'audio-resume-timeout-code',
        'remote-audio-timeout-code',
        {
          profileId: 'new-api-creative',
          modelId: managedAudioModel.id,
        }
      );
      const observed = resumed.then(
        () => null,
        (error) => error
      );

      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

      await expect(observed).resolves.toMatchObject({
        code: 'TIMEOUT',
        name: 'TIMEOUT',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
