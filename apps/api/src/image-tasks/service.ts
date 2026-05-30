import { randomUUID } from 'crypto';

import {
  AssetService,
  type GeneratedAssetInput,
} from '../assets/service';
import { toAssetView } from '../assets/service';
import type { AssetRepository } from '../assets/types';
import type { AuthenticatedSession } from '../auth/types';
import { DEFAULT_TENANT_ID } from '../auth/types';
import { AppError } from '../errors';
import type { ProjectRepository } from '../projects/types';
import {
  MOCK_MODEL_KEY,
} from '../providers/mock-provider';
import { EnvProviderCredentialResolver } from '../providers/credentials';
import { MockImageModelCatalog } from '../providers/model-catalog';
import {
  ImageProviderRegistry,
  createDefaultProviderRegistry,
} from '../providers/registry';
import type {
  ImageModelCatalog,
  ImageProviderResult,
  ProviderCredentialResolver,
  ProviderInputImage,
  ResolvedImageModel,
} from '../providers/types';
import { QuotaService } from '../quota/service';
import type {
  CreateImageTaskInput,
  ImageTask,
  ImageTaskLateReconciliationResult,
  ImageTaskOperationType,
  ImageTaskQuote,
  ImageTaskReferenceAssetInput,
  ImageTaskRepository,
  ImageTaskStatus,
  ImageTaskView,
} from './types';

interface ImageTaskServiceOptions {
  autoRunWorker?: boolean;
  credentialResolver?: ProviderCredentialResolver;
  modelCatalog?: ImageModelCatalog;
  now?: () => Date;
  providerRegistry?: ImageProviderRegistry;
  tenantId?: string;
}

interface QuoteImageTaskInput {
  batchSize: 1 | 2 | 4;
  maskAssetId?: string | null;
  modelKey: string;
  operationType: ImageTaskOperationType;
  projectId?: string;
  ratio: string;
  referenceAssets?: ImageTaskReferenceAssetInput[];
  sourceAssetId?: string | null;
}

export class ImageTaskService {
  private readonly autoRunWorker: boolean;
  private readonly credentialResolver: ProviderCredentialResolver;
  private readonly modelCatalog: ImageModelCatalog;
  private readonly now: () => Date;
  private readonly providerRegistry: ImageProviderRegistry;
  private readonly tenantId: string;

  constructor(
    private readonly repository: ImageTaskRepository,
    private readonly projectRepository: ProjectRepository,
    private readonly assetRepository: AssetRepository,
    private readonly assetService: AssetService,
    private readonly quotaService: QuotaService,
    options: ImageTaskServiceOptions = {}
  ) {
    this.autoRunWorker = options.autoRunWorker ?? true;
    this.credentialResolver =
      options.credentialResolver ?? new EnvProviderCredentialResolver();
    this.modelCatalog = options.modelCatalog ?? new MockImageModelCatalog();
    this.now = options.now ?? (() => new Date());
    this.providerRegistry = options.providerRegistry ?? createDefaultProviderRegistry();
    this.tenantId = options.tenantId ?? DEFAULT_TENANT_ID;
  }

  async listModels() {
    return { models: await this.modelCatalog.listModels() };
  }

  async quote(
    input: QuoteImageTaskInput,
    auth?: AuthenticatedSession
  ): Promise<{ quote: ImageTaskQuote }> {
    const normalized = this.normalizeQuoteInput(input);
    if (auth && normalized.projectId) {
      await this.requireOwnedProject(auth, normalized.projectId);
      await this.assetService.validateImageTaskAssetReferences(
        auth,
        normalized.projectId,
        normalized
      );
    }
    const { quote } = await this.modelCatalog.quote(normalized);
    return { quote };
  }

