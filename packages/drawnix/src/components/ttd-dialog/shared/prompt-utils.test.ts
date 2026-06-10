import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getImagePrompts, getVideoPrompts } from '../../../constants/prompts';
import * as promptUtils from './prompt-utils';

const {
  mockGetImagePromptHistoryContents,
  mockGetVideoPromptHistoryContents,
  mockGetHistory,
  mockSortPrompts,
  mockIsPinned,
  mockResolveContent,
  mockResolveMetadata,
} = vi.hoisted(() => ({
  mockGetImagePromptHistoryContents: vi.fn(),
  mockGetVideoPromptHistoryContents: vi.fn(),
  mockGetHistory: vi.fn(),
  mockSortPrompts: vi.fn(),
  mockIsPinned: vi.fn(),
  mockResolveContent: vi.fn((content: string) => content.trim()),
  mockResolveMetadata: vi.fn(),
}));

vi.mock('../../../services/prompt-storage-service', () => ({
  getImagePromptHistoryContents: mockGetImagePromptHistoryContents,
  getVideoPromptHistoryContents: mockGetVideoPromptHistoryContents,
  promptStorageService: {
    getHistory: mockGetHistory,
    sortPrompts: mockSortPrompts,
    isPinned: mockIsPinned,
    resolveContent: mockResolveContent,
    resolveMetadata: mockResolveMetadata,
  },
}));
describe('resolvePromptItemsByGenerationType', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetImagePromptHistoryContents.mockReturnValue([]);
    mockGetVideoPromptHistoryContents.mockReturnValue([]);
    mockGetHistory.mockReturnValue([]);
    mockSortPrompts.mockImplementation((_type, prompts) => prompts);
    mockIsPinned.mockReturnValue(false);
    mockResolveContent.mockImplementation((content: string) => content.trim());
    mockResolveMetadata.mockImplementation((content: string) => ({
      sourceContent: content.trim(),
      content: content.trim(),
      title: undefined,
      tags: undefined,
      modelType: undefined,
    }));
  });

  it('图片类型合并同类我的提示词，不混入视频来源', () => {
    mockGetImagePromptHistoryContents.mockReturnValue(['本地图片历史']);
    mockGetVideoPromptHistoryContents.mockReturnValue(['本地视频历史']);
    mockGetHistory.mockReturnValue([
      {
        id: 'manual-image',
        content: '我的提示词图片历史',
        timestamp: 500,
        modelType: 'image',
      },
      {
        id: 'manual-video',
        content: '我的提示词视频历史',
        timestamp: 550,
        modelType: 'video',
      },
    ]);

    const resolver = promptUtils.resolvePromptItemsByGenerationType;

    expect(typeof resolver).toBe('function');

    const items = resolver({
      generationType: 'image',
      language: 'zh',
      aiInputHistory: [
        {
          id: 'ai-image-only',
          content: 'AI 输入图片历史',
          timestamp: 100,
          modelType: 'image',
        },
        {
          id: 'ai-video-only',
          content: 'AI 输入视频历史',
          timestamp: 200,
          modelType: 'video',
        },
      ],
      imageHistory: [
        {
          id: 'task-image-1',
          type: 'image',
          prompt: '任务图片历史',
          timestamp: 300,
          imageUrl: '/image-task.png',
          width: 1024,
          height: 1024,
        },
      ],
      videoHistory: [
        {
          id: 'task-video-1',
          type: 'video',
          prompt: '任务视频历史',
          timestamp: 400,
          imageUrl: '/video-thumb.png',
          previewUrl: '/video.mp4',
          downloadUrl: '/video.mp4',
          width: 1280,
          height: 720,
        },
      ],
    });

    const contents = items.map((item: { content: string }) => item.content);
    const taskImageItem = items.find(
      (item: { content: string }) => item.content === '任务图片历史'
    );
    const defaultImageItem = items.find(
      (item: { content: string }) => item.content === getImagePrompts('zh')[0]
    );

    expect(contents).toContain('本地图片历史');
    expect(contents).toContain('我的提示词图片历史');
    expect(contents).toContain('任务图片历史');
    expect(contents).toContain(getImagePrompts('zh')[0]);
    expect(contents).not.toContain('本地视频历史');
    expect(contents).not.toContain('任务视频历史');
    expect(contents).not.toContain('我的提示词视频历史');
    expect(contents).not.toContain('AI 输入图片历史');
    expect(contents).not.toContain('AI 输入视频历史');
    expect(taskImageItem?.previewExamples?.[0]?.src).toBe('/image-task.png');
    expect(defaultImageItem?.previewExamples).toBeUndefined();
  });

  it('图片默认提示词不再绑定内置示例图', () => {
    const defaults = promptUtils.getDefaultPromptsByGenerationType('image', 'zh');

    expect(defaults).toHaveLength(getImagePrompts('zh').length);
    expect(defaults.every((item) => !item.previewExamples?.length)).toBe(true);
  });

  it('构造 PromptItem 时同步标题、标签和发送提示词元数据', () => {
    mockResolveMetadata.mockImplementation((content: string) =>
      content === '文本历史提示'
        ? {
            sourceContent: '文本历史提示原始',
            content: '真正发送的提示词',
            title: '元数据标题',
            tags: ['常用', '改写'],
            modelType: 'text',
          }
        : {
            sourceContent: content.trim(),
            content: content.trim(),
            title: undefined,
            tags: undefined,
            modelType: undefined,
          }
    );

    const items = promptUtils.resolvePromptItemsByGenerationType({
      generationType: 'text',
      language: 'zh',
      aiInputHistory: [
        {
          id: 'text-1',
          content: '文本历史提示',
          timestamp: 100,
          modelType: 'text',
        },
      ],
      imageHistory: [],
      videoHistory: [],
    });

    const item = items.find(({ content }) => content === '文本历史提示');

    expect(item).toMatchObject({
      content: '文本历史提示',
      title: '元数据标题',
      tags: ['常用', '改写'],
      sentPrompt: '真正发送的提示词',
    });
  });

  it('同一条图片提示词同时存在本地历史和已完成任务时，真实任务结果预览优先', () => {
    const duplicatedPrompt = getImagePrompts('zh')[1];
    mockGetImagePromptHistoryContents.mockReturnValue([duplicatedPrompt]);

    const items = promptUtils.resolvePromptItemsByGenerationType({
      generationType: 'image',
      language: 'zh',
      aiInputHistory: [],
      imageHistory: [
        {
          id: 'task-image-real-preview',
          type: 'image',
          prompt: duplicatedPrompt,
          timestamp: 300,
          imageUrl: '/real-kitten-result.png',
          width: 1024,
          height: 1024,
        },
      ],
      videoHistory: [],
    });

    const duplicatedItems = items.filter((item) => item.content === duplicatedPrompt);

    expect(duplicatedItems).toHaveLength(1);
    expect(duplicatedItems[0]?.previewExamples?.[0]?.src).toBe(
      '/real-kitten-result.png'
    );
  });

  it('图片任务提示词被编辑后，下拉使用编辑后的内容并保留真实预览', () => {
    mockResolveContent.mockImplementation((content: string) =>
      content === '原始图片提示词' ? '编辑后的图片提示词' : content.trim()
    );

    const items = promptUtils.resolvePromptItemsByGenerationType({
      generationType: 'image',
      language: 'zh',
      aiInputHistory: [],
      imageHistory: [
        {
          id: 'task-image-edited',
          type: 'image',
          prompt: '原始图片提示词',
          timestamp: 300,
          imageUrl: '/edited-preview.png',
          width: 1024,
          height: 1024,
        },
      ],
      videoHistory: [],
    });

    const editedItem = items.find(
      (item) => item.content === '编辑后的图片提示词'
    );
    expect(editedItem?.previewExamples?.[0]?.src).toBe('/edited-preview.png');
    expect(items.map((item) => item.content)).not.toContain('原始图片提示词');
  });

  it('语言值异常时回退到默认语言，而不是抛出运行时错误', () => {
    expect(() =>
      promptUtils.getDefaultPromptsByGenerationType('image', 'zh-CN' as never)
    ).not.toThrow();

    const defaults = promptUtils.getDefaultPromptsByGenerationType(
      'image',
      'zh-CN' as never
    );

    expect(defaults[0]?.content).toBe(getImagePrompts('zh')[0]);
    expect(defaults[1]?.previewExamples).toBeUndefined();
  });

  it('视频类型只返回视频来源，不混入图片来源', () => {
    mockGetImagePromptHistoryContents.mockReturnValue(['本地图片历史']);
    mockGetVideoPromptHistoryContents.mockReturnValue(['本地视频历史']);
    mockGetHistory.mockReturnValue([
      {
        id: 'manual-video',
        content: '我的提示词视频历史',
        timestamp: 500,
        modelType: 'video',
      },
      {
        id: 'manual-image',
        content: '我的提示词图片历史',
        timestamp: 550,
        modelType: 'image',
      },
    ]);

    const resolver = promptUtils.resolvePromptItemsByGenerationType;

    expect(typeof resolver).toBe('function');

    const items = resolver({
      generationType: 'video',
      language: 'zh',
      aiInputHistory: [
        {
          id: 'ai-video-only',
          content: 'AI 输入视频历史',
          timestamp: 200,
          modelType: 'video',
        },
      ],
      imageHistory: [
        {
          id: 'task-image-1',
          type: 'image',
          prompt: '任务图片历史',
          timestamp: 300,
          imageUrl: '/image-task.png',
          width: 1024,
          height: 1024,
        },
      ],
      videoHistory: [
        {
          id: 'task-video-1',
          type: 'video',
          prompt: '任务视频历史',
          timestamp: 400,
          imageUrl: '/video-thumb.png',
          previewUrl: '/video.mp4',
          downloadUrl: '/video.mp4',
          width: 1280,
          height: 720,
        },
      ],
    });

    const contents = items.map((item: { content: string }) => item.content);
    const taskVideoItem = items.find(
      (item: { content: string }) => item.content === '任务视频历史'
    );
    const defaultVideoItem = items.find(
      (item: { content: string }) => item.content === getVideoPrompts('zh')[0]
    );

    expect(contents).toContain('本地视频历史');
    expect(contents).toContain('我的提示词视频历史');
    expect(contents).toContain('任务视频历史');
    expect(contents).toContain(getVideoPrompts('zh')[0]);
    expect(contents).not.toContain('本地图片历史');
    expect(contents).not.toContain('任务图片历史');
    expect(contents).not.toContain('我的提示词图片历史');
    expect(contents).not.toContain('AI 输入视频历史');
    expect(taskVideoItem?.previewExamples?.[0]).toMatchObject({
      kind: 'video',
      src: '/video.mp4',
      posterSrc: '/video-thumb.png',
      playable: true,
    });
    expect(defaultVideoItem?.previewExamples).toBeUndefined();
  });

  it('默认视频提示词命中用户生成历史时，使用真实视频预览', () => {
    const duplicatedPrompt = getVideoPrompts('zh')[4];
    mockGetVideoPromptHistoryContents.mockReturnValue([duplicatedPrompt]);

    const items = promptUtils.resolvePromptItemsByGenerationType({
      generationType: 'video',
      language: 'zh',
      aiInputHistory: [],
      imageHistory: [],
      videoHistory: [
        {
          id: 'task-video-short-preview',
          prompt: duplicatedPrompt,
          timestamp: 500,
          imageUrl: '/local-short-video.png',
          previewUrl: '/local-short-video.mp4',
          downloadUrl: '/local-short-video.mp4',
          width: 1280,
          height: 720,
          duration: 5,
        } as any,
      ],
    });

    const duplicatedItems = items.filter((item) => item.content === duplicatedPrompt);

    expect(duplicatedItems).toHaveLength(1);
    expect(duplicatedItems[0]?.previewExamples?.[0]).toMatchObject({
      kind: 'video',
      src: '/local-short-video.mp4',
      posterSrc: '/local-short-video.png',
      playable: true,
    });
  });

  it('默认视频提示词命中同文案的真实视频历史时，不再优先使用内置样片', () => {
    const duplicatedPrompt = getVideoPrompts('zh')[1];
    mockGetVideoPromptHistoryContents.mockReturnValue([duplicatedPrompt]);

    const items = promptUtils.resolvePromptItemsByGenerationType({
      generationType: 'video',
      language: 'zh',
      aiInputHistory: [],
      imageHistory: [],
      videoHistory: [
        {
          id: 'task-video-real-preview',
          prompt: duplicatedPrompt,
          timestamp: 600,
          imageUrl: '/generated/sunrise-task.png',
          previewUrl: '/generated/sunrise-task.mp4',
          downloadUrl: '/generated/sunrise-task.mp4',
          width: 1280,
          height: 720,
          duration: 8,
        } as any,
      ],
    });

    const duplicatedItems = items.filter((item) => item.content === duplicatedPrompt);

    expect(duplicatedItems).toHaveLength(1);
    expect(duplicatedItems[0]?.previewExamples?.[0]).toMatchObject({
      kind: 'video',
      src: '/generated/sunrise-task.mp4',
      posterSrc: '/generated/sunrise-task.png',
      playable: true,
    });
  });

  it('resolvePresetPromptItems 会为用户生成过的默认视频提示词附加真实预览', () => {
    const duplicatedPrompt = getVideoPrompts('zh')[1];

    const items = promptUtils.resolvePresetPromptItems({
      generationType: 'video',
      language: 'zh',
      promptContents: [duplicatedPrompt],
      imageHistory: [],
      videoHistory: [
        {
          id: 'task-video-real-preview',
          prompt: duplicatedPrompt,
          timestamp: 600,
          imageUrl: '/generated/sunrise-task.png',
          previewUrl: '/generated/sunrise-task.mp4',
          downloadUrl: '/generated/sunrise-task.mp4',
          width: 1280,
          height: 720,
          duration: 8,
        } as any,
      ],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      content: duplicatedPrompt,
      modelType: 'video',
      pinned: false,
    });
    expect(items[0]?.previewExamples?.[0]).toMatchObject({
      kind: 'video',
      src: '/generated/sunrise-task.mp4',
      posterSrc: '/generated/sunrise-task.png',
      playable: true,
    });
  });

  it('resolvePresetPromptItems 同步标题、标签和发送提示词元数据', () => {
    mockResolveMetadata.mockImplementation((content: string) =>
      content === '原始图片提示词'
        ? {
            sourceContent: '原始图片提示词',
            content: '原始图片提示词',
            title: '我的标题',
            tags: ['收藏', '图片'],
            modelType: 'image',
          }
        : {
            sourceContent: content.trim(),
            content: content.trim(),
            title: undefined,
            tags: undefined,
            modelType: undefined,
          }
    );

    const items = promptUtils.resolvePresetPromptItems({
      generationType: 'image',
      language: 'zh',
      promptContents: ['原始图片提示词'],
      imageHistory: [],
      videoHistory: [],
    });

    expect(items[0]).toMatchObject({
      content: '原始图片提示词',
      title: '我的标题',
      tags: ['收藏', '图片'],
      sentPrompt: '原始图片提示词',
      modelType: 'image',
    });
  });

  it('resolvePresetPromptItems 不会为默认图片提示词附加内置静态示例图', () => {
    const prompt = getImagePrompts('zh')[1];

    const items = promptUtils.resolvePresetPromptItems({
      generationType: 'image',
      language: 'zh',
      promptContents: [prompt],
      imageHistory: [],
      videoHistory: [],
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      content: prompt,
      modelType: 'image',
      pinned: false,
    });
    expect(items[0]?.previewExamples).toEqual([]);
  });

  it('音频类型只返回音频历史与音频默认提示词', () => {
    const resolver = promptUtils.resolvePromptItemsByGenerationType;
    const getDefaults = promptUtils.getDefaultPromptsByGenerationType;

    expect(typeof resolver).toBe('function');
    expect(typeof getDefaults).toBe('function');

    const items = resolver({
      generationType: 'audio',
      language: 'zh',
      aiInputHistory: [
        {
          id: 'audio-1',
          content: '音频历史提示',
          timestamp: 100,
          modelType: 'audio',
        },
        {
          id: 'text-1',
          content: '文本历史提示',
          timestamp: 200,
          modelType: 'text',
        },
        {
          id: 'agent-1',
          content: 'Agent 历史提示',
          timestamp: 300,
          modelType: 'agent',
        },
      ],
      imageHistory: [],
      videoHistory: [],
    });

    const contents = items.map((item: { content: string }) => item.content);
    const defaultAudioItem = items.find(
      (item: { content: string }) =>
        item.content === getDefaults('audio', 'zh')[0].content
    );
    const historyAudioItem = items.find(
      (item: { content: string }) => item.content === '音频历史提示'
    );

    expect(contents).toContain('音频历史提示');
    expect(contents).toContain(getDefaults('audio', 'zh')[0].content);
    expect(contents).not.toContain('文本历史提示');
    expect(contents).not.toContain('Agent 历史提示');
    expect(defaultAudioItem?.previewExamples).toBeUndefined();
    expect(historyAudioItem?.previewExamples).toBeUndefined();
  });

  it('文本类型只返回文本历史与文本默认提示词', () => {
    const resolver = promptUtils.resolvePromptItemsByGenerationType;
    const getDefaults = promptUtils.getDefaultPromptsByGenerationType;

    expect(typeof resolver).toBe('function');
    expect(typeof getDefaults).toBe('function');

    const items = resolver({
      generationType: 'text',
      language: 'zh',
      aiInputHistory: [
        {
          id: 'audio-1',
          content: '音频历史提示',
          timestamp: 100,
          modelType: 'audio',
        },
        {
          id: 'text-1',
          content: '文本历史提示',
          timestamp: 200,
          modelType: 'text',
        },
      ],
      imageHistory: [],
      videoHistory: [],
    });

    const contents = items.map((item: { content: string }) => item.content);
    const defaultTextItem = items.find(
      (item: { content: string }) =>
        item.content === getDefaults('text', 'zh')[0].content
    );
    const historyTextItem = items.find(
      (item: { content: string }) => item.content === '文本历史提示'
    );

    expect(contents).toContain('文本历史提示');
    expect(contents).toContain(getDefaults('text', 'zh')[0].content);
    expect(contents).not.toContain('音频历史提示');
    expect(defaultTextItem?.previewExamples).toBeUndefined();
    expect(historyTextItem?.previewExamples).toBeUndefined();
  });

  it('Agent 类型只返回 Agent 历史与 Agent 默认提示词', () => {
    const resolver = promptUtils.resolvePromptItemsByGenerationType;
    const getDefaults = promptUtils.getDefaultPromptsByGenerationType;

    expect(typeof resolver).toBe('function');
    expect(typeof getDefaults).toBe('function');

    const items = resolver({
      generationType: 'agent',
      language: 'zh',
      aiInputHistory: [
        {
          id: 'agent-1',
          content: 'Agent 历史提示',
          timestamp: 100,
          modelType: 'agent',
        },
        {
          id: 'video-1',
          content: '视频历史提示',
          timestamp: 200,
          modelType: 'video',
        },
      ],
      imageHistory: [],
      videoHistory: [],
    });

    const contents = items.map((item: { content: string }) => item.content);
    const defaultAgentItem = items.find(
      (item: { content: string }) =>
        item.content === getDefaults('agent', 'zh')[0].content
    );
    const historyAgentItem = items.find(
      (item: { content: string }) => item.content === 'Agent 历史提示'
    );

    expect(contents).toContain('Agent 历史提示');
    expect(contents).toContain(getDefaults('agent', 'zh')[0].content);
    expect(contents).not.toContain('视频历史提示');
    expect(defaultAgentItem?.previewExamples).toBeUndefined();
    expect(historyAgentItem?.previewExamples).toBeUndefined();
  });

  it('PPT 公共提示词类型只返回公共提示词历史且无默认预设', () => {
    const resolver = promptUtils.resolvePromptItemsByGenerationType;
    const getDefaults = promptUtils.getDefaultPromptsByGenerationType;

    const items = resolver({
      generationType: 'ppt-common',
      language: 'zh',
      aiInputHistory: [
        {
          id: 'ppt-common-1',
          content: 'PPT 公共风格历史',
          timestamp: 100,
          modelType: 'ppt-common',
        },
        {
          id: 'agent-1',
          content: 'Agent 历史提示',
          timestamp: 200,
          modelType: 'agent',
        },
      ],
      imageHistory: [],
      videoHistory: [],
    });

    const contents = items.map((item: { content: string }) => item.content);

    expect(contents).toEqual(['PPT 公共风格历史']);
    expect(contents).not.toContain('Agent 历史提示');
    expect(getDefaults('ppt-common', 'zh')).toEqual([]);
    expect(items[0]?.previewExamples).toBeUndefined();
  });

  it('PPT 页面提示词类型只返回页面提示词历史，不进入普通图片列表', () => {
    const resolver = promptUtils.resolvePromptItemsByGenerationType;
    const getDefaults = promptUtils.getDefaultPromptsByGenerationType;

    const aiInputHistory = [
      {
        id: 'ppt-slide-1',
        content: 'PPT 页面提示词',
        timestamp: 100,
        modelType: 'ppt-slide' as const,
      },
      {
        id: 'image-1',
        content: '普通图片提示词',
        timestamp: 200,
        modelType: 'image' as const,
      },
    ];

    const slideItems = resolver({
      generationType: 'ppt-slide',
      language: 'zh',
      aiInputHistory,
      imageHistory: [],
      videoHistory: [],
    });
    const imageItems = resolver({
      generationType: 'image',
      language: 'zh',
      aiInputHistory,
      imageHistory: [],
      videoHistory: [],
    });

    expect(slideItems.map((item) => item.content)).toEqual(['PPT 页面提示词']);
    expect(imageItems.map((item) => item.content)).not.toContain(
      'PPT 页面提示词'
    );
    expect(getDefaults('ppt-slide', 'zh')).toEqual([]);
    expect(slideItems[0]?.modelType).toBe('ppt-slide');
  });
});
