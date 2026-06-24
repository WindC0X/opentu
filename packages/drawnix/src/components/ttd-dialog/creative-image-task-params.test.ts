import { describe, expect, it } from 'vitest';
import {
  ModelVendor,
  type ModelConfig,
  type ParamConfig,
} from '../../constants/model-config';
import {
  applyCreativeImageAspectRatioToParams,
  buildCreativeImageRuntimeTaskParams,
  getCreativeImageAspectRatioFromParams,
  mergeCreativeImageEditableTaskParams,
  normalizeCreativeImageEditableUserParams,
} from './creative-image-task-params';

const runtimeParams: ParamConfig[] = [
  {
    id: 'aspectRatio',
    label: '比例',
    valueType: 'enum',
    options: [
      { value: 'auto', label: '自动' },
      { value: '1:1', label: '1:1' },
      { value: '21:9', label: '21:9' },
    ],
    defaultValue: 'auto',
    compatibleModels: ['creative-runtime-test'],
    modelType: 'image',
    runtimeSchema: true,
    runtimeValueType: 'enum',
    runtimeOptions: [
      { value: '1:1', label: '1:1' },
      { value: '21:9', label: '21:9' },
    ],
  },
  {
    id: 'imageSize',
    label: '分辨率',
    valueType: 'enum',
    options: [
      { value: '1K', label: '1K' },
      { value: '4K', label: '4K' },
    ],
    defaultValue: '1K',
    compatibleModels: ['creative-runtime-test'],
    modelType: 'image',
    runtimeSchema: true,
    runtimeValueType: 'enum',
    runtimeOptions: [
      { value: '1K', label: '1K' },
      { value: '4K', label: '4K' },
    ],
  },
  {
    id: 'quality',
    label: '质量',
    valueType: 'enum',
    options: [
      { value: 'medium', label: '标准' },
      { value: 'high', label: '高清' },
    ],
    defaultValue: 'medium',
    compatibleModels: ['creative-runtime-test'],
    modelType: 'image',
    runtimeSchema: true,
    runtimeValueType: 'enum',
    runtimeOptions: [
      { value: 'medium', label: '标准' },
      { value: 'high', label: '高清' },
    ],
  },
];

const runtimeModel: ModelConfig = {
  id: 'creative-runtime-test',
  label: 'Creative Runtime Test',
  type: 'image',
  vendor: ModelVendor.GPT,
  parameterSchema: runtimeParams,
};

const legacyModel: ModelConfig = {
  id: 'legacy-image-test',
  label: 'Legacy Image Test',
  type: 'image',
  vendor: ModelVendor.GPT,
};

describe('buildCreativeImageRuntimeTaskParams', () => {
  it('moves schema-backed image params into userParams and marks the task creative-managed', () => {
    const result = buildCreativeImageRuntimeTaskParams(runtimeModel, {
      aspectRatio: '21:9',
      imageSize: '4K',
      quality: 'high',
      ignoredLegacyParam: 'should-not-pass',
    });

    expect(result.schemaBacked).toBe(true);
    expect(result.taskParams).toEqual({
      creativeManaged: true,
      userParams: {
        aspectRatio: '21:9',
        imageSize: '4K',
        quality: 'high',
      },
    });
  });

  it('returns an empty userParams carrier for schema-backed models with no selected params', () => {
    const result = buildCreativeImageRuntimeTaskParams(runtimeModel, {});

    expect(result.schemaBacked).toBe(true);
    expect(result.taskParams).toEqual({
      creativeManaged: true,
      userParams: {},
    });
  });

  it('does not mark legacy image models as creative-managed', () => {
    const result = buildCreativeImageRuntimeTaskParams(legacyModel, {
      quality: 'high',
    });

    expect(result.schemaBacked).toBe(false);
    expect(result.taskParams).toEqual({});
  });

  it('normalizes stored userParams back into editable string params', () => {
    expect(
      normalizeCreativeImageEditableUserParams({
        aspectRatio: '21:9',
        imageSize: '1K',
        seed: 123,
        transparent: false,
        ignoredObject: { value: 'nope' },
        ignoredArray: ['nope'],
      })
    ).toEqual({
      aspectRatio: '21:9',
      imageSize: '1K',
      seed: '123',
      transparent: 'false',
    });
  });

  it('lets schema-backed stored userParams override legacy top-level edit params', () => {
    expect(
      mergeCreativeImageEditableTaskParams({
        params: { quality: 'low', style: 'legacy' },
        userParams: {
          quality: 'high',
          imageSize: '4K',
        },
        size: '1:1',
        resolution: '1K',
        quality: 'medium',
      })
    ).toEqual({
      quality: 'high',
      style: 'legacy',
      imageSize: '4K',
      size: '1:1',
      resolution: '1K',
    });
  });

  it('maps frame aspect ratio into schema-backed aspectRatio userParams instead of legacy size', () => {
    const selectedParams = applyCreativeImageAspectRatioToParams(
      runtimeModel,
      { imageSize: '1K', quality: 'medium' },
      '21:9'
    );

    expect(selectedParams).toMatchObject({
      aspectRatio: '21:9',
      imageSize: '1K',
      quality: 'medium',
    });
    expect(selectedParams).not.toHaveProperty('size');
    expect(
      buildCreativeImageRuntimeTaskParams(runtimeModel, selectedParams)
        .taskParams.userParams
    ).toMatchObject({ aspectRatio: '21:9' });
  });

  it('falls back to legacy size params when a model has no schema aspectRatio field', () => {
    expect(applyCreativeImageAspectRatioToParams('gpt-image-2', {}, '21:9')).toEqual(
      { size: '21x9' }
    );
    expect(
      getCreativeImageAspectRatioFromParams('gpt-image-2', { size: '21x9' })
    ).toBe('21:9');
  });
});