  async createTask(
    auth: AuthenticatedSession,
    input: CreateImageTaskInput
  ): Promise<{ task: ImageTaskView }> {
    const normalized = this.normalizeCreateInput(input);
    const project = await this.requireOwnedProject(auth, normalized.projectId);
    await this.assetService.validateImageTaskAssetReferences(
      auth,
      project.id,
      normalized
    );
    const existing = await this.repository.findTaskByIdempotencyKey(
      this.tenantId,
      auth.user.id,
      normalized.idempotencyKey
    );
    if (existing) {
      return { task: await this.toTaskView(existing) };
    }

    const { model, quote } = await this.modelCatalog.quote(normalized);
    const plannedTaskId = randomUUID();
    const hold = await this.quotaService.hold(auth, quote, {
      idempotencyKey: normalized.idempotencyKey,
      taskId: plannedTaskId,
    });
    const task = await this.repository.createTask({
      auth,
      holdLedgerId: hold.id,
      id: plannedTaskId,
      input: {
        ...normalized,
        idempotencyKey: normalized.idempotencyKey,
      },
      model,
      quote,
    });

    await this.repository.createOutboxEvent({
      aggregateId: task.id,
      aggregateType: 'image_task',
      eventType: 'image_task_created',
      idempotencyKey: `image_task_created:${task.id}`,
      payload: {
        imageTaskId: task.id,
        projectId: project.id,
        requestedModelKey: task.requestedModelKey,
      },
      tenantId: this.tenantId,
    });

    if (this.autoRunWorker) {
      await this.runProviderWorker(auth, task, normalized, quote, model);
    }

    const latest = await this.repository.findTaskById(this.tenantId, task.id);
    return { task: await this.toTaskView(latest ?? task) };
  }

  async getTask(
    auth: AuthenticatedSession,
    taskId: string
  ): Promise<{ task: ImageTaskView }> {
    const task = await this.requireVisibleTask(auth, taskId);
    return { task: await this.toTaskView(task) };
  }

  async listProjectTasks(
    auth: AuthenticatedSession,
    projectId: string
  ): Promise<{ tasks: ImageTaskView[] }> {
    await this.requireOwnedProject(auth, projectId);
    const tasks = await this.repository.listProjectTasks({
      ownerUserId: auth.user.id,
      projectId,
      tenantId: this.tenantId,
    });
    return {
      tasks: await Promise.all(tasks.map((task) => this.toTaskView(task))),
    };
  }

  async listAdminTasks(
    auth: AuthenticatedSession,
    input: { status?: ImageTaskStatus } = {}
  ): Promise<{ tasks: ImageTaskView[] }> {
    this.requireAdmin(auth);
    const tasks = await this.repository.listAdminTasks({
      status: input.status,
      tenantId: this.tenantId,
    });
    return {
      tasks: await Promise.all(tasks.map((task) => this.toTaskView(task))),
    };
  }

  async adminCancelTask(
    auth: AuthenticatedSession,
    taskId: string
  ): Promise<{ task: ImageTaskView }> {
    this.requireAdmin(auth);
    const task = await this.requireVisibleTask(auth, taskId);
    if (task.ownerUserId !== auth.user.id) {
      throw new AppError(
        'FORBIDDEN',
        403,
        '跨用户取消任务需要单独确认点数释放语义'
      );
    }
    return this.cancelTask(auth, taskId);
  }

  async adminRetryTask(
    auth: AuthenticatedSession,
    taskId: string
  ): Promise<{ task: ImageTaskView }> {
    this.requireAdmin(auth);
    const task = await this.requireVisibleTask(auth, taskId);
    if (task.ownerUserId !== auth.user.id) {
      throw new AppError(
        'FORBIDDEN',
        403,
        '跨用户重试任务需要单独确认点数冻结语义'
      );
    }
    return this.retryTask(auth, taskId);
  }

  async cancelTask(
    auth: AuthenticatedSession,
    taskId: string
  ): Promise<{ task: ImageTaskView }> {
    const task = await this.requireVisibleTask(auth, taskId);
    if (task.status !== 'queued') {
      throw new AppError('BAD_REQUEST', 400, '只有排队任务可以取消');
    }
    const quote = this.quoteFromTask(task);
    await this.quotaService.release(auth, quote, {
      amount: task.quotedPriceAmount,
      idempotencyKey: `cancel:${task.id}`,
      taskId: task.id,
    });
    const updated = await this.repository.updateTask(task.id, {
      canvasSyncStatus: 'not_required',
      failureCount: task.batchSize,
      status: 'cancelled',
    });
    await this.repository.createOutboxEvent({
      aggregateId: task.id,
      aggregateType: 'image_task',
      eventType: 'image_task_failed',
      idempotencyKey: `image_task_cancelled:${task.id}`,
      payload: { imageTaskId: task.id, reason: 'cancelled' },
      tenantId: this.tenantId,
    });
    return { task: await this.toTaskView(updated) };
  }

