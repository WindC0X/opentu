import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskStatus, TaskType } from '../types/task.types';
import type { PromptMetadata } from './prompt-storage-service';
import type { PromptHistoryTaskSummary } from './task-storage-reader';

const mocks = vi.hoisted(() => ({
  getPromptHistoryTaskSummaries: vi.fn(),
  getHistory: vi.fn((): any[] => []),
  addHistory: vi.fn(),
  isContentPinned: vi.fn((_content: string): boolean => false),
  isContentDeleted: vi.fn(() => false),
  setContentPinned: vi.fn(() => true),
  deleteContents: vi.fn(),
  getHistoryOverride: vi.fn((): any => undefined),
  setHistoryOverride: vi.fn(() => true),
  resolveContent: vi.fn((content: string) => content.trim()),
  resolveMetadata: vi.fn((content: string): PromptMetadata => ({
    sourceContent: content.trim(),
    content: content.trim(),
    title: undefined,
    tags: undefined,
    modelType: undefined,
  })),
  setContentEdited: vi.fn(() => true),
}));

vi.mock('./task-storage-reader', () => ({
  taskStorageReader: {
    getPromptHistoryTaskSummaries: mocks.getPromptHistoryTaskSummaries,
  },
}));

vi.mock('./prompt-storage-service', () => ({
  promptStorageService: {
    getHistory: mocks.getHistory,
    addHistory: mocks.addHistory,
    isContentPinned: mocks.isContentPinned,
    isContentDeleted: mocks.isContentDeleted,
    setContentPinned: mocks.setContentPinned,
    deleteContents: mocks.deleteContents,
    getHistoryOverride: mocks.getHistoryOverride,
    setHistoryOverride: mocks.setHistoryOverride,
    resolveContent: mocks.resolveContent,
    resolveMetadata: mocks.resolveMetadata,
    setContentEdited: mocks.setContentEdited,
  },
}));

type PromptHistoryTaskSummaryOverrides = Omit<
  Partial<PromptHistoryTaskSummary>,
  'params'
> & {
  params?: Partial<PromptHistoryTaskSummary['params']>;
};

function createSummary(
  overrides: PromptHistoryTaskSummaryOverrides = {}
): PromptHistoryTaskSummary {
  const { params, ...restOverrides } = overrides;
  return {
    id: 'task-1',
    type: TaskType.IMAGE,
    status: TaskStatus.COMPLETED,
    createdAt: 1000,
    updatedAt: 1000,
    completedAt: 1200,
    params: {
      prompt: '发送提示词',
      promptMeta: undefined,
      sourcePrompt: undefined,
      rawInput: undefined,
      workflowId: undefined,
      batchIndex: undefined,
      batchTotal: undefined,
      model: undefined,
      title: undefined,
      tags: undefined,
      ...params,
    },
    result: {
      url: 'https://example.com/out.png',
      format: 'png',
      size: 1,
    } as PromptHistoryTaskSummary['result'],
    ...restOverrides,
  };
}

