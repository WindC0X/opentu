import type { PlaitBoard } from '@plait/core';
import { Task, TaskType } from '../../types/task.types';
import {
  ensureGeneratedImageUrlsReadyForCanvas,
  resolveGeneratedImageContentUrl,
} from '../../utils/generated-media-cache';
import {
  getGeneratedImageCanvasMetadata,
  hasGeneratedImageCanvasMetadata,
} from '../../utils/generated-image-canvas-metadata';

export interface DialogTaskInsertDeps {
  insertImage?: (
    board: PlaitBoard,
    url: string,
    metadata?: Record<string, unknown>
  ) => Promise<unknown>;
  ensureImageUrlsReady?: (
    task: Task,
    urls: string[]
  ) => Promise<Array<{ url: string; metadata?: Record<string, unknown> }>>;
  insertVideo?: (board: PlaitBoard, url: string) => Promise<unknown>;
  markAsInserted?: (
    taskId: string,
    source: 'manual'
  ) => void | Promise<void>;
}

export interface DialogTaskInsertResult {
  type: 'image' | 'video';
  insertedCount: number;
}

function getTaskResultUrls(task: Task): string[] {
  const urls = task.result?.urls?.length ? task.result.urls : [task.result?.url];
  return urls.filter((url): url is string => typeof url === 'string' && url.length > 0);
}

function getTaskImageCanvasMetadata(
  task: Task
): Record<string, unknown> | undefined {
  const result = task.result;
  const contentUrl = resolveGeneratedImageContentUrl({
    contentUrl: result?.contentUrl,
    remoteTaskId: result?.remoteTaskId,
    providerTaskId: result?.providerTaskId,
    taskRemoteId: task.remoteId,
  });
  const metadata = getGeneratedImageCanvasMetadata({
    contentUrl,
    remoteTaskId: result?.remoteTaskId || task.remoteId,
    providerTaskId:
      result?.providerTaskId || result?.remoteTaskId || task.remoteId,
    mimeType: result?.mimeType,
  });
  return hasGeneratedImageCanvasMetadata(metadata) ? { ...metadata } : undefined;
}

export async function insertDialogTaskResultToBoard(
  task: Task,
  board: PlaitBoard,
  deps: DialogTaskInsertDeps = {}
): Promise<DialogTaskInsertResult> {
  const markAsInserted =
    deps.markAsInserted ||
    (async (taskId: string) => {
      const { taskQueueService } = await import('../../services/task-queue');
      taskQueueService.markAsInserted(taskId, 'manual');
    });

  if (task.type === TaskType.IMAGE) {
    const urls = getTaskResultUrls(task);
    if (urls.length === 0) {
      throw new Error('No image result URL');
    }
    const insertImage =
      deps.insertImage ||
      (async (
        targetBoard: PlaitBoard,
        targetUrl: string,
        metadata?: Record<string, unknown>
      ) => {
        const { insertImageFromUrl } = await import('../../data/image');
        return insertImageFromUrl(
          targetBoard,
          targetUrl,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          metadata
        );
      });
    const readyUrls = await (deps.ensureImageUrlsReady ||
      ensureGeneratedImageUrlsReadyForCanvas)(task, urls);
    for (const item of readyUrls) {
      const metadata =
        ('metadata' in item ? item.metadata : undefined) ||
        getTaskImageCanvasMetadata(task);
      if (metadata) {
        await insertImage(board, item.url, metadata);
      } else {
        await insertImage(board, item.url);
      }
    }
    await markAsInserted(task.id, 'manual');
    return { type: 'image', insertedCount: urls.length };
  }

  if (task.type === TaskType.VIDEO) {
    const url = task.result?.url;
    if (!url) {
      throw new Error('No video result URL');
    }
    const insertVideo =
      deps.insertVideo ||
      (await import('../../data/video')).insertVideoFromUrl;
    await insertVideo(board, url);
    await markAsInserted(task.id, 'manual');
    return { type: 'video', insertedCount: 1 };
  }

  throw new Error(`Unsupported task type for manual insert: ${task.type}`);
}
