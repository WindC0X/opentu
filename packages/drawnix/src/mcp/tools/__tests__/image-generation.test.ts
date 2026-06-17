import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createQueueTask: vi.fn(),
  resolveAdapterForInvocation: vi.fn(),
  getAdapterContextFromSettings: vi.fn(),
  generateImage: vi.fn(),
}));

vi.mock('../../../constants/model-config', () => ({
  getDefaultImageModel: () => 'gpt-image-2',
  setRuntimeModelConfigs: vi.fn(),
  getStaticModelConfig: vi.fn(() => undefined),
  getAllModels: vi.fn(() => []),
  getAllModelConfigs: vi.fn(() => []),
  getCompatibleParams: (model: unknown) =>
    model === 'mock:gpt-image-2:preview'
      ? [
          { id: 'size', runtimeSchema: true },
          { id: 'seed', runtimeSchema: true },
          { id: 'oversea', runtimeSchema: true },
        ]
      : [],
  hasCreativeUserParams: (userParams?: Record<string, unknown> | null) =>
    !!userParams && Object.keys(userParams).length > 0,
  hasRuntimeParameterSchema: (model: unknown) =>
    model === 'mock:gpt-image-2:preview',
  isCreativeManagedImageTask: (value?: { creativeManaged?: unknown } | null) =>
    value?.creativeManaged === true,
  isCreativeManagedModel: (
    model: unknown,
    modelRef?: { profileId?: string } | null
  ) =>
    model === 'mock:gpt-image-2:preview' ||
    modelRef?.profileId === 'new-api-creative',
  sanitizeCreativeUserParamsForModel: (
    _model: unknown,
    rawUserParams?: Record<string, unknown> | null
  ) => {
    const params: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(rawUserParams || {})) {
      if (key === 'size' || key === 'seed' || key === 'oversea') {
        if (
          typeof value === 'string' ||
          typeof value === 'number' ||
          typeof value === 'boolean'
        ) {
          params[key] = value;
        }
      }
    }
    return params;
  },
  getFallbackDefaultModelId: () => 'gpt-image-2',
  IMAGE_PARAMS: [
    {
      id: 'size',
      options: [
        { value: '1x1', label: '1:1' },
        { value: '16x9', label: '16:9' },
        { value: '9x16', label: '9:16' },
      ],
    },
  ],
}));

vi.mock('../../../utils/settings-manager', () => ({
  LEGACY_DEFAULT_PROVIDER_PROFILE_ID: 'legacy-default',
  geminiSettings: {
    get: () => ({}),
  },
  providerCatalogsSettings: {
    get: () => [],
    addListener: () => vi.fn(),
  },
  invocationPresetsSettings: {
    get: () => [],
    addListener: () => vi.fn(),
  },
  settingsManager: {
    addListener: () => vi.fn(),
  },
}));

vi.mock('../../../utils/runtime-model-discovery', () => ({
  getFallbackDefaultModelId: () => 'gpt-image-2',
}));

vi.mock('../../../services/creative-embedded-model-guard', () => ({
  resolveCreativeEmbeddedModelForGeneration: () => null,
}));

vi.mock('../../../services/media-api/utils', () => ({
  normalizeToClosestImageSize: (size: string) => size,
}));

vi.mock('../../../services/model-adapters', () => ({
  resolveAdapterForInvocation: mocks.resolveAdapterForInvocation,
  getAdapterContextFromSettings: mocks.getAdapterContextFromSettings,
  GPT_IMAGE_EDIT_REQUEST_SCHEMAS: [
    'openai.image.gpt-edit-form',
    'tuzi.image.gpt-edit-json',
  ],
  isGPTImageEditRequestSchema: (value?: string | string[] | null) => {
    const schemas = Array.isArray(value) ? value : value ? [value] : [];
    return schemas.some(
      (schema) =>
        schema === 'openai.image.gpt-edit-form' ||
        schema === 'tuzi.image.gpt-edit-json'
    );
  },
}));

