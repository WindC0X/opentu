import { useEffect } from 'react';
import { PlaitBoard, PlaitElement, Transforms } from '@plait/core';
import { taskQueueService } from '../services/task-queue';
import { taskStorageReader } from '../services/task-storage-reader';
import { Task, TaskStatus, TaskType } from '../types/task.types';
import { GENERATED_MEDIA_CACHE_MISS_EVENT } from '../utils/asset-cleanup';
import {
  isGeneratedImageCacheUrl,
  isGeneratedVideoCacheUrl,
  rehydrateGeneratedImageCacheUrl,
  rehydrateGeneratedVideoCacheUrl,
  resolveGeneratedImageContentUrl,
  resolveGeneratedVideoContentUrl,
} from '../utils/generated-media-cache';
import {
  getGeneratedImageCanvasMetadata,
  hasGeneratedImageCanvasMetadata,
} from '../utils/generated-image-canvas-metadata';

type GeneratedMediaType = 'image' | 'video';

interface GeneratedMediaCacheMissDetail {
  mediaType?: GeneratedMediaType;
  boardId?: string;
  taskId?: string;
  elementId?: string;
  imageUrl?: string;
  mediaUrl?: string;
  contentUrl?: string;
  remoteTaskId?: string;
  providerTaskId?: string;
  mimeType?: string;
}

interface PendingGeneratedMediaCacheMiss {
  detail: GeneratedMediaCacheMissDetail;
  createdAt: number;
  attempts: number;
  lastAttemptAt: number;
  inFlight: boolean;
  retryTimer?: ReturnType<typeof setTimeout>;
}

const PENDING_CACHE_MISS_TTL_MS = 5 * 60 * 1000;
const PENDING_CACHE_MISS_MAX_ENTRIES = 100;
const PENDING_CACHE_MISS_MAX_ATTEMPTS = 5;
const PENDING_CACHE_MISS_RETRY_DELAYS_MS = [
  1000, 2000, 5000, 10000,
] as const;

const pendingGeneratedMediaCacheMisses = new Map<
  string,
  PendingGeneratedMediaCacheMiss
>();

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function getBoardId(board: PlaitBoard | null | undefined): string | undefined {
  const value =
    (board as { __plait_id?: unknown } | null | undefined)?.__plait_id ||
    (board as { id?: unknown } | null | undefined)?.id;
  return stringValue(value);
}

function normalizeGeneratedMediaPath(value: string | undefined): string {
  if (!value) {
    return '';
  }
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.pathname;
  } catch {
    return value.split('#')[0]?.split('?')[0] || value;
  }
}

function inferGeneratedMediaType(
  detail: GeneratedMediaCacheMissDetail
): GeneratedMediaType | undefined {
  if (detail.mediaType === 'image' || detail.mediaType === 'video') {
    return detail.mediaType;
  }
  const mediaUrl = detail.mediaUrl || detail.imageUrl;
  if (isGeneratedVideoCacheUrl(mediaUrl)) {
    return 'video';
  }
  if (isGeneratedImageCacheUrl(mediaUrl)) {
    return 'image';
  }
  return undefined;
}

function normalizeCacheMissDetail(
  detail: GeneratedMediaCacheMissDetail
): GeneratedMediaCacheMissDetail | undefined {
  const mediaUrl = detail.mediaUrl || detail.imageUrl;
  const mediaType = inferGeneratedMediaType({ ...detail, mediaUrl });
  if (!mediaUrl || !mediaType) {
    return undefined;
  }
  if (
    (mediaType === 'image' && !isGeneratedImageCacheUrl(mediaUrl)) ||
    (mediaType === 'video' && !isGeneratedVideoCacheUrl(mediaUrl))
  ) {
    return undefined;
  }
  return {
    ...detail,
    mediaType,
    mediaUrl,
    imageUrl: detail.imageUrl || (mediaType === 'image' ? mediaUrl : undefined),
  };
}

function getGeneratedMediaCacheMissKey(
  detail: GeneratedMediaCacheMissDetail
): string {
  return [
    detail.boardId || '',
    detail.mediaType || '',
    normalizeGeneratedMediaPath(detail.mediaUrl || detail.imageUrl),
    detail.elementId || '',
    detail.taskId || '',
  ].join('|');
}

function sweepExpiredPendingCacheMisses(now = Date.now()): void {
  for (const [key, entry] of pendingGeneratedMediaCacheMisses) {
    if (now - entry.createdAt > PENDING_CACHE_MISS_TTL_MS) {
      if (entry.retryTimer) {
        clearTimeout(entry.retryTimer);
      }
      pendingGeneratedMediaCacheMisses.delete(key);
    }
  }
}

