/**
 * Adapter routes for FallbackMediaExecutor
 *
 * 将专用 adapter（mj-imagine、kling 等）的执行逻辑从 fallback-executor 中提取出来，
 * 保持 LLM 日志、任务存储、认证错误检测等基础设施。
 */

import type { ModelRef } from '../../utils/settings-manager';
import type { GenerationParams } from '../../types/shared/core.types';
import {
  hasCreativeUserParams,
  isCreativeManagedImageTask,
  type CreativeUserParams,
} from '../../constants/model-config';
import type { ExecutionOptions } from './types';
import { taskStorageWriter } from './task-storage-writer';
import {
  CREATIVE_RELAY_BASE_URL,
  requireCreativeSessionAuthHeaders,
} from '../creative-mode';
import { createTaskInvocationRouteSnapshot } from '../task-invocation-route';
import {
  startLLMApiLog,
  completeLLMApiLog,
  failLLMApiLog,
  updateLLMApiLogMetadata,
  LLMReferenceImage,
} from './llm-api-logger';
import {
  classifyApiCredentialError,
  dispatchApiAuthError,
} from '../../utils/api-auth-error-event';
import { unifiedCacheService } from '../unified-cache-service';
import {
  getAdapterContextFromSettings,
  GPT_IMAGE_EDIT_REQUEST_SCHEMAS,
  isGPTImageEditRequestSchema,
} from '../model-adapters';
import type { ImageModelAdapter, VideoModelAdapter } from '../model-adapters';
import {
  ensureBase64ForAI,
  cacheRemoteUrl,
  cacheRemoteUrls,
} from './fallback-utils';

type ImageGenerationMode = 'text_to_image' | 'image_to_image' | 'image_edit';
type ImageInputFidelity = 'high' | 'low';
type ImageBackground = 'transparent' | 'opaque' | 'auto';
type ImageOutputFormat = 'png' | 'jpeg' | 'webp';

type CreativeImageTaskStatus =
  | 'queued'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'succeeded'
  | 'success'
  | 'error';

interface CreativeImageTaskDTO {
  task_id?: string;
  status?: CreativeImageTaskStatus | string;
  progress?: string;
  model?: string;
  result?: {
    url?: string;
    mimeType?: string;
  };
}