  async retryTask(
    auth: AuthenticatedSession,
    taskId: string
  ): Promise<{ task: ImageTaskView }> {
    const task = await this.requireVisibleTask(auth, taskId);
    if (task.status !== 'failed' && task.status !== 'cancelled') {
      throw new AppError('BAD_REQUEST', 400, '只有失败或取消任务可以重试');
    }
    return this.createTask(auth, {
      batchSize: task.batchSize,
      idempotencyKey: `retry:${task.id}:${Date.now()}`,
      maskAssetId: readTaskMaskAssetId(task),
      modelKey: task.requestedModelKey,
      operationType: task.operationType,
      prompt: task.userPrompt,
      projectId: task.projectId,
      ratio: task.ratio,
      referenceAssets: readTaskReferenceAssets(task),
      sourceAssetId: readTaskSourceAssetId(task),
    });
  }

  async reconcileLateProviderResult(
    auth: AuthenticatedSession,
    taskId: string
  ): Promise<ImageTaskLateReconciliationResult> {
    const task = await this.requireVisibleTask(auth, taskId);
    if (task.status === 'succeeded') {
      return this.lateReconciliationResult(
        'already_succeeded',
        task,
        null,
        null
      );
    }

    const usage = task.providerUsageId
      ? await this.repository.findProviderUsageById(
          this.tenantId,
          task.providerUsageId
        )
      : null;
    const providerRequestId = usage?.requestId ?? null;
    if (!providerRequestId) {
      return this.lateReconciliationResult(
        'not_recoverable',
        task,
        null,
        'missing_provider_request_id'
      );
    }

    if (task.status === 'failed' || task.status === 'cancelled') {
      return this.lateReconciliationResult(
        'blocked_released',
        task,
        providerRequestId,
        'task_already_finalized_without_held_quota'
      );
    }

    const input = this.inputFromTask(task);
    const { model, quote } = await this.modelCatalog.quote(input);
    const adapter = this.providerRegistry.require(model.providerKey);
    if (!adapter.recoverLateResult) {
      return this.lateReconciliationResult(
        'not_recoverable',
        task,
        providerRequestId,
        'provider_late_recovery_unsupported'
      );
    }

    const providerResult = await this.recoverProviderLateResult(
      task,
      input,
      model,
      providerRequestId
    );
    if (providerResult.successCount === 0) {
      return this.lateReconciliationResult(
        'not_recoverable',
        task,
        providerRequestId,
        providerResult.rawErrorCode ?? providerResult.status
      );
    }

    const successAmount =
      (quote.amount / input.batchSize) * providerResult.successCount;
    const canConsumeHeldQuota = await this.quotaService.canConsumeHeldAmount(
      auth,
      successAmount
    );
    if (!canConsumeHeldQuota) {
      return this.lateReconciliationResult(
        'blocked_released',
        task,
        providerRequestId,
        'insufficient_held_quota'
      );
    }

    const recoveredUsage = await this.createProviderUsage(
      task,
      input,
      model,
      providerResult
    );
    await this.repository.updateTask(task.id, {
      providerUsageId: recoveredUsage.id,
    });
    const updated = await this.persistSuccessfulProviderResult(
      auth,
      task,
      input,
      quote,
      model,
      providerResult
    );
    return this.lateReconciliationResult(
      'recovered',
      updated,
      providerRequestId,
      null
    );
  }

  async insertToCanvas(
    auth: AuthenticatedSession,
    taskId: string
  ): Promise<{ task: ImageTaskView }> {
    const task = await this.requireVisibleTask(auth, taskId);
    if (task.status !== 'succeeded') {
      throw new AppError('BAD_REQUEST', 400, '任务未成功，不能插入画布');
    }
    await this.repository.updateCanvasSyncRecord({
      imageTaskId: task.id,
      status: 'succeeded',
      tenantId: this.tenantId,
    });
    const updated = await this.repository.updateTask(task.id, {
      canvasSyncStatus: 'succeeded',
    });
    return { task: await this.toTaskView(updated) };
  }

