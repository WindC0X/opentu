/**
 * Image Generation Service
 *
 * 独立的图片生成服务，不依赖工作流概念。
 * 薄代理层：参数构建 → 调用 executor → 等待完成 → 返回结果。
 * 任务状态管理和 IndexedDB 持久化由 executor 层负责。
 */

import type { ImageGenerationOptions, ImageGenerationResult } from './types';
import { TaskStatus } from './types';
import { generateTaskId } from '../../utils/task-utils';
import {
  validateGenerationParams,
  sanitizeGenerationParams,
} from '../../utils/validation-utils';
import { taskStorageWriter } from '../media-executor/task-storage-writer';
import { executorFactory, waitForTaskCompletion } from '../media-executor';
import {
  hasInvocationRouteCredentials,
  settingsManager,
} from '../../utils/settings-manager';
import { TaskType } from '../../types/shared/core.types';
import type { ImageGenerationParams } from '../media-executor/types';
import { taskQueueService } from '../task-queue-service';
import {
  TaskStatus as QueueTaskStatus,
  TaskExecutionPhase,
} from '../../types/task.types';
import { createTaskInvocationRouteSnapshot } from '../task-invocation-route';
import { resolveCreativeEmbeddedModelForGeneration } from '../creative-embedded-model-guard';
import {
  hasCreativeUserParams,
  hasRuntimeParameterSchema,
  isCreativeManagedImageTask,
  isCreativeManagedModel,
  getCompatibleParams,
  getModelConfig,
  getRuntimeModelConfigs,
} from '../../constants/model-config';

function supportsLegacyCreativeImageParams(
  model?: string | null,
  modelRef?: ImageGenerationOptions['modelRef'],
  fallbackModelId?: string | null
): boolean {
  if (!model || !isCreativeManagedModel(model, modelRef || null)) {
    return true;
  }
  const fallbackParams = fallbackModelId
    ? getCompatibleParams(fallbackModelId)
    : [];
  if (fallbackParams.some((param) => !param.runtimeSchema)) {
    return true;
  }

  const lookupId = modelRef?.modelId || model;
  const normalizedLookupId = lookupId.trim().toLowerCase();
  const modelConfig =
    getModelConfig(lookupId) ||
    getRuntimeModelConfigs().find(
      (candidate) => candidate.id.trim().toLowerCase() === normalizedLookupId
    );
  const params = modelConfig
    ? getCompatibleParams(modelConfig)
    : getCompatibleParams(model);
  return params.some((param) => !param.runtimeSchema);
}

function buildStoredImageAdapterParams(
  options: ImageGenerationOptions
): Record<string, unknown> | undefined {
  const adapterParams: Record<string, unknown> = {
    ...(options.params || {}),
  };

  if (
    options.resolution !== undefined &&
    adapterParams.resolution === undefined
  ) {
    adapterParams.resolution = options.resolution;
  }

  if (options.quality !== undefined && adapterParams.quality === undefined) {
    adapterParams.quality = options.quality;
  }

  if (
    typeof options.count === 'number' &&
    Number.isFinite(options.count) &&
    adapterParams.n === undefined
  ) {
    adapterParams.n = options.count;
  }

  return Object.keys(adapterParams).length > 0 ? adapterParams : undefined;
}

function buildStoredImageTaskParams(
  prompt: string,
  options: ImageGenerationOptions,
  schemaBacked = hasCreativeUserParams(options.userParams),
  legacyParamsAllowed = !schemaBacked
) {
  const userParams = options.userParams ?? (schemaBacked ? {} : undefined);
  return {
    prompt,
    model: options.model,
    modelRef: options.modelRef || null,
    size: legacyParamsAllowed ? options.size : undefined,
    resolution: legacyParamsAllowed ? options.resolution : undefined,
    quality: legacyParamsAllowed ? options.quality : undefined,
    generationMode: options.generationMode,
    referenceImages:
      options.referenceImages && options.referenceImages.length > 0
        ? options.referenceImages
        : undefined,
    maskImage: options.maskImage,
    inputFidelity: legacyParamsAllowed ? options.inputFidelity : undefined,
    background: legacyParamsAllowed ? options.background : undefined,
    outputFormat: legacyParamsAllowed ? options.outputFormat : undefined,
    outputCompression: legacyParamsAllowed
      ? options.outputCompression
      : undefined,
    uploadedImages:
      options.uploadedImages && options.uploadedImages.length > 0
        ? options.uploadedImages
        : undefined,
    count: legacyParamsAllowed ? options.count : undefined,
    assetMetadata: options.assetMetadata,
    promptMeta: options.promptMeta,
    params: legacyParamsAllowed
      ? buildStoredImageAdapterParams(options)
      : undefined,
    userParams,
    creativeManaged: schemaBacked ? true : undefined,
    creativeParameterFallbackModelId: options.creativeParameterFallbackModelId,
  };
}

/**
 * 生成图片
 *
 * @param prompt 生成提示词
 * @param options 生成选项
 * @returns 包含任务对象的结果
 */
