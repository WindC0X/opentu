import { describe, expect, it } from 'vitest';
import {
  getCompatibleParams,
  getSizeOptionsForModel,
  getStaticModelConfig,
  buildCreativeUserParams,
  hasRuntimeParameterSchema,
  isCreativeManagedModel,
  normalizeCreativeParameterSchema,
  sanitizeCreativeUserParamsForModel,
  ModelVendor,
  type CreativeParameterSchemaItem,
  type ModelConfig,
} from '../model-config';

describe('model-config image size options', () => {
  it('优先使用 new-api runtime parameterSchema 并保留原始 value 类型信息', () => {
    const parameterSchema = normalizeCreativeParameterSchema(
      [
        {
          id: 'size',
          label: '尺寸',
          type: 'enum',
          defaultValue: '1024x1024',
          options: [{ value: '1024x1024', label: '1024×1024' }],
          order: 2,
        },
        {
          id: 'oversea',
          label: '海外',
          type: 'boolean',
          defaultValue: true,
          order: 1,
        },
      ],
      'image',
      'grsai:gpt-image-2:generate'
    );
    const runtimeModel: ModelConfig = {
      id: 'grsai:gpt-image-2:generate',
      label: 'GrsAI GPT Image 2',
      type: 'image',
      vendor: ModelVendor.OTHER,
      parameterSchema,
    };

    const params = getCompatibleParams(runtimeModel);

    expect(params.map((param) => param.id)).toEqual(['oversea', 'size']);
    expect(params[0]).toMatchObject({
      id: 'oversea',
      valueType: 'boolean',
      defaultValue: 'true',
      runtimeValueType: 'boolean',
      runtimeSchema: true,
    });
    expect(params[1]?.options?.map((option) => option.value)).toEqual([
      '1024x1024',
    ]);
    expect(params[0]?.runtimeDefaultValue).toBe(true);
  });

  it('把 runtime parameterSchema 选择值转换为类型化 userParams', () => {
    const parameterSchema = normalizeCreativeParameterSchema(
      [
        {
          id: 'size',
          label: '尺寸',
          type: 'enum',
          defaultValue: '1024x1024',
          options: [{ value: '1024x1024', label: '1024×1024' }],
        },
        { id: 'seed', label: 'Seed', type: 'integer' },
        { id: 'oversea', label: '海外', type: 'boolean' },
      ],
      'image',
      'mock:gpt-image-2:preview'
    );
    const runtimeModel: ModelConfig = {
      id: 'mock:gpt-image-2:preview',
      label: 'Mock GPT Image 2',
      type: 'image',
      vendor: ModelVendor.OTHER,
      parameterSchema,
    };

    expect(hasRuntimeParameterSchema(runtimeModel)).toBe(true);
    expect(
      buildCreativeUserParams(runtimeModel, {
        size: '1024x1024',
        seed: '42.8',
        oversea: 'true',
        callback: 'https://evil.example/hook',
      })
    ).toEqual({
      size: '1024x1024',
      seed: 42,
      oversea: true,
    });
  });

  it('按 runtime schema allowlist 净化并转换直接传入的 userParams', () => {
    const parameterSchema = normalizeCreativeParameterSchema(
      [
        {
          id: 'size',
          label: '尺寸',
          type: 'enum',
          options: [
            { value: '1024x1024', label: '1024×1024' },
            { value: '2048x2048', label: '2048×2048' },
          ],
        },
        { id: 'seed', label: 'Seed', type: 'integer', min: 0, max: 100 },
        { id: 'oversea', label: '海外', type: 'boolean' },
      ],
      'image',
      'mock:gpt-image-2:preview'
    );
    const runtimeModel: ModelConfig = {
      id: 'mock:gpt-image-2:preview',
      label: 'Mock GPT Image 2',
      type: 'image',
      vendor: ModelVendor.OTHER,
      parameterSchema,
      creativeManaged: true,
    };

    expect(
      sanitizeCreativeUserParamsForModel(runtimeModel, {
        size: '2048x2048',
        seed: '42.8',
        oversea: 'false',
      })
    ).toEqual({
      size: '2048x2048',
      seed: 42,
      oversea: false,
    });

    expect(() =>
      sanitizeCreativeUserParamsForModel(runtimeModel, {
        callback: 'https://evil.example/hook',
      })
    ).toThrow(/Disallowed Creative userParams field: callback/);

    expect(() =>
      sanitizeCreativeUserParamsForModel(runtimeModel, {
        size: 'not-in-schema',
      })
    ).toThrow(/Invalid Creative userParams value/);
  });

  it('忽略未知 runtime schema type，且托管标记不依赖非空 schema', () => {
    const malformedSchema = [
      {
        id: 'style',
        label: 'Style',
        type: 'json',
      },
      {
        id: 'hidden_size',
        label: 'Hidden Size',
        type: 'string',
        hidden: true,
      },
    ] as unknown as CreativeParameterSchemaItem[];
    const parameterSchema = normalizeCreativeParameterSchema(
      malformedSchema,
      'image',
      'mock:gpt-image-2:empty-schema'
    );
    const runtimeModel: ModelConfig = {
      id: 'mock:gpt-image-2:empty-schema',
      label: 'Mock GPT Image 2 Empty Schema',
      type: 'image',
      vendor: ModelVendor.OTHER,
      providerModelId: 'gpt-image-2',
      sourceProfileId: 'new-api-creative',
      creativeManaged: true,
      parameterSchema,
    };

    expect(parameterSchema).toBeUndefined();
    expect(hasRuntimeParameterSchema(runtimeModel)).toBe(false);
    expect(isCreativeManagedModel(runtimeModel)).toBe(true);
    expect(sanitizeCreativeUserParamsForModel(runtimeModel, {})).toEqual({});
    expect(() =>
      sanitizeCreativeUserParamsForModel(runtimeModel, {
        style: 'watercolor',
      })
    ).toThrow(/Disallowed Creative userParams field: style/);
    expect(getCompatibleParams(runtimeModel)).toEqual([]);
  });

  it('拒绝 runtime parameterSchema 中的危险控制字段 ID', () => {
    const dangerousIds = [
      'baseUrl',
      'endpoint',
      'url',
      'authHeader',
      'user',
      'model',
      'model_name',
      'modelRef',
      'sourceProfileId',
      'provider',
      'channel',
      'channelId',
      'idempotencyKey',
      'onProgress',
      'onSubmitted',
      'headers',
      'callback',
      'webhook',
      'notifyHook',
    ];
    const parameterSchema = normalizeCreativeParameterSchema(
      [
        ...dangerousIds.map((id) => ({
          id,
          label: id,
          type: 'string' as const,
        })),
        {
          id: 'size',
          label: '尺寸',
          type: 'enum',
          options: [{ value: '1024x1024', label: '1024×1024' }],
        },
      ],
      'image',
      'grsai:gpt-image-2:generate'
    );

    expect(parameterSchema?.map((param) => param.id)).toEqual(['size']);
  });

  it('binding 没有 runtime schema 时按 providerModelId 继续匹配静态参数', () => {
    const runtimeModel: ModelConfig = {
      id: 'grsai:gpt-image-2:generate',
      providerModelId: 'gpt-image-2',
      priceModelId: 'unrelated-price-model',
      label: 'GrsAI GPT Image 2',
      type: 'image',
      vendor: ModelVendor.OTHER,
    };

    expect(getCompatibleParams(runtimeModel).map((param) => param.id)).toEqual(
      expect.arrayContaining(['size', 'resolution', 'quality'])
    );
  });

  it('binding 静态参数 fallback 不使用 priceModelId', () => {
    const runtimeModel: ModelConfig = {
      id: 'billing-only-binding',
      providerModelId: 'unknown-provider-model',
      priceModelId: 'gpt-image-2',
      label: 'Billing only binding',
      type: 'image',
      vendor: ModelVendor.OTHER,
    };

    expect(getCompatibleParams(runtimeModel)).toEqual([]);
  });

  it('为 gpt-image-2 系列暴露扩展比例', () => {
    const expected = [
      'auto',
      '1x1',
      '2x3',
      '3x2',
      '3x4',
      '4x3',
      '4x5',
      '5x4',
      '9x16',
      '16x9',
      '21x9',
    ];

    expect(
      getSizeOptionsForModel('gpt-image-2').map((option) => option.value)
    ).toEqual(expected);
    expect(
      getSizeOptionsForModel('gpt-image-2-vip').map((option) => option.value)
    ).toEqual(expected);
  });

  it('为 gpt-image-2 暴露分辨率和官方画质参数', () => {
    const params = getCompatibleParams('gpt-image-2');
    const qualityParams = params.filter((param) => param.id === 'quality');

    expect(
      params
        .find((param) => param.id === 'resolution')
        ?.options?.map((option) => option.value)
    ).toEqual(['1k', '2k', '4k']);
    expect(qualityParams).toHaveLength(1);
    expect(qualityParams[0]?.options?.map((option) => option.value)).toEqual([
      'auto',
      'low',
      'medium',
      'high',
    ]);
  });

  it('对 new-api 渠道返回的大小写变体也使用同一份静态参数元数据', () => {
    const staticModel = getStaticModelConfig('Gpt-image-2');
    const params = getCompatibleParams('Gpt-image-2');

    expect(staticModel?.id).toBe('gpt-image-2');
    expect(
      getSizeOptionsForModel('Gpt-image-2').map((option) => option.value)
    ).toEqual([
      'auto',
      '1x1',
      '2x3',
      '3x2',
      '3x4',
      '4x3',
      '4x5',
      '5x4',
      '9x16',
      '16x9',
      '21x9',
    ]);
    expect(params.map((param) => param.id)).toEqual(
      expect.arrayContaining(['size', 'resolution', 'quality'])
    );
  });

  it('不再内置已下架的 GPT Image 旧模型', () => {
    expect(getStaticModelConfig('gpt-image-1')).toBeUndefined();
    expect(getStaticModelConfig('gpt-image-1.5')).toBeUndefined();
    expect(getCompatibleParams('gpt-image-1')).toEqual([]);
    expect(getCompatibleParams('gpt-image-1.5')).toEqual([]);
  });

  it('保留 Gemini preview 的旧 quality 档位参数', () => {
    const params = getCompatibleParams('gemini-3-pro-image-preview');
    const qualityParams = params.filter((param) => param.id === 'quality');

    expect(qualityParams).toHaveLength(1);
    expect(qualityParams[0]?.options?.map((option) => option.value)).toEqual([
      '1k',
      '2k',
      '4k',
    ]);
  });

  it('按模型暴露 HappyHorse 参数控制', () => {
    const t2vParams = getCompatibleParams('happyhorse-1.0-t2v');
    const i2vParams = getCompatibleParams('happyhorse-1.0-i2v');
    const r2vParams = getCompatibleParams('happyhorse-1.0-r2v');
    const editParams = getCompatibleParams('happyhorse-1.0-video-edit');

    expect(getSizeOptionsForModel('happyhorse-1.0-r2v')[0]?.value).toBe(
      '1080P'
    );
    expect(
      r2vParams
        .find((param) => param.id === 'duration')
        ?.options?.map((option) => option.value)
    ).toEqual([
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
      '9',
      '10',
      '11',
      '12',
      '13',
      '14',
      '15',
    ]);
    expect(
      r2vParams
        .find((param) => param.id === 'ratio')
        ?.options?.map((option) => option.value)
    ).toEqual(['16:9', '9:16', '1:1', '4:3', '3:4']);
    expect(i2vParams.some((param) => param.id === 'ratio')).toBe(false);
    expect(editParams.some((param) => param.id === 'duration')).toBe(false);
    expect(editParams.some((param) => param.id === 'ratio')).toBe(false);
    expect(editParams.some((param) => param.id === 'audio_setting')).toBe(true);
    expect(t2vParams.some((param) => param.id === 'ratio')).toBe(true);
    expect(r2vParams.find((param) => param.id === 'seed')).toMatchObject({
      valueType: 'number',
      min: 0,
      max: 2147483647,
    });
    expect(
      r2vParams
        .find((param) => param.id === 'watermark')
        ?.options?.map((option) => option.value)
    ).toEqual(['true', 'false']);
    expect(
      r2vParams.find((param) => param.id === 'watermark')?.defaultValue
    ).toBe('false');
    expect(getStaticModelConfig('happyhorse-1.0-t2v')?.vendor).toBe(
      ModelVendor.HAPPYHORSE
    );
  });
});