  private async runProviderWorker(
    auth: AuthenticatedSession,
    task: ImageTask,
    input: CreateImageTaskInput,
    quote: ImageTaskQuote,
    model: ResolvedImageModel
  ): Promise<void> {
    await this.repository.updateTask(task.id, {
      actualModelKey: model.modelKey,
      actualProvider: model.providerKey,
      status: 'running',
    });

    const providerResult = await this.executeProvider(task, input, model);
    const usage = await this.createProviderUsage(task, input, model, providerResult);
    await this.repository.updateTask(task.id, { providerUsageId: usage.id });

    if (providerResult.successCount === 0) {
      await this.quotaService.release(auth, quote, {
        amount: quote.amount,
        idempotencyKey: `provider_fail:${task.id}`,
        taskId: task.id,
      });
      await this.repository.updateTask(task.id, {
        canvasSyncStatus: 'not_required',
        failureCode: providerResult.rawErrorCode ?? 'PROVIDER_UNAVAILABLE',
        failureCount: input.batchSize,
        failureMessage:
          providerResult.rawErrorMessage ?? 'Provider execution failed',
        status: 'failed',
      });
      return;
    }

    await this.persistSuccessfulProviderResult(
      auth,
      task,
      input,
      quote,
      model,
      providerResult
    );
  }

  private async createProviderUsage(
    task: ImageTask,
    input: CreateImageTaskInput,
    model: ResolvedImageModel,
    providerResult: ImageProviderResult
  ) {
    return this.repository.createProviderUsage({
      imageTaskId: task.id,
      latencyMs: providerResult.latencyMs,
      providerConfigId: model.providerConfigId,
      providerCostAmount: providerResult.providerCostAmount,
      providerCostCurrency: providerResult.providerCostCurrency,
      providerModelId: model.providerModelId,
      rawErrorCode: providerResult.rawErrorCode,
      rawErrorMessage: providerResult.rawErrorMessage,
      requestId: providerResult.providerRequestId,
      requestSnapshot: {
        batchSize: input.batchSize,
        maskAssetId: input.maskAssetId ?? null,
        modelKey: input.modelKey,
        operationType: input.operationType,
        providerKey: model.providerKey,
        promptLength: input.prompt.length,
        referenceAssetCount: input.referenceAssets?.length ?? 0,
        sourceAssetId: input.sourceAssetId ?? null,
      },
      responseSnapshot: providerResult.responseSnapshot,
      status: providerResult.status,
      tenantId: this.tenantId,
    });
  }

  private async persistSuccessfulProviderResult(
    auth: AuthenticatedSession,
    task: ImageTask,
    input: CreateImageTaskInput,
    quote: ImageTaskQuote,
    model: ResolvedImageModel,
    providerResult: ImageProviderResult
  ): Promise<ImageTask> {
    await this.repository.updateTask(task.id, { status: 'persisting' });

    if (input.prompt.includes('__mock_persist_fail__')) {
      await this.quotaService.release(auth, quote, {
        amount: quote.amount,
        idempotencyKey: `persist_fail:${task.id}`,
        taskId: task.id,
      });
      return this.repository.updateTask(task.id, {
        canvasSyncStatus: 'not_required',
        failureCode: 'ASSET_PERSIST_FAILED',
        failureCount: input.batchSize,
        failureMessage: 'Mock asset persistence failure',
        status: 'failed',
      });
    }

    const generatedInputs: GeneratedAssetInput[] = providerResult.images.map(
      (image) => ({
        body: image.body,
        candidateIndex: image.candidateIndex,
        jobId: task.id,
        mimeType: image.mimeType,
        modelKey: model.modelKey,
        modelVersion: model.modelVersion,
        maskAssetId: input.maskAssetId ?? null,
        projectId: input.projectId,
        provider: model.providerKey,
        referenceAssets: input.referenceAssets ?? [],
        sourceAssetId: input.sourceAssetId ?? null,
        taskId: task.id,
      })
    );
    const generated = await this.assetService.createGeneratedAssets(
      auth,
      generatedInputs
    );

    const successAmount =
      (quote.amount / input.batchSize) * providerResult.successCount;
    const releaseAmount = quote.amount - successAmount;
    await this.quotaService.consume(auth, quote, {
      amount: successAmount,
      idempotencyKey: `success:${task.id}`,
      taskId: task.id,
    });
    await this.quotaService.release(auth, quote, {
      amount: releaseAmount,
      idempotencyKey: `partial_release:${task.id}`,
      taskId: task.id,
    });

    const canvasSyncStatus = input.prompt.includes('__mock_canvas_fail__')
      ? 'failed'
      : 'succeeded';
    await this.repository.createCanvasSyncRecord({
      assetIds: generated.assets.map((asset) => asset.id),
      imageTaskId: task.id,
      projectId: task.projectId,
      status: canvasSyncStatus,
      tenantId: this.tenantId,
    });
    await this.repository.createOutboxEvent({
      aggregateId: task.id,
      aggregateType: 'image_task',
      eventType: 'image_task_succeeded',
      idempotencyKey: `image_task_succeeded:${task.id}`,
      payload: {
        assetIds: generated.assets.map((asset) => asset.id),
        imageTaskId: task.id,
      },
      tenantId: this.tenantId,
    });
    await this.repository.createOutboxEvent({
      aggregateId: task.id,
      aggregateType: 'image_task',
      eventType: 'canvas_sync_requested',
      idempotencyKey: `canvas_sync_requested:${task.id}`,
      payload: {
        assetIds: generated.assets.map((asset) => asset.id),
        imageTaskId: task.id,
        projectId: task.projectId,
      },
      tenantId: this.tenantId,
    });
    return this.repository.updateTask(task.id, {
      canvasSyncStatus,
      failureCount: providerResult.failureCount,
      settledAt: this.now(),
      settledPriceAmount: successAmount,
      status: 'succeeded',
      successCount: providerResult.successCount,
    });
  }