describe('prompt-history-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isContentPinned.mockReturnValue(false);
    mocks.isContentDeleted.mockReturnValue(false);
    mocks.getHistory.mockReturnValue([]);
    mocks.getHistoryOverride.mockReturnValue(undefined);
    mocks.setHistoryOverride.mockReturnValue(true);
    mocks.resolveContent.mockImplementation((content: string) => content.trim());
    mocks.resolveMetadata.mockImplementation((content: string): PromptMetadata => ({
      sourceContent: content.trim(),
      content: content.trim(),
      title: undefined,
      tags: undefined,
      modelType: undefined,
    }));
    mocks.setContentEdited.mockReturnValue(true);
  });

  it('uses initial prompt as title when initial and sent prompts differ', async () => {
    const { taskSummaryToPromptHistoryRecord } = await import(
      './prompt-history-service'
    );

    const record = taskSummaryToPromptHistoryRecord(
      createSummary({
        params: {
          prompt: '优化后的图片提示词',
          promptMeta: {
            initialPrompt: '一只猫',
            sentPrompt: '优化后的图片提示词',
            category: 'image',
          },
        },
      })
    );

    expect(record.title).toBe('一只猫');
    expect(record.sentPrompt).toBe('优化后的图片提示词');
  });

  it('falls back to first 20 chars of sent prompt when prompts match', async () => {
    const { taskSummaryToPromptHistoryRecord } = await import(
      './prompt-history-service'
    );
    const prompt = '这是一段很长很长的发送提示词，用来测试标题截断';

    const record = taskSummaryToPromptHistoryRecord(
      createSummary({
        params: {
          prompt,
          promptMeta: {
            initialPrompt: prompt,
            sentPrompt: prompt,
            category: 'text',
          },
        },
      })
    );

    expect(record.title).toBe(prompt.slice(0, 20));
  });

  it('restores old task prompts from rawInput before prompt', async () => {
    const { taskSummaryToPromptHistoryRecord } = await import(
      './prompt-history-service'
    );

    const record = taskSummaryToPromptHistoryRecord(
      createSummary({
        type: TaskType.CHAT,
        params: {
          prompt: '最终提示词',
          rawInput: '用户初始输入',
        },
      })
    );

    expect(record.category).toBe('text');
    expect(record.initialPrompt).toBe('用户初始输入');
    expect(record.sentPrompt).toBe('最终提示词');
  });

  it('keeps knowledge context out of prompt text while preserving note refs as tags', async () => {
    const { taskSummaryToPromptHistoryRecord } = await import(
      './prompt-history-service'
    );

    const record = taskSummaryToPromptHistoryRecord(
      createSummary({
        params: {
          prompt: '用户提示\n\n---\n【参考知识库笔记】\n完整笔记正文',
          knowledgeContextRefs: [
            {
              noteId: 'note-1',
              title: '产品定位',
              directoryId: 'dir-1',
              updatedAt: 2,
            },
          ],
        },
      })
    );

    expect(record.sentPrompt).toBe('用户提示');
    expect(record.initialPrompt).toBe('用户提示');
    expect(record.sourceSentPrompt).toBe('用户提示');
    expect(record.tags).toContain('知识库:产品定位');
    expect(record.sentPrompt).not.toContain('完整笔记正文');
  });

  it('uses Skill metadata for Agent records', async () => {
    const { taskSummaryToPromptHistoryRecord } = await import(
      './prompt-history-service'
    );

    const record = taskSummaryToPromptHistoryRecord(
      createSummary({
        type: TaskType.CHAT,
        params: {
          prompt: '生成一张封面',
          promptMeta: {
            category: 'agent',
            initialPrompt: '做封面',
            sentPrompt: '生成一张封面',
            skillId: 'skill-cover',
            skillName: '封面 Skill',
          },
        },
      })
    );

    expect(record.category).toBe('agent');
    expect(record.skillName).toBe('封面 Skill');
    expect(record.tags).toContain('封面 Skill');
  });

  it('maps image, video, audio, text and failed result previews', async () => {
    const { taskSummaryToPromptHistoryRecord } = await import(
      './prompt-history-service'
    );

    expect(
      taskSummaryToPromptHistoryRecord(
        createSummary({
          type: TaskType.IMAGE,
          result: {
            url: 'https://example.com/full.png',
            thumbnailUrl: 'https://example.com/thumb.png',
            format: 'png',
            size: 1,
          } as PromptHistoryTaskSummary['result'],
        })
      ).resultPreview
    ).toMatchObject({ kind: 'image', url: 'https://example.com/thumb.png' });

    expect(
      taskSummaryToPromptHistoryRecord(
        createSummary({
          type: TaskType.VIDEO,
          result: {
            url: 'https://example.com/out.mp4',
            thumbnailUrl: 'https://example.com/poster.jpg',
            format: 'mp4',
            size: 1,
          } as PromptHistoryTaskSummary['result'],
        })
      ).resultPreview
    ).toMatchObject({ kind: 'video', posterUrl: 'https://example.com/poster.jpg' });

    expect(
      taskSummaryToPromptHistoryRecord(
        createSummary({
          type: TaskType.VIDEO,
          result: {
            url: 'https://example.com/out.mp4',
            format: 'mp4',
            size: 1,
          } as PromptHistoryTaskSummary['result'],
        })
      ).resultPreview
    ).toMatchObject({ kind: 'video', url: 'https://example.com/out.mp4' });

    expect(
      taskSummaryToPromptHistoryRecord(
        createSummary({
          type: TaskType.AUDIO,
          result: {
            url: 'https://example.com/out.mp3',
            previewImageUrl: 'https://example.com/cover.jpg',
            title: '歌曲标题',
            format: 'mp3',
            size: 1,
          } as PromptHistoryTaskSummary['result'],
        })
      ).resultPreview
    ).toMatchObject({ kind: 'audio', coverUrl: 'https://example.com/cover.jpg' });

    expect(
      taskSummaryToPromptHistoryRecord(
        createSummary({
          type: TaskType.CHAT,
          params: { prompt: '写摘要', promptMeta: { category: 'text' } },
          result: {
            url: '',
            format: 'md',
            size: 10,
            resultKind: 'chat',
            chatResponse: '摘要结果',
          } as PromptHistoryTaskSummary['result'],
        })
      ).resultPreview
    ).toMatchObject({ kind: 'text', text: '摘要结果' });

    expect(
      taskSummaryToPromptHistoryRecord(
        createSummary({
          status: TaskStatus.FAILED,
          error: { code: 'ERR', message: '失败原因' },
          result: undefined,
        })
      ).resultPreview
    ).toEqual({ kind: 'error', text: '失败原因' });
  });

  it('classifies PPT slide image tasks separately and uses the slide prompt', async () => {
    const { taskSummaryToPromptHistoryRecord } = await import(
      './prompt-history-service'
    );

    const record = taskSummaryToPromptHistoryRecord(
      createSummary({
        type: TaskType.IMAGE,
        params: {
          prompt: '实际生图提示词',
          pptSlideImage: true,
          pptSlidePrompt: 'PPT 页面提示词',
        },
      })
    );

    expect(record).toMatchObject({
      category: 'ppt-slide',
      sentPrompt: 'PPT 页面提示词',
      sourceSentPrompt: 'PPT 页面提示词',
      resultPreview: { kind: 'image', url: 'https://example.com/out.png' },
    });
    expect(record.tags).toContain('ppt-slide');
  });

  it('loads pages through bounded task summary reads and filters results', async () => {
    const { getPromptHistoryPage } = await import('./prompt-history-service');
    mocks.getPromptHistoryTaskSummaries.mockResolvedValueOnce({
      items: [
        createSummary({
          id: 'image-task',
          type: TaskType.IMAGE,
          params: { prompt: '猫图' },
        }),
        createSummary({
          id: 'video-task',
          type: TaskType.VIDEO,
          params: { prompt: '猫视频' },
        }),
      ],
      nextOffset: 2,
      hasMore: false,
    });

    const page = await getPromptHistoryPage({
      category: 'video',
      search: '猫',
      limit: 10,
    });

    expect(page.records).toHaveLength(1);
    expect(page.records[0].taskId).toBe('video-task');
    expect(mocks.getPromptHistoryTaskSummaries).toHaveBeenCalledWith(
      expect.objectContaining({ offset: 0, limit: 80 })
    );
  });

  it('aggregates duplicated sent prompts and keeps latest time with combined results', async () => {
    const { getPromptHistoryPage } = await import('./prompt-history-service');
    mocks.getPromptHistoryTaskSummaries.mockResolvedValueOnce({
      items: [
        createSummary({
          id: 'older',
          createdAt: 1000,
          completedAt: 1000,
          params: { prompt: '相同发送提示词', promptMeta: { title: '短标题' } },
          result: {
            url: 'https://example.com/old.png',
            format: 'png',
            size: 1,
          } as PromptHistoryTaskSummary['result'],
        }),
        createSummary({
          id: 'newer',
          createdAt: 3000,
          completedAt: 3000,
          params: {
            prompt: '相同发送提示词',
            promptMeta: { title: '更长一点的标题' },
          },
          result: {
            url: 'https://example.com/new.png',
            format: 'png',
            size: 1,
          } as PromptHistoryTaskSummary['result'],
        }),
      ],
      nextOffset: 2,
      hasMore: false,
    });

    const page = await getPromptHistoryPage({ limit: 10 });

    expect(page.total).toBe(1);
    expect(page.records[0]).toMatchObject({
      taskId: 'newer',
      title: '更长一点的标题',
      createdAt: 3000,
      resultCount: 2,
    });
  });

  it('applies edited title, sent prompt and tags without changing the source key', async () => {
    const { getPromptHistoryPage, updatePromptHistoryRecord } = await import(
      './prompt-history-service'
    );
    mocks.getHistoryOverride.mockReturnValue({
      sourceSentPrompt: '原始发送提示词',
      title: '用户标题',
      sentPrompt: '用户修改后的发送提示词',
      tags: ['灵感', '收藏'],
      updatedAt: 2000,
    });
    mocks.getPromptHistoryTaskSummaries.mockResolvedValueOnce({
      items: [
        createSummary({
          id: 'edited',
          params: { prompt: '原始发送提示词' },
        }),
      ],
      nextOffset: 1,
      hasMore: false,
    });

    const page = await getPromptHistoryPage({ limit: 10 });

    expect(page.records[0]).toMatchObject({
      sourceSentPrompt: '原始发送提示词',
      title: '用户标题',
      sentPrompt: '用户修改后的发送提示词',
      tags: ['灵感', '收藏'],
    });
    expect(mocks.isContentDeleted).toHaveBeenCalledWith('原始发送提示词');
    mocks.resolveMetadata.mockReturnValueOnce({
      sourceContent: '原始发送提示词',
      content: '原始发送提示词',
      title: undefined,
      tags: undefined,
      modelType: undefined,
    });

    expect(
      updatePromptHistoryRecord({
        sourceSentPrompt: '原始发送提示词',
        sourceSentPrompts: ['原始发送提示词'],
        title: '用户标题',
        sentPrompt: '用户修改后的发送提示词',
        tags: ['灵感', '收藏'],
        category: 'image',
      })
    ).toBe(true);
    expect(mocks.setContentEdited).not.toHaveBeenCalled();
    expect(mocks.setHistoryOverride).toHaveBeenCalledWith('原始发送提示词', {
      title: '用户标题',
      sentPrompt: '原始发送提示词',
      tags: ['灵感', '收藏'],
      modelType: 'image',
    });
  });

  it('updates sent prompt content when editing is explicitly allowed', async () => {
    const { updatePromptHistoryRecord } = await import(
      './prompt-history-service'
    );
    mocks.resolveMetadata.mockReturnValueOnce({
      sourceContent: '旧发送提示词',
      content: '旧发送提示词',
      title: '旧标题',
      tags: ['旧标签'],
      modelType: 'text',
    });

    expect(
      updatePromptHistoryRecord({
        sourceSentPrompt: '旧发送提示词',
        sourceSentPrompts: ['旧发送提示词'],
        title: '新标题',
        sentPrompt: '新发送提示词',
        tags: ['新标签'],
        category: 'text',
        allowSentPromptEdit: true,
      })
    ).toBe(true);

    expect(mocks.setContentEdited).toHaveBeenCalledWith(
      ['旧发送提示词'],
      '新发送提示词',
      'text'
    );
    expect(mocks.setHistoryOverride).toHaveBeenCalledWith('旧发送提示词', {
      title: '新标题',
      sentPrompt: '新发送提示词',
      tags: ['新标签'],
      modelType: 'text',
    });
  });

  it('creates manual prompt records through storage service', async () => {
    const { createPromptHistoryRecord } = await import(
      './prompt-history-service'
    );

    expect(
      createPromptHistoryRecord({
        content: ' 手动提示词 ',
        title: '手动标题',
        tags: ['灵感'],
        category: 'image',
        pinned: true,
      })
    ).toBe(true);

    expect(mocks.addHistory).toHaveBeenCalledWith('手动提示词', undefined, 'image');
    expect(mocks.setHistoryOverride).toHaveBeenCalledWith('手动提示词', {
      title: '手动标题',
      sentPrompt: '手动提示词',
      tags: ['灵感'],
      modelType: 'image',
    });
    expect(mocks.setContentPinned).toHaveBeenCalledWith(
      '手动提示词',
      true,
      'image'
    );
  });

  it('includes manual records in page and supports filter, search and pinned sorting', async () => {
    const { getPromptHistoryPage } = await import('./prompt-history-service');
    mocks.getHistory.mockReturnValue([
      {
        id: 'manual-text',
        content: '普通手动提示词',
        timestamp: 2000,
        modelType: 'text',
      },
      {
        id: 'manual-image',
        content: '手动猫图',
        timestamp: 1000,
        pinned: true,
        modelType: 'image',
      },
    ]);
    mocks.resolveMetadata.mockImplementation((content: string) => {
      const trimmed = content.trim();
      if (trimmed === '手动猫图') {
        return {
          sourceContent: '手动猫图',
          content: '手动猫图',
          title: '收藏猫图',
          tags: ['收藏'],
          modelType: 'image',
        };
      }
      return {
        sourceContent: trimmed,
        content: trimmed,
        title: undefined,
        tags: undefined,
        modelType: undefined,
      };
    });
    mocks.isContentPinned.mockImplementation((content: string) => content === '手动猫图');
    mocks.getPromptHistoryTaskSummaries.mockResolvedValueOnce({
      items: [
        createSummary({
          id: 'task-image',
          createdAt: 3000,
          completedAt: 3000,
          params: { prompt: '任务猫图' },
        }),
      ],
      nextOffset: 1,
      hasMore: false,
    });

    const page = await getPromptHistoryPage({
      category: 'image',
      search: '猫图',
      limit: 10,
    });

    expect(page.records.map((record) => record.sentPrompt)).toEqual([
      '手动猫图',
      '任务猫图',
    ]);
    expect(page.records[0]).toMatchObject({
      title: '收藏猫图',
      category: 'image',
      pinned: true,
      resultCount: 0,
      resultPreviews: [],
    });
    expect(page.total).toBe(2);
  });
});
