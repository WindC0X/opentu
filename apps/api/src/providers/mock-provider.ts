import { AppError } from '../errors';
import type {
  CreateImageTaskInput,
  ImageModelView,
  ImageTask,
} from '../image-tasks/types';

export const MOCK_PROVIDER_KEY = 'mock';
export const MOCK_PROVIDER_CONFIG_ID = '00000000-0000-0000-0000-00000000f001';
export const MOCK_MODEL_KEY = 'mock-image-v1';
export const MOCK_MODEL_VERSION = '2026-05-27';
export const MOCK_PRICE_POLICY_ID = '00000000-0000-0000-0000-00000000f101';
export const MOCK_PRICE_VERSION = 1;
export const MOCK_PRICE_PER_IMAGE = 10;

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

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

export class MockImageProvider {
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