  private async recoverProviderLateResult(
    task: ImageTask,
    input: CreateImageTaskInput,
    model: ResolvedImageModel,
    providerRequestId: string
  ): Promise<ImageProviderResult> {
    const adapter = this.providerRegistry.require(model.providerKey);
    if (!adapter.recoverLateResult) {
      return failedProviderResult({
        code: 'PROVIDER_LATE_RECOVERY_UNSUPPORTED',
        failureCount: input.batchSize,
        message: 'Provider does not support late result recovery',
        requestId: providerRequestId,
        status: 'failed',
      });
    }

    let credentialSecret: string | null = null;
    try {
      credentialSecret = await this.credentialResolver.resolve({
        credential: model.credential,
        model,
      });
      const sourceImage = await this.providerInputImage(
        input.sourceAssetId ?? null,
        'source'
      );
      const maskImage = await this.providerInputImage(
        input.maskAssetId ?? null,
        'mask'
      );
      const referenceImages = await Promise.all(
        (input.referenceAssets ?? []).map((reference) =>
          this.providerInputImage(reference.assetId, reference.role, reference.order)
        )
      );
      const result = await adapter.recoverLateResult({
        credentialSecret,
        input,
        maskImage,
        model,
        providerRequestId,
        referenceImages: referenceImages.filter(
          (image): image is ProviderInputImage => Boolean(image)
        ),
        sourceImage,
        task,
      });
      return sanitizeProviderResult(result, credentialSecret);
    } catch (error) {
      const appError = error instanceof AppError ? error : null;
      const rawErrorMessage = sanitizeProviderText(
        appError?.message ?? 'Provider late result recovery failed',
        credentialSecret
      );
      return failedProviderResult({
        code: appError?.code ?? 'PROVIDER_LATE_RECOVERY_FAILED',
        failureCount: input.batchSize,
        message: rawErrorMessage,
        requestId: providerRequestId,
        status: 'failed',
      });
    }
  }

  private async executeProvider(
    task: ImageTask,
    input: CreateImageTaskInput,
    model: ResolvedImageModel
  ): Promise<ImageProviderResult> {
    const adapter = this.providerRegistry.require(model.providerKey);
    let credentialSecret: string | null = null;
    try {
      credentialSecret = await this.credentialResolver.resolve({
        credential: model.credential,
        model,
      });
      const sourceImage = await this.providerInputImage(
        input.sourceAssetId ?? null,
        'source'
      );
      const maskImage = await this.providerInputImage(
        input.maskAssetId ?? null,
        'mask'
      );
      const referenceImages = await Promise.all(
        (input.referenceAssets ?? []).map((reference) =>
          this.providerInputImage(reference.assetId, reference.role, reference.order)
        )
      );
      const result = await adapter.execute({
        credentialSecret,
        input,
        maskImage,
        model,
        referenceImages: referenceImages.filter(
          (image): image is ProviderInputImage => Boolean(image)
        ),
        sourceImage,
        task,
      });
      return sanitizeProviderResult(result, credentialSecret);
    } catch (error) {
      const appError = error instanceof AppError ? error : null;
      const rawErrorMessage = sanitizeProviderText(
        appError?.message ?? 'Provider execution failed',
        credentialSecret
      );
      return {
        failureCount: input.batchSize,
        images: [],
        latencyMs: null,
        providerCostAmount: null,
        providerCostCurrency: null,
        providerRequestId: null,
        rawErrorCode: appError?.code ?? 'PROVIDER_UNAVAILABLE',
        rawErrorMessage,
        responseSnapshot: {
          errorCode: appError?.code ?? 'PROVIDER_UNAVAILABLE',
          message: rawErrorMessage,
        },
        status: 'failed',
        successCount: 0,
      };
    }
  }

