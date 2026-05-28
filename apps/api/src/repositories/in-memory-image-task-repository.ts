import { randomUUID } from 'crypto';

import { AppError } from '../errors';
import type {
  CanvasSyncRecordView,
  CreateImageTaskRecordInput,
  ImageTask,
  ImageTaskRepository,
  OutboxEvent,
  ProviderUsage,
} from '../image-tasks/types';
import {
  MOCK_MODEL_KEY,
  MOCK_MODEL_VERSION,
  MOCK_PROVIDER_KEY,
} from '../providers/mock-provider';

export class InMemoryImageTaskRepository implements ImageTaskRepository {
  readonly canvasSyncRecords = new Map<string, CanvasSyncRecordView>();
  readonly outboxEvents = new Map<string, OutboxEvent>();
  readonly providerUsage = new Map<string, ProviderUsage>();
  readonly tasks = new Map<string, ImageTask>();

  async createTask(input: CreateImageTaskRecordInput): Promise<ImageTask> {
    const now = new Date();
    const task: ImageTask = {
      actualModelKey: null,
      actualProvider: null,
      batchSize: input.input.batchSize,
      canvasSyncStatus: 'pending',
      createdAt: now,
      failureCode: null,
      failureCount: 0,
      failureMessage: null,
      finalPrompt: input.input.prompt,
      id: input.id,
      idempotencyKey: input.input.idempotencyKey,
      modelFamily: 'mock-image',
      modelVersion: MOCK_MODEL_VERSION,
      normalizedParams: {
        maskAssetId: input.input.maskAssetId ?? null,
        ratio: input.input.ratio,
        referenceAssets: input.input.referenceAssets ?? [],
        sourceAssetId: input.input.sourceAssetId ?? null,
      },
      operationType: input.input.operationType,
      optimizedPrompt: input.input.promptOptimize
        ? `${input.input.prompt} optimized`
        : null,
      ownerUserId: input.auth.user.id,
      parentTaskId: null,
      pricePolicyId: input.quote.pricePolicyId,
      priceVersion: input.quote.priceVersion,
      projectId: input.input.projectId,
      providerUsageId: null,
      quotaHoldLedgerId: input.holdLedgerId,
      quotedPriceAmount: input.quote.amount,
      quotedPriceUnit: input.quote.unit,
      ratio: input.input.ratio,
      rawProviderParams: {},
      requestedModelKey: input.input.modelKey,
      requestedProvider: MOCK_PROVIDER_KEY,
      settledAt: null,
      settledPriceAmount: null,
      status: 'queued',
      successCount: 0,
      tenantId: input.auth.user.tenantId,
      updatedAt: now,
      userPrompt: input.input.prompt,
    };
    this.tasks.set(task.id, task);
    return task;
  }

  async findTaskById(
    tenantId: string,
    taskId: string
  ): Promise<ImageTask | null> {
    const task = this.tasks.get(taskId);
    return task?.tenantId === tenantId ? task : null;
  }

  async findTaskByIdempotencyKey(
    tenantId: string,
    ownerUserId: string,
    idempotencyKey: string
  ): Promise<ImageTask | null> {
    return (
      [...this.tasks.values()].find(
        (task) =>
          task.tenantId === tenantId &&
          task.ownerUserId === ownerUserId &&
          task.idempotencyKey === idempotencyKey
      ) ?? null
    );
  }

  async listProjectTasks(input: {
    ownerUserId: string;
    projectId: string;
    tenantId: string;
  }): Promise<ImageTask[]> {
    return [...this.tasks.values()]
      .filter(
        (task) =>
          task.tenantId === input.tenantId &&
          task.ownerUserId === input.ownerUserId &&
          task.projectId === input.projectId
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async listAdminTasks(input: {
    status?: ImageTask['status'];
    tenantId: string;
  }): Promise<ImageTask[]> {
    return [...this.tasks.values()]
      .filter(
        (task) =>
          task.tenantId === input.tenantId &&
          (!input.status || task.status === input.status)
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async updateTask(
    taskId: string,
    patch: Parameters<ImageTaskRepository['updateTask']>[1]
  ): Promise<ImageTask> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new AppError('IMAGE_TASK_NOT_FOUND', 404, '任务不存在');
    }
    const updated: ImageTask = {
      ...task,
      ...patch,
      actualModelKey: patch.actualModelKey ?? task.actualModelKey,
      actualProvider: patch.actualProvider ?? task.actualProvider,
      updatedAt: new Date(),
    };
    this.tasks.set(taskId, updated);
    return updated;
  }

  async createProviderUsage(
    input: Omit<ProviderUsage, 'createdAt' | 'id'>
  ): Promise<ProviderUsage> {
    const usage: ProviderUsage = {
      ...input,
      createdAt: new Date(),
      id: randomUUID(),
      providerModelId: input.providerModelId ?? MOCK_MODEL_KEY,
    };
    this.providerUsage.set(usage.id, usage);
    return usage;
  }

  async createCanvasSyncRecord(input: {
    assetIds: string[];
    imageTaskId: string;
    projectId: string;
    status: CanvasSyncRecordView['status'];
    tenantId: string;
  }): Promise<CanvasSyncRecordView> {
    const record: CanvasSyncRecordView = {
      assetIds: input.assetIds,
      imageTaskId: input.imageTaskId,
      projectId: input.projectId,
      retryCount: 0,
      status: input.status,
    };
    this.canvasSyncRecords.set(input.imageTaskId, record);
    return record;
  }

  async listCanvasSyncRecords(
    tenantId: string,
    taskId: string
  ): Promise<CanvasSyncRecordView[]> {
    const task = this.tasks.get(taskId);
    const record = this.canvasSyncRecords.get(taskId);
    return task?.tenantId === tenantId && record ? [record] : [];
  }

  async updateCanvasSyncRecord(input: {
    imageTaskId: string;
    status: CanvasSyncRecordView['status'];
    tenantId: string;
  }): Promise<CanvasSyncRecordView | null> {
    const task = this.tasks.get(input.imageTaskId);
    const record = this.canvasSyncRecords.get(input.imageTaskId);
    if (!task || task.tenantId !== input.tenantId || !record) {
      return null;
    }
    const updated = {
      ...record,
      retryCount: record.retryCount + 1,
      status: input.status,
    };
    this.canvasSyncRecords.set(input.imageTaskId, updated);
    return updated;
  }

  async createOutboxEvent(input: {
    aggregateId: string;
    aggregateType: string;
    eventType: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    tenantId: string;
  }): Promise<OutboxEvent> {
    const existing = [...this.outboxEvents.values()].find(
      (event) =>
        event.tenantId === input.tenantId &&
        event.idempotencyKey === input.idempotencyKey
    );
    if (existing) {
      return existing;
    }
    const now = new Date();
    const event: OutboxEvent = {
      aggregateId: input.aggregateId,
      aggregateType: input.aggregateType,
      attemptCount: 0,
      createdAt: now,
      eventType: input.eventType,
      id: randomUUID(),
      idempotencyKey: input.idempotencyKey,
      nextAttemptAt: null,
      payload: input.payload,
      status: 'pending',
      tenantId: input.tenantId,
      updatedAt: now,
    };
    this.outboxEvents.set(event.id, event);
    return event;
  }
}