function enforcePendingCacheMissCap(): void {
  while (pendingGeneratedMediaCacheMisses.size > PENDING_CACHE_MISS_MAX_ENTRIES) {
    const oldestKey = pendingGeneratedMediaCacheMisses.keys().next().value as
      | string
      | undefined;
    if (!oldestKey) {
      return;
    }
    const oldest = pendingGeneratedMediaCacheMisses.get(oldestKey);
    if (oldest?.retryTimer) {
      clearTimeout(oldest.retryTimer);
    }
    pendingGeneratedMediaCacheMisses.delete(oldestKey);
  }
}

function bufferCacheMiss(
  detail: GeneratedMediaCacheMissDetail
): string | undefined {
  const normalized = normalizeCacheMissDetail(detail);
  if (!normalized) {
    return undefined;
  }

  sweepExpiredPendingCacheMisses();
  const key = getGeneratedMediaCacheMissKey(normalized);
  const existing = pendingGeneratedMediaCacheMisses.get(key);
  if (existing) {
    existing.detail = { ...existing.detail, ...normalized };
    return key;
  }

  pendingGeneratedMediaCacheMisses.set(key, {
    detail: normalized,
    createdAt: Date.now(),
    attempts: 0,
    lastAttemptAt: 0,
    inFlight: false,
  });
  enforcePendingCacheMissCap();
  return key;
}

function detailBelongsToBoard(
  detail: GeneratedMediaCacheMissDetail,
  board: PlaitBoard | null | undefined
): boolean {
  if (!detail.boardId) {
    return true;
  }
  const boardId = getBoardId(board);
  return !!boardId && boardId === detail.boardId;
}

function getTaskResultUrls(task: Task): string[] {
  const result = task.result as { url?: string; urls?: string[] } | undefined;
  const urls = new Set<string>();
  if (result?.url) {
    urls.add(result.url);
  }
  result?.urls?.forEach((url) => {
    if (url) {
      urls.add(url);
    }
  });
  return Array.from(urls);
}

function taskMatchesGeneratedCacheMiss(
  task: Task,
  detail: GeneratedMediaCacheMissDetail
): boolean {
  const mediaType = inferGeneratedMediaType(detail);
  const expectedTaskType = mediaType === 'video' ? TaskType.VIDEO : TaskType.IMAGE;
  if (task.type !== expectedTaskType || task.status !== TaskStatus.COMPLETED) {
    return false;
  }

  const result = task.result as
    | { remoteTaskId?: string; providerTaskId?: string }
    | undefined;
  const detailTaskId = detail.taskId;
  if (
    detailTaskId &&
    (task.id === detailTaskId ||
      task.remoteId === detailTaskId ||
      result?.remoteTaskId === detailTaskId ||
      result?.providerTaskId === detailTaskId)
  ) {
    return true;
  }

  const targetPath = normalizeGeneratedMediaPath(detail.mediaUrl || detail.imageUrl);
  if (!targetPath) {
    return false;
  }

  return getTaskResultUrls(task).some(
    (url) => normalizeGeneratedMediaPath(url) === targetPath
  );
}

async function findGeneratedTaskForMiss(
  detail: GeneratedMediaCacheMissDetail
): Promise<Task | undefined> {
  const mediaType = inferGeneratedMediaType(detail);
  const taskType = mediaType === 'video' ? TaskType.VIDEO : TaskType.IMAGE;

  const inMemoryTask = taskQueueService
    .getAllTasks()
    .find((task) => taskMatchesGeneratedCacheMiss(task, detail));
  if (inMemoryTask) {
    return inMemoryTask;
  }

  if (detail.taskId) {
    const directTask = await taskStorageReader.getTask(detail.taskId);
    if (directTask && taskMatchesGeneratedCacheMiss(directTask, detail)) {
      return directTask;
    }
  }

  const mediaUrl = detail.mediaUrl || detail.imageUrl;
  if (mediaType === 'image' && mediaUrl) {
    const taskId = await taskStorageReader.findImageTaskIdByResultUrl(mediaUrl, {
      includeArchived: true,
    });
    if (taskId) {
      const directTask = await taskStorageReader.getTask(taskId);
      if (directTask && taskMatchesGeneratedCacheMiss(directTask, detail)) {
        return directTask;
      }
    }
  }

  const storedTasks = await taskStorageReader.getAllTasks({
    type: taskType,
    includeArchived: true,
  });
  return storedTasks.find((task) => taskMatchesGeneratedCacheMiss(task, detail));
}