  private async providerInputImage(
    assetId: string | null,
    role: ProviderInputImage['role'],
    order = 0
  ): Promise<ProviderInputImage | null> {
    if (!assetId) {
      return null;
    }
    const result = await this.assetService.readProviderInputVariant(assetId);
    return {
      assetId,
      body: result.body,
      mimeType: result.mimeType,
      order,
      role,
    };
  }

  private normalizeQuoteInput(input: QuoteImageTaskInput): QuoteImageTaskInput {
    const operationType = normalizeOperationType(input.operationType);
    const referenceAssets = normalizeReferenceAssets(
      input.referenceAssets ?? []
    );
    const normalized: QuoteImageTaskInput = {
      ...input,
      maskAssetId: cleanOptionalId(input.maskAssetId),
      modelKey: input.modelKey || MOCK_MODEL_KEY,
      operationType,
      ratio: input.ratio || '1:1',
      referenceAssets,
      sourceAssetId: cleanOptionalId(input.sourceAssetId),
    };
    assertOperationAssetRequirements(normalized);
    if (![1, 2, 4].includes(normalized.batchSize)) {
      throw new AppError('BAD_REQUEST', 400, 'batch_size must be 1, 2, or 4');
    }
    return normalized;
  }

  private normalizeCreateInput(
    input: CreateImageTaskInput
  ): CreateImageTaskInput {
    const prompt = input.prompt.trim();
    if (!prompt) {
      throw new AppError('BAD_REQUEST', 400, 'prompt is required');
    }
    const normalized = {
      ...input,
      idempotencyKey: input.idempotencyKey || randomUUID(),
      maskAssetId: cleanOptionalId(input.maskAssetId),
      modelKey: input.modelKey || MOCK_MODEL_KEY,
      operationType: normalizeOperationType(input.operationType),
      prompt,
      ratio: input.ratio || '1:1',
      referenceAssets: normalizeReferenceAssets(input.referenceAssets ?? []),
      sourceAssetId: cleanOptionalId(input.sourceAssetId),
    };
    assertOperationAssetRequirements(normalized);
    if (![1, 2, 4].includes(normalized.batchSize)) {
      throw new AppError('BAD_REQUEST', 400, 'batch_size must be 1, 2, or 4');
    }
    return normalized;
  }

  private async requireOwnedProject(
    auth: AuthenticatedSession,
    projectId: string
  ) {
    const project = await this.projectRepository.findProjectById(
      this.tenantId,
      projectId
    );
    if (!project || project.deletedAt || project.status !== 'active') {
      throw new AppError('PROJECT_NOT_FOUND', 404, '项目不存在');
    }
    if (project.ownerUserId !== auth.user.id) {
      throw new AppError('FORBIDDEN', 403, '无权访问该项目');
    }
    return project;
  }

  private async requireVisibleTask(
    auth: AuthenticatedSession,
    taskId: string
  ): Promise<ImageTask> {
    const task = await this.repository.findTaskById(this.tenantId, taskId);
    if (!task) {
      throw new AppError('IMAGE_TASK_NOT_FOUND', 404, '任务不存在');
    }
    if (task.ownerUserId !== auth.user.id && auth.user.role !== 'admin') {
      throw new AppError('IMAGE_TASK_NOT_FOUND', 404, '任务不存在');
    }
    return task;
  }

  private requireAdmin(auth: AuthenticatedSession): void {
    if (auth.user.role !== 'admin') {
      throw new AppError('FORBIDDEN', 403, 'Forbidden');
    }
  }

