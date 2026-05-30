import { AppError } from '../errors';
import type {
  CreateImageTaskInput,
  ImageModelView,
  ImageTask,
} from '../image-tasks/types';
import type {
  ImageProviderAdapter,
  ImageProviderExecutionInput,
  ImageProviderResult,
} from './types';

export const MOCK_PROVIDER_KEY = 'mock';
export const MOCK_PROVIDER_CONFIG_ID = '00000000-0000-0000-0000-00000000f001';
export const MOCK_MODEL_KEY = 'mock-image-v1';
export const MOCK_MODEL_VERSION = '2026-05-27';
export const MOCK_PRICE_POLICY_ID = '00000000-0000-0000-0000-00000000f101';
export const MOCK_PRICE_VERSION = 1;
export const MOCK_PRICE_PER_IMAGE = 10;
export const MOCK_PROMPT_OPTIMIZE_PRICE = 2;
export const MOCK_PROMPT_OPTIMIZER_MODEL_KEY = 'mock-prompt-optimizer-v1';
export const MOCK_PROMPT_OPTIMIZER_VERSION = '2026-05-30';
export const MOCK_PROMPT_OPTIMIZE_FAIL_TOKEN = '__mock_prompt_optimize_fail__';

export const MOCK_IMAGE_MODEL: ImageModelView = {
  capabilities: {
    maxBatchSize: 4,
    maxReferenceImages: 5,
    operationType: 'text_to_image',
    operationTypes: [
      'text_to_image',
      'image_to_image',
      'inpaint',
      'reference_generate',
      'prompt_optimize',
    ],
    supportedRatios: ['1:1', '16:9', '9:16'],
    supportsBatch: true,
    supportsMask: true,
  },
  displayName: 'Mock Image v1',
  modelKey: MOCK_MODEL_KEY,
  price: {
    amount: MOCK_PRICE_PER_IMAGE,
    unit: 'per_image',
    version: MOCK_PRICE_VERSION,
  },
  providerKey: MOCK_PROVIDER_KEY,
};

export interface MockProviderResult {
  failureCount: number;
  images: Array<{
    body: Buffer;
    candidateIndex: number;
    mimeType: 'image/png';
  }>;
  providerRequestId: string;
  status: 'succeeded' | 'failed' | 'partial_succeeded';
  successCount: number;
  usageSnapshot: Record<string, unknown>;
}

export interface MockPromptOptimizerResult {
  failureCount: number;
  latencyMs: number;
  optimizedPrompt: string | null;
  providerRequestId: string;
  rawErrorCode: string | null;
  rawErrorMessage: string | null;
  responseSnapshot: Record<string, unknown>;
  status: 'succeeded' | 'failed';
  successCount: number;
}

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

export class MockImageProvider implements ImageProviderAdapter {
  readonly providerKey = MOCK_PROVIDER_KEY;

  async execute(
    input: ImageProviderExecutionInput
  ): Promise<ImageProviderResult> {
    const result = await this.generate(input.task, input.input);
    return {
      failureCount: result.failureCount,
      images: result.images,
      latencyMs: 1,
      providerCostAmount: 0,
      providerCostCurrency: 'USD',
      providerRequestId: result.providerRequestId,
      rawErrorCode: result.status === 'failed' ? 'MOCK_PROVIDER_FAILED' : null,
      rawErrorMessage:
        result.status === 'failed' ? 'Mock provider failed' : null,
      responseSnapshot: result.usageSnapshot,
      status: result.status,
      successCount: result.successCount,
    };
  }

  async generate(
    task: ImageTask,
    input: CreateImageTaskInput
  ): Promise<MockProviderResult> {
    if (input.prompt.includes('__mock_provider_fail__')) {
      return {
        failureCount: input.batchSize,
        images: [],
        providerRequestId: `mock_req_${task.id}`,
        status: 'failed',
        successCount: 0,
        usageSnapshot: {
          code: 'MOCK_PROVIDER_FAILED',
          message: 'Mock provider failure requested by prompt',
        },
      };
    }

    const requestedSuccessCount = input.prompt.includes('__mock_partial__')
      ? Math.max(1, input.batchSize - 1)
      : input.batchSize;
    const images = Array.from(
      { length: requestedSuccessCount },
      (_, index) => ({
        body: ONE_PIXEL_PNG,
        candidateIndex: index,
        mimeType: 'image/png' as const,
      })
    );

    return {
      failureCount: input.batchSize - requestedSuccessCount,
      images,
      providerRequestId: `mock_req_${task.id}`,
      status:
        requestedSuccessCount === input.batchSize
          ? 'succeeded'
          : 'partial_succeeded',
      successCount: requestedSuccessCount,
      usageSnapshot: {
        imageCount: requestedSuccessCount,
        hasMask: Boolean(input.maskAssetId),
        hasSource: Boolean(input.sourceAssetId),
        modelKey: MOCK_MODEL_KEY,
        operationType: input.operationType,
        promptLength: input.prompt.length,
        referenceImageCount: input.referenceAssets?.length ?? 0,
      },
    };
  }
}

export function optimizePromptWithMock(
  task: ImageTask,
  input: CreateImageTaskInput
): MockPromptOptimizerResult {
  const providerRequestId = `mock_prompt_opt_${task.id}`;
  if (input.prompt.includes(MOCK_PROMPT_OPTIMIZE_FAIL_TOKEN)) {
    return {
      failureCount: 1,
      latencyMs: 1,
      optimizedPrompt: null,
      providerRequestId,
      rawErrorCode: 'MOCK_PROMPT_OPTIMIZER_FAILED',
      rawErrorMessage: 'Prompt optimization failed',
      responseSnapshot: {
        code: 'MOCK_PROMPT_OPTIMIZER_FAILED',
        message: 'Mock prompt optimization failure requested by prompt',
        modelKey: MOCK_PROMPT_OPTIMIZER_MODEL_KEY,
        modelVersion: MOCK_PROMPT_OPTIMIZER_VERSION,
        operationType: input.operationType,
        promptLength: input.prompt.length,
      },
      status: 'failed',
      successCount: 0,
    };
  }

  const normalizedPrompt = input.prompt.trim().replace(/\s+/g, ' ');
  const optimizedPrompt = [
    `[Mock Optimized v1] ${normalizedPrompt}`,
    'Add a clear subject, concrete visual details, composition, lighting, style, and output constraints.',
  ].join(' ');

  return {
    failureCount: 0,
    latencyMs: 1,
    optimizedPrompt,
    providerRequestId,
    rawErrorCode: null,
    rawErrorMessage: null,
    responseSnapshot: {
      modelKey: MOCK_PROMPT_OPTIMIZER_MODEL_KEY,
      modelVersion: MOCK_PROMPT_OPTIMIZER_VERSION,
      operationType: input.operationType,
      promptLength: input.prompt.length,
      resultLength: optimizedPrompt.length,
    },
    status: 'succeeded',
    successCount: 1,
  };
}

export function listMockImageModels(): ImageModelView[] {
  return [MOCK_IMAGE_MODEL];
}

export function requireMockImageModel(modelKey: string): ImageModelView {
  const model = listMockImageModels().find(
    (candidate) => candidate.modelKey === modelKey
  );
  if (!model) {
    throw new AppError(
      'MODEL_UNSUPPORTED_OPERATION',
      400,
      `Unsupported mock model: ${modelKey}`
    );
  }
  return model;
}
