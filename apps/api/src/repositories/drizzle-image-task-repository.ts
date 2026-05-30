import { and, desc, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

import * as schema from '../db/schema';
import { AppError } from '../errors';
import type {
  CanvasSyncRecordView,
  CreateImageTaskRecordInput,
  ImageTask,
  ImageTaskRepository,
  OutboxEvent,
  ProviderUsage,
} from '../image-tasks/types';

type Db = PostgresJsDatabase<typeof schema>;

export class DrizzleImageTaskRepository implements ImageTaskRepository {
  constructor(private readonly db: Db) {}

  async createTask(input: CreateImageTaskRecordInput): Promise<ImageTask> {
    const [row] = await this.db
      .insert(schema.mtImageTasks)
      .values({
        batchSize: input.input.batchSize,
        canvasSyncStatus:
          input.input.operationType === 'prompt_optimize'
            ? 'not_required'
            : 'pending',
        finalPrompt: input.input.prompt,
        id: input.id,
        idempotencyKey: input.input.idempotencyKey,
        modelFamily: input.model.modelFamily,
        modelVersion: input.model.modelVersion,
        normalizedParams: {
          maskAssetId: input.input.maskAssetId ?? null,
          ratio: input.input.ratio,
          referenceAssets: input.input.referenceAssets ?? [],
          sourceAssetId: input.input.sourceAssetId ?? null,
        },
        operationType: input.input.operationType,
        optimizedPrompt:
          input.input.operationType !== 'prompt_optimize' &&
          input.input.promptOptimize
            ? `${input.input.prompt} optimized`
            : null,
        ownerUserId: input.auth.user.id,
        pricePolicyId: input.quote.pricePolicyId,
        priceVersion: input.quote.priceVersion,
        projectId: input.input.projectId,
        quotaHoldLedgerId: input.holdLedgerId,
        quotedPriceAmount: input.quote.amount,
        quotedPriceUnit: input.quote.unit,
        ratio: input.input.ratio,
        rawProviderParams: {},
        requestedModelKey: input.input.modelKey,
        requestedProvider: input.model.providerKey,
        tenantId: input.auth.user.tenantId,
        userPrompt: input.input.prompt,
      })
      .returning();
    return mapTask(requireRow(row, 'Image task insert failed'));
  }

  async findTaskById(
    tenantId: string,
    taskId: string
  ): Promise<ImageTask | null> {
    const [row] = await this.db
      .select()
      .from(schema.mtImageTasks)
      .where(
        and(
          eq(schema.mtImageTasks.tenantId, tenantId),
          eq(schema.mtImageTasks.id, taskId)
        )
      )
      .limit(1);
    return row ? mapTask(row) : null;
  }

  async findTaskByIdempotencyKey(
    tenantId: string,
    ownerUserId: string,
    idempotencyKey: string
  ): Promise<ImageTask | null> {
    const [row] = await this.db
      .select()
      .from(schema.mtImageTasks)
      .where(
        and(
          eq(schema.mtImageTasks.tenantId, tenantId),
          eq(schema.mtImageTasks.ownerUserId, ownerUserId),
          eq(schema.mtImageTasks.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);
    return row ? mapTask(row) : null;
  }

  async listProjectTasks(input: {
    ownerUserId: string;
    projectId: string;
    tenantId: string;
  }): Promise<ImageTask[]> {
    const rows = await this.db
      .select()
      .from(schema.mtImageTasks)
      .where(
        and(
          eq(schema.mtImageTasks.tenantId, input.tenantId),
          eq(schema.mtImageTasks.ownerUserId, input.ownerUserId),
          eq(schema.mtImageTasks.projectId, input.projectId)
        )
      )
      .orderBy(desc(schema.mtImageTasks.createdAt));
    return rows.map(mapTask);
  }

  async listAdminTasks(input: {
    status?: ImageTask['status'];
    tenantId: string;
  }): Promise<ImageTask[]> {
    const conditions = [
      eq(schema.mtImageTasks.tenantId, input.tenantId),
      input.status ? eq(schema.mtImageTasks.status, input.status) : undefined,
    ].filter(Boolean);
    const rows = await this.db
      .select()
      .from(schema.mtImageTasks)
      .where(and(...conditions))
      .orderBy(desc(schema.mtImageTasks.createdAt));
    return rows.map(mapTask);
  }

  async updateTask(
    taskId: string,
    patch: Parameters<ImageTaskRepository['updateTask']>[1]
  ): Promise<ImageTask> {
    const [row] = await this.db
      .update(schema.mtImageTasks)
      .set({
        actualModelKey: patch.actualModelKey,
        actualProvider: patch.actualProvider,
        canvasSyncStatus: patch.canvasSyncStatus,
        failureCode: patch.failureCode,
        failureCount: patch.failureCount,
        failureMessage: patch.failureMessage,
        finalPrompt: patch.finalPrompt,
        normalizedParams: patch.normalizedParams,
        optimizedPrompt: patch.optimizedPrompt,
        providerUsageId: patch.providerUsageId,
        rawProviderParams: patch.rawProviderParams,
        settledAt: patch.settledAt,
        settledPriceAmount: patch.settledPriceAmount,
        status: patch.status,
        successCount: patch.successCount,
        updatedAt: new Date(),
      })
      .where(eq(schema.mtImageTasks.id, taskId))
      .returning();
    return mapTask(requireRow(row, 'Image task not found'));
  }

  async createProviderUsage(
    input: Omit<ProviderUsage, 'createdAt' | 'id'>
  ): Promise<ProviderUsage> {
    const [row] = await this.db
      .insert(schema.mtProviderUsage)
      .values({
        imageTaskId: input.imageTaskId,
        latencyMs: input.latencyMs,
        providerConfigId: input.providerConfigId,
        providerCostAmount: input.providerCostAmount,
        providerCostCurrency: input.providerCostCurrency,
        providerModelId: input.providerModelId,
        rawErrorCode: input.rawErrorCode,
        rawErrorMessage: input.rawErrorMessage,
        requestId: input.requestId,
        requestSnapshot: input.requestSnapshot,
        responseSnapshot: input.responseSnapshot,
        status: input.status,
        tenantId: input.tenantId,
      })
      .returning();
    return mapProviderUsage(requireRow(row, 'Provider usage insert failed'));
  }

  async findProviderUsageById(
    tenantId: string,
    usageId: string
  ): Promise<ProviderUsage | null> {
    const [row] = await this.db
      .select()
      .from(schema.mtProviderUsage)
      .where(
        and(
          eq(schema.mtProviderUsage.tenantId, tenantId),
          eq(schema.mtProviderUsage.id, usageId)
        )
      )
      .limit(1);
    return row ? mapProviderUsage(row) : null;
  }

  async createCanvasSyncRecord(input: {
    assetIds: string[];
    imageTaskId: string;
    projectId: string;
    status: CanvasSyncRecordView['status'];
    tenantId: string;
  }): Promise<CanvasSyncRecordView> {
    await this.db.insert(schema.mtCanvasSyncRecords).values(
      input.assetIds.map((assetId) => ({
        assetId,
        imageTaskId: input.imageTaskId,
        projectId: input.projectId,
        status: input.status,
        tenantId: input.tenantId,
      }))
    );
    return {
      assetIds: input.assetIds,
      imageTaskId: input.imageTaskId,
      projectId: input.projectId,
      retryCount: 0,
      status: input.status,
    };
  }

  async listCanvasSyncRecords(
    tenantId: string,
    taskId: string
  ): Promise<CanvasSyncRecordView[]> {
    const rows = await this.db
      .select()
      .from(schema.mtCanvasSyncRecords)
      .where(
        and(
          eq(schema.mtCanvasSyncRecords.tenantId, tenantId),
          eq(schema.mtCanvasSyncRecords.imageTaskId, taskId)
        )
      );
    if (rows.length === 0) {
      return [];
    }
    return [
      {
        assetIds: rows.map((row) => row.assetId).filter(Boolean) as string[],
        imageTaskId: taskId,
        projectId: rows[0]!.projectId,
        retryCount: Math.max(...rows.map((row) => row.retryCount)),
        status:
          rows[0]!.status === 'not_required' ? 'pending' : rows[0]!.status,
      },
    ];
  }

  async updateCanvasSyncRecord(input: {
    imageTaskId: string;
    status: CanvasSyncRecordView['status'];
    tenantId: string;
  }): Promise<CanvasSyncRecordView | null> {
    const rows = await this.db
      .select()
      .from(schema.mtCanvasSyncRecords)
      .where(
        and(
          eq(schema.mtCanvasSyncRecords.tenantId, input.tenantId),
          eq(schema.mtCanvasSyncRecords.imageTaskId, input.imageTaskId)
        )
      );
    if (rows.length === 0) {
      return null;
    }
    await Promise.all(
      rows.map((row) =>
        this.db
          .update(schema.mtCanvasSyncRecords)
          .set({
            retryCount: row.retryCount + 1,
            status: input.status,
            updatedAt: new Date(),
          })
          .where(eq(schema.mtCanvasSyncRecords.id, row.id))
      )
    );
    return {
      assetIds: rows.map((row) => row.assetId).filter(Boolean) as string[],
      imageTaskId: input.imageTaskId,
      projectId: rows[0]!.projectId,
      retryCount: Math.max(...rows.map((row) => row.retryCount + 1)),
      status: input.status,
    };
  }

  async createOutboxEvent(input: {
    aggregateId: string;
    aggregateType: string;
    eventType: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    tenantId: string;
  }): Promise<OutboxEvent> {
    const [row] = await this.db
      .insert(schema.mtOutboxEvents)
      .values({
        aggregateId: input.aggregateId,
        aggregateType: input.aggregateType,
        eventType: input.eventType,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
        tenantId: input.tenantId,
      })
      .onConflictDoNothing()
      .returning();
    if (row) {
      return mapOutboxEvent(row);
    }

    const [existing] = await this.db
      .select()
      .from(schema.mtOutboxEvents)
      .where(
        and(
          eq(schema.mtOutboxEvents.tenantId, input.tenantId),
          eq(schema.mtOutboxEvents.idempotencyKey, input.idempotencyKey)
        )
      )
      .limit(1);
    return mapOutboxEvent(requireRow(existing, 'Outbox event not found'));
  }
}

function mapTask(row: typeof schema.mtImageTasks.$inferSelect): ImageTask {
  return {
    actualModelKey: row.actualModelKey,
    actualProvider: row.actualProvider,
    batchSize: row.batchSize as 1 | 2 | 4,
    canvasSyncStatus: row.canvasSyncStatus,
    createdAt: row.createdAt,
    failureCode: row.failureCode,
    failureCount: row.failureCount,
    failureMessage: row.failureMessage,
    finalPrompt: row.finalPrompt,
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    modelFamily: row.modelFamily,
    modelVersion: row.modelVersion,
    normalizedParams: asRecord(row.normalizedParams),
    operationType: row.operationType as ImageTask['operationType'],
    optimizedPrompt: row.optimizedPrompt,
    ownerUserId: row.ownerUserId,
    parentTaskId: row.parentTaskId,
    pricePolicyId: row.pricePolicyId,
    priceVersion: row.priceVersion,
    projectId: row.projectId,
    providerUsageId: row.providerUsageId,
    quotaHoldLedgerId: row.quotaHoldLedgerId,
    quotedPriceAmount: row.quotedPriceAmount,
    quotedPriceUnit: 'points',
    ratio: row.ratio,
    rawProviderParams: asRecord(row.rawProviderParams),
    requestedModelKey: row.requestedModelKey,
    requestedProvider: row.requestedProvider,
    settledAt: row.settledAt,
    settledPriceAmount: row.settledPriceAmount,
    status: row.status,
    successCount: row.successCount,
    tenantId: row.tenantId,
    updatedAt: row.updatedAt,
    userPrompt: row.userPrompt,
  };
}

function mapProviderUsage(
  row: typeof schema.mtProviderUsage.$inferSelect
): ProviderUsage {
  return {
    createdAt: row.createdAt,
    id: row.id,
    imageTaskId: row.imageTaskId,
    latencyMs: row.latencyMs,
    providerConfigId: row.providerConfigId,
    providerCostAmount: row.providerCostAmount,
    providerCostCurrency: row.providerCostCurrency,
    providerModelId: row.providerModelId,
    rawErrorCode: row.rawErrorCode,
    rawErrorMessage: row.rawErrorMessage,
    requestId: row.requestId,
    requestSnapshot: asRecord(row.requestSnapshot),
    responseSnapshot: asRecord(row.responseSnapshot),
    status: row.status,
    tenantId: row.tenantId,
  };
}

function mapOutboxEvent(
  row: typeof schema.mtOutboxEvents.$inferSelect
): OutboxEvent {
  return {
    aggregateId: row.aggregateId,
    aggregateType: row.aggregateType,
    attemptCount: row.attemptCount,
    createdAt: row.createdAt,
    eventType: row.eventType,
    id: row.id,
    idempotencyKey: row.idempotencyKey,
    nextAttemptAt: row.nextAttemptAt,
    payload: asRecord(row.payload),
    status: row.status,
    tenantId: row.tenantId,
    updatedAt: row.updatedAt,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requireRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new AppError('IMAGE_TASK_NOT_FOUND', 404, message);
  }
  return row;
}