  private quoteFromTask(task: ImageTask): ImageTaskQuote {
    return {
      amount: task.quotedPriceAmount,
      batchSize: task.batchSize,
      maskAssetId: readTaskMaskAssetId(task),
      modelKey: task.requestedModelKey,
      operationType: task.operationType,
      pricePolicyId: task.pricePolicyId,
      priceVersion: task.priceVersion,
      ratio: task.ratio,
      referenceAssets: readTaskReferenceAssets(task),
      sourceAssetId: readTaskSourceAssetId(task),
      unit: task.quotedPriceUnit,
    };
  }

  private inputFromTask(task: ImageTask): CreateImageTaskInput {
    return {
      batchSize: task.batchSize,
      idempotencyKey: task.idempotencyKey,
      maskAssetId: readTaskMaskAssetId(task),
      modelKey: task.requestedModelKey,
      operationType: task.operationType,
      prompt: task.userPrompt,
      projectId: task.projectId,
      ratio: task.ratio,
      referenceAssets: readTaskReferenceAssets(task),
      sourceAssetId: readTaskSourceAssetId(task),
    };
  }

  private async lateReconciliationResult(
    status: ImageTaskLateReconciliationResult['status'],
    task: ImageTask,
    providerRequestId: string | null,
    reason: string | null
  ): Promise<ImageTaskLateReconciliationResult> {
    return {
      providerRequestId,
      reason,
      status,
      task: await this.toTaskView(task),
    };
  }

  private async toTaskView(task: ImageTask): Promise<ImageTaskView> {
    const assetRecords = await this.assetRepository.listAssetsByTask(
      this.tenantId,
      task.id
    );
    const canvasSync =
      (
        await this.repository.listCanvasSyncRecords(this.tenantId, task.id)
      )[0] ?? null;
    return {
      actualModelKey: task.actualModelKey,
      actualProvider: task.actualProvider,
      assets: assetRecords.map((record) =>
        toAssetView(record.asset, record.variants)
      ),
      batchSize: task.batchSize,
      canvasSync,
      canvasSyncStatus: task.canvasSyncStatus,
      createdAt: task.createdAt,
      failureCode: task.failureCode,
      failureCount: task.failureCount,
      failureMessage: task.failureMessage,
      finalPrompt: task.finalPrompt,
      id: task.id,
      modelFamily: task.modelFamily,
      modelVersion: task.modelVersion,
      maskAssetId: readTaskMaskAssetId(task),
      operationType: task.operationType,
      optimizedPrompt: task.optimizedPrompt,
      ownerUserId: task.ownerUserId,
      priceVersion: task.priceVersion,
      projectId: task.projectId,
      quotedPriceAmount: task.quotedPriceAmount,
      quotedPriceUnit: task.quotedPriceUnit,
      ratio: task.ratio,
      referenceAssets: readTaskReferenceAssets(task),
      requestedModelKey: task.requestedModelKey,
      requestedProvider: task.requestedProvider,
      settledAt: task.settledAt,
      settledPriceAmount: task.settledPriceAmount,
      sourceAssetId: readTaskSourceAssetId(task),
      status: task.status,
      successCount: task.successCount,
      updatedAt: task.updatedAt,
      userPrompt: task.userPrompt,
    };
  }
}

function normalizeOperationType(
  value: ImageTaskOperationType
): ImageTaskOperationType {
  if (
    value === 'text_to_image' ||
    value === 'image_to_image' ||
    value === 'inpaint' ||
    value === 'reference_generate'
  ) {
    return value;
  }
  throw new AppError('MODEL_UNSUPPORTED_OPERATION', 400, '模型不支持当前操作');
}

