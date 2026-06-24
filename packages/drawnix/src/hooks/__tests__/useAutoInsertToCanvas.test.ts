// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useAutoInsertToCanvas,
  clearInsertedTaskIds,
} from '../useAutoInsertToCanvas';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';
import { IMAGE_GENERATION_ANCHOR_RETRY_EVENT } from '../../types/image-generation-anchor.types';
import { parseSizeToPixels } from '../../services/canvas-operations';
import {
  handleSplitAndInsertTask,
  isGridImageTask,
  isInspirationBoardTask,
} from '../../services/media-result-handler';
import { insertMediaIntoFrame } from '../../utils/frame-insertion-utils';

const mocks = vi.hoisted(() => {
  const taskListeners: Array<(event: any) => void> = [];
  const completionListeners: Array<(event: any) => void> = [];
  const taskState = {
    tasks: [] as any[],
  };

  return {
    board: null as any,
    taskListeners,
    completionListeners,
    taskState,
    quickInsert: vi.fn(),
    insertImageGroup: vi.fn(),
    executeCanvasInsertion: vi.fn(),
    getCachedBlob: vi.fn(),
    cacheMediaFromBlob: vi.fn(),
    markAsInserted: vi.fn(),
    registerTask: vi.fn(),
    startPostProcessing: vi.fn(),
    completePostProcessing: vi.fn(),
    failPostProcessing: vi.fn(),
    clearTask: vi.fn(),
    getPostProcessingStatus: vi.fn(),
    retryTask: vi.fn(),
    updateAnchor: vi.fn(),
  };
});

vi.mock('../../services/task-queue', () => {
  const taskQueueService = {
    getAllTasks: () => mocks.taskState.tasks,
    getTask: (taskId: string) =>
      mocks.taskState.tasks.find((task) => task.id === taskId),
    markAsInserted: mocks.markAsInserted,
    retryTask: mocks.retryTask,
    observeTaskUpdates: () => ({
      subscribe: (listener: (event: any) => void) => {
        mocks.taskListeners.push(listener);
        return {
          unsubscribe: () => {
            const index = mocks.taskListeners.indexOf(listener);
            if (index >= 0) {
              mocks.taskListeners.splice(index, 1);
            }
          },
        };
      },
    }),
  };

  return {
    getTaskQueueService: () => taskQueueService,
    taskQueueService,
  };
});

vi.mock('../../services/workflow-completion-service', () => ({
  workflowCompletionService: {
    registerTask: mocks.registerTask,
    startPostProcessing: mocks.startPostProcessing,
    completePostProcessing: mocks.completePostProcessing,
    failPostProcessing: mocks.failPostProcessing,
    clearTask: mocks.clearTask,
    getPostProcessingStatus: mocks.getPostProcessingStatus,
    isPostProcessingCompleted: vi.fn(() => true),
    observeCompletionEvents: () => ({
      subscribe: (listener: (event: any) => void) => {
        mocks.completionListeners.push(listener);
        return {
          unsubscribe: () => {
            const index = mocks.completionListeners.indexOf(listener);
            if (index >= 0) {
              mocks.completionListeners.splice(index, 1);
            }
          },
        };
      },
    }),
  },
}));

vi.mock('../../services/canvas-operations', () => ({
  getCanvasBoard: () => mocks.board,
  executeCanvasInsertion: mocks.executeCanvasInsertion,
  insertAIFlow: vi.fn(),
  insertImageGroup: mocks.insertImageGroup,
  parseSizeToPixels: vi.fn(() => ({ width: 512, height: 512 })),
  quickInsert: mocks.quickInsert,
}));

vi.mock('../../services/unified-cache-service', () => ({
  unifiedCacheService: {
    getCachedBlob: mocks.getCachedBlob,
    cacheMediaFromBlob: mocks.cacheMediaFromBlob,
  },
}));

vi.mock('../../data/audio', () => ({
  AUDIO_CARD_DEFAULT_HEIGHT: 144,
  AUDIO_CARD_DEFAULT_WIDTH: 360,
}));

