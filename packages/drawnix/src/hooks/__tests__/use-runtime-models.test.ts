import { describe, expect, it } from 'vitest';
import {
  getPlatformCompatibleParams,
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

  it('reuses existing image params for platform models beyond ratio', () => {
    const model = mapPlatformImageModelToModelConfig({
      capabilities: {
        maxBatchSize: 4,
        maxReferenceImages: 1,
        operationTypes: ['text_to_image'],
        supportedRatios: ['1:1', '16:9', '9:16'],
        supportsBatch: true,
        supportsMask: false,
      },
      displayName: 'GPT Image 2',
      modelKey: 'gpt-image-2',
      providerKey: 'grsai',
    });

    const params = getPlatformCompatibleParams(model);

    expect(params.map((param) => param.id)).toEqual([
      'size',
      'resolution',
      'quality',
    ]);
    expect(params.find((param) => param.id === 'size')?.options).toEqual([
      { value: '1x1', label: '1:1' },
      { value: '16x9', label: '16:9' },
      { value: '9x16', label: '9:16' },
    ]);
    expect(params.find((param) => param.id === 'resolution')?.options).toEqual([
      { value: '1k', label: '1K' },
      { value: '2k', label: '2K' },
      { value: '4k', label: '4K' },
    ]);
    expect(params.find((param) => param.id === 'quality')?.options).toContainEqual(
      { value: 'high', label: '高清' }
    );
  });

  it('keeps product entries with disabled reasons when params are not declared', () => {
    const model = mapPlatformImageModelToModelConfig({
      capabilities: {
        maxBatchSize: 1,
        maxReferenceImages: 0,
        operationTypes: ['text_to_image'],
        supportedRatios: ['1:1'],
        supportsBatch: false,
        supportsMask: false,
      },
      displayName: 'Platform Custom Image',
      modelKey: 'platform-custom-image',
      providerKey: 'custom',
    });

    const params = getPlatformCompatibleParams(model);

    expect(params.map((param) => param.id)).toEqual([
      'size',
      'resolution',
      'quality',
    ]);
    expect(params.find((param) => param.id === 'resolution')).toMatchObject({
      disabledReason: '当前模型暂未声明分辨率档位',
    });
    expect(params.find((param) => param.id === 'quality')).toMatchObject({
      disabledReason: '当前模型暂未声明画质档位',
    });
  });
});
