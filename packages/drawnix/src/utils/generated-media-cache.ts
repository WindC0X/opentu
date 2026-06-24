import type { Task } from '../types/task.types';
import { unifiedCacheService } from '../services/unified-cache-service';
import { normalizeImageDataUrl } from './image-data-url';

const GENERATED_IMAGE_CACHE_PREFIX = '/__aitu_cache__/image/';
const GENERATED_VIDEO_CACHE_PREFIX = '/__aitu_cache__/video/';
const CREATIVE_IMAGE_CONTENT_PATH_PREFIX = '/creative/relay/v1/images/tasks/';
const CREATIVE_VIDEO_CONTENT_PATH_PREFIX = '/creative/relay/v1/videos/';
const CREATIVE_ASSET_CONTENT_PATH_PREFIX = '/creative/api/assets/';
const GENERATED_MEDIA_REHYDRATE_RETRY_DELAYS_MS = [
  250, 500, 1000, 2000,
] as const;

type GeneratedMediaKind = 'image' | 'video';

type GeneratedTaskResult = Task['result'] & {
  contentUrl?: string;
  mimeType?: string;
  targetWidth?: number;
  targetHeight?: number;
  remoteTaskId?: string;
  providerTaskId?: string;
};

export interface GeneratedImageVerification {
  url: string;
  blob: Blob;
  mimeType?: string;
  width?: number;
  height?: number;
}

export interface GeneratedImageCacheUrlReadyOptions {
  contentUrl?: string;
  remoteTaskId?: string;
  providerTaskId?: string;
  taskRemoteId?: string;
  metadata?: Record<string, unknown>;
}

function getUrlOrigin(): string {
  return typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'http://aitu.local';
}

function getUrlPathname(url: string | undefined): string {
  if (!url) {
    return '';
  }
  try {
    return new URL(url, getUrlOrigin()).pathname;
  } catch {
    return url.split('#')[0]?.split('?')[0] || url;
  }
}

export function isGeneratedImageCacheUrl(url: string | undefined): boolean {
  return getUrlPathname(url).startsWith(GENERATED_IMAGE_CACHE_PREFIX);
}

export function isGeneratedVideoCacheUrl(url: string | undefined): boolean {
  return getUrlPathname(url).startsWith(GENERATED_VIDEO_CACHE_PREFIX);
}

export function isGeneratedMediaCacheUrl(url: string | undefined): boolean {
  return isGeneratedImageCacheUrl(url) || isGeneratedVideoCacheUrl(url);
}

function extractGeneratedTaskIdFromCacheUrl(
  url: string | undefined,
  prefix: string
): string | undefined {
  const pathname = getUrlPathname(url);
  if (!pathname.startsWith(prefix)) {
    return undefined;
  }
  const fileName = pathname.slice(prefix.length);
  if (!fileName) {
    return undefined;
  }
  const dotIndex = fileName.lastIndexOf('.');
  const taskId = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  try {
    return decodeURIComponent(taskId) || undefined;
  } catch {
    return taskId || undefined;
  }
}

export function extractGeneratedImageTaskId(
  imageUrl: string | undefined
): string | undefined {
  return extractGeneratedTaskIdFromCacheUrl(
    imageUrl,
    GENERATED_IMAGE_CACHE_PREFIX
  );
}

export function extractGeneratedVideoTaskId(
  videoUrl: string | undefined
): string | undefined {
  return extractGeneratedTaskIdFromCacheUrl(
    videoUrl,
    GENERATED_VIDEO_CACHE_PREFIX
  );
}

function getTaskResult(task: Task): GeneratedTaskResult | undefined {
  return task.result as GeneratedTaskResult | undefined;
}

function getSafeCreativeContentUrl(task: Task): string | undefined {
  const result = getTaskResult(task);
  return resolveGeneratedImageContentUrl({
    contentUrl: result?.contentUrl,
    remoteTaskId: result?.remoteTaskId,
    providerTaskId: result?.providerTaskId,
    taskRemoteId: task.remoteId,
  });
}

function normalizeSafeCreativeMediaContentUrl(
  contentUrl: string | undefined,
  kind: GeneratedMediaKind
): string | undefined {
  if (!contentUrl) {
    return undefined;
  }

  const relayPrefix =
    kind === 'image'
      ? CREATIVE_IMAGE_CONTENT_PATH_PREFIX
      : CREATIVE_VIDEO_CONTENT_PATH_PREFIX;

  try {
    const parsed = new URL(contentUrl, getUrlOrigin());
    if (
      parsed.origin === getUrlOrigin() &&
      (parsed.pathname.startsWith(relayPrefix) ||
        parsed.pathname.startsWith(CREATIVE_ASSET_CONTENT_PATH_PREFIX)) &&
      parsed.pathname.endsWith('/content')
    ) {
      return parsed.pathname + parsed.search;
    }
    return undefined;
  } catch {
    return (contentUrl.startsWith(relayPrefix) ||
      contentUrl.startsWith(CREATIVE_ASSET_CONTENT_PATH_PREFIX)) &&
      contentUrl.endsWith('/content')
      ? contentUrl
      : undefined;
  }
}

