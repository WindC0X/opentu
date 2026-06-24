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
  sanitizeCreativeUserParamsForModel,
  type CreativeUserParams,
} from '../../constants/model-config';
import type { ExecutionOptions } from './types';
import { taskStorageWriter } from './task-storage-writer';
import {
  CREATIVE_IMAGE_SUBMIT_TIMEOUT_MS,
  CREATIVE_REMOTE_IMAGE_TIMEOUT_MS,
  TASK_TIMEOUT,
} from '../../constants/TASK_CONSTANTS';
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
import { decodeGeneratedImageBlobDimensions } from '../../utils/generated-media-cache';
import { sanitizeCreativeFailureMessage } from '../creative-error-sanitizer';

type ImageGenerationMode = 'text_to_image' | 'image_to_image' | 'image_edit';
type ImageInputFidelity = 'high' | 'low';
type ImageBackground = 'transparent' | 'opaque' | 'auto';
type ImageOutputFormat = 'png' | 'jpeg' | 'webp';

const CREATIVE_IMAGE_MATERIALIZATION_RETRY_DELAY_MS = 1000;
const CREATIVE_IMAGE_TASK_FAILURE_FALLBACK = 'Creative image task failed';

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
  fail_reason?: string;
  error?: { message?: string } | string | Record<string, unknown>;
  result?: {
    url?: string;
    mimeType?: string;
    contentUrl?: string;
    width?: number;
    height?: number;
    targetWidth?: number;
    targetHeight?: number;
  };
}

interface CreativeManagedImageResult {
  url: string;
  format: string;
  size: number;
  remoteTaskId: string;
  providerTaskId: string;
  contentUrl?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  targetWidth?: number;
  targetHeight?: number;
}

class CreativeImageTaskTimeoutError extends Error {
  code = 'TIMEOUT';

  constructor() {
    super('creative image task timed out');
    this.name = 'TIMEOUT';
  }
}

class CreativeImageTaskSubmitInterruptedError extends Error {
  code = 'INTERRUPTED_DURING_SUBMISSION';

  constructor(message = 'Creative image task submit interrupted') {
    super(message);
    this.name = 'INTERRUPTED_DURING_SUBMISSION';
  }
}

export function isCreativeImageTaskTimeoutError(error: unknown): boolean {
  const candidate = error as { code?: unknown; name?: unknown } | undefined;
  return (
    error instanceof CreativeImageTaskTimeoutError ||
    candidate?.code === 'TIMEOUT' ||
    candidate?.name === 'TIMEOUT'
  );
}

function isCreativeImageTaskSubmitInterruptedError(error: unknown): boolean {
  const candidate = error as { code?: unknown; name?: unknown } | undefined;
  return (
    error instanceof CreativeImageTaskSubmitInterruptedError ||
    candidate?.code === 'INTERRUPTED_DURING_SUBMISSION' ||
    candidate?.name === 'INTERRUPTED_DURING_SUBMISSION'
  );
}

async function fetchCreativeImageTaskSubmit(
  init: RequestInit,
  timeoutMs = CREATIVE_IMAGE_SUBMIT_TIMEOUT_MS
): Promise<Response> {
  const callerSignal = init.signal;
  if (callerSignal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  return await new Promise<Response>((resolve, reject) => {
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const resolveOnce = (response: Response) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };
    const onCallerAbort = () => {
      controller?.abort();
      rejectOnce(new DOMException('Aborted', 'AbortError'));
    };

    timeoutId = setTimeout(() => {
      controller?.abort();
      rejectOnce(new CreativeImageTaskSubmitInterruptedError());
    }, timeoutMs);

    callerSignal?.addEventListener('abort', onCallerAbort, { once: true });

    fetch(creativeImageTaskPath(), {
      ...init,
      signal: controller?.signal || callerSignal,
    }).then(resolveOnce, (error) => {
      if (callerSignal?.aborted || isAbortError(error)) {
        rejectOnce(error);
        return;
      }
      rejectOnce(new CreativeImageTaskSubmitInterruptedError());
    });
  }).finally(() => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  });
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

