// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGeneratedMediaCacheMissRecovery } from '../useGeneratedMediaCacheMissRecovery';
import { GENERATED_MEDIA_CACHE_MISS_EVENT } from '../../utils/asset-cleanup';
import { TaskStatus, TaskType } from '../../types/task.types';
import {
  rehydrateGeneratedImageCacheUrl,
  rehydrateGeneratedVideoCacheUrl,
} from '../../utils/generated-media-cache';
import { Transforms } from '@plait/core';

const mocks = vi.hoisted(() => ({
  tasks: [] as any[],
  getAllTasks: vi.fn(() => [] as any[]),
  getStoredTasks: vi.fn(async () => [] as any[]),
  getStoredTask: vi.fn(async (_taskId: string) => null as any),
  findImageTaskIdByResultUrl: vi.fn(
    async (_imageUrl: string) => null as string | null
  ),
  rehydrateGeneratedImageCacheUrl: vi.fn(async () => new Blob(['image'])),
  rehydrateGeneratedVideoCacheUrl: vi.fn(async () => new Blob(['video'])),
  setNode: vi.fn(),
}));

vi.mock('../../services/task-queue', () => ({
  taskQueueService: {
    getAllTasks: mocks.getAllTasks,
  },
}));

vi.mock('../../services/task-storage-reader', () => ({
  taskStorageReader: {
    getAllTasks: mocks.getStoredTasks,
    getTask: mocks.getStoredTask,
    findImageTaskIdByResultUrl: mocks.findImageTaskIdByResultUrl,
  },
}));

vi.mock('../../utils/generated-media-cache', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../utils/generated-media-cache')
  >();
  return {
    ...actual,
    rehydrateGeneratedImageCacheUrl: mocks.rehydrateGeneratedImageCacheUrl,
    rehydrateGeneratedVideoCacheUrl: mocks.rehydrateGeneratedVideoCacheUrl,
  };
});

vi.mock('@plait/core', () => ({
  Transforms: {
    setNode: mocks.setNode,
  },
}));