export function normalizeSafeCreativeContentUrl(
  contentUrl: string | undefined
): string | undefined {
  return normalizeSafeCreativeMediaContentUrl(contentUrl, 'image');
}

export function normalizeSafeCreativeVideoContentUrl(
  contentUrl: string | undefined
): string | undefined {
  return normalizeSafeCreativeMediaContentUrl(contentUrl, 'video');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function creativeContentUrlFromTaskId(
  taskId: string | undefined,
  kind: GeneratedMediaKind
): string | undefined {
  const id = stringValue(taskId);
  if (!id) {
    return undefined;
  }
  const prefix =
    kind === 'image'
      ? CREATIVE_IMAGE_CONTENT_PATH_PREFIX
      : CREATIVE_VIDEO_CONTENT_PATH_PREFIX;
  return normalizeSafeCreativeMediaContentUrl(
    `${prefix}${encodeURIComponent(id)}/content`,
    kind
  );
}

function resolveGeneratedMediaContentUrl(
  options: {
    contentUrl?: string;
    remoteTaskId?: string;
    providerTaskId?: string;
    taskRemoteId?: string;
    metadata?: Record<string, unknown>;
  },
  kind: GeneratedMediaKind
): string | undefined {
  const metadata = options.metadata;
  const direct = normalizeSafeCreativeMediaContentUrl(
    options.contentUrl || stringValue(metadata?.contentUrl),
    kind
  );
  if (direct) {
    return direct;
  }

  for (const candidate of [
    options.remoteTaskId,
    options.providerTaskId,
    options.taskRemoteId,
    stringValue(metadata?.remoteTaskId),
    stringValue(metadata?.providerTaskId),
  ]) {
    const contentUrl = creativeContentUrlFromTaskId(candidate, kind);
    if (contentUrl) {
      return contentUrl;
    }
  }

  return undefined;
}

export function resolveGeneratedImageContentUrl(options: {
  contentUrl?: string;
  remoteTaskId?: string;
  providerTaskId?: string;
  taskRemoteId?: string;
  metadata?: Record<string, unknown>;
}): string | undefined {
  return resolveGeneratedMediaContentUrl(options, 'image');
}

export function resolveGeneratedVideoContentUrl(options: {
  contentUrl?: string;
  remoteTaskId?: string;
  providerTaskId?: string;
  taskRemoteId?: string;
  metadata?: Record<string, unknown>;
}): string | undefined {
  return resolveGeneratedMediaContentUrl(options, 'video');
}

async function fetchCreativeContentBlob(
  contentUrl: string,
  accept: string,
  emptyMessage: string
): Promise<Blob> {
  const response = await fetch(contentUrl, {
    method: 'GET',
    credentials: 'same-origin',
    headers: {
      Accept: accept,
    },
  });
  if (!response.ok) {
    const error = new Error(`content rehydrate failed: ${response.status}`);
    (error as Error & { httpStatus?: number }).httpStatus = response.status;
    throw error;
  }
  const blob = await response.blob();
  if (!blob.size) {
    throw new Error(emptyMessage);
  }
  return blob;
}

function isRetryableCreativeContentRehydrateError(error: unknown): boolean {
  const status = (error as { httpStatus?: unknown })?.httpStatus;
  if (typeof status !== 'number') {
    return true;
  }
  return (
    status === 404 ||
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

async function waitForGeneratedMediaRehydrateRetry(
  delayMs: number
): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function fetchCreativeContentBlobWithRetry(
  contentUrl: string,
  accept: string,
  emptyMessage: string
): Promise<Blob> {
  let lastError: unknown;
  for (
    let attempt = 0;
    attempt <= GENERATED_MEDIA_REHYDRATE_RETRY_DELAYS_MS.length;
    attempt += 1
  ) {
    try {
      return await fetchCreativeContentBlob(contentUrl, accept, emptyMessage);
    } catch (error) {
      lastError = error;
      if (
        attempt >= GENERATED_MEDIA_REHYDRATE_RETRY_DELAYS_MS.length ||
        !isRetryableCreativeContentRehydrateError(error)
      ) {
        break;
      }
      await waitForGeneratedMediaRehydrateRetry(
        GENERATED_MEDIA_REHYDRATE_RETRY_DELAYS_MS[attempt]
      );
    }
  }
  throw lastError;
}

export async function rehydrateGeneratedImageCacheUrl(
  cacheUrl: string,
  contentUrl: string | undefined,
  metadata: Record<string, unknown> = {}
): Promise<Blob | null> {
  const normalizedCacheUrl = normalizeImageDataUrl(cacheUrl);
  if (!isGeneratedImageCacheUrl(normalizedCacheUrl)) {
    return null;
  }

  const safeContentUrl = resolveGeneratedImageContentUrl({
    contentUrl,
    metadata,
  });
  if (!safeContentUrl) {
    return null;
  }

  const blob = await fetchCreativeContentBlobWithRetry(
    safeContentUrl,
    'image/*,application/octet-stream',
    'content rehydrate returned empty image'
  );
  await unifiedCacheService.cacheMediaFromBlob(
    normalizedCacheUrl,
    blob,
    'image',
    {
      metadata: {
        ...metadata,
        contentUrl: safeContentUrl,
      },
    }
  );
  return blob;
}

export async function rehydrateGeneratedVideoCacheUrl(
  cacheUrl: string,
  contentUrl: string | undefined,
  metadata: Record<string, unknown> = {}
): Promise<Blob | null> {
  const normalizedCacheUrl = normalizeImageDataUrl(cacheUrl);
  if (!isGeneratedVideoCacheUrl(normalizedCacheUrl)) {
    return null;
  }

  const safeContentUrl = resolveGeneratedVideoContentUrl({
    contentUrl,
    metadata,
  });
  if (!safeContentUrl) {
    return null;
  }

  const blob = await fetchCreativeContentBlobWithRetry(
    safeContentUrl,
    'video/*,application/octet-stream',
    'content rehydrate returned empty video'
  );
  await unifiedCacheService.cacheMediaFromBlob(
    normalizedCacheUrl,
    blob,
    'video',
    {
      metadata: {
        ...metadata,
        contentUrl: safeContentUrl,
      },
    }
  );
  return blob;
}

export async function ensureGeneratedImageCacheUrlReady(
  url: string,
  options: GeneratedImageCacheUrlReadyOptions = {}
): Promise<GeneratedImageVerification> {
  const normalizedUrl = normalizeImageDataUrl(url);

  if (!isGeneratedImageCacheUrl(normalizedUrl)) {
    return {
      url: normalizedUrl,
      blob: new Blob(),
    };
  }

  let blob = await unifiedCacheService.getCachedBlob(normalizedUrl);
  if (!blob) {
    blob = await rehydrateGeneratedImageCacheUrl(
      normalizedUrl,
      resolveGeneratedImageContentUrl(options),
      options.metadata
    );
  }

  if (!blob || !blob.size) {
    throw new Error('generated image cache is unavailable');
  }

  const decoded = await decodeGeneratedImageBlobDimensions(blob);
  return {
    url: normalizedUrl,
    blob,
    mimeType: blob.type,
    width: decoded.width,
    height: decoded.height,
  };
}

export async function decodeGeneratedImageBlobDimensions(
  blob: Blob
): Promise<{ width?: number; height?: number }> {
  if (!blob.type.startsWith('image/')) {
    return {};
  }

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    const dimensions = {
      width: bitmap.width,
      height: bitmap.height,
    };
    bitmap.close?.();
    return dimensions;
  }

  if (
    typeof Image === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return {};
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        resolve({
          width: image.naturalWidth || image.width,
          height: image.naturalHeight || image.height,
        });
      };
      image.onerror = () => reject(new Error('image decode failed'));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function ensureGeneratedImageCacheForTask(
  task: Task,
  url: string
): Promise<GeneratedImageVerification> {
  const normalizedUrl = normalizeImageDataUrl(url);
  const result = getTaskResult(task);
  const safeContentUrl =
    normalizeSafeCreativeContentUrl(normalizedUrl) ||
    getSafeCreativeContentUrl(task);

  if (!isGeneratedImageCacheUrl(normalizedUrl)) {
    if (safeContentUrl) {
      const blob = await fetchCreativeContentBlobWithRetry(
        safeContentUrl,
        'image/*,application/octet-stream',
        'content rehydrate returned empty image'
      );
      const decoded = await decodeGeneratedImageBlobDimensions(blob);
      return {
        url: normalizedUrl,
        blob,
        mimeType: blob.type || result?.mimeType,
        width: decoded.width || result?.width || result?.targetWidth,
        height: decoded.height || result?.height || result?.targetHeight,
      };
    }
    return {
      url: normalizedUrl,
      blob: new Blob(),
      mimeType: result?.mimeType,
      width: result?.width || result?.targetWidth,
      height: result?.height || result?.targetHeight,
    };
  }

  const verified = await ensureGeneratedImageCacheUrlReady(normalizedUrl, {
    contentUrl: safeContentUrl,
    remoteTaskId: result?.remoteTaskId,
    providerTaskId: result?.providerTaskId,
    taskRemoteId: task.remoteId,
    metadata: {
      taskId: task.id,
      remoteTaskId: result?.remoteTaskId || task.remoteId,
      providerTaskId: result?.providerTaskId || task.remoteId,
      prompt: task.params.prompt,
      model: task.params.model,
      params: task.params,
    },
  });

  return {
    url: normalizedUrl,
    blob: verified.blob,
    mimeType: verified.mimeType || result?.mimeType,
    width: verified.width || result?.width || result?.targetWidth,
    height: verified.height || result?.height || result?.targetHeight,
  };
}

export async function ensureGeneratedImageUrlsReadyForCanvas(
  task: Task,
  urls: string[]
): Promise<GeneratedImageVerification[]> {
  return Promise.all(
    urls.map((url) => ensureGeneratedImageCacheForTask(task, url))
  );
}
