import type { AuthenticatedSession } from '../auth/types';
import type { AssetReferenceRole, AssetView } from '../assets/types';
import type { ResolvedImageModel } from '../providers/types';

export type ImageTaskOperationType =
  | 'text_to_image'
  | 'image_to_image'
  | 'inpaint'
  | 'reference_generate';
export type ImageTaskStatus =
  | 'queued'
  | 'running'
  | 'persisting'
  | 'succeeded'
  | 'failed'
  | 'cancelled';
export type ImageTaskCanvasSyncStatus =
  | 'not_required'
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed';

export interface ImageTask {
  actualModelKey: string | null;
  actualProvider: string | null;
  batchSize: 1 | 2 | 4;
  canvasSyncStatus: ImageTaskCanvasSyncStatus;
  createdAt: Date;
  failureCode: string | null;
  failureCount: number;
  failureMessage: string | null;
  finalPrompt: string;
  id: string;
  idempotencyKey: string;
  modelFamily: string;
  modelVersion: string;
  normalizedParams: Record<string, unknown>;
  operationType: ImageTaskOperationType;
  optimizedPrompt: string | null;
  ownerUserId: string;
  parentTaskId: string | null;
  pricePolicyId: string;
  priceVersion: number;
  projectId: string;
  providerUsageId: string | null;
  quotaHoldLedgerId: string;
  quotedPriceAmount: number;
  quotedPriceUnit: 'points';
  ratio: string;
  rawProviderParams: Record<string, unknown>;
  requestedModelKey: string;
  requestedProvider: string;
  settledAt: Date | null;
  settledPriceAmount: number | null;
  status: ImageTaskStatus;
  successCount: number;
  tenantId: string;
  updatedAt: Date;
  userPrompt: string;
}

export interface ProviderUsage {
  createdAt: Date;
  id: string;
  imageTaskId: string;
  latencyMs: number | null;
  providerConfigId: string;
  providerCostAmount: number | null;
  providerCostCurrency: string | null;
  providerModelId: string | null;
  rawErrorCode: string | null;
  rawErrorMessage: string | null;
  requestId: string | null;
  requestSnapshot: Record<string, unknown>;
  responseSnapshot: Record<string, unknown>;
  status: 'succeeded' | 'failed' | 'timeout' | 'partial_succeeded';
  tenantId: string;
}

export interface OutboxEvent {
  aggregateId: string;
  aggregateType: string;
  attemptCount: number;
  createdAt: Date;
  eventType: string;
  id: string;
  idempotencyKey: string;
  nextAttemptAt: Date | null;
  payload: Record<string, unknown>;
  status: 'pending' | 'processing' | 'published' | 'failed';
  tenantId: string;
  updatedAt: Date;
}

export interface CanvasSyncRecordView {
  assetIds: string[];
  imageTaskId: string;
  projectId: string;
  retryCount: number;
  status: Exclude<ImageTaskCanvasSyncStatus, 'not_required'>;
}

export interface ImageModelView {
  capabilities: {
    maxBatchSize: 1 | 2 | 4;
    maxReferenceImages: number;
    operationType: ImageTaskOperationType;
    operationTypes: ImageTaskOperationType[];
    supportedRatios: string[];
    supportsBatch: boolean;
    supportsMask: boolean;
  };
  displayName: string;
  modelKey: string;
  price: {
    amount: number;
    unit: 'per_image';
    version: number;
  };
  providerKey: string;
}

export interface ImageTaskQuote {
  amount: number;
  batchSize: 1 | 2 | 4;
  maskAssetId?: string | null;
  modelKey: string;
  operationType: ImageTaskOperationType;
  pricePolicyId: string;
  priceVersion: number;
  ratio: string;
  referenceAssets?: ImageTaskReferenceAssetInput[];
  sourceAssetId?: string | null;
  unit: 'points';
}

export interface ImageTaskReferenceAssetInput {
  assetId: string;
  order: number;
  role: AssetReferenceRole;
}

