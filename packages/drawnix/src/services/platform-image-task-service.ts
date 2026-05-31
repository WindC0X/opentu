import {
  TaskStatus,
  TaskType,
  type GenerationParams,
  type PlatformImageTaskCanvasSyncStatus,
  type PlatformImageTaskOperationType,
  type PlatformImageTaskStatus,
  type PlatformImageTaskPriceQuoteMirror,
  type PlatformImageTaskReferenceAsset,
  type PlatformImageTaskReferenceAssetRole,
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
const MAX_PLATFORM_REFERENCE_IMAGES = 5;

interface PlatformImageInputRef {
  assetId?: string;
  file?: Blob | File;
  name: string;
  url?: string;
}

interface ApiEnvelope<T> {
  data: T | null;
  error: {
    code: string;
    message: string;
  } | null;
  request_id: string;
}

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
  maskAssetId: string | null;
  operationType: PlatformImageTaskOperationType;
  optimizedPrompt: string | null;
  ownerUserId: string;
  priceVersion: number;
  projectId: string;
  quotedPriceAmount: number;
  quotedPriceUnit: 'points';
  ratio: string;
  referenceAssets: PlatformImageTaskReferenceAsset[];
  requestedModelKey: string;
  requestedProvider: string;
  settledAt: string | null;
  settledPriceAmount: number | null;
  sourceAssetId: string | null;
  status: PlatformImageTaskStatus;
  successCount: number;
  updatedAt: string;
  userPrompt: string;
}

export interface PlatformImageTaskPatch {
  status: TaskStatus;
  updates: Partial<Task>;
}

export interface PlatformPromptOptimizationResult {
  optimizedPrompt: string;
  priceQuote: PlatformImageTaskPriceQuoteMirror;
  task: PlatformImageTaskView;
  taskId: string;
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
  const operationType = resolvePlatformOperationType(params);
  const imageInputs = collectPlatformImageInputs(params);
  const hasMask = Boolean(cleanString(params.maskImage));