export async function generateImage(
  prompt: string,
  options: ImageGenerationOptions = {}
): Promise<ImageGenerationResult> {
  // 参数验证
  const params = { prompt, ...options };
  const validation = validateGenerationParams(params, TaskType.IMAGE);
  if (!validation.valid) {
    throw new Error(validation.errors.join(', '));
  }
  const sanitizedParams = sanitizeGenerationParams(params);

  // 确保 API Key 已解密
  await settingsManager.waitForInitialization();
  const embeddedModel = resolveCreativeEmbeddedModelForGeneration(
    'image',
    options.model,
    options.modelRef || null
  );
  const effectiveOptions: ImageGenerationOptions = embeddedModel
    ? {
        ...options,
        model: embeddedModel.modelId,
        modelRef: embeddedModel.modelRef,
      }
    : options;
  if (
    !hasInvocationRouteCredentials(
      'image',
      effectiveOptions.modelRef || effectiveOptions.model
    )
  ) {
    throw new Error('未配置 API Key，请在设置中配置');
  }

  // 创建任务记录
  const taskId = generateTaskId();
  const now = Date.now();
  const schemaBacked =
    isCreativeManagedImageTask(effectiveOptions) ||
    hasCreativeUserParams(effectiveOptions.userParams) ||
    (!!effectiveOptions.model &&
      hasRuntimeParameterSchema(effectiveOptions.model));
  const legacyParamsAllowed =
    !schemaBacked &&
    supportsLegacyCreativeImageParams(
      effectiveOptions.model,
      effectiveOptions.modelRef || null,
      effectiveOptions.creativeParameterFallbackModelId
    );
  const userParams =
    effectiveOptions.userParams ?? (schemaBacked ? {} : undefined);
  const persistedTaskParams = buildStoredImageTaskParams(
    sanitizedParams.prompt,
    effectiveOptions,
    schemaBacked,
    legacyParamsAllowed
  );
  const invocationRoute = createTaskInvocationRouteSnapshot(
    'image',
    effectiveOptions.modelRef || effectiveOptions.model || null
  );
  await taskStorageWriter.createTask(
    taskId,
    'image',
    persistedTaskParams,
    invocationRoute
  );

  // 注册到 TaskQueueService 内存 Map，确保任务队列 UI 和重试功能可用
  taskQueueService.trackExternalTask({
    id: taskId,
    type: TaskType.IMAGE,
    status: QueueTaskStatus.PROCESSING,
    params: persistedTaskParams,
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    invocationRoute,
    executionPhase: TaskExecutionPhase.SUBMITTING,
  });

  // 通知调用方 taskId，以便提前持久化到工作流步骤
  await options.onTaskCreated?.(taskId);

  // 构建 executor 参数
  const executorParams: ImageGenerationParams = {
    taskId,
    prompt: sanitizedParams.prompt,
    model: effectiveOptions.model,
    modelRef: effectiveOptions.modelRef || null,
    size: legacyParamsAllowed ? effectiveOptions.size : undefined,
    resolution: legacyParamsAllowed ? effectiveOptions.resolution : undefined,
    generationMode: effectiveOptions.generationMode,
    quality: legacyParamsAllowed ? effectiveOptions.quality : undefined,
    referenceImages: effectiveOptions.referenceImages,
    maskImage: effectiveOptions.maskImage,
    inputFidelity: legacyParamsAllowed
      ? effectiveOptions.inputFidelity
      : undefined,
    background: legacyParamsAllowed ? effectiveOptions.background : undefined,
    outputFormat: legacyParamsAllowed
      ? effectiveOptions.outputFormat
      : undefined,
    outputCompression: legacyParamsAllowed
      ? effectiveOptions.outputCompression
      : undefined,
    uploadedImages: effectiveOptions.uploadedImages,
    count: legacyParamsAllowed ? effectiveOptions.count : undefined,
    assetMetadata: effectiveOptions.assetMetadata,
    params: legacyParamsAllowed ? effectiveOptions.params : undefined,
    userParams,
    creativeManaged: schemaBacked ? true : undefined,
    creativeParameterFallbackModelId:
      effectiveOptions.creativeParameterFallbackModelId,
  };

  // 调用 executor 执行
  const executor = options.forceMainThread
    ? executorFactory.getFallbackExecutor()
    : await executorFactory.getExecutor();

  await executor.generateImage(executorParams, { signal: options.signal });

  // 等待任务完成（轮询 IndexedDB）
  const result = await waitForTaskCompletion(taskId, {
    signal: options.signal,
    onProgress: (updatedTask) => {
      taskQueueService.syncTaskFromStorage(taskId, updatedTask);
    },
  });

  if (!result.success || !result.task) {
    const errorTask = result.task || {
      id: taskId,
      type: TaskType.IMAGE,
      status: TaskStatus.FAILED,
      params: { prompt },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      error: {
        code: 'GENERATION_ERROR',
        message: result.error || '图片生成失败',
      },
    };
    return { task: errorTask };
  }

  return { task: result.task, url: result.task.result?.url };
}