describe('useGeneratedMediaCacheMissRecovery', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    mocks.tasks = [
      {
        id: 'task-local-1',
        type: TaskType.IMAGE,
        status: TaskStatus.COMPLETED,
        remoteId: 'remote-1',
        params: {
          prompt: 'restore image',
          model: 'mock:gpt-image-2:preview',
        },
        result: {
          url: '/__aitu_cache__/image/remote-1.png',
          contentUrl: '/creative/relay/v1/images/tasks/remote-1/content',
          remoteTaskId: 'remote-1',
          mimeType: 'image/png',
          format: 'png',
          size: 1,
        },
        createdAt: 1,
        updatedAt: 2,
        completedAt: 3,
      },
    ];
    mocks.getAllTasks.mockReset();
    mocks.getAllTasks.mockImplementation(() => mocks.tasks);
    mocks.getStoredTasks.mockReset();
    mocks.getStoredTasks.mockResolvedValue([]);
    mocks.getStoredTask.mockReset();
    mocks.getStoredTask.mockResolvedValue(null);
    mocks.findImageTaskIdByResultUrl.mockReset();
    mocks.findImageTaskIdByResultUrl.mockResolvedValue(null);
    mocks.rehydrateGeneratedImageCacheUrl.mockClear();
    mocks.rehydrateGeneratedImageCacheUrl.mockResolvedValue(
      new Blob(['image'], { type: 'image/png' })
    );
    mocks.rehydrateGeneratedVideoCacheUrl.mockClear();
    mocks.rehydrateGeneratedVideoCacheUrl.mockResolvedValue(
      new Blob(['video'], { type: 'video/mp4' })
    );
    mocks.setNode.mockClear();
  });

  it('rehydrates a generated canvas image cache miss from its task contentUrl and retriggers the canvas image URL', async () => {
    const board = {
      children: [
        {
          id: 'image-element-1',
          url: '/__aitu_cache__/image/remote-1.png',
        },
      ],
    } as any;

    renderHook(() => useGeneratedMediaCacheMissRecovery(board, true));

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(GENERATED_MEDIA_CACHE_MISS_EVENT, {
          detail: {
            taskId: 'remote-1',
            elementId: 'image-element-1',
            imageUrl: '/__aitu_cache__/image/remote-1.png',
          },
        })
      );
      await Promise.resolve();
    });

    expect(rehydrateGeneratedImageCacheUrl).toHaveBeenCalledWith(
      '/__aitu_cache__/image/remote-1.png',
      '/creative/relay/v1/images/tasks/remote-1/content',
      expect.objectContaining({
        taskId: 'task-local-1',
        remoteTaskId: 'remote-1',
        contentUrl: '/creative/relay/v1/images/tasks/remote-1/content',
        mimeType: 'image/png',
      })
    );
    expect(Transforms.setNode).toHaveBeenCalledWith(
      board,
      expect.objectContaining({
        url: expect.stringMatching(
          new RegExp('^/__aitu_cache__/image/remote-1\\.png\\?_retry=')
        ),
      }),
      [0]
    );
  });

  it('falls back to archived stored tasks when a generated cache miss is not in memory', async () => {
    const storedTask = {
      ...mocks.tasks[0],
      id: 'task-stored-1',
      archived: true,
    };
    mocks.getAllTasks.mockReturnValue([]);
    mocks.findImageTaskIdByResultUrl.mockResolvedValue('task-stored-1');
    mocks.getStoredTask.mockImplementation(async (taskId: string) =>
      taskId === 'task-stored-1' ? storedTask : null
    );
    const board = {
      children: [
        {
          id: 'stored-image-element-1',
          url: '/__aitu_cache__/image/remote-1.png',
        },
      ],
    } as any;

    renderHook(() => useGeneratedMediaCacheMissRecovery(board, true));

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(GENERATED_MEDIA_CACHE_MISS_EVENT, {
          detail: {
            taskId: 'remote-1',
            elementId: 'stored-image-element-1',
            imageUrl: '/__aitu_cache__/image/remote-1.png',
          },
        })
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mocks.findImageTaskIdByResultUrl).toHaveBeenCalledWith(
        '/__aitu_cache__/image/remote-1.png',
        { includeArchived: true }
      );
      expect(mocks.getStoredTask).toHaveBeenCalledWith('task-stored-1');
      expect(mocks.getStoredTasks).not.toHaveBeenCalled();
      expect(rehydrateGeneratedImageCacheUrl).toHaveBeenCalledWith(
        '/__aitu_cache__/image/remote-1.png',
        '/creative/relay/v1/images/tasks/remote-1/content',
        expect.objectContaining({
          taskId: 'task-stored-1',
          remoteTaskId: 'remote-1',
        })
      );
      expect(Transforms.setNode).toHaveBeenCalledWith(
        board,
        expect.objectContaining({
          url: expect.stringMatching(
            new RegExp('^/__aitu_cache__/image/remote-1\\.png\\?_retry=')
          ),
        }),
        [0]
      );
    });
  });

  it('rehydrates from durable canvas node metadata when task records are unavailable', async () => {
    mocks.getAllTasks.mockReturnValue([]);
    mocks.findImageTaskIdByResultUrl.mockResolvedValue(null);
    mocks.getStoredTasks.mockResolvedValue([]);
    const board = {
      children: [
        {
          id: 'metadata-only-image',
          url: '/__aitu_cache__/image/metadata-only.png',
          contentUrl: '/creative/relay/v1/images/tasks/remote-metadata/content',
          remoteTaskId: 'remote-metadata',
          providerTaskId: 'provider-metadata',
          mimeType: 'image/png',
        },
      ],
    } as any;

    renderHook(() => useGeneratedMediaCacheMissRecovery(board, true));

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(GENERATED_MEDIA_CACHE_MISS_EVENT, {
          detail: {
            elementId: 'metadata-only-image',
            imageUrl: '/__aitu_cache__/image/metadata-only.png',
          },
        })
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(rehydrateGeneratedImageCacheUrl).toHaveBeenCalledWith(
        '/__aitu_cache__/image/metadata-only.png',
        '/creative/relay/v1/images/tasks/remote-metadata/content',
        expect.objectContaining({
          remoteTaskId: 'remote-metadata',
          providerTaskId: 'provider-metadata',
          contentUrl: '/creative/relay/v1/images/tasks/remote-metadata/content',
          mimeType: 'image/png',
        })
      );
      expect(Transforms.setNode).toHaveBeenCalledWith(
        board,
        expect.objectContaining({
          url: expect.stringMatching(
            new RegExp('^/__aitu_cache__/image/metadata-only\\.png\\?_retry=')
          ),
        }),
        [0]
      );
    });
  });

  it('buffers generated canvas cache misses while disabled and rehydrates when enabled', async () => {
    const board = {
      children: [
        {
          id: 'image-element-buffered',
          url: '/__aitu_cache__/image/remote-1.png',
        },
      ],
    } as any;

    const { rerender } = renderHook(
      ({ enabled }) => useGeneratedMediaCacheMissRecovery(board, enabled),
      { initialProps: { enabled: false } }
    );

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(GENERATED_MEDIA_CACHE_MISS_EVENT, {
          detail: {
            taskId: 'remote-1',
            elementId: 'image-element-buffered',
            imageUrl: '/__aitu_cache__/image/remote-1.png',
          },
        })
      );
      await Promise.resolve();
    });

    expect(rehydrateGeneratedImageCacheUrl).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => {
      expect(rehydrateGeneratedImageCacheUrl).toHaveBeenCalledWith(
        '/__aitu_cache__/image/remote-1.png',
        '/creative/relay/v1/images/tasks/remote-1/content',
        expect.objectContaining({
          taskId: 'task-local-1',
          remoteTaskId: 'remote-1',
          contentUrl: '/creative/relay/v1/images/tasks/remote-1/content',
        })
      );
      expect(Transforms.setNode).toHaveBeenCalledWith(
        board,
        expect.objectContaining({
          url: expect.stringMatching(
            new RegExp('^/__aitu_cache__/image/remote-1\\.png\\?_retry=')
          ),
        }),
        [0]
      );
    });
  });

  it('derives Creative contentUrl from providerTaskId when stored contentUrl is missing', async () => {
    mocks.tasks = [
      {
        ...mocks.tasks[0],
        remoteId: 'remote-derived-1',
        result: {
          ...mocks.tasks[0].result,
          contentUrl: undefined,
          remoteTaskId: undefined,
          providerTaskId: 'remote-derived-1',
          url: '/__aitu_cache__/image/remote-derived-1.png',
        },
      },
    ];
    mocks.getAllTasks.mockImplementation(() => mocks.tasks);
    const board = {
      children: [
        {
          id: 'image-element-derived',
          url: '/__aitu_cache__/image/remote-derived-1.png',
        },
      ],
    } as any;

    renderHook(() => useGeneratedMediaCacheMissRecovery(board, true));

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(GENERATED_MEDIA_CACHE_MISS_EVENT, {
          detail: {
            taskId: 'remote-derived-1',
            elementId: 'image-element-derived',
            imageUrl: '/__aitu_cache__/image/remote-derived-1.png',
          },
        })
      );
      await Promise.resolve();
    });

    expect(rehydrateGeneratedImageCacheUrl).toHaveBeenCalledWith(
      '/__aitu_cache__/image/remote-derived-1.png',
      '/creative/relay/v1/images/tasks/remote-derived-1/content',
      expect.objectContaining({
        taskId: 'task-local-1',
        remoteTaskId: 'remote-derived-1',
        providerTaskId: 'remote-derived-1',
        contentUrl: '/creative/relay/v1/images/tasks/remote-derived-1/content',
      })
    );
  });

  it('requeues transient generated image cache misses and retries recovery instead of dropping the event', async () => {
    vi.useFakeTimers();
    mocks.rehydrateGeneratedImageCacheUrl
      .mockRejectedValueOnce(new Error('content rehydrate failed: 409'))
      .mockResolvedValueOnce(new Blob(['image'], { type: 'image/png' }));
    const board = {
      children: [
        {
          id: 'image-element-retry',
          url: '/__aitu_cache__/image/remote-1.png',
        },
      ],
    } as any;

    try {
      renderHook(() => useGeneratedMediaCacheMissRecovery(board, true));

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent(GENERATED_MEDIA_CACHE_MISS_EVENT, {
            detail: {
              taskId: 'remote-1',
              elementId: 'image-element-retry',
              imageUrl: '/__aitu_cache__/image/remote-1.png',
            },
          })
        );
        await Promise.resolve();
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(rehydrateGeneratedImageCacheUrl).toHaveBeenCalledTimes(1);
      expect(Transforms.setNode).not.toHaveBeenCalled();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
        await Promise.resolve();
      });

      expect(rehydrateGeneratedImageCacheUrl).toHaveBeenCalledTimes(2);
      expect(Transforms.setNode).toHaveBeenCalledWith(
        board,
        expect.objectContaining({
          url: expect.stringMatching(
            new RegExp('^/__aitu_cache__/image/remote-1\\.png\\?_retry=')
          ),
        }),
        [0]
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not drain a buffered cache miss for a different board id', async () => {
    const board = {
      __plait_id: 'board-b',
      children: [
        {
          id: 'image-element-buffer-other-board',
          url: '/__aitu_cache__/image/remote-1.png',
        },
      ],
    } as any;

    const { rerender } = renderHook(
      ({ enabled }) => useGeneratedMediaCacheMissRecovery(board, enabled),
      { initialProps: { enabled: false } }
    );

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(GENERATED_MEDIA_CACHE_MISS_EVENT, {
          detail: {
            boardId: 'board-a',
            taskId: 'remote-1',
            elementId: 'image-element-buffer-other-board',
            imageUrl: '/__aitu_cache__/image/remote-1.png',
          },
        })
      );
      await Promise.resolve();
    });

    rerender({ enabled: true });
    await act(async () => {
      await Promise.resolve();
    });

    expect(rehydrateGeneratedImageCacheUrl).not.toHaveBeenCalled();
    expect(Transforms.setNode).not.toHaveBeenCalled();
  });

  it('rehydrates generated video cache misses from task remote id content and retriggers the video URL', async () => {
    mocks.tasks = [
      {
        id: 'task-video-local-1',
        type: TaskType.VIDEO,
        status: TaskStatus.COMPLETED,
        remoteId: 'remote-video-1',
        params: {
          prompt: 'restore video',
          model: 'mock:sora:preview',
        },
        result: {
          url: '/__aitu_cache__/video/remote-video-1.mp4',
          format: 'mp4',
          size: 1,
          duration: 5,
        },
        createdAt: 1,
        updatedAt: 2,
        completedAt: 3,
      },
    ];
    mocks.getAllTasks.mockImplementation(() => mocks.tasks);
    const board = {
      children: [
        {
          id: 'video-element-1',
          url: '/__aitu_cache__/video/remote-video-1.mp4#video',
          isVideo: true,
        },
      ],
    } as any;

    renderHook(() => useGeneratedMediaCacheMissRecovery(board, true));

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent(GENERATED_MEDIA_CACHE_MISS_EVENT, {
          detail: {
            mediaType: 'video',
            taskId: 'remote-video-1',
            elementId: 'video-element-1',
            mediaUrl: '/__aitu_cache__/video/remote-video-1.mp4#video',
          },
        })
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(rehydrateGeneratedVideoCacheUrl).toHaveBeenCalledWith(
        '/__aitu_cache__/video/remote-video-1.mp4#video',
        '/creative/relay/v1/videos/remote-video-1/content',
        expect.objectContaining({
          taskId: 'task-video-local-1',
          remoteTaskId: 'remote-video-1',
          contentUrl: '/creative/relay/v1/videos/remote-video-1/content',
        })
      );
      expect(Transforms.setNode).toHaveBeenCalledWith(
        board,
        expect.objectContaining({
          url: expect.stringMatching(
            new RegExp('^/__aitu_cache__/video/remote-video-1\\.mp4\\?_retry=.*#video$')
          ),
        }),
        [0]
      );
    });
  });
});