vi.mock('../shared/queue-utils', () => ({
  createQueueTask: mocks.createQueueTask,
  validatePrompt: (prompt: unknown) =>
    !prompt || typeof prompt !== 'string'
      ? { success: false, error: '缺少必填参数 prompt', type: 'error' }
      : null,
  wrapApiError: (error: any, fallbackMessage: string) => ({
    success: false,
    error: error?.message || fallbackMessage,
    type: 'error',
  }),
  toUploadedImages: (referenceImages?: string[]) =>
    referenceImages?.map((url, index) => ({
      type: 'url' as const,
      url,
      name: `reference-${index + 1}`,
    })),
}));

import { imageGenerationTool } from '../image-generation';

describe('image-generation MCP tool', () => {
  beforeEach(() => {
    mocks.createQueueTask.mockReset();
    mocks.resolveAdapterForInvocation.mockReset();
    mocks.getAdapterContextFromSettings.mockReset();
    mocks.generateImage.mockReset();

    mocks.getAdapterContextFromSettings.mockReturnValue({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      authType: 'bearer',
    });
  });

  it('routes async generation through the selected image adapter', async () => {
    mocks.resolveAdapterForInvocation.mockReturnValue({
      id: 'gpt-image-adapter',
      kind: 'image',
      generateImage: mocks.generateImage,
    });
    mocks.generateImage.mockResolvedValue({
      url: 'https://example.com/output.webp',
      urls: [
        'https://example.com/output.webp',
        'https://example.com/output-2.webp',
      ],
      format: 'webp',
    });

    const result = await imageGenerationTool.execute(
      {
        prompt: 'Create an edited image',
        model: 'gpt-image-2',
        size: '16x9',
        resolution: '2k',
        quality: 'high',
        referenceImages: ['https://example.com/input.png'],
        generationMode: 'image_edit',
        maskImage: 'https://example.com/mask.png',
        inputFidelity: 'high',
        background: 'transparent',
        outputFormat: 'png',
        outputCompression: 80,
        count: 3,
      },
      { mode: 'async' }
    );

    expect(mocks.resolveAdapterForInvocation).toHaveBeenCalledWith(
      'image',
      'gpt-image-2',
      null,
      {
        preferredRequestSchema: [
          'openai.image.gpt-edit-form',
          'tuzi.image.gpt-edit-json',
        ],
      }
    );
    expect(mocks.getAdapterContextFromSettings).toHaveBeenCalledWith(
      'image',
      'gpt-image-2',
      {
        preferredRequestSchema: [
          'openai.image.gpt-edit-form',
          'tuzi.image.gpt-edit-json',
        ],
      }
    );
    expect(mocks.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://api.openai.com/v1',
      }),
      expect.objectContaining({
        prompt: 'Create an edited image',
        model: 'gpt-image-2',
        size: '16x9',
        generationMode: 'image_edit',
        referenceImages: ['https://example.com/input.png'],
        maskImage: 'https://example.com/mask.png',
        inputFidelity: 'high',
        background: 'transparent',
        outputFormat: 'png',
        outputCompression: 80,
        params: {
          resolution: '2k',
          quality: 'high',
          n: 3,
        },
      })
    );
    expect(result).toEqual({
      success: true,
      data: {
        url: 'https://example.com/output.webp',
        urls: [
          'https://example.com/output.webp',
          'https://example.com/output-2.webp',
        ],
        format: 'webp',
        prompt: 'Create an edited image',
        size: '16x9',
      },
      type: 'image',
    });
  });

  it('passes top-level quality and resolution into queue task params', async () => {
    mocks.createQueueTask.mockReturnValue({
      success: true,
      type: 'image',
      taskId: 'task-1',
    });

    await imageGenerationTool.execute(
      {
        prompt: 'Queue this image',
        model: 'gpt-image-2',
        size: '1x1',
        resolution: '4k',
        quality: 'high',
        params: {
          foo: 'bar',
        },
      },
      { mode: 'queue' }
    );

    expect(mocks.createQueueTask).toHaveBeenCalledTimes(1);
    const queueConfig = mocks.createQueueTask.mock.calls[0]?.[2];

    expect(queueConfig.buildTaskPayload()).toMatchObject({
      prompt: 'Queue this image',
      size: '1x1',
      model: 'gpt-image-2',
      params: {
        foo: 'bar',
        resolution: '4k',
        quality: 'high',
      },
    });
  });

  it('routes async schema-backed Creative userParams only through managed adapters', async () => {
    mocks.resolveAdapterForInvocation.mockReturnValue({
      id: 'new-api-creative-image-adapter',
      kind: 'image',
      supportsCreativeUserParams: true,
      generateImage: mocks.generateImage,
    });
    mocks.generateImage.mockResolvedValue({
      url: 'https://example.com/output.webp',
      format: 'webp',
    });

    const result = await imageGenerationTool.execute(
      {
        prompt: 'Create a managed image',
        model: 'mock:gpt-image-2:preview',
        size: '16x9',
        inputFidelity: 'high',
        background: 'transparent',
        outputFormat: 'png',
        outputCompression: 80,
        params: {
          callback: 'https://evil.example/hook',
        },
        userParams: {
          size: '1024x1024',
          seed: 42,
          oversea: true,
        },
        creativeManaged: true,
      },
      { mode: 'async' }
    );

    expect(result.success).toBe(true);
    const callArgs = mocks.generateImage.mock.calls[0]?.[1];
    expect(callArgs).toMatchObject({
      model: 'mock:gpt-image-2:preview',
      userParams: {
        size: '1024x1024',
        seed: 42,
        oversea: true,
      },
    });
    expect(callArgs.params).toBeUndefined();
    expect(callArgs.size).toBeUndefined();
    expect(callArgs.inputFidelity).toBeUndefined();
    expect(callArgs.background).toBeUndefined();
    expect(callArgs.outputFormat).toBeUndefined();
    expect(callArgs.outputCompression).toBeUndefined();
  });

  it('fails async schema-backed Creative requests before unsupported adapters run', async () => {
    mocks.resolveAdapterForInvocation.mockReturnValue({
      id: 'gpt-image-adapter',
      kind: 'image',
      generateImage: mocks.generateImage,
    });

    const result = await imageGenerationTool.execute(
      {
        prompt: 'Create a managed image',
        model: 'mock:gpt-image-2:preview',
        userParams: {
          size: '1024x1024',
        },
        creativeManaged: true,
      },
      { mode: 'async' }
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('managed userParams adapter');
    expect(mocks.generateImage).not.toHaveBeenCalled();
  });

  it('does not pass top-level count as adapter n in queue task params', async () => {
    mocks.createQueueTask.mockReturnValue({
      success: true,
      type: 'image',
      taskId: 'task-1',
    });

    await imageGenerationTool.execute(
      {
        prompt: 'Queue two image tasks',
        model: 'gpt-image-2',
        count: 2,
        params: {
          foo: 'bar',
        },
      },
      { mode: 'queue' }
    );

    const queueConfig = mocks.createQueueTask.mock.calls[0]?.[2];

    expect(queueConfig.buildTaskPayload()).toMatchObject({
      prompt: 'Queue two image tasks',
      params: {
        foo: 'bar',
      },
    });
    expect(queueConfig.buildTaskPayload().params).not.toHaveProperty('n');
    expect(queueConfig.buildTaskPayload().params).not.toHaveProperty('count');
  });

  it('migrates direct-tool schema UI params into sanitized userParams for managed queue payloads', async () => {
    mocks.createQueueTask.mockReturnValue({
      success: true,
      type: 'image',
      taskId: 'task-1',
    });

    await imageGenerationTool.execute(
      {
        prompt: 'Queue managed image from direct tool params',
        model: 'mock:gpt-image-2:preview',
        size: '16x9',
        quality: 'high',
        params: {
          size: '1024x1024',
          seed: 42,
          oversea: true,
          callback: 'https://evil.example/hook',
          quality: 'high',
        },
      },
      { mode: 'queue' }
    );

    const queueConfig = mocks.createQueueTask.mock.calls[0]?.[2];
    const payload = queueConfig.buildTaskPayload();

    expect(payload).toMatchObject({
      prompt: 'Queue managed image from direct tool params',
      model: 'mock:gpt-image-2:preview',
      userParams: {
        size: '1024x1024',
        seed: 42,
        oversea: true,
      },
      creativeManaged: true,
    });
    expect(payload.params).toBeUndefined();
    expect(payload.size).toBeUndefined();
    expect(payload.quality).toBeUndefined();
  });

  it('preserves schema-backed userParams and creativeManaged in queue task payload', async () => {
    mocks.createQueueTask.mockReturnValue({
      success: true,
      type: 'image',
      taskId: 'task-1',
    });

    await imageGenerationTool.execute(
      {
        prompt: 'Queue managed image',
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
        creativeManaged: true,
      },
      { mode: 'queue' }
    );

    const queueConfig = mocks.createQueueTask.mock.calls[0]?.[2];
    const payload = queueConfig.buildTaskPayload();

    expect(payload).toMatchObject({
      prompt: 'Queue managed image',
      model: 'mock:gpt-image-2:preview',
      userParams: {
        size: '1024x1024',
        seed: 42,
        oversea: true,
      },
      creativeManaged: true,
    });
    expect(payload.params).toBeUndefined();
    expect(payload.size).toBeUndefined();
    expect(payload.resolution).toBeUndefined();
    expect(payload.quality).toBeUndefined();
  });

  it('passes PPT slide replacement metadata into queue task params', async () => {
    mocks.createQueueTask.mockReturnValue({
      success: true,
      type: 'image',
      taskId: 'task-1',
    });

    await imageGenerationTool.execute(
      {
        prompt: 'Regenerate a PPT slide',
        model: 'gpt-image-2',
        size: '16x9',
        autoInsertToCanvas: true,
        targetFrameId: 'frame-1',
        targetFrameDimensions: { width: 1920, height: 1080 },
        pptSlideImage: true,
        pptReplaceElementId: 'old-image',
      },
      { mode: 'queue' }
    );

    const queueConfig = mocks.createQueueTask.mock.calls[0]?.[2];

    expect(queueConfig.buildTaskPayload()).toMatchObject({
      prompt: 'Regenerate a PPT slide',
      size: '16x9',
      targetFrameId: 'frame-1',
      targetFrameDimensions: { width: 1920, height: 1080 },
      pptSlideImage: true,
      pptReplaceElementId: 'old-image',
    });
  });

  it('passes schema-backed Creative userParams into queue task params without legacy params', async () => {
    mocks.createQueueTask.mockReturnValue({
      success: true,
      type: 'image',
      taskId: 'task-1',
    });

    await imageGenerationTool.execute(
      {
        prompt: 'Queue a managed Creative image',
        model: 'mock:gpt-image-2:preview',
        size: '16x9',
        quality: 'high',
        params: {
          legacy: 'must-not-leak',
        },
        userParams: {
          size: '1024x1024',
          seed: 42,
          oversea: true,
        },
        creativeManaged: true,
      },
      { mode: 'queue' }
    );

    const queueConfig = mocks.createQueueTask.mock.calls[0]?.[2];
    const payload = queueConfig.buildTaskPayload();

    expect(payload).toMatchObject({
      prompt: 'Queue a managed Creative image',
      model: 'mock:gpt-image-2:preview',
      userParams: {
        size: '1024x1024',
        seed: 42,
        oversea: true,
      },
      creativeManaged: true,
    });
    expect(payload.params).toBeUndefined();
    expect(payload.size).toBeUndefined();
    expect(payload.quality).toBeUndefined();
  });
});
