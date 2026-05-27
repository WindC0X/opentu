import {
  TaskStatus,
  TaskType,
  type GenerationParams,
  type PlatformImageTaskCanvasSyncStatus,
  type PlatformImageTaskPriceQuoteMirror,
  type Task,
  type TaskError,
  type TaskResult,
} from '../types/task.types';
import {
  getCurrentPlatformProjectId,
  type PlatformAsset,
} from './asset-integration-service';

const DEFAULT_PLATFORM_IMAGE_MODEL_KEY = 'mock-image-v1';
const DEFAULT_PLATFORM_IMAGE_RATIO = '1:1';

interface ApiEnvelope<T> {
  data: T | null;
  error: {
    code: string;
    message: string;
  } | null;
  request_id: string;
}

export type PlatformImageTaskStatus =
  | 'queued'
  | 'running'
  | 'persisting'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface PlatformImageTaskQuote
  extends PlatformImageTaskPriceQuoteMirror {
  pricePolicyId: string;
}

export interface PlatformImageTaskView {
  actualModelKey: string | null;
  actualProvider: string | null;
  assets: PlatformAsset[];
  batchSize: 1 | 2 | 4;
  canvasSync: {
    assetIds: string[];
    imageTaskId: string;
    projectId: string;
    retryCount: number;
    status: Exclude<PlatformImageTaskCanvasSyncStatus, 'not_required'>;
  } | null;
  canvasSyncStatus: PlatformImageTaskCanvasSyncStatus;
  createdAt: string;
  failureCode: string | null;
  failureCount: number;
  failureMessage: string | null;
  finalPrompt: string;
  id: string;
  modelFamily: string;
  modelVersion: string;
  operationType: 'text_to_image';
  optimizedPrompt: string | null;
  ownerUserId: string;
  priceVersion: number;
  projectId: string;
  quotedPriceAmount: number;
  quotedPriceUnit: 'points';
  ratio: string;
  requestedModelKey: string;
  requestedProvider: string;
  settledAt: string | null;
  settledPriceAmount: number | null;
  status: PlatformImageTaskStatus;
  successCount: number;
  updatedAt: string;
  userPrompt: string;
}

export interface PlatformImageTaskPatch {
  status: TaskStatus;
  updates: Partial<Task>;
}

export function normalizePlatformImageRatio(size?: string): string {
  if (!size) {
    return DEFAULT_PLATFORM_IMAGE_RATIO;
  }
  const normalized = size.trim().replace('x', ':');
  if (normalized === '1:1' || normalized === '16:9' || normalized === '9:16') {
    return normalized;
  }
  return DEFAULT_PLATFORM_IMAGE_RATIO;
}

export function getPlatformImageTaskProjectId(
  params?: Pick<GenerationParams, 'platformProjectId'>
): string | null {
  const explicitProjectId = params?.platformProjectId?.trim();
  return explicitProjectId || getCurrentPlatformProjectId();
}

export function isPlatformEligibleImageParams(
  params: GenerationParams,
  type: TaskType
): boolean {
  if (type !== TaskType.IMAGE) {
    return false;
  }
  const generationMode = params.generationMode || 'text_to_image';
  return (
    generationMode === 'text_to_image' &&
    !params.maskImage &&
    !params.referenceImages?.length &&
    !params.uploadedImages?.length &&
    !params.uploadedImage
  );
}

export function withPlatformImageTaskMetadata(
  params: GenerationParams,
  type: TaskType
): GenerationParams {
  const projectId = getPlatformImageTaskProjectId(params);
  if (!projectId || !isPlatformEligibleImageParams(params, type)) {
    return params;
  }

  return {
    ...params,
    platformManagedImageTask: true,
    platformModelKey: DEFAULT_PLATFORM_IMAGE_MODEL_KEY,
    platformOperationType: 'text_to_image',
    platformProjectId: projectId,
    platformRatio: normalizePlatformImageRatio(params.platformRatio || params.size),
  };
}

export function isPlatformManagedImageTask(
  taskOrParams: Task | GenerationParams,
  type?: TaskType
): boolean {
  if ('type' in taskOrParams && 'params' in taskOrParams) {
    return (
      taskOrParams.type === TaskType.IMAGE &&
      taskOrParams.params.platformManagedImageTask === true
    );
  }

  return (
    type === TaskType.IMAGE &&
    (taskOrParams as GenerationParams).platformManagedImageTask === true
  );
}

