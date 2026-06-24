import { describe, expect, it, vi } from 'vitest';
import { insertDialogTaskResultToBoard } from './dialog-task-insert';
import { TaskStatus, TaskType, type Task } from '../../types/task.types';

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 'task-1',
    type: TaskType.IMAGE,
    status: TaskStatus.COMPLETED,
    params: { prompt: 'prompt' },
    result: { url: '/image.png', format: 'png', size: 1 },
    progress: 100,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    insertedToCanvas: false,
    ...overrides,
  } as Task;
}

describe('insertDialogTaskResultToBoard', () => {
  it('marks an image task as manually inserted only after all images are inserted', async () => {
    const insertImage = vi.fn(async () => undefined);
    const markAsInserted = vi.fn();
    const task = makeTask({
      id: 'task-images',
      result: {
        url: '/image-a.png',
        urls: ['/image-a.png', '/image-b.png'],
        format: 'png',
        size: 2,
      },
    });

    await expect(
      insertDialogTaskResultToBoard(task, {} as any, {
        insertImage,
        markAsInserted,
      })
    ).resolves.toEqual({ type: 'image', insertedCount: 2 });

    expect(insertImage).toHaveBeenNthCalledWith(1, {}, '/image-a.png');
    expect(insertImage).toHaveBeenNthCalledWith(2, {}, '/image-b.png');
    expect(markAsInserted).toHaveBeenCalledWith('task-images', 'manual');
  });

  it('does not mark an image task as inserted when insertion fails', async () => {
    const insertImage = vi.fn(async () => {
      throw new Error('canvas insert failed');
    });
    const markAsInserted = vi.fn();
    const task = makeTask({ id: 'task-fail' });

    await expect(
      insertDialogTaskResultToBoard(task, {} as any, {
        insertImage,
        markAsInserted,
      })
    ).rejects.toThrow('canvas insert failed');

    expect(markAsInserted).not.toHaveBeenCalled();
  });

  it('rehydrates generated image URLs before manual image insertion', async () => {
    const insertImage = vi.fn(async () => undefined);
    const ensureImageUrlsReady = vi.fn(async () => [
      { url: '/__aitu_cache__/image/task-generated.png' },
    ]);
    const markAsInserted = vi.fn();
    const task = makeTask({
      id: 'task-generated',
      result: {
        url: '/__aitu_cache__/image/task-generated.png',
        contentUrl: '/creative/relay/v1/images/tasks/remote-generated/content',
        format: 'png',
        size: 2,
      },
    });

    await expect(
      insertDialogTaskResultToBoard(task, {} as any, {
        insertImage,
        ensureImageUrlsReady,
        markAsInserted,
      })
    ).resolves.toEqual({ type: 'image', insertedCount: 1 });

    expect(ensureImageUrlsReady).toHaveBeenCalledWith(task, [
      '/__aitu_cache__/image/task-generated.png',
    ]);
    expect(insertImage).toHaveBeenCalledWith(
      {},
      '/__aitu_cache__/image/task-generated.png',
      expect.objectContaining({
        contentUrl: '/creative/relay/v1/images/tasks/remote-generated/content',
      })
    );
    expect(markAsInserted).toHaveBeenCalledWith('task-generated', 'manual');
  });

  it('marks a video task as manually inserted after video insertion succeeds', async () => {
    const insertVideo = vi.fn(async () => undefined);
    const markAsInserted = vi.fn();
    const task = makeTask({
      id: 'task-video',
      type: TaskType.VIDEO,
      result: { url: '/video.mp4', format: 'mp4', size: 1 },
    });

    await expect(
      insertDialogTaskResultToBoard(task, {} as any, {
        insertVideo,
        markAsInserted,
      })
    ).resolves.toEqual({ type: 'video', insertedCount: 1 });

    expect(insertVideo).toHaveBeenCalledWith({}, '/video.mp4');
    expect(markAsInserted).toHaveBeenCalledWith('task-video', 'manual');
  });
});