function getStringParam(
  params: { params?: Record<string, unknown> },
  keys: string[]
): string | undefined {
  const rawParams = params as unknown as Record<string, unknown>;
  const nestedParams = params.params;

  for (const key of keys) {
    const value = rawParams[key] ?? nestedParams?.[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function resolvePreferredRequestSchema(params: {
  generationMode?: ImageGenerationMode;
  maskImage?: string;
  referenceImages?: string[];
  params?: Record<string, unknown>;
  preferredRequestSchema?: string | readonly string[];
}): string | readonly string[] | undefined {
  const generationMode =
    params.generationMode ||
    getStringParam(params, ['generationMode', 'generation_mode']);

  if (
    params.referenceImages?.length ||
    generationMode === 'image_to_image' ||
    generationMode === 'image_edit' ||
    params.maskImage ||
    getStringParam(params, ['maskImage', 'mask_image'])
  ) {
    return params.preferredRequestSchema || GPT_IMAGE_EDIT_REQUEST_SCHEMAS;
  }

  return params.preferredRequestSchema;
}

function creativeImageTaskPath(taskId?: string): string {
  const base = `${CREATIVE_RELAY_BASE_URL}/images/tasks`;
  return taskId ? `${base}/${encodeURIComponent(taskId)}` : base;
}

function isCreativeImageTaskComplete(status?: string): boolean {
  const normalized = (status || '').toLowerCase();
  return (
    normalized === 'completed' ||
    normalized === 'succeeded' ||
    normalized === 'success'
  );
}

function isCreativeImageTaskFailed(status?: string): boolean {
  const normalized = (status || '').toLowerCase();
  return normalized === 'failed' || normalized === 'error';
}

function extensionFromMimeType(mimeType?: string): string {
  const normalized = mimeType?.toLowerCase() || '';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  if (normalized.includes('webp')) return 'webp';
  return 'png';
}

function createCreativeImageTaskIdempotencyKey(taskId: string): string {
  return `opentu-image-${taskId}`;
}

function resolveCreativeImageTaskContentUrl(
  taskId: string,
  contentUrl?: string
): string {
  const fallback = `${creativeImageTaskPath(taskId)}/content`;
  if (!contentUrl) {
    return fallback;
  }
  if (contentUrl === fallback) {
    return contentUrl;
  }
  return fallback;
}

async function parseCreativeImageTaskResponse(
  response: Response,
  operation: 'submit' | 'fetch' | 'content'
): Promise<CreativeImageTaskDTO> {
  if (!response.ok) {
    const error = new Error(
      `creative image task ${operation} failed: ${response.status}`
    );
    (error as any).httpStatus = response.status;
    throw error;
  }
  if (operation === 'content') {
    return {};
  }
  const payload = (await response.json()) as CreativeImageTaskDTO;
  if (!payload || typeof payload !== 'object') {
    throw new Error(`creative image task ${operation} returned invalid JSON`);
  }
  return payload;
}

async function downloadCreativeImageTaskContent(params: {
  taskId: string;
  contentUrl?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<{ url: string; format: string; size: number }> {
  const response = await fetch(
    resolveCreativeImageTaskContentUrl(params.taskId, params.contentUrl),
    {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'image/*,application/octet-stream',
      },
      signal: params.signal,
    }
  );
  await parseCreativeImageTaskResponse(response, 'content');
  const blob = await response.blob();
  if (!blob.size) {
    throw new Error('creative image task content is empty');
  }
  const format = extensionFromMimeType(blob.type);
  const localUrl = `/__aitu_cache__/image/${params.taskId}.${format}`;
  await unifiedCacheService.cacheMediaFromBlob(localUrl, blob, 'image', {
    taskId: params.taskId,
    model: params.model,
  });
  return { url: localUrl, format, size: blob.size };
}

export async function executeCreativeManagedImageTask(
  taskId: string,
  params: {
    prompt: string;
    model: string;
    modelRef?: ModelRef | null;
    referenceImages?: string[];
    userParams: CreativeUserParams;
    assetMetadata?: GenerationParams['assetMetadata'];
  },
  options?: ExecutionOptions,
  startTime?: number
): Promise<void> {
  const logStartTime = startTime || Date.now();
  const logId = startLLMApiLog({
    endpoint: `${CREATIVE_RELAY_BASE_URL}/images/tasks`,
    model: params.model,
    taskType: 'image',
    prompt: params.prompt,
    hasReferenceImages:
      !!params.referenceImages && params.referenceImages.length > 0,
    referenceImageCount: params.referenceImages?.length,
    taskId,
  });

  try {
    if (params.referenceImages?.length) {
      throw new Error(
        'creative managed image task does not support reference images yet'
      );
    }
    const idempotencyKey = createCreativeImageTaskIdempotencyKey(taskId);
    options?.onProgress?.({ progress: 10, phase: 'submitting' });
    const submitResponse = await fetch(creativeImageTaskPath(), {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        ...requireCreativeSessionAuthHeaders(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify({
        model: params.model,
        prompt: params.prompt,
        userParams: params.userParams,
      }),
      signal: options?.signal,
    });
    const submitted = await parseCreativeImageTaskResponse(
      submitResponse,
      'submit'
    );
    const remoteTaskId = submitted.task_id || taskId;
    updateLLMApiLogMetadata(logId, {
      remoteId: remoteTaskId,
      httpStatus: submitResponse.status,
    });

    let current = submitted;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (isCreativeImageTaskComplete(current.status)) {
        const content = await downloadCreativeImageTaskContent({
          taskId: remoteTaskId,
          contentUrl: current.result?.url,
          model: params.model,
          signal: options?.signal,
        });
        completeLLMApiLog(logId, {
          httpStatus: submitResponse.status,
          duration: Date.now() - logStartTime,
          resultType: 'image',
          resultCount: 1,
          remoteId: remoteTaskId,
          resultUrl: content.url,
        });
        options?.onProgress?.({ progress: 100 });
        await taskStorageWriter.completeTask(taskId, {
          url: content.url,
          format: content.format,
          size: content.size,
        });
        return;
      }

      if (isCreativeImageTaskFailed(current.status)) {
        throw new Error('creative image task failed');
      }

      options?.onProgress?.({
        progress: Math.min(95, 10 + attempt),
        phase: 'polling',
      });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const pollResponse = await fetch(creativeImageTaskPath(remoteTaskId), {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
        },
        signal: options?.signal,
      });
      current = await parseCreativeImageTaskResponse(pollResponse, 'fetch');
    }

    throw new Error('creative image task timed out');
  } catch (error: any) {
    const errorMessage = error?.message || 'Creative image task failed';
    failLLMApiLog(logId, {
      duration: Date.now() - logStartTime,
      errorMessage,
    });
    await taskStorageWriter.failTask(taskId, {
      code: 'IMAGE_GENERATION_ERROR',
      message: errorMessage,
    });
    throw error;
  }
}

/**
 * 通过专用 adapter 生成图片（mj-imagine 等非 gemini 模型）
 * 复用 LLM 日志、任务存储、认证错误检测
 */
export async function executeImageViaAdapter(
  taskId: string,
  adapter: ImageModelAdapter,
  params: {
    prompt: string;
    model: string;
    modelRef?: ModelRef | null;
    size?: string;
    resolution?: '1k' | '2k' | '4k';
    quality?: string;
    count?: number;
    referenceImages?: string[];
    generationMode?: ImageGenerationMode;
    maskImage?: string;
    inputFidelity?: ImageInputFidelity;
    background?: ImageBackground;
    outputFormat?: ImageOutputFormat;
    outputCompression?: number;
    idempotencyKey?: string;
    params?: Record<string, unknown>;
    userParams?: CreativeUserParams;
    creativeManaged?: boolean;
    assetMetadata?: GenerationParams['assetMetadata'];
    preferredRequestSchema?: string | readonly string[];
  },
  options?: ExecutionOptions,
  startTime?: number
): Promise<void> {
  const logStartTime = startTime || Date.now();
  const preferredRequestSchema = resolvePreferredRequestSchema(params);

  const logId = startLLMApiLog({
    endpoint: `adapter:${adapter.id}`,
    model: params.model,
    taskType: 'image',
    prompt: params.prompt,
    hasReferenceImages:
      !!params.referenceImages && params.referenceImages.length > 0,
    referenceImageCount: params.referenceImages?.length,
    referenceImages: params.referenceImages?.map(
      (url) => ({ url, size: 0, width: 0, height: 0 } as LLMReferenceImage)
    ),
    taskId,
  });

  try {
    const schemaBacked =
      isCreativeManagedImageTask(params) ||
      hasCreativeUserParams(params.userParams);
    if (schemaBacked && !adapter.supportsCreativeUserParams) {
      throw new Error(
        'schema-backed Creative image requests require a managed userParams adapter'
      );
    }
    let processedImages: string[] | undefined;
    if (params.referenceImages && params.referenceImages.length > 0) {
      processedImages = await Promise.all(
        params.referenceImages.map(async (imgUrl) => {
          const imageData = await unifiedCacheService.getImageForAI(imgUrl);
          return ensureBase64ForAI(imageData, options?.signal);
        })
      );
    }

    options?.onProgress?.({ progress: 10, phase: 'submitting' });
    const idempotencyKey = `opentu-image-${taskId}`;

    const result = await adapter.generateImage(
      getAdapterContextFromSettings('image', params.modelRef || params.model, {
        preferredRequestSchema,
      }),
      {
        prompt: params.prompt,
        model: params.model,
        modelRef: params.modelRef || null,
        size: schemaBacked ? undefined : params.size,
        generationMode:
          params.generationMode ||
          (isGPTImageEditRequestSchema(preferredRequestSchema)
            ? 'image_to_image'
            : 'text_to_image'),
        referenceImages: processedImages,
        maskImage: params.maskImage,
        inputFidelity: schemaBacked ? undefined : params.inputFidelity,
        background: schemaBacked ? undefined : params.background,
        outputFormat: schemaBacked ? undefined : params.outputFormat,
        outputCompression: schemaBacked
          ? undefined
          : params.outputCompression,
        idempotencyKey,
        params: schemaBacked
          ? undefined
          : {
              resolution: params.resolution,
              quality: params.quality,
              n: params.count,
              ...params.params,
              idempotencyKey,
            },
        userParams: schemaBacked ? params.userParams : undefined,
      }
    );

    const duration = Date.now() - logStartTime;

    completeLLMApiLog(logId, {
      httpStatus: 200,
      duration,
      resultType: 'image',
      resultCount: 1,
      resultUrl: result.url,
    });

    options?.onProgress?.({ progress: 100 });

    // 缓存远程签名 URL 到本地，避免 Referer 校验导致 403
    const fmt = result.format || 'png';
    const allUrls = result.urls?.length ? result.urls : [result.url];
    const cachedUrls = await cacheRemoteUrls(allUrls, taskId, 'image', fmt, {
      extraMetadata: params.assetMetadata
        ? { ...params.assetMetadata }
        : undefined,
    });
    const cachedPrimary = cachedUrls[0];

    await taskStorageWriter.completeTask(taskId, {
      url: cachedPrimary,
      urls: cachedUrls.length > 1 ? cachedUrls : undefined,
      format: fmt,
      size: 0,
    });
  } catch (error: any) {
    const duration = Date.now() - logStartTime;
    const errorMessage = error.message || 'Image generation failed (adapter)';

    const credentialErrorKind = classifyApiCredentialError(error);
    if (credentialErrorKind) {
      dispatchApiAuthError({
        message: errorMessage,
        source: 'image',
        reason: credentialErrorKind,
      });
    }

    failLLMApiLog(logId, { duration, errorMessage });
    await taskStorageWriter.failTask(taskId, {
      code: 'IMAGE_GENERATION_ERROR',
      message: errorMessage,
    });
    throw error;
  }
}

const isVirtualPath = (u: string) =>
  u.startsWith('/__aitu_cache__/') || u.startsWith('/asset-library/');

/**
 * 通过专用 adapter 生成视频（kling 等非 gemini 模型）
 * 复用 LLM 日志、任务存储、认证错误检测
 */
export async function executeVideoViaAdapter(
  taskId: string,
  adapter: VideoModelAdapter,
  params: {
    prompt: string;
    model: string;
    modelRef?: ModelRef | null;
    size?: string;
    duration?: string;
    referenceImages?: string[];
    inputReference?: string;
    idempotencyKey?: string;
    params?: Record<string, unknown>;
  },
  options?: ExecutionOptions,
  startTime?: number
): Promise<void> {
  const logStartTime = startTime || Date.now();

  const refUrls =
    (params.referenceImages && params.referenceImages.length > 0
      ? params.referenceImages
      : undefined) ||
    (params.inputReference ? [params.inputReference] : undefined);

  const logId = startLLMApiLog({
    endpoint: `adapter:${adapter.id}`,
    model: params.model,
    taskType: 'video',
    prompt: params.prompt,
    taskId,
    hasReferenceImages: !!refUrls && refUrls.length > 0,
    referenceImageCount: refUrls?.length,
    referenceImages: refUrls?.map(
      (url) => ({ url, size: 0, width: 0, height: 0 } as LLMReferenceImage)
    ),
  });

  try {
    let processedImages: string[] | undefined;
    if (refUrls && refUrls.length > 0) {
      processedImages = await Promise.all(
        refUrls.map(async (url) => {
          if (isVirtualPath(url)) {
            const imageData = await unifiedCacheService.getImageForAI(url);
            return ensureBase64ForAI(imageData, options?.signal);
          }
          return url;
        })
      );
    }

    options?.onProgress?.({ progress: 10, phase: 'submitting' });

    const durationNum = params.duration
      ? parseInt(params.duration, 10)
      : undefined;
    const nestedIdempotencyKey =
      typeof params.params?.idempotencyKey === 'string'
        ? params.params.idempotencyKey.trim()
        : undefined;
    const idempotencyKey =
      params.idempotencyKey || nestedIdempotencyKey || `opentu-video-${taskId}`;

    const result = await adapter.generateVideo(
      getAdapterContextFromSettings('video', params.modelRef || params.model),
      {
        prompt: params.prompt,
        model: params.model,
        modelRef: params.modelRef || null,
        size: params.size,
        duration: durationNum,
        referenceImages: processedImages,
        idempotencyKey,
        params: {
          ...params.params,
          onProgress: (progress: number) => {
            const safeProgress = Math.min(100, Math.max(10, progress));
            options?.onProgress?.({
              progress: safeProgress,
              phase: safeProgress <= 10 ? 'submitting' : 'polling',
            });
          },
          onSubmitted: (videoId: string) => {
            void taskStorageWriter.updateRemoteId(
              taskId,
              videoId,
              createTaskInvocationRouteSnapshot(
                'video',
                params.modelRef || params.model
              )
            );
          },
        },
      }
    );

    const duration = Date.now() - logStartTime;

    completeLLMApiLog(logId, {
      httpStatus: 200,
      duration,
      resultType: 'video',
      resultCount: 1,
      resultUrl: result.url,
    });

    options?.onProgress?.({ progress: 100 });

    // 缓存远程签名 URL 到本地
    const videoFmt = result.format || 'mp4';
    const cachedVideoUrl = await cacheRemoteUrl(
      result.url,
      taskId,
      'video',
      videoFmt
    );

    await taskStorageWriter.completeTask(taskId, {
      url: cachedVideoUrl,
      format: videoFmt,
      size: 0,
      duration: result.duration,
    });
  } catch (error: any) {
    const duration = Date.now() - logStartTime;
    const errorMessage = error.message || 'Video generation failed (adapter)';

    const credentialErrorKind = classifyApiCredentialError(error);
    if (credentialErrorKind) {
      dispatchApiAuthError({
        message: errorMessage,
        source: 'video',
        reason: credentialErrorKind,
      });
    }

    failLLMApiLog(logId, { duration, errorMessage });
    await taskStorageWriter.failTask(taskId, {
      code: error.code || 'VIDEO_GENERATION_ERROR',
      message: errorMessage,
    });
    throw error;
  }
}