export async function createPlatformImageTaskFromLocalTask(
  task: Task
): Promise<PlatformImageTaskView> {
  const params = task.params;
  const projectId = getPlatformImageTaskProjectId(params);
  if (!projectId) {
    throw new Error('缺少平台项目 ID，无法创建图片任务');
  }

  const result = await request<{ task: PlatformImageTaskView }>('/api/image-tasks', {
    body: JSON.stringify({
      batchSize: 1,
      idempotencyKey: params.platformIdempotencyKey || `drawnix:${task.id}`,
      modelKey: params.platformModelKey || DEFAULT_PLATFORM_IMAGE_MODEL_KEY,
      operationType: 'text_to_image',
      prompt: params.prompt,
      projectId,
      promptOptimize: Boolean(params.platformPromptOptimize),
      ratio: normalizePlatformImageRatio(params.platformRatio || params.size),
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  return result.task;
}

export async function getPlatformImageTask(
  platformTaskId: string
): Promise<PlatformImageTaskView> {
  const result = await request<{ task: PlatformImageTaskView }>(
    `/api/image-tasks/${encodeURIComponent(platformTaskId)}`
  );
  return result.task;
}

export async function cancelPlatformImageTask(
  platformTaskId: string
): Promise<PlatformImageTaskView> {
  const result = await request<{ task: PlatformImageTaskView }>(
    `/api/image-tasks/${encodeURIComponent(platformTaskId)}/cancel`,
    { method: 'POST' }
  );
  return result.task;
}

export async function insertPlatformImageTaskToCanvas(
  platformTaskId: string
): Promise<PlatformImageTaskView> {
  const result = await request<{ task: PlatformImageTaskView }>(
    `/api/image-tasks/${encodeURIComponent(platformTaskId)}/insert-to-canvas`,
    { method: 'POST' }
  );
  return result.task;
}

export function platformImageTaskToTaskPatch(
  platformTask: PlatformImageTaskView
): PlatformImageTaskPatch {
  const status = mapPlatformTaskStatus(platformTask.status);
  const result =
    platformTask.status === 'succeeded'
      ? platformImageTaskToTaskResult(platformTask)
      : undefined;
  const error =
    platformTask.status === 'failed' ? platformImageTaskToTaskError(platformTask) : undefined;

  return {
    status,
    updates: {
      canvasSyncStatus: platformTask.canvasSyncStatus,
      error,
      platformAssetIds: platformTask.assets.map((asset) => asset.id),
      platformTaskId: platformTask.id,
      priceQuote: platformImageTaskToQuoteMirror(platformTask),
      progress: platformTaskStatusProgress(platformTask.status),
      remoteId: platformTask.id,
      result,
    },
  };
}

function mapPlatformTaskStatus(status: PlatformImageTaskStatus): TaskStatus {
  switch (status) {
    case 'queued':
    case 'running':
    case 'persisting':
      return TaskStatus.PROCESSING;
    case 'succeeded':
      return TaskStatus.COMPLETED;
    case 'failed':
      return TaskStatus.FAILED;
    case 'cancelled':
      return TaskStatus.CANCELLED;
  }
}

function platformTaskStatusProgress(status: PlatformImageTaskStatus): number {
  switch (status) {
    case 'queued':
      return 10;
    case 'running':
      return 45;
    case 'persisting':
      return 80;
    case 'succeeded':
      return 100;
    case 'failed':
    case 'cancelled':
      return 0;
  }
}

function platformImageTaskToQuoteMirror(
  task: PlatformImageTaskView
): PlatformImageTaskPriceQuoteMirror {
  return {
    amount: task.quotedPriceAmount,
    batchSize: task.batchSize,
    modelKey: task.requestedModelKey,
    operationType: task.operationType,
    priceVersion: task.priceVersion,
    ratio: task.ratio,
    unit: task.quotedPriceUnit,
  };
}

function platformImageTaskToTaskResult(
  task: PlatformImageTaskView
): TaskResult | undefined {
  const assetUrls = task.assets
    .map((asset) => getPlatformAssetVariantUrl(asset, 'original') || asset.variants[0]?.url)
    .filter((url): url is string => Boolean(url));
  if (assetUrls.length === 0) {
    return undefined;
  }

  const thumbnailUrls = task.assets
    .map((asset) => getPlatformAssetVariantUrl(asset, 'thumb'))
    .filter((url): url is string => Boolean(url));
  const firstAsset = task.assets[0];

  return {
    format: mimeTypeToFormat(firstAsset?.mimeType),
    height: firstAsset?.height,
    resultKind: 'image',
    size: task.assets.reduce((total, asset) => total + asset.sizeBytes, 0),
    thumbnailUrls,
    url: assetUrls[0]!,
    urls: assetUrls,
    width: firstAsset?.width,
  };
}

function platformImageTaskToTaskError(task: PlatformImageTaskView): TaskError {
  return {
    code: task.failureCode || 'PLATFORM_IMAGE_TASK_FAILED',
    message: task.failureMessage || '平台图片任务失败',
    details: {
      originalError: task.failureMessage || undefined,
      timestamp: Date.parse(task.updatedAt) || Date.now(),
    },
  };
}

function getPlatformAssetVariantUrl(
  asset: PlatformAsset,
  type: 'original' | 'thumb'
): string | undefined {
  return asset.variants.find((variant) => variant.type === type)?.url;
}

function mimeTypeToFormat(mimeType?: string): string {
  if (!mimeType) {
    return 'png';
  }
  return mimeType.split('/')[1] || 'png';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
  });
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || envelope.error || !envelope.data) {
    throw new Error(envelope.error?.message ?? '平台图片任务请求失败');
  }

  return envelope.data;
}
