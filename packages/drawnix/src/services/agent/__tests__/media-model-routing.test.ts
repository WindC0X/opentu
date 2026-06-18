import { describe, expect, it } from 'vitest';
import { applyMediaModelDefaultsToArgs } from '../media-model-routing';

describe('media-model-routing', () => {
  it('为未指定模型的媒体工具注入对应默认模型和来源', () => {
    const imageRef = { profileId: 'profile-a', modelId: 'gpt-image-2' };
    const args = applyMediaModelDefaultsToArgs(
      'generate_image',
      { prompt: 'cat' },
      {
        defaultModels: { image: 'gpt-image-2' },
        defaultModelRefs: { image: imageRef },
      }
    );

    expect(args.model).toBe('gpt-image-2');
    expect(args.modelRef).toEqual(imageRef);
  });

  it('纠正媒体类型不匹配的显式模型', () => {
    const args = applyMediaModelDefaultsToArgs(
      'generate_video',
      { prompt: 'sunset', model: 'deepseek-v3.2' },
      {
        defaultModels: { video: 'seedance-1.5-pro' },
      }
    );

    expect(args.model).toBe('seedance-1.5-pro');
  });

  it('为 schema-backed 图片工具注入 typed userParams 并清理 legacy 参数', () => {
    const args = applyMediaModelDefaultsToArgs(
      'generate_image',
      {
        prompt: 'cat',
        size: '1x1',
        params: { callback: 'https://evil.example/hook' },
      },
      {
        contextModel: { id: 'mock:gpt-image-2:preview', type: 'image' },
        creativeUserParams: { size: '1024x1024', seed: 42 },
        creativeManaged: true,
      }
    );

    expect(args).toMatchObject({
      model: 'mock:gpt-image-2:preview',
      userParams: { size: '1024x1024', seed: 42 },
      creativeManaged: true,
    });
    expect(args.size).toBeUndefined();
    expect(args.params).toBeUndefined();
  });

  it('schema-backed 空 userParams 仍保留 managed 标记', () => {
    const args = applyMediaModelDefaultsToArgs(
      'generate_image',
      { prompt: 'cat', size: '1x1' },
      {
        contextModel: { id: 'mock:gpt-image-2:preview', type: 'image' },
        creativeManaged: true,
      }
    );

    expect(args).toMatchObject({
      model: 'mock:gpt-image-2:preview',
      userParams: {},
      creativeManaged: true,
    });
    expect(args.size).toBeUndefined();
  });

  it('为 PPT 只同步文本模型字段', () => {
    const imageRef = { profileId: 'profile-b', modelId: 'gpt-image-2' };
    const textRef = { profileId: 'profile-text', modelId: 'deepseek-v3.2' };
    const args = applyMediaModelDefaultsToArgs(
      'generate_ppt',
      { topic: 'AI 产品' },
      {
        defaultModels: { image: 'gpt-image-2' },
        defaultModelRefs: { image: imageRef },
        contextModel: { id: 'deepseek-v3.2', type: 'text' },
        contextModelRef: textRef,
      }
    );

    expect(args.model).toBeUndefined();
    expect(args.modelRef).toBeUndefined();
    expect(args.imageModel).toBeUndefined();
    expect(args.imageModelRef).toBeUndefined();
    expect(args.textModel).toBe('deepseek-v3.2');
    expect(args.textModelRef).toEqual(textRef);
  });
});