function cleanOptionalId(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeReferenceAssets(
  references: ImageTaskReferenceAssetInput[]
): ImageTaskReferenceAssetInput[] {
  const seen = new Set<string>();
  const normalized: ImageTaskReferenceAssetInput[] = [];
  for (const [index, reference] of references.entries()) {
    const assetId = cleanOptionalId(reference.assetId);
    if (!assetId || seen.has(assetId)) {
      continue;
    }
    seen.add(assetId);
    normalized.push({
      assetId,
      order: Number.isInteger(reference.order) ? reference.order : index,
      role: reference.role || 'general',
    });
  }
  return normalized.sort((left, right) => left.order - right.order);
}

function assertOperationAssetRequirements(input: {
  maskAssetId?: string | null;
  operationType: ImageTaskOperationType;
  referenceAssets?: ImageTaskReferenceAssetInput[];
  sourceAssetId?: string | null;
}): void {
  const referenceCount = input.referenceAssets?.length ?? 0;
  if (input.operationType === 'text_to_image') {
    if (input.sourceAssetId || input.maskAssetId || referenceCount > 0) {
      throw new AppError(
        'BAD_REQUEST',
        400,
        'text_to_image cannot include source, mask, or reference assets'
      );
    }
    return;
  }
  if (input.operationType === 'image_to_image' && !input.sourceAssetId) {
    throw new AppError('BAD_REQUEST', 400, 'source_asset_id is required');
  }
  if (input.operationType === 'inpaint') {
    if (!input.sourceAssetId) {
      throw new AppError('BAD_REQUEST', 400, 'source_asset_id is required');
    }
    if (!input.maskAssetId) {
      throw new AppError('BAD_REQUEST', 400, 'mask_asset_id is required');
    }
  }
  if (input.operationType === 'reference_generate' && referenceCount === 0) {
    throw new AppError('BAD_REQUEST', 400, 'reference_assets is required');
  }
  if (referenceCount > 5) {
    throw new AppError(
      'MODEL_UNSUPPORTED_OPERATION',
      400,
      '模型不支持当前参考图数量'
    );
  }
}

function readTaskSourceAssetId(task: ImageTask): string | null {
  const value = task.normalizedParams.sourceAssetId;
  return typeof value === 'string' && value.trim() ? value : null;
}

function readTaskMaskAssetId(task: ImageTask): string | null {
  const value = task.normalizedParams.maskAssetId;
  return typeof value === 'string' && value.trim() ? value : null;
}

function readTaskReferenceAssets(
  task: ImageTask
): ImageTaskReferenceAssetInput[] {
  const value = task.normalizedParams.referenceAssets;
  if (!Array.isArray(value)) {
    return [];
  }
  return normalizeReferenceAssets(
    value.filter(isReferenceAssetInputLike).map((reference) => ({
      assetId: reference.assetId,
      order: reference.order,
      role: reference.role,
    }))
  );
}

function isReferenceAssetInputLike(
  value: unknown
): value is ImageTaskReferenceAssetInput {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const reference = value as Partial<ImageTaskReferenceAssetInput>;
  return (
    typeof reference.assetId === 'string' &&
    Number.isInteger(reference.order) &&
    (reference.role === 'general' ||
      reference.role === 'subject' ||
      reference.role === 'style' ||
      reference.role === 'composition' ||
      reference.role === 'background')
  );
}

function failedProviderResult(input: {
  code: string;
  failureCount: number;
  message: string;
  requestId: string | null;
  status: 'failed' | 'timeout';
}): ImageProviderResult {
  const message = sanitizeProviderText(input.message);
  return {
    failureCount: input.failureCount,
    images: [],
    latencyMs: null,
    providerCostAmount: null,
    providerCostCurrency: null,
    providerRequestId: input.requestId,
    rawErrorCode: input.code,
    rawErrorMessage: message,
    responseSnapshot: {
      errorCode: input.code,
      message,
    },
    status: input.status,
    successCount: 0,
  };
}

function sanitizeProviderResult(
  result: ImageProviderResult,
  credentialSecret: string | null
): ImageProviderResult {
  return {
    ...result,
    rawErrorMessage: result.rawErrorMessage
      ? sanitizeProviderText(result.rawErrorMessage, credentialSecret)
      : null,
    responseSnapshot: sanitizeProviderSnapshot(
      result.responseSnapshot,
      credentialSecret
    ),
  };
}

function sanitizeProviderSnapshot(
  value: Record<string, unknown>,
  credentialSecret: string | null
): Record<string, unknown> {
  const sanitized = sanitizeProviderValue(value, credentialSecret);
  return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)
    ? (sanitized as Record<string, unknown>)
    : {};
}

function sanitizeProviderValue(
  value: unknown,
  credentialSecret: string | null
): unknown {
  if (typeof value === 'string') {
    return sanitizeProviderText(value, credentialSecret);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeProviderValue(item, credentialSecret));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeProviderValue(item, credentialSecret),
      ])
    );
  }
  return value;
}

function sanitizeProviderText(
  value: string,
  credentialSecret: string | null = null
): string {
  let sanitized = value.replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]');
  if (credentialSecret) {
    sanitized = sanitized.split(credentialSecret).join('[redacted]');
  }
  return sanitized.slice(0, 500);
}