vi.mock('../../plugins/with-image-generation-anchor', () => ({
  ImageGenerationAnchorTransforms: {
    getAnchorByTaskId: vi.fn(() => null),
    getAnchorByBatchSlot: vi.fn(() => null),
    getAnchorsByWorkflowId: vi.fn(() => []),
    updateAnchor: mocks.updateAnchor,
    updateGeometry: vi.fn(),
  },
}));

vi.mock('../../plugins/with-workzone', () => ({
  WorkZoneTransforms: {
    getAllWorkZones: vi.fn(() => []),
    updateWorkflow: vi.fn(),
    removeWorkZone: vi.fn(),
  },
}));

vi.mock('../../services/media-result-handler', () => ({
  isGridImageTask: vi.fn(() => false),
  isInspirationBoardTask: vi.fn(() => false),
  handleSplitAndInsertTask: vi.fn(),
}));

vi.mock('../../utils/selection-utils', () => ({
  getInsertionPointBelowBottommostElement: vi.fn(() => [100, 100]),
}));

vi.mock('../../utils/frame-insertion-utils', () => ({
  insertMediaIntoFrame: vi.fn(),
  replacePPTSlideImage: vi.fn(),
  setFramePPTMeta: vi.fn(),
}));

function createCompletedImageTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    type: TaskType.IMAGE,
    status: TaskStatus.COMPLETED,
    params: {
      prompt: '生成一张图',
      size: '1:1',
      autoInsertToCanvas: true,
    },
    result: {
      url: '/__aitu_cache__/image/task-1.png',
      format: 'png',
      size: 123,
    },
    createdAt: 1,
    updatedAt: 2,
    completedAt: 2,
    insertedToCanvas: false,
    ...overrides,
  };
}


function createCompletedVideoTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'video-task-1',
    type: TaskType.VIDEO,
    status: TaskStatus.COMPLETED,
    params: {
      prompt: '生成一段视频',
      size: '16:9',
      autoInsertToCanvas: true,
    },
    result: {
      url: '/__aitu_cache__/video/video-task-1.mp4',
      format: 'mp4',
      size: 123,
    },
    createdAt: 1,
    updatedAt: 2,
    completedAt: 2,
    insertedToCanvas: false,
    ...overrides,
  };
}

function emitTaskEvent(
  task: Task,
  type: 'taskUpdated' | 'taskCreated' = 'taskUpdated'
) {
  mocks.taskListeners.forEach((listener) => {
    listener({
      type,
      task,
      timestamp: Date.now(),
    });
  });
}