interface GeneratedMediaElementLookup {
  path: number[];
  element: PlaitElement & {
    id?: string;
    url?: string;
    children?: PlaitElement[];
    contentUrl?: string;
    remoteTaskId?: string;
    providerTaskId?: string;
    mimeType?: string;
  };
}

function findElementByIdOrMediaUrl(
  children: PlaitElement[] | undefined,
  elementId: string | undefined,
  mediaUrl: string | undefined,
  basePath: number[] = []
): GeneratedMediaElementLookup | undefined {
  if (!children?.length) {
    return undefined;
  }

  const targetPath = normalizeGeneratedMediaPath(mediaUrl);
  for (let index = 0; index < children.length; index += 1) {
    const element = children[index] as GeneratedMediaElementLookup['element'];
    const path = [...basePath, index];
    if (
      (elementId && element.id === elementId) ||
      (targetPath && normalizeGeneratedMediaPath(element.url) === targetPath)
    ) {
      return { path, element };
    }

    const child = findElementByIdOrMediaUrl(
      element.children,
      elementId,
      mediaUrl,
      path
    );
    if (child) {
      return child;
    }
  }

  return undefined;
}

function withMediaRetryParam(mediaUrl: string): string {
  try {
    const parsed = new URL(mediaUrl, window.location.origin);
    parsed.searchParams.set('_retry', String(Date.now()));
    return parsed.origin === window.location.origin
      ? `${parsed.pathname}${parsed.search}${parsed.hash}`
      : parsed.toString();
  } catch {
    const [withoutHash, hash = ''] = mediaUrl.split('#');
    const separator = withoutHash.includes('?') ? '&' : '?';
    return `${withoutHash}${separator}_retry=${Date.now()}${
      hash ? `#${hash}` : ''
    }`;
  }
}

function getElementMetadata(
  element: GeneratedMediaElementLookup['element'] | undefined,
  mediaType: GeneratedMediaType
): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  if (!element) {
    return base;
  }

  if (mediaType === 'image') {
    const imageMetadata = getGeneratedImageCanvasMetadata(
      element as Record<string, unknown>
    );
    if (hasGeneratedImageCanvasMetadata(imageMetadata)) {
      Object.assign(base, imageMetadata);
    }
  }

  const contentUrl = stringValue(element.contentUrl);
  const remoteTaskId = stringValue(element.remoteTaskId);
  const providerTaskId = stringValue(element.providerTaskId);
  const mimeType = stringValue(element.mimeType);
  if (contentUrl) {
    base.contentUrl = contentUrl;
  }
  if (remoteTaskId) {
    base.remoteTaskId = remoteTaskId;
  }
  if (providerTaskId) {
    base.providerTaskId = providerTaskId;
  }
  if (mimeType) {
    base.mimeType = mimeType;
  }
  return base;
}

async function recoverGeneratedMediaCacheMiss(
  board: PlaitBoard,
  detail: GeneratedMediaCacheMissDetail
): Promise<boolean> {
  const normalized = normalizeCacheMissDetail(detail);
  if (!normalized?.mediaType || !normalized.mediaUrl) {
    return false;
  }

  const mediaUrl = normalized.mediaUrl;
  const elementLookup = findElementByIdOrMediaUrl(
    board.children as PlaitElement[],
    normalized.elementId,
    mediaUrl
  );
  const elementMetadata = getElementMetadata(
    elementLookup?.element,
    normalized.mediaType
  );
  const task = await findGeneratedTaskForMiss(normalized);
  const result = task?.result as
    | {
        contentUrl?: string;
        mimeType?: string;
        remoteTaskId?: string;
        providerTaskId?: string;
      }
    | undefined;
  const resolveContentUrl =
    normalized.mediaType === 'video'
      ? resolveGeneratedVideoContentUrl
      : resolveGeneratedImageContentUrl;
  const contentUrl = resolveContentUrl({
    contentUrl:
      normalized.contentUrl || result?.contentUrl || stringValue(elementMetadata.contentUrl),
    remoteTaskId:
      normalized.remoteTaskId || result?.remoteTaskId || stringValue(elementMetadata.remoteTaskId),
    providerTaskId:
      normalized.providerTaskId ||
      result?.providerTaskId ||
      stringValue(elementMetadata.providerTaskId),
    taskRemoteId: task?.remoteId,
    metadata: elementMetadata,
  });
  if (!contentUrl) {
    return false;
  }

  const rehydrateMetadata = {
    ...elementMetadata,
    ...(task
      ? {
          taskId: task.id,
          remoteTaskId: result?.remoteTaskId || task.remoteId,
          providerTaskId: result?.providerTaskId || task.remoteId,
          prompt: task.params.prompt,
          model: task.params.model,
          params: task.params,
        }
      : {}),
    contentUrl,
    mimeType: result?.mimeType || normalized.mimeType || elementMetadata.mimeType,
  };

  const blob =
    normalized.mediaType === 'video'
      ? await rehydrateGeneratedVideoCacheUrl(mediaUrl, contentUrl, rehydrateMetadata)
      : await rehydrateGeneratedImageCacheUrl(mediaUrl, contentUrl, rehydrateMetadata);
  if (!blob) {
    return false;
  }

  const elementPath =
    elementLookup?.path ||
    findElementByIdOrMediaUrl(
      board.children as PlaitElement[],
      normalized.elementId,
      mediaUrl
    )?.path;
  if (!elementPath) {
    return false;
  }

  Transforms.setNode(
    board,
    { url: withMediaRetryParam(mediaUrl) } as Partial<PlaitElement>,
    elementPath
  );
  return true;
}

export function useGeneratedMediaCacheMissRecovery(
  board: PlaitBoard | null | undefined,
  enabled = true
): void {
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    let disposed = false;

    const scheduleRetry = (key: string, entry: PendingGeneratedMediaCacheMiss) => {
      if (entry.retryTimer || entry.attempts >= PENDING_CACHE_MISS_MAX_ATTEMPTS) {
        if (entry.attempts >= PENDING_CACHE_MISS_MAX_ATTEMPTS) {
          pendingGeneratedMediaCacheMisses.delete(key);
        }
        return;
      }
      const delay =
        PENDING_CACHE_MISS_RETRY_DELAYS_MS[
          Math.min(entry.attempts - 1, PENDING_CACHE_MISS_RETRY_DELAYS_MS.length - 1)
        ] || PENDING_CACHE_MISS_RETRY_DELAYS_MS[0];
      const remainingDelay = Math.max(
        0,
        entry.lastAttemptAt + delay - Date.now()
      );
      if (remainingDelay === 0) {
        void processPendingCacheMiss(key);
        return;
      }
      entry.retryTimer = setTimeout(() => {
        entry.retryTimer = undefined;
        if (!disposed) {
          void processPendingCacheMiss(key);
        }
      }, remainingDelay);
    };

    const processPendingCacheMiss = async (key: string): Promise<void> => {
      const entry = pendingGeneratedMediaCacheMisses.get(key);
      if (!entry || disposed) {
        return;
      }
      if (!enabled || !board || !detailBelongsToBoard(entry.detail, board)) {
        return;
      }
      if (Date.now() - entry.createdAt > PENDING_CACHE_MISS_TTL_MS) {
        pendingGeneratedMediaCacheMisses.delete(key);
        return;
      }
      if (entry.inFlight) {
        return;
      }
      if (entry.attempts >= PENDING_CACHE_MISS_MAX_ATTEMPTS) {
        pendingGeneratedMediaCacheMisses.delete(key);
        return;
      }

      entry.inFlight = true;
      entry.attempts += 1;
      entry.lastAttemptAt = Date.now();
      try {
        const recovered = await recoverGeneratedMediaCacheMiss(board, entry.detail);
        if (recovered) {
          if (entry.retryTimer) {
            clearTimeout(entry.retryTimer);
          }
          pendingGeneratedMediaCacheMisses.delete(key);
          return;
        }
        entry.inFlight = false;
        scheduleRetry(key, entry);
      } catch (error) {
        entry.inFlight = false;
        console.warn(
          '[GeneratedMediaCacheMissRecovery] Failed to rehydrate generated media cache:',
          error
        );
        scheduleRetry(key, entry);
      }
    };

    const processCacheMiss = (detail: GeneratedMediaCacheMissDetail) => {
      const key = bufferCacheMiss(detail);
      if (!key) {
        return;
      }
      void processPendingCacheMiss(key);
    };

    const onCacheMiss = (event: Event) => {
      const detail = (event as CustomEvent<GeneratedMediaCacheMissDetail>).detail;
      processCacheMiss(detail || {});
    };

    window.addEventListener(GENERATED_MEDIA_CACHE_MISS_EVENT, onCacheMiss);
    if (enabled && board && pendingGeneratedMediaCacheMisses.size > 0) {
      Array.from(pendingGeneratedMediaCacheMisses.entries()).forEach(([key, entry]) => {
        if (detailBelongsToBoard(entry.detail, board)) {
          void processPendingCacheMiss(key);
        }
      });
    }
    return () => {
      disposed = true;
      window.removeEventListener(GENERATED_MEDIA_CACHE_MISS_EVENT, onCacheMiss);
    };
  }, [board, enabled]);
}