function createCreativeImageTaskIdempotencyKey(
  taskId: string,
  retryAttempt = 0
): string {
  return retryAttempt > 0
    ? `opentu-image-${taskId}-retry-${retryAttempt}`
    : `opentu-image-${taskId}`;
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

function normalizeRetryAttempt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : undefined;
}

function createTaskStorageWriteGuard(params: {
  retryAttempt?: unknown;
  startedAt?: unknown;
}): { expectedRetryAttempt?: number; expectedStartedAt?: number } | undefined {
  const expectedRetryAttempt = normalizeRetryAttempt(params.retryAttempt);
  const expectedStartedAt =
    typeof params.startedAt === 'number' && Number.isFinite(params.startedAt)
      ? params.startedAt
      : undefined;
  return typeof expectedRetryAttempt === 'number' ||
    typeof expectedStartedAt === 'number'
    ? { expectedRetryAttempt, expectedStartedAt }
    : undefined;
}

async function updateStoredRemoteId(
  taskId: string,
  remoteId: string,
  invocationRoute: ReturnType<typeof createTaskInvocationRouteSnapshot>,
  guard?: { expectedRetryAttempt?: number; expectedStartedAt?: number }
): Promise<boolean> {
  if (guard) {
    return taskStorageWriter.updateRemoteId(
      taskId,
      remoteId,
      invocationRoute,
      guard
    );
  }
  return taskStorageWriter.updateRemoteId(taskId, remoteId, invocationRoute);
}

async function completeStoredTask(
  taskId: string,
  result: Parameters<typeof taskStorageWriter.completeTask>[1],
  guard?: { expectedRetryAttempt?: number; expectedStartedAt?: number }
): Promise<boolean> {
  if (guard) {
    return taskStorageWriter.completeTask(taskId, result, guard);
  }
  return taskStorageWriter.completeTask(taskId, result);
}

async function failStoredTask(
  taskId: string,
  error: Parameters<typeof taskStorageWriter.failTask>[1],
  guard?: { expectedRetryAttempt?: number; expectedStartedAt?: number }
): Promise<boolean> {
  if (guard) {
    return taskStorageWriter.failTask(taskId, error, guard);
  }
  return taskStorageWriter.failTask(taskId, error);
}

function extractCreativeTaskErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const candidate = payload as Record<string, unknown>;
  if (
    typeof candidate.fail_reason === 'string' &&
    candidate.fail_reason.trim()
  ) {
    return sanitizeCreativeFailureMessage(
      candidate.fail_reason,
      CREATIVE_IMAGE_TASK_FAILURE_FALLBACK
    );
  }
  if (typeof candidate.message === 'string' && candidate.message.trim()) {
    return sanitizeCreativeFailureMessage(
      candidate.message,
      CREATIVE_IMAGE_TASK_FAILURE_FALLBACK
    );
  }

  const error = candidate.error;
  if (typeof error === 'string' && error.trim()) {
    return sanitizeCreativeFailureMessage(
      error,
      CREATIVE_IMAGE_TASK_FAILURE_FALLBACK
    );
  }
  if (error && typeof error === 'object') {
    const errorMessage = (error as Record<string, unknown>).message;
    if (typeof errorMessage === 'string' && errorMessage.trim()) {
      return sanitizeCreativeFailureMessage(
        errorMessage,
        CREATIVE_IMAGE_TASK_FAILURE_FALLBACK
      );
    }
  }

  return undefined;
}

async function readCreativeTaskErrorMessage(
  response: Response
): Promise<string | undefined> {
  const contentType = response.headers.get('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      return extractCreativeTaskErrorMessage(await response.json());
    }
    const text = await response.text();
    return text.trim()
      ? sanitizeCreativeFailureMessage(
          text.trim().slice(0, 500),
          CREATIVE_IMAGE_TASK_FAILURE_FALLBACK
        )
      : undefined;
  } catch {
    return undefined;
  }
}