describe('useAutoInsertToCanvas', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearInsertedTaskIds();
    mocks.board = null;
    mocks.taskListeners.length = 0;
    mocks.completionListeners.length = 0;
    mocks.taskState.tasks = [];
    mocks.quickInsert.mockReset();
    mocks.executeCanvasInsertion.mockReset();
    mocks.executeCanvasInsertion.mockResolvedValue({
      success: true,
      data: {
        insertedCount: 1,
        items: [
          {
            type: 'text',
            point: [100, 100],
            elementId: 'text-1',
            size: { width: 512, height: 120 },
          },
        ],
        firstElementId: 'text-1',
        firstElementPosition: [100, 100],
        firstElementSize: { width: 512, height: 120 },
      },
    });
    mocks.insertImageGroup.mockReset();
    mocks.insertImageGroup.mockResolvedValue({
      success: true,
      data: {
        insertedCount: 2,
        items: [
          {
            type: 'image',
            point: [100, 100],
            elementId: 'image-group-1',
            size: { width: 512, height: 512 },
          },
        ],
        firstElementId: 'image-group-1',
        firstElementPosition: [100, 100],
        firstElementSize: { width: 512, height: 512 },
      },
    });
    mocks.getCachedBlob.mockReset();
    mocks.getCachedBlob.mockResolvedValue(
      new Blob(['image'], { type: 'image/png' })
    );
    mocks.cacheMediaFromBlob.mockReset();
    mocks.cacheMediaFromBlob.mockImplementation(
      async (url: string) => url
    );
    vi.mocked(parseSizeToPixels).mockClear();
    vi.mocked(parseSizeToPixels).mockReturnValue({ width: 512, height: 512 });
    mocks.quickInsert.mockResolvedValue({
      success: true,
      data: {
        insertedCount: 1,
        items: [
          {
            type: 'image',
            point: [100, 100],
            elementId: 'image-1',
            size: { width: 512, height: 512 },
          },
        ],
        firstElementId: 'image-1',
        firstElementPosition: [100, 100],
        firstElementSize: { width: 512, height: 512 },
      },
    });
    mocks.markAsInserted.mockReset();
    mocks.registerTask.mockReset();
    mocks.startPostProcessing.mockReset();
    mocks.completePostProcessing.mockReset();
    mocks.failPostProcessing.mockReset();
    mocks.clearTask.mockReset();
    mocks.getPostProcessingStatus.mockReset();
    mocks.getPostProcessingStatus.mockReturnValue(undefined);
    mocks.retryTask.mockReset();
    mocks.updateAnchor.mockReset();
    vi.mocked(isGridImageTask).mockReturnValue(false);
    vi.mocked(isInspirationBoardTask).mockReturnValue(false);
    vi.mocked(handleSplitAndInsertTask).mockReset();
    vi.mocked(handleSplitAndInsertTask).mockResolvedValue({
      success: true,
      count: 1,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('retries pending completed inserts when the canvas board is not ready yet', async () => {
    const task = createCompletedImageTask();
    mocks.taskState.tasks = [task];
    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      emitTaskEvent(task);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(mocks.quickInsert).not.toHaveBeenCalled();

    mocks.board = { children: [] };

    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.markAsInserted).toHaveBeenCalledWith(task.id, 'auto_insert');
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      task.id,
      1,
      [100, 100],
      'image-1',
      { width: 512, height: 512 }
    );
  });



  it('passes generated video rehydrate metadata through auto quick insert', async () => {
    const task = createCompletedVideoTask({
      id: 'task-video-metadata',
      remoteId: 'remote-video-metadata',
      result: {
        url: '/__aitu_cache__/video/remote-video-metadata.mp4',
        contentUrl: '/creative/relay/v1/videos/remote-video-metadata/content',
        remoteTaskId: 'remote-video-metadata',
        providerTaskId: 'provider-video-metadata',
        mimeType: 'video/mp4',
        format: 'mp4',
        size: 123,
      },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      emitTaskEvent(task);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.quickInsert).toHaveBeenCalledWith(
      'video',
      '/__aitu_cache__/video/remote-video-metadata.mp4',
      [100, 100],
      { width: 512, height: 512 },
      expect.objectContaining({
        contentUrl: '/creative/relay/v1/videos/remote-video-metadata/content',
        remoteTaskId: 'remote-video-metadata',
        providerTaskId: 'provider-video-metadata',
        mimeType: 'video/mp4',
      })
    );
  });

  it('passes generated video rehydrate metadata through frame insertion', async () => {
    const task = createCompletedVideoTask({
      id: 'task-video-frame-metadata',
      params: {
        prompt: '生成 frame 视频',
        autoInsertToCanvas: true,
        targetFrameId: 'frame-video-1',
        targetFrameDimensions: { width: 1280, height: 720 },
      },
      remoteId: 'remote-video-frame',
      result: {
        url: '/__aitu_cache__/video/remote-video-frame.mp4',
        contentUrl: '/creative/relay/v1/videos/remote-video-frame/content',
        remoteTaskId: 'remote-video-frame',
        providerTaskId: 'provider-video-frame',
        mimeType: 'video/mp4',
        format: 'mp4',
        size: 123,
      },
    });
    vi.mocked(insertMediaIntoFrame).mockResolvedValue({
      point: [100, 100],
      elementId: 'frame-video-node-1',
      size: { width: 1280, height: 720 },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      emitTaskEvent(task);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(insertMediaIntoFrame).toHaveBeenCalledWith(
      mocks.board,
      '/__aitu_cache__/video/remote-video-frame.mp4',
      'video',
      'frame-video-1',
      { width: 1280, height: 720 },
      { width: 512, height: 512 },
      undefined,
      {
        metadata: expect.objectContaining({
          contentUrl: '/creative/relay/v1/videos/remote-video-frame/content',
          remoteTaskId: 'remote-video-frame',
          providerTaskId: 'provider-video-frame',
          mimeType: 'video/mp4',
        }),
      }
    );
  });

  it('uses schema-backed Creative aspect ratio userParams for canvas insertion dimensions', async () => {
    const task = createCompletedImageTask({
      id: 'task-schema-backed',
      params: {
        prompt: '生成 21:9 图',
        userParams: {
          aspectRatio: '21:9',
          imageSize: '1K',
          quality: 'high',
        },
        creativeManaged: true,
        autoInsertToCanvas: true,
      },
      result: {
        url: '/__aitu_cache__/image/task-schema-backed.png',
        format: 'png',
        size: 123,
      },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      emitTaskEvent(task);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(parseSizeToPixels).toHaveBeenCalledWith('21x9');
    expect(mocks.quickInsert).toHaveBeenCalledWith(
      'image',
      '/__aitu_cache__/image/task-schema-backed.png',
      [100, 100],
      { width: 512, height: 512 },
      undefined
    );
  });

  it('uses decoded actual image dimensions as the final canvas ratio when available', async () => {
    const task = createCompletedImageTask({
      id: 'task-actual-dimensions',
      params: {
        prompt: '生成真实比例图',
        userParams: {
          aspectRatio: '1:1',
          imageSize: '1K',
        },
        creativeManaged: true,
        autoInsertToCanvas: true,
      },
      result: {
        url: '/__aitu_cache__/image/task-actual-dimensions.png',
        format: 'png',
        size: 123,
        width: 3840,
        height: 1648,
        targetWidth: 1024,
        targetHeight: 1024,
      },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      emitTaskEvent(task);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(parseSizeToPixels).toHaveBeenCalledWith('3840x1648');
    expect(mocks.quickInsert).toHaveBeenCalledWith(
      'image',
      '/__aitu_cache__/image/task-actual-dimensions.png',
      [100, 100],
      { width: 512, height: 512 },
      undefined
    );
  });

  it('uses backend target image dimensions when decoded actual dimensions are not available yet', async () => {
    const task = createCompletedImageTask({
      id: 'task-target-dimensions',
      params: {
        prompt: '生成目标比例图',
        userParams: {
          aspectRatio: '1:1',
          imageSize: '1K',
        },
        creativeManaged: true,
        autoInsertToCanvas: true,
      },
      result: {
        url: '/__aitu_cache__/image/task-target-dimensions.png',
        format: 'png',
        size: 123,
        targetWidth: 1792,
        targetHeight: 768,
      },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      emitTaskEvent(task);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(parseSizeToPixels).toHaveBeenCalledWith('1792x768');
    expect(mocks.quickInsert).toHaveBeenCalledWith(
      'image',
      '/__aitu_cache__/image/task-target-dimensions.png',
      [100, 100],
      { width: 512, height: 512 },
      undefined
    );
  });

  it('does not mark generated image post-processing complete when cache verification fails', async () => {
    const task = createCompletedImageTask({
      id: 'task-cache-miss',
      result: {
        url: '/__aitu_cache__/image/task-cache-miss.png',
        format: 'png',
        size: 123,
      },
    });
    mocks.getCachedBlob.mockResolvedValue(null);
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      emitTaskEvent(task);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.quickInsert).not.toHaveBeenCalled();
    expect(mocks.completePostProcessing).not.toHaveBeenCalled();
    expect(mocks.markAsInserted).not.toHaveBeenCalled();
    expect(mocks.failPostProcessing).toHaveBeenCalledWith(
      task.id,
      expect.stringContaining('cache')
    );
  });

  it('does not mark post-processing complete when canvas insertion reports failure', async () => {
    const task = createCompletedImageTask({
      id: 'task-insert-failure',
    });
    mocks.quickInsert.mockResolvedValueOnce({
      success: false,
      error: 'canvas insert failed',
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      emitTaskEvent(task);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.completePostProcessing).not.toHaveBeenCalled();
    expect(mocks.markAsInserted).not.toHaveBeenCalled();
    expect(mocks.failPostProcessing).toHaveBeenCalledWith(
      task.id,
      expect.stringContaining('canvas insert failed')
    );
  });

  it('passes generated metadata through grouped PPT slide frame insertion', async () => {
    const taskA = createCompletedImageTask({
      id: 'task-ppt-a',
      params: {
        prompt: 'PPT slide image',
        autoInsertToCanvas: true,
        pptSlideImage: true,
        targetFrameId: 'frame-1',
        targetFrameDimensions: { width: 1024, height: 576 },
      },
      result: {
        url: '/__aitu_cache__/image/task-ppt-a.png',
        contentUrl: '/creative/relay/v1/images/tasks/remote-ppt-a/content',
        remoteTaskId: 'remote-ppt-a',
        providerTaskId: 'provider-ppt-a',
        mimeType: 'image/png',
        format: 'png',
        size: 123,
      },
    });
    const taskB = createCompletedImageTask({
      id: 'task-ppt-b',
      params: {
        prompt: 'PPT slide image',
        autoInsertToCanvas: true,
        pptSlideImage: true,
        targetFrameId: 'frame-1',
        targetFrameDimensions: { width: 1024, height: 576 },
      },
      result: {
        url: '/__aitu_cache__/image/task-ppt-b.png',
        contentUrl: '/creative/relay/v1/images/tasks/remote-ppt-b/content',
        remoteTaskId: 'remote-ppt-b',
        providerTaskId: 'provider-ppt-b',
        mimeType: 'image/png',
        format: 'png',
        size: 123,
      },
    });
    vi.mocked(insertMediaIntoFrame).mockResolvedValue({
      point: [100, 100],
      elementId: 'frame-image-1',
      size: { width: 1024, height: 576 },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [taskA, taskB];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      emitTaskEvent(taskA);
      emitTaskEvent(taskB);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(insertMediaIntoFrame).toHaveBeenCalledWith(
      mocks.board,
      '/__aitu_cache__/image/task-ppt-b.png',
      'image',
      'frame-1',
      { width: 1024, height: 576 },
      undefined,
      undefined,
      {
        metadata: expect.objectContaining({
          contentUrl: '/creative/relay/v1/images/tasks/remote-ppt-b/content',
          remoteTaskId: 'remote-ppt-b',
          providerTaskId: 'provider-ppt-b',
          mimeType: 'image/png',
        }),
      }
    );
  });

  it('does not mark chat post-processing complete when chat canvas insertion reports failure', async () => {
    const task: Task = {
      ...createCompletedImageTask({
        id: 'task-chat-insert-failure',
      }),
      type: TaskType.CHAT,
      result: {
        url: '',
        format: 'md',
        size: 1,
        resultKind: 'chat',
        chatResponse: '聊天结果',
      },
    };
    mocks.executeCanvasInsertion.mockResolvedValueOnce({
      success: false,
      error: 'chat canvas insert failed',
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      emitTaskEvent(task);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.executeCanvasInsertion).toHaveBeenCalledTimes(1);
    expect(mocks.completePostProcessing).not.toHaveBeenCalled();
    expect(mocks.markAsInserted).not.toHaveBeenCalled();
    expect(mocks.failPostProcessing).toHaveBeenCalledWith(
      task.id,
      expect.stringContaining('chat canvas insert failed')
    );
  });

  it('does not mark chat post-processing complete when chat canvas insertion inserts no elements', async () => {
    const task: Task = {
      ...createCompletedImageTask({
        id: 'task-chat-empty-insert',
      }),
      type: TaskType.CHAT,
      result: {
        url: '',
        format: 'md',
        size: 1,
        resultKind: 'chat',
        chatResponse: '聊天结果',
      },
    };
    mocks.executeCanvasInsertion.mockResolvedValueOnce({
      success: true,
      data: {
        insertedCount: 0,
        items: [],
      },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      emitTaskEvent(task);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(mocks.executeCanvasInsertion).toHaveBeenCalledTimes(1);
    expect(mocks.completePostProcessing).not.toHaveBeenCalled();
    expect(mocks.markAsInserted).not.toHaveBeenCalled();
    expect(mocks.failPostProcessing).toHaveBeenCalledWith(
      task.id,
      expect.stringContaining('inserted no canvas elements')
    );
  });

  it('rehydrates generated image cache from contentUrl before marking post-processing complete', async () => {
    const contentUrl = '/creative/relay/v1/images/tasks/remote-1/content';
    const task = createCompletedImageTask({
      id: 'task-rehydrate',
      result: {
        url: '/__aitu_cache__/image/task-rehydrate.png',
        contentUrl,
        format: 'png',
        size: 123,
      },
    });
    mocks.getCachedBlob.mockResolvedValue(null);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Blob(['image'], { type: 'image/png' })))
    );
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      emitTaskEvent(task);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.cacheMediaFromBlob).toHaveBeenCalledWith(
      '/__aitu_cache__/image/task-rehydrate.png',
      expect.anything(),
      'image',
      expect.objectContaining({
        metadata: expect.objectContaining({
          taskId: task.id,
          contentUrl,
        }),
      })
    );
    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      task.id,
      1,
      [100, 100],
      'image-1',
      { width: 512, height: 512 }
    );
    expect(mocks.markAsInserted).toHaveBeenCalledWith(task.id, 'auto_insert');
  });

  it('verifies non-cache generated image contentUrl before marking canvas post-processing complete', async () => {
    const contentUrl = '/creative/api/assets/asset-task-direct/content';
    const task = createCompletedImageTask({
      id: 'task-direct-content-url',
      result: {
        url: contentUrl,
        contentUrl,
        format: 'png',
        size: 123,
        targetWidth: 1024,
        targetHeight: 1024,
      },
    });
    const fetchMock = vi.fn(
      async () => new Response(new Blob(['image'], { type: 'image/png' }))
    );
    vi.stubGlobal('fetch', fetchMock);
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      emitTaskEvent(task);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(fetchMock).toHaveBeenCalledWith(contentUrl, expect.any(Object));
    expect(mocks.quickInsert).toHaveBeenCalledWith(
      'image',
      contentUrl,
      [100, 100],
      { width: 512, height: 512 },
      expect.objectContaining({
        contentUrl,
      })
    );
    expect(mocks.completePostProcessing).toHaveBeenCalledWith(
      task.id,
      1,
      [100, 100],
      'image-1',
      { width: 512, height: 512 }
    );
  });

  it('rehydrates grouped generated images with each task contentUrl', async () => {
    const taskA = createCompletedImageTask({
      id: 'task-group-a',
      params: {
        prompt: 'same prompt',
        size: '1:1',
        autoInsertToCanvas: true,
      },
      result: {
        url: '/__aitu_cache__/image/task-group-a.png',
        contentUrl: '/creative/relay/v1/images/tasks/remote-a/content',
        format: 'png',
        size: 123,
      },
    });
    const taskB = createCompletedImageTask({
      id: 'task-group-b',
      params: {
        prompt: 'same prompt',
        size: '1:1',
        autoInsertToCanvas: true,
      },
      result: {
        url: '/__aitu_cache__/image/task-group-b.png',
        contentUrl: '/creative/relay/v1/images/tasks/remote-b/content',
        format: 'png',
        size: 123,
      },
    });
    mocks.getCachedBlob.mockResolvedValue(null);
    const fetchMock = vi.fn(async () => new Response(new Blob(['image'])));
    vi.stubGlobal('fetch', fetchMock);
    mocks.board = { children: [] };
    mocks.taskState.tasks = [taskA, taskB];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      emitTaskEvent(taskA);
      emitTaskEvent(taskB);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/creative/relay/v1/images/tasks/remote-a/content',
      expect.any(Object)
    );
    expect(fetchMock).toHaveBeenCalledWith(
      '/creative/relay/v1/images/tasks/remote-b/content',
      expect.any(Object)
    );
    expect(mocks.cacheMediaFromBlob).toHaveBeenCalledWith(
      '/__aitu_cache__/image/task-group-a.png',
      expect.anything(),
      'image',
      expect.objectContaining({
        metadata: expect.objectContaining({
          taskId: taskA.id,
          contentUrl: '/creative/relay/v1/images/tasks/remote-a/content',
        }),
      })
    );
    expect(mocks.cacheMediaFromBlob).toHaveBeenCalledWith(
      '/__aitu_cache__/image/task-group-b.png',
      expect.anything(),
      'image',
      expect.objectContaining({
        metadata: expect.objectContaining({
          taskId: taskB.id,
          contentUrl: '/creative/relay/v1/images/tasks/remote-b/content',
        }),
      })
    );
    expect(mocks.insertImageGroup).toHaveBeenCalledWith(
      [
        '/__aitu_cache__/image/task-group-a.png',
        '/__aitu_cache__/image/task-group-b.png',
      ],
      [100, 100],
      [
        { width: 512, height: 512 },
        { width: 512, height: 512 },
      ],
      [
        expect.objectContaining({
          contentUrl: '/creative/relay/v1/images/tasks/remote-a/content',
        }),
        expect.objectContaining({
          contentUrl: '/creative/relay/v1/images/tasks/remote-b/content',
        }),
      ]
    );
  });

  it('keeps per-image actual dimensions when grouped generated images have different ratios', async () => {
    vi.mocked(parseSizeToPixels).mockImplementation((size?: string) => {
      if (size === '3840x1648') {
        return { width: 3840, height: 1648 };
      }
      if (size === '720x1280') {
        return { width: 720, height: 1280 };
      }
      return { width: 512, height: 512 };
    });
    const wideTask = createCompletedImageTask({
      id: 'task-group-wide',
      params: {
        prompt: 'same prompt',
        size: '1:1',
        autoInsertToCanvas: true,
      },
      result: {
        url: '/__aitu_cache__/image/task-group-wide.png',
        format: 'png',
        size: 123,
        width: 3840,
        height: 1648,
      },
    });
    const tallTask = createCompletedImageTask({
      id: 'task-group-tall',
      params: {
        prompt: 'same prompt',
        size: '1:1',
        autoInsertToCanvas: true,
      },
      result: {
        url: '/__aitu_cache__/image/task-group-tall.png',
        format: 'png',
        size: 123,
        width: 720,
        height: 1280,
      },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [wideTask, tallTask];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      emitTaskEvent(wideTask);
      emitTaskEvent(tallTask);
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.insertImageGroup).toHaveBeenCalledWith(
      [
        '/__aitu_cache__/image/task-group-wide.png',
        '/__aitu_cache__/image/task-group-tall.png',
      ],
      [100, 100],
      [
        { width: 3840, height: 1648 },
        { width: 720, height: 1280 },
      ]
    );
  });

  it('does not split a generated grid image until the cache URL is verified', async () => {
    const task = createCompletedImageTask({
      id: 'task-grid-cache-miss',
      params: {
        prompt: '生成宫格图',
        size: '1:1',
        autoInsertToCanvas: true,
        gridImageRows: 3,
        gridImageCols: 3,
      },
      result: {
        url: '/__aitu_cache__/image/task-grid-cache-miss.png',
        format: 'png',
        size: 123,
      },
    });
    vi.mocked(isGridImageTask).mockReturnValue(true);
    mocks.getCachedBlob.mockResolvedValue(null);
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      emitTaskEvent(task);
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(handleSplitAndInsertTask).not.toHaveBeenCalled();
    expect(mocks.markAsInserted).not.toHaveBeenCalled();
    expect(mocks.failPostProcessing).toHaveBeenCalledWith(
      task.id,
      expect.stringContaining('cache')
    );
  });

  it('recovers completed uninserted tasks that already exist before subscribing', async () => {
    const task = createCompletedImageTask({ id: 'task-restored' });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.markAsInserted).toHaveBeenCalledWith(task.id, 'auto_insert');
  });

  it('does not retry a completed task that is already marked inserted', async () => {
    const task = createCompletedImageTask({ insertedToCanvas: true });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(IMAGE_GENERATION_ANCHOR_RETRY_EVENT, {
          detail: { taskId: task.id },
        })
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.quickInsert).not.toHaveBeenCalled();
    expect(mocks.clearTask).not.toHaveBeenCalled();
    expect(mocks.markAsInserted).not.toHaveBeenCalled();
  });

  it('does not retry a completed task whose post-processing already completed', async () => {
    const task = createCompletedImageTask();
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];
    mocks.getPostProcessingStatus.mockReturnValue({
      taskId: task.id,
      status: 'completed',
      type: 'direct_insert',
      insertedCount: 1,
    });

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(IMAGE_GENERATION_ANCHOR_RETRY_EVENT, {
          detail: { taskId: task.id },
        })
      );
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.quickInsert).not.toHaveBeenCalled();
    expect(mocks.clearTask).not.toHaveBeenCalled();
    expect(mocks.markAsInserted).not.toHaveBeenCalled();
  });

  it('does not clear post-processing when retry is requested for an active task', async () => {
    const task: Task = {
      ...createCompletedImageTask(),
      id: 'task-active',
      status: TaskStatus.PROCESSING,
      completedAt: undefined,
      result: undefined,
      insertedToCanvas: false,
    };
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(IMAGE_GENERATION_ANCHOR_RETRY_EVENT, {
          detail: { taskId: task.id, anchorId: 'anchor-active' },
        })
      );
    });

    expect(mocks.retryTask).not.toHaveBeenCalled();
    expect(mocks.clearTask).not.toHaveBeenCalled();
    expect(mocks.updateAnchor).toHaveBeenCalledWith(
      mocks.board,
      'anchor-active',
      expect.objectContaining({
        phase: 'queued',
        subtitle: '任务仍在执行，请稍候',
      })
    );
  });

  it('retries completed task post-processing without regenerating when generation anchor retry follows failed post-processing', async () => {
    const task = createCompletedImageTask({
      id: 'task-post-processing-failed',
      params: {
        prompt: '重新生成一张图',
        size: '1:1',
        autoInsertToCanvas: true,
      },
    });
    mocks.board = { children: [] };
    mocks.taskState.tasks = [task];
    mocks.getPostProcessingStatus
      .mockReturnValueOnce({
        taskId: task.id,
        status: 'processing',
        type: 'direct_insert',
      })
      .mockReturnValue({
        taskId: task.id,
        status: 'failed',
        type: 'direct_insert',
        error: 'Failed to fetch',
      });

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(IMAGE_GENERATION_ANCHOR_RETRY_EVENT, {
          detail: {
            taskId: task.id,
            anchorId: 'anchor-post-processing-failed',
          },
        })
      );
    });

    expect(mocks.updateAnchor).toHaveBeenCalledWith(
      mocks.board,
      'anchor-post-processing-failed',
      expect.objectContaining({
        phase: 'queued',
        subtitle: '正在重新显影，请稍候',
      })
    );
    expect(mocks.clearTask).toHaveBeenCalledWith(task.id);
    expect(mocks.retryTask).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mocks.quickInsert).toHaveBeenCalledTimes(1);
    expect(mocks.markAsInserted).toHaveBeenCalledWith(task.id, 'auto_insert');
  });

  it('keeps the failed state visible when retry task has been removed', async () => {
    mocks.board = { children: [] };
    mocks.taskState.tasks = [];

    renderHook(() =>
      useAutoInsertToCanvas({
        enabled: true,
        groupSimilarTasks: true,
        groupTimeWindow: 10,
      })
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent(IMAGE_GENERATION_ANCHOR_RETRY_EVENT, {
          detail: { taskId: 'missing-task', anchorId: 'anchor-missing' },
        })
      );
    });

    expect(mocks.retryTask).not.toHaveBeenCalled();
    expect(mocks.clearTask).not.toHaveBeenCalled();
    expect(mocks.updateAnchor).toHaveBeenCalledWith(
      mocks.board,
      'anchor-missing',
      expect.objectContaining({
        phase: 'failed',
        error: '任务已丢失，无法重试',
      })
    );
  });
});