  if (operationType === 'text_to_image') {
    return imageInputs.length === 0 && !hasMask;
  }
  if (operationType === 'image_to_image') {
    return imageInputs.length >= 1 && !hasMask;
  }
  if (operationType === 'inpaint') {
    return imageInputs.length >= 1 && hasMask;
  }
  return (
    imageInputs.length > 0 &&
    imageInputs.length <= MAX_PLATFORM_REFERENCE_IMAGES &&
    !hasMask
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
    platformModelKey:
      cleanString(params.platformModelKey) ??
      cleanString(params.model) ??
      DEFAULT_PLATFORM_IMAGE_MODEL_KEY,
    platformOperationType: resolvePlatformOperationType(params),
    platformProjectId: projectId,
    platformRatio: normalizePlatformImageRatio(
      params.platformRatio || params.size
    ),
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
  const payload = await buildPlatformImageTaskCreatePayload(task, projectId);

  const result = await request<{ task: PlatformImageTaskView }>(
    '/api/image-tasks',
    {
      body: JSON.stringify(payload),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }
  );
  return result.task;
}

export async function quotePlatformPromptOptimization(
  input: {
    modelKey?: string;
    projectId?: string;
    prompt?: string;
  } = {}
): Promise<PlatformImageTaskQuote> {
  const projectId = input.projectId ?? getPlatformImageTaskProjectId();
  if (!projectId) {
    throw new Error('缺少平台项目 ID，无法预估提示词优化点数');
  }
  const result = await request<{ quote: PlatformImageTaskQuote }>(
    '/api/image-tasks/quote',
    {
      body: JSON.stringify({
        batchSize: 1,
        maskAssetId: null,
        modelKey: input.modelKey || DEFAULT_PLATFORM_IMAGE_MODEL_KEY,
        operationType: 'prompt_optimize',
        projectId,
        ratio: DEFAULT_PLATFORM_IMAGE_RATIO,
        referenceAssets: [],
        sourceAssetId: null,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }
  );
  return result.quote;
}

export async function quotePlatformImageTask(input: {
  batchSize?: number;
  maskAssetId?: string | null;
  modelKey?: string;
  operationType?: PlatformImageTaskOperationType;
  projectId?: string;
  ratio?: string;
  referenceAssets?: PlatformImageTaskReferenceAsset[];
  sourceAssetId?: string | null;
}): Promise<PlatformImageTaskQuote> {
  const projectId = input.projectId ?? getPlatformImageTaskProjectId();
  if (!projectId) {
    throw new Error('缺少平台项目 ID，无法预估图片任务点数');
  }

  const result = await request<{ quote: PlatformImageTaskQuote }>(
    '/api/image-tasks/quote',
    {
      body: JSON.stringify({
        batchSize: normalizePlatformBatchSize(input.batchSize),
        maskAssetId: input.maskAssetId ?? null,
        modelKey: input.modelKey || DEFAULT_PLATFORM_IMAGE_MODEL_KEY,
        operationType: input.operationType ?? 'text_to_image',
        projectId,
        ratio: normalizePlatformImageRatio(input.ratio),
        referenceAssets: input.referenceAssets ?? [],
        sourceAssetId: input.sourceAssetId ?? null,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }
  );
  return result.quote;
}

export async function optimizePlatformPrompt(input: {
  idempotencyKey?: string;
  modelKey?: string;
  projectId?: string;
  prompt: string;
}): Promise<PlatformPromptOptimizationResult> {
  const prompt = cleanString(input.prompt);
  if (!prompt) {
    throw new Error('请输入要优化的提示词');
  }
  const projectId = input.projectId ?? getPlatformImageTaskProjectId();
  if (!projectId) {
    throw new Error('缺少平台项目 ID，无法优化提示词');
  }

  const result = await request<{ task: PlatformImageTaskView }>(
    '/api/image-tasks',
    {
      body: JSON.stringify({
        batchSize: 1,
        idempotencyKey:
          input.idempotencyKey ?? createPromptOptimizationIdempotencyKey(),
        maskAssetId: null,
        modelKey: input.modelKey || DEFAULT_PLATFORM_IMAGE_MODEL_KEY,
        operationType: 'prompt_optimize',
        prompt,
        projectId,
        promptOptimize: false,
        ratio: DEFAULT_PLATFORM_IMAGE_RATIO,
        referenceAssets: [],
        sourceAssetId: null,
      }),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }
  );
  const task = result.task;
  if (task.status !== 'succeeded' || !task.optimizedPrompt) {
    throw new Error(task.failureMessage || '提示词优化失败');
  }
  return {
    optimizedPrompt: task.optimizedPrompt,
    priceQuote: platformImageTaskToQuoteMirror(task),
    task,
    taskId: task.id,
  };
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
    platformTask.status === 'failed'
      ? platformImageTaskToTaskError(platformTask)
      : undefined;

  return {
    status,
    updates: {
      canvasSyncStatus: platformTask.canvasSyncStatus,
      error,
      platformAssetIds: platformTask.assets.map((asset) => asset.id),
      platformStatus: platformTask.status,
      platformTaskId: platformTask.id,
      priceQuote: platformImageTaskToQuoteMirror(platformTask),
      progress: platformTaskStatusProgress(platformTask.status),
      remoteId: platformTask.id,
      result,
    },
  };
}

async function buildPlatformImageTaskCreatePayload(
  task: Task,
  projectId: string
) {
  const params = task.params;
  const operationType =
    params.platformOperationType ?? resolvePlatformOperationType(params);
  const imageInputs = collectPlatformImageInputs(params);
  let sourceAssetId = cleanString(params.platformSourceAssetId) ?? null;
  let maskAssetId = cleanString(params.platformMaskAssetId) ?? null;
  let referenceAssets = normalizePlatformReferenceAssets(
    params.platformReferenceAssets
  );

  if (operationType === 'image_to_image' || operationType === 'inpaint') {
    sourceAssetId =
      sourceAssetId ??
      (await resolvePlatformImageInputAssetId(
        requireImageInput(imageInputs[0], '缺少源图，无法创建平台图片任务'),
        projectId,
        'image'
      ));
    if (referenceAssets.length === 0 && imageInputs.length > 1) {
      referenceAssets = await resolvePlatformReferenceAssets(
        imageInputs.slice(1, MAX_PLATFORM_REFERENCE_IMAGES + 1),
        projectId
      );
    }
  }

  if (operationType === 'inpaint') {
    maskAssetId =
      maskAssetId ??
      (await resolvePlatformImageInputAssetId(
        {
          name: 'platform-mask.png',
          url: requireImageUrl(
            params.maskImage,
            '缺少 mask，无法创建局部重绘任务'
          ),
        },
        projectId,
        'mask'
      ));
  }

  if (operationType === 'reference_generate' && referenceAssets.length === 0) {
    referenceAssets = await resolvePlatformReferenceAssets(
      imageInputs.slice(0, MAX_PLATFORM_REFERENCE_IMAGES),
      projectId
    );
  }

  return {
    batchSize: 1,
    idempotencyKey: params.platformIdempotencyKey || `drawnix:${task.id}`,
    maskAssetId,
    modelKey:
      cleanString(params.platformModelKey) ??
      cleanString(params.model) ??
      DEFAULT_PLATFORM_IMAGE_MODEL_KEY,
    operationType,
    prompt: params.prompt,
    projectId,
    promptOptimize: Boolean(params.platformPromptOptimize),
    ratio: normalizePlatformImageRatio(params.platformRatio || params.size),
    referenceAssets,
    sourceAssetId,
  };
}

export function resolvePlatformOperationType(
  params: GenerationParams
): PlatformImageTaskOperationType {
  if (params.platformOperationType) {
    return params.platformOperationType;
  }
  const generationMode = params.generationMode || 'text_to_image';
  const imageInputs = collectPlatformImageInputs(params);
  const hasMask = Boolean(cleanString(params.maskImage));

  if (hasMask) {
    return 'inpaint';
  }
  if (generationMode === 'image_to_image' || generationMode === 'image_edit') {
    return 'image_to_image';
  }
  if (imageInputs.length > 0) {
    return 'reference_generate';
  }
  return 'text_to_image';
}

function normalizePlatformBatchSize(value?: number): 1 | 2 | 4 {
  if (value === 4) {
    return 4;
  }
  if (value === 2) {
    return 2;
  }
  return 1;
}

function collectPlatformImageInputs(
  params: GenerationParams
): PlatformImageInputRef[] {
  const refs: PlatformImageInputRef[] = [];
  const seen = new Set<string>();
  const pushRef = (ref: PlatformImageInputRef) => {
    const key = ref.assetId ?? ref.url ?? ref.name;
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    refs.push(ref);
  };

  const referenceImages = Array.isArray(params.referenceImages)
    ? params.referenceImages
    : [];
  referenceImages.forEach((url, index) => {
    if (typeof url === 'string' && url.trim()) {
      pushRef({ name: `reference-${index + 1}.png`, url });
    }
  });

  const uploadedImages = Array.isArray(params.uploadedImages)
    ? params.uploadedImages
    : [];
  uploadedImages.forEach((image, index) => {
    const ref = uploadedImageToInputRef(image, `uploaded-${index + 1}.png`);
    if (ref) {
      pushRef(ref);
    }
  });

  const uploadedImage = uploadedImageToInputRef(
    params.uploadedImage,
    'uploaded.png'
  );
  if (uploadedImage) {
    pushRef(uploadedImage);
  }

  return refs;
}

function uploadedImageToInputRef(
  value: unknown,
  fallbackName: string
): PlatformImageInputRef | null {
  if (typeof value === 'string' && value.trim()) {
    return { name: fallbackName, url: value };
  }
  if (!value || typeof value !== 'object') {
    return null;
  }
  const image = value as {
    assetId?: unknown;
    file?: unknown;
    name?: unknown;
    platformAssetId?: unknown;
    url?: unknown;
  };
  const assetId =
    cleanString(image.platformAssetId) ??
    cleanString(image.assetId) ??
    undefined;
  const url = cleanString(image.url) ?? undefined;
  const file = image.file instanceof Blob ? image.file : undefined;
  if (!assetId && !url && !file) {
    return null;
  }
  return {
    assetId,
    file,
    name: cleanString(image.name) ?? fallbackName,
    url,
  };
}

function normalizePlatformReferenceAssets(
  references: PlatformImageTaskReferenceAsset[] | undefined
): PlatformImageTaskReferenceAsset[] {
  if (!references?.length) {
    return [];
  }
  return references
    .filter((reference) => Boolean(cleanString(reference.assetId)))
    .slice(0, MAX_PLATFORM_REFERENCE_IMAGES)
    .map((reference, index) => ({
      assetId: reference.assetId.trim(),
      order: Number.isInteger(reference.order) ? reference.order : index,
      role: normalizeReferenceRole(reference.role),
    }))
    .sort((left, right) => left.order - right.order);
}

async function resolvePlatformReferenceAssets(
  inputs: PlatformImageInputRef[],
  projectId: string
): Promise<PlatformImageTaskReferenceAsset[]> {
  const references: PlatformImageTaskReferenceAsset[] = [];
  for (const [index, input] of inputs.entries()) {
    references.push({
      assetId: await resolvePlatformImageInputAssetId(
        input,
        projectId,
        'image'
      ),
      order: index,
      role: 'general',
    });
  }
  return references;
}

async function resolvePlatformImageInputAssetId(
  input: PlatformImageInputRef,
  projectId: string,
  assetKind: 'image' | 'mask'
): Promise<string> {
  if (input.assetId) {
    return input.assetId;
  }
  const body =
    input.file ??
    (await fetchPlatformImageBlob(
      requireImageUrl(input.url, '缺少图片 URL，无法上传平台资产')
    ));
  const asset = await uploadPlatformImageAsset(
    body,
    projectId,
    input.name,
    assetKind
  );
  return asset.id;
}

async function fetchPlatformImageBlob(url: string): Promise<Blob> {
  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) {
    throw new Error(`平台图片上传前读取失败: ${response.status}`);
  }
  const blob = await response.blob();
  if (blob.type) {
    return blob;
  }
  return new Blob([await blob.arrayBuffer()], { type: 'image/png' });
}

async function uploadPlatformImageAsset(
  file: File | Blob,
  projectId: string,
  fallbackName: string,
  assetKind: 'image' | 'mask'
): Promise<PlatformAsset> {
  const form = new FormData();
  form.append('projectId', projectId);
  form.append('assetKind', assetKind);
  form.append(
    'file',
    file instanceof File
      ? file
      : new File([file], fallbackName, { type: file.type })
  );
  const result = await request<{ asset: PlatformAsset }>('/api/assets/upload', {
    body: form,
    method: 'POST',
  });
  return result.asset;
}

function requireImageInput(
  input: PlatformImageInputRef | undefined,
  message: string
): PlatformImageInputRef {
  if (!input) {
    throw new Error(message);
  }
  return input;
}

function requireImageUrl(value: unknown, message: string): string {
  const url = cleanString(value);
  if (!url) {
    throw new Error(message);
  }
  return url;
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeReferenceRole(
  value: unknown
): PlatformImageTaskReferenceAssetRole {
  if (
    value === 'general' ||
    value === 'subject' ||
    value === 'style' ||
    value === 'composition' ||
    value === 'background'
  ) {
    return value;
  }
  return 'general';
}

function createPromptOptimizationIdempotencyKey(): string {
  const randomId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `drawnix:prompt-optimize:${randomId}`;
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
    maskAssetId: task.maskAssetId,
    modelKey: task.requestedModelKey,
    operationType: task.operationType,
    priceVersion: task.priceVersion,
    ratio: task.ratio,
    referenceAssets: task.referenceAssets,
    sourceAssetId: task.sourceAssetId,
    unit: task.quotedPriceUnit,
  };
}

function platformImageTaskToTaskResult(
  task: PlatformImageTaskView
): TaskResult | undefined {
  const assetUrls = task.assets
    .map(
      (asset) =>
        getPlatformAssetVariantUrl(asset, 'original') || asset.variants[0]?.url
    )
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