async function parseCreativeImageTaskResponse(
  response: Response,
  operation: 'submit' | 'fetch' | 'content'
): Promise<CreativeImageTaskDTO> {
  if (!response.ok) {
    const safeMessage = await readCreativeTaskErrorMessage(response);
    const error = new Error(
      safeMessage ||
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

function isTemporaryCreativeImagePollStatus(status: number): boolean {
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

function isRetryableCreativeImageMaterializationError(error: unknown): boolean {
  const candidate = error as
    | { httpStatus?: unknown; retryableMaterialization?: unknown }
    | undefined;
  if (candidate?.retryableMaterialization === true) {
    return true;
  }
  return (
    typeof candidate?.httpStatus === 'number' &&
    isTemporaryCreativeImagePollStatus(candidate.httpStatus)
  );
}

function isAbortError(error: unknown): boolean {
  return (
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function createRetryableMaterializationError(
  message: string,
  cause?: unknown
): Error {
  const error = new Error(message);
  (error as any).retryableMaterialization = true;
  if (cause !== undefined) {
    (error as any).cause = cause;
  }
  return error;
}

async function waitForCreativeImageMaterializationRetry(
  signal?: AbortSignal
): Promise<void> {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, CREATIVE_IMAGE_MATERIALIZATION_RETRY_DELAY_MS);

    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function getCreativeImageTaskFailureMessage(
  task: CreativeImageTaskDTO
): string {
  if (typeof task.fail_reason === 'string' && task.fail_reason.trim()) {
    return sanitizeCreativeFailureMessage(
      task.fail_reason,
      CREATIVE_IMAGE_TASK_FAILURE_FALLBACK
    );
  }
  if (typeof task.error === 'string' && task.error.trim()) {
    return sanitizeCreativeFailureMessage(
      task.error,
      CREATIVE_IMAGE_TASK_FAILURE_FALLBACK
    );
  }
  if (
    task.error &&
    typeof task.error === 'object' &&
    typeof task.error.message === 'string' &&
    task.error.message.trim()
  ) {
    return sanitizeCreativeFailureMessage(
      task.error.message,
      CREATIVE_IMAGE_TASK_FAILURE_FALLBACK
    );
  }
  return CREATIVE_IMAGE_TASK_FAILURE_FALLBACK;
}

async function downloadCreativeImageTaskContent(params: {
  taskId: string;
  contentUrl?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<{
  url: string;
  format: string;
  size: number;
  contentUrl: string;
  mimeType?: string;
  width?: number;
  height?: number;
}> {
  const contentUrl = resolveCreativeImageTaskContentUrl(
    params.taskId,
    params.contentUrl
  );
  let response: Response;
  try {
    response = await fetch(contentUrl, {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        Accept: 'image/*,application/octet-stream',
      },
      signal: params.signal,
    });
  } catch (error) {
    if (params.signal?.aborted || isAbortError(error)) {
      throw error;
    }
    const retryable = new Error(
      `creative image task content fetch failed: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    (retryable as any).retryableMaterialization = true;
    throw retryable;
  }
  await parseCreativeImageTaskResponse(response, 'content');
  const blob = await response.blob();
  if (!blob.size) {
    throw new Error('creative image task content is empty');
  }
  const decoded = await decodeGeneratedImageBlobDimensions(blob);
  const format = extensionFromMimeType(blob.type);
  const localUrl = `/__aitu_cache__/image/${params.taskId}.${format}`;
  try {
    await unifiedCacheService.cacheMediaFromBlob(localUrl, blob, 'image', {
      taskId: params.taskId,
      model: params.model,
      metadata: {
        remoteTaskId: params.taskId,
        contentUrl,
        mimeType: blob.type,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw createRetryableMaterializationError(
      `creative image task cache write failed: ${message}`,
      error
    );
  }
  return {
    url: localUrl,
    format,
    size: blob.size,
    contentUrl,
    mimeType: blob.type,
    width: decoded.width,
    height: decoded.height,
  };
}

async function pollCreativeManagedImageTask(params: {
  taskId: string;
  remoteTaskId: string;
  model?: string;
  current?: CreativeImageTaskDTO;
  options?: ExecutionOptions;
  pollStartedAt?: number;
}): Promise<CreativeManagedImageResult> {
  let current = params.current;
  const startedAt = params.pollStartedAt ?? Date.now();

  while (Date.now() - startedAt <= CREATIVE_REMOTE_IMAGE_TIMEOUT_MS) {
    if (isCreativeImageTaskComplete(current?.status)) {
      try {
        const content = await downloadCreativeImageTaskContent({
          taskId: params.remoteTaskId,
          contentUrl: current?.result?.contentUrl || current?.result?.url,
          model: params.model,
          signal: params.options?.signal,
        });
        return {
          url: content.url,
          format: content.format,
          size: content.size,
          remoteTaskId: params.remoteTaskId,
          providerTaskId: params.remoteTaskId,
          contentUrl: content.contentUrl,
          mimeType: content.mimeType || current?.result?.mimeType,
          width: content.width || current?.result?.width,
          height: content.height || current?.result?.height,
          targetWidth: current?.result?.targetWidth,
          targetHeight: current?.result?.targetHeight,
        };
      } catch (error) {
        if (
          !isRetryableCreativeImageMaterializationError(error) ||
          Date.now() - startedAt >= CREATIVE_REMOTE_IMAGE_TIMEOUT_MS
        ) {
          throw error;
        }
        params.options?.onProgress?.({
          progress: 96,
          phase: 'materializing',
        });
        await waitForCreativeImageMaterializationRetry(params.options?.signal);
        continue;
      }
    }

    if (isCreativeImageTaskFailed(current?.status)) {
      throw new Error(getCreativeImageTaskFailureMessage(current || {}));
    }

    const elapsed = Date.now() - startedAt;
    params.options?.onProgress?.({
      progress: Math.min(95, 10 + Math.floor(elapsed / 1000)),
      phase: 'polling',
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));

    let pollResponse: Response;
    try {
      pollResponse = await fetch(creativeImageTaskPath(params.remoteTaskId), {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
        },
        signal: params.options?.signal,
      });
    } catch (error) {
      if (params.options?.signal?.aborted || isAbortError(error)) {
        throw error;
      }
      if (Date.now() - startedAt >= CREATIVE_REMOTE_IMAGE_TIMEOUT_MS) {
        throw new CreativeImageTaskTimeoutError();
      }
      continue;
    }
    if (
      !pollResponse.ok &&
      isTemporaryCreativeImagePollStatus(pollResponse.status)
    ) {
      continue;
    }
    current = await parseCreativeImageTaskResponse(pollResponse, 'fetch');
  }

  throw new CreativeImageTaskTimeoutError();
}

export async function resumeCreativeManagedImageTask(
  taskId: string,
  remoteTaskId: string,
  params: {
    model?: string;
  },
  options?: ExecutionOptions
): Promise<CreativeManagedImageResult> {
  return pollCreativeManagedImageTask({
    taskId,
    remoteTaskId,
    model: params.model,
    options,
  });
}

export async function executeCreativeManagedImageTask(
  taskId: string,
  params: {
    prompt: string;
    model: string;
    modelRef?: ModelRef | null;
    referenceImages?: string[];
    userParams: CreativeUserParams;
    idempotencyKey?: string;
    assetMetadata?: GenerationParams['assetMetadata'];
    retryAttempt?: number;
    startedAt?: number;
  },
  options?: ExecutionOptions,
  startTime?: number
): Promise<void> {
  const logStartTime = startTime || Date.now();
  const writeGuard = createTaskStorageWriteGuard(params);
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
  let acceptedRemoteTaskId: string | undefined;

  try {
    if (params.referenceImages?.length) {
      throw new Error(
        'creative managed image task does not support reference images yet'
      );
    }
    const idempotencyKey =
      params.idempotencyKey ||
      createCreativeImageTaskIdempotencyKey(taskId, params.retryAttempt);
    const userParams = sanitizeCreativeUserParamsForModel(
      params.model,
      params.userParams
    );
    options?.onProgress?.({ progress: 10, phase: 'submitting' });
    const submitResponse = await fetchCreativeImageTaskSubmit({
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
        userParams,
      }),
      signal: options?.signal,
    });
    const submitted = await parseCreativeImageTaskResponse(
      submitResponse,
      'submit'
    );
    const remoteTaskId = submitted.task_id || taskId;
    acceptedRemoteTaskId = remoteTaskId;
    updateLLMApiLogMetadata(logId, {
      remoteId: remoteTaskId,
      httpStatus: submitResponse.status,
    });
    const invocationRoute = createTaskInvocationRouteSnapshot(
      'image',
      params.modelRef || params.model
    );
    await updateStoredRemoteId(
      taskId,
      remoteTaskId,
      invocationRoute,
      writeGuard
    );
    await options?.onSubmitted?.(remoteTaskId, invocationRoute);

    const result = await pollCreativeManagedImageTask({
      taskId,
      remoteTaskId,
      model: params.model,
      current: submitted,
      options,
      pollStartedAt: logStartTime,
    });
    completeLLMApiLog(logId, {
      httpStatus: submitResponse.status,
      duration: Date.now() - logStartTime,
      resultType: 'image',
      resultCount: 1,
      remoteId: remoteTaskId,
      resultUrl: result.url,
    });
    options?.onProgress?.({ progress: 100 });
    await completeStoredTask(taskId, result, writeGuard);
    return;
  } catch (error: any) {
    const errorMessage = sanitizeCreativeFailureMessage(
      error?.message,
      CREATIVE_IMAGE_TASK_FAILURE_FALLBACK
    );
    const acceptedRemoteTaskWasLocallyAborted =
      !!acceptedRemoteTaskId &&
      (options?.signal?.aborted || isAbortError(error));
    if (
      isCreativeImageTaskTimeoutError(error) ||
      acceptedRemoteTaskWasLocallyAborted
    ) {
      const recoverableError = isCreativeImageTaskTimeoutError(error)
        ? error
        : new CreativeImageTaskTimeoutError();
      const recoverableMessage = sanitizeCreativeFailureMessage(
        recoverableError.message,
        CREATIVE_IMAGE_TASK_FAILURE_FALLBACK
      );
      failLLMApiLog(logId, {
        duration: Date.now() - logStartTime,
        errorMessage: recoverableMessage,
      });
      if (writeGuard) {
        await taskStorageWriter.updateProgress(
          taskId,
          95,
          'polling',
          writeGuard
        );
      } else {
        await taskStorageWriter.updateProgress(taskId, 95, 'polling');
      }
      throw recoverableError;
    }
    const errorCode =
      error?.code === 'TIMEOUT' || error?.name === 'TIMEOUT'
        ? 'TIMEOUT'
        : isCreativeImageTaskSubmitInterruptedError(error)
        ? 'INTERRUPTED_DURING_SUBMISSION'
        : 'IMAGE_GENERATION_ERROR';
    failLLMApiLog(logId, {
      duration: Date.now() - logStartTime,
      errorMessage,
    });
    await failStoredTask(
      taskId,
      {
        code: errorCode,
        message: errorMessage,
      },
      writeGuard
    );
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
    retryAttempt?: number;
    startedAt?: number;
  },
  options?: ExecutionOptions,
  startTime?: number
): Promise<void> {
  const logStartTime = startTime || Date.now();
  const writeGuard = createTaskStorageWriteGuard(params);
  const preferredRequestSchema = resolvePreferredRequestSchema(params);
  const invocationRoute = createTaskInvocationRouteSnapshot(
    'image',
    params.modelRef || params.model
  );

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
    const idempotencyKey =
      params.idempotencyKey || createCreativeImageTaskIdempotencyKey(taskId);
    const adapterParams: Record<string, unknown> | undefined = schemaBacked
      ? undefined
      : {
          resolution: params.resolution,
          quality: params.quality,
          n: params.count,
          ...params.params,
          idempotencyKey,
        };
    const onAdapterProgress = (progress: number) => {
      const safeProgress = Math.min(100, Math.max(10, progress));
      options?.onProgress?.({
        progress: safeProgress,
        phase: safeProgress <= 10 ? 'submitting' : 'polling',
      });
    };
    const onAdapterSubmitted = async (remoteId: string) => {
      await options?.onSubmitted?.(remoteId, invocationRoute);
    };

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
        outputCompression: schemaBacked ? undefined : params.outputCompression,
        idempotencyKey,
        onProgress: onAdapterProgress,
        onSubmitted: onAdapterSubmitted,
        params: adapterParams,
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

    await completeStoredTask(
      taskId,
      {
        url: cachedPrimary,
        urls: cachedUrls.length > 1 ? cachedUrls : undefined,
        format: fmt,
        size: 0,
      },
      writeGuard
    );
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
    await failStoredTask(
      taskId,
      {
        code: 'IMAGE_GENERATION_ERROR',
        message: errorMessage,
      },
      writeGuard
    );
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
    retryAttempt?: number;
    startedAt?: number;
  },
  options?: ExecutionOptions,
  startTime?: number
): Promise<void> {
  const logStartTime = startTime || Date.now();
  const writeGuard = createTaskStorageWriteGuard(params);

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
    let submittedVideoId: string | undefined;
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
        signal: options?.signal,
        onProgress: (progress: number) => {
          const safeProgress = Math.min(100, Math.max(10, progress));
          options?.onProgress?.({
            progress: safeProgress,
            phase: safeProgress <= 10 ? 'submitting' : 'polling',
          });
        },
        onSubmitted: async (videoId: string) => {
          submittedVideoId = videoId;
          const invocationRoute = createTaskInvocationRouteSnapshot(
            'video',
            params.modelRef || params.model
          );
          await updateStoredRemoteId(
            taskId,
            videoId,
            invocationRoute,
            writeGuard
          );
          await options?.onSubmitted?.(videoId, invocationRoute);
        },
        params: {
          ...params.params,
          onProgress: (progress: number) => {
            const safeProgress = Math.min(100, Math.max(10, progress));
            options?.onProgress?.({
              progress: safeProgress,
              phase: safeProgress <= 10 ? 'submitting' : 'polling',
            });
          },
          onSubmitted: async (videoId: string) => {
            submittedVideoId = videoId;
            const invocationRoute = createTaskInvocationRouteSnapshot(
              'video',
              params.modelRef || params.model
            );
            await updateStoredRemoteId(
              taskId,
              videoId,
              invocationRoute,
              writeGuard
            );
            await options?.onSubmitted?.(videoId, invocationRoute);
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
      videoFmt,
      undefined,
      {
        forceRemoteCache: true,
        extraMetadata: {
          contentUrl: result.url,
          ...(submittedVideoId
            ? {
                remoteTaskId: submittedVideoId,
                providerTaskId: submittedVideoId,
              }
            : undefined),
        },
      }
    );

    await completeStoredTask(
      taskId,
      {
        url: cachedVideoUrl,
        format: videoFmt,
        size: 0,
        duration: result.duration,
      },
      writeGuard
    );
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
    await failStoredTask(
      taskId,
      {
        code: error.code || 'VIDEO_GENERATION_ERROR',
        message: errorMessage,
      },
      writeGuard
    );
    throw error;
  }
}