export interface CreateImageTaskInput {
  batchSize: 1 | 2 | 4;
  idempotencyKey: string;
  maskAssetId?: string | null;
  modelKey: string;
  operationType: ImageTaskOperationType;
  prompt: string;
  projectId: string;
  promptOptimize?: boolean;
  ratio: string;
  referenceAssets?: ImageTaskReferenceAssetInput[];
  sourceAssetId?: string | null;
}

export interface ImageTaskView {
  actualModelKey: string | null;
  actualProvider: string | null;
  assets: AssetView[];
  batchSize: 1 | 2 | 4;
  canvasSync: CanvasSyncRecordView | null;
  canvasSyncStatus: ImageTaskCanvasSyncStatus;
  createdAt: Date;
  failureCode: string | null;
  failureCount: number;
  failureMessage: string | null;
  finalPrompt: string;
  id: string;
  modelFamily: string;
  modelVersion: string;
  maskAssetId: string | null;
  operationType: ImageTaskOperationType;
  optimizedPrompt: string | null;
  ownerUserId: string;
  priceVersion: number;
  projectId: string;
  quotedPriceAmount: number;
  quotedPriceUnit: 'points';
  ratio: string;
  referenceAssets: ImageTaskReferenceAssetInput[];
  requestedModelKey: string;
  requestedProvider: string;
  settledAt: Date | null;
  settledPriceAmount: number | null;
  sourceAssetId: string | null;
  status: ImageTaskStatus;
  successCount: number;
  updatedAt: Date;
  userPrompt: string;
}

export type ImageTaskLateReconciliationStatus =
  | 'recovered'
  | 'already_succeeded'
  | 'not_recoverable'
  | 'blocked_released';

export interface ImageTaskLateReconciliationResult {
  providerRequestId: string | null;
  reason: string | null;
  status: ImageTaskLateReconciliationStatus;
  task: ImageTaskView;
}

export interface CreateImageTaskRecordInput {
  auth: AuthenticatedSession;
  holdLedgerId: string;
  id: string;
  input: CreateImageTaskInput;
  model: ResolvedImageModel;
  quote: ImageTaskQuote;
}

export interface ImageTaskRepository {
  createCanvasSyncRecord(input: {
    assetIds: string[];
    imageTaskId: string;
    projectId: string;
    status: Exclude<ImageTaskCanvasSyncStatus, 'not_required'>;
    tenantId: string;
  }): Promise<CanvasSyncRecordView>;
  createOutboxEvent(input: {
    aggregateId: string;
    aggregateType: string;
    eventType: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    tenantId: string;
  }): Promise<OutboxEvent>;
  createProviderUsage(
    input: Omit<ProviderUsage, 'createdAt' | 'id'>
  ): Promise<ProviderUsage>;
  createTask(input: CreateImageTaskRecordInput): Promise<ImageTask>;
  findProviderUsageById(
    tenantId: string,
    usageId: string
  ): Promise<ProviderUsage | null>;
  findTaskById(tenantId: string, taskId: string): Promise<ImageTask | null>;
  findTaskByIdempotencyKey(
    tenantId: string,
    ownerUserId: string,
    idempotencyKey: string
  ): Promise<ImageTask | null>;
  listCanvasSyncRecords(
    tenantId: string,
    taskId: string
  ): Promise<CanvasSyncRecordView[]>;
  listProjectTasks(input: {
    ownerUserId: string;
    projectId: string;
    tenantId: string;
  }): Promise<ImageTask[]>;
  listAdminTasks(input: {
    status?: ImageTaskStatus;
    tenantId: string;
  }): Promise<ImageTask[]>;
  updateCanvasSyncRecord(input: {
    imageTaskId: string;
    status: Exclude<ImageTaskCanvasSyncStatus, 'not_required'>;
    tenantId: string;
  }): Promise<CanvasSyncRecordView | null>;
  updateTask(
    taskId: string,
    patch: Partial<
      Pick<
        ImageTask,
        | 'actualModelKey'
        | 'actualProvider'
        | 'canvasSyncStatus'
        | 'failureCode'
        | 'failureCount'
        | 'failureMessage'
        | 'providerUsageId'
        | 'settledAt'
        | 'settledPriceAmount'
        | 'status'
        | 'successCount'
      >
    >
  ): Promise<ImageTask>;
}
