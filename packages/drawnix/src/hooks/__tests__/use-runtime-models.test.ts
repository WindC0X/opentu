import { describe, expect, it } from 'vitest';
import {
  getPlatformModelConfigCapabilities,
  getPlatformRatioParamConfig,
  mapPlatformImageModelToModelConfig,
} from '../use-runtime-models';

describe('platform runtime model mapping', () => {
  it('keeps platform capability metadata on selectable model config', () => {
    const model = mapPlatformImageModelToModelConfig({
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
      displayName: 'GPT Image 2',
      modelKey: 'gpt-image-2',
      price: { amount: 10, unit: 'per_image', version: 2 },
      providerKey: 'grsai',
    });

    expect(model.description).toContain('平台价 10 点/张');
    expect(model.tags).toContain('platform-op:inpaint');
    expect(getPlatformModelConfigCapabilities(model)).toMatchObject({
      maxBatchSize: 4,
      maxReferenceImages: 5,
      supportsMask: true,
    });
    expect(getPlatformRatioParamConfig(model)?.options).toEqual([
      { label: '1:1', value: '1:1' },
      { label: '16:9', value: '16:9' },
      { label: '9:16', value: '9:16' },
    ]);
  });
});
