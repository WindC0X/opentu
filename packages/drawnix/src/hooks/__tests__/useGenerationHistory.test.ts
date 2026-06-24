// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGenerationHistory } from '../useGenerationHistory';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';

const mocks = vi.hoisted(() => ({
  completedTasks: [] as Task[],
}));

vi.mock('../useTaskQueue', () => ({
  useTaskQueue: () => ({
    completedTasks: mocks.completedTasks,
  }),
}));

function createCompletedImageTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-history-image',
    type: TaskType.IMAGE,
    status: TaskStatus.COMPLETED,
    params: {
      prompt: 'history prompt',
      model: 'managed-image-binding',
    },
    result: {
      url: '/__aitu_cache__/image/task-history-image.png',
      contentUrl: '/creative/relay/v1/images/tasks/remote-history/content',
      remoteTaskId: 'remote-history',
      providerTaskId: 'provider-history',
      mimeType: 'image/png',
      width: 1024,
      height: 1024,
      format: 'png',
      size: 1,
    },
    createdAt: 1,
    updatedAt: 2,
    completedAt: 3,
    ...overrides,
  } as Task;
}

function createCompletedVideoTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-history-video',
    type: TaskType.VIDEO,
    status: TaskStatus.COMPLETED,
    params: {
      prompt: 'video history prompt',
      model: 'managed-video-binding',
    },
    result: {
      url: '/__aitu_cache__/video/task-history-video.mp4',
      format: 'mp4',
      size: 1,
      width: 1280,
      height: 720,
      duration: 5,
    },
    createdAt: 1,
    updatedAt: 2,
    completedAt: 3,
    ...overrides,
  } as Task;
}

describe('useGenerationHistory', () => {
  beforeEach(() => {
    mocks.completedTasks = [];
  });

  it('preserves generated image rehydrate metadata for history thumbnails', () => {
    mocks.completedTasks = [createCompletedImageTask()];

    const { result } = renderHook(() => useGenerationHistory());

    expect(result.current.imageHistory).toHaveLength(1);
    expect(result.current.imageHistory[0]).toEqual(
      expect.objectContaining({
        imageUrl: '/__aitu_cache__/image/task-history-image.png',
        rehydrateSourceUrl:
          '/creative/relay/v1/images/tasks/remote-history/content',
        rehydrateMetadata: expect.objectContaining({
          taskId: 'task-history-image',
          remoteTaskId: 'remote-history',
          providerTaskId: 'provider-history',
          contentUrl: '/creative/relay/v1/images/tasks/remote-history/content',
          mimeType: 'image/png',
          prompt: 'history prompt',
          model: 'managed-image-binding',
        }),
      })
    );
  });

  it('uses the video placeholder instead of trying to render a video URL as an image thumbnail', () => {
    mocks.completedTasks = [createCompletedVideoTask()];

    const { result } = renderHook(() => useGenerationHistory());

    expect(result.current.videoHistory).toHaveLength(1);
    expect(result.current.videoHistory[0]).toEqual(
      expect.objectContaining({
        type: 'video',
        imageUrl: undefined,
        previewUrl: '/__aitu_cache__/video/task-history-video.mp4',
        downloadUrl: '/__aitu_cache__/video/task-history-video.mp4',
      })
    );
  });

  it('uses an actual video thumbnail when one is available', () => {
    mocks.completedTasks = [
      createCompletedVideoTask({
        result: {
          url: '/__aitu_cache__/video/task-history-video.mp4',
          thumbnailUrl: '/__aitu_cache__/image/task-history-video-poster.png',
          format: 'mp4',
          size: 1,
        },
      }),
    ];

    const { result } = renderHook(() => useGenerationHistory());

    expect(result.current.videoHistory[0]).toEqual(
      expect.objectContaining({
        imageUrl: '/__aitu_cache__/image/task-history-video-poster.png',
      })
    );
  });

  it('uses previewImageUrl as the video history thumbnail fallback', () => {
    mocks.completedTasks = [
      createCompletedVideoTask({
        result: {
          url: '/__aitu_cache__/video/task-history-video.mp4',
          previewImageUrl: '/__aitu_cache__/image/task-history-video-preview.png',
          format: 'mp4',
          size: 1,
        },
      }),
    ];

    const { result } = renderHook(() => useGenerationHistory());

    expect(result.current.videoHistory[0]).toEqual(
      expect.objectContaining({
        imageUrl: '/__aitu_cache__/image/task-history-video-preview.png',
      })
    );
  });
});
