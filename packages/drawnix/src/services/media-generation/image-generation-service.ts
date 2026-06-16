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
} from '../../constants/model-config';

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
  schemaBacked = hasCreativeUserParams(options.userParams)
) {
  const userParams = options.userParams || (schemaBacked ? {} : undefined);
  return {
    prompt,
    model: options.model,
    modelRef: options.modelRef || null,
    size: schemaBacked ? undefined : options.size,
    resolution: schemaBacked ? undefined : options.resolution,
    quality: schemaBacked ? undefined : options.quality,
    generationMode: options.generationMode,
    referenceImages:
      options.referenceImages && options.referenceImages.length > 0
        ? options.referenceImages
        : undefined,
    maskImage: options.maskImage,
    inputFidelity: schemaBacked ? undefined : options.inputFidelity,
    background: schemaBacked ? undefined : options.background,
    outputFormat: schemaBacked ? undefined : options.outputFormat,
    outputCompression: schemaBacked ? undefined : options.outputCompression,
    uploadedImages:
      options.uploadedImages && options.uploadedImages.length > 0
        ? options.uploadedImages
        : undefined,
    count: schemaBacked ? undefined : options.count,
    assetMetadata: options.assetMetadata,
    promptMeta: options.promptMeta,
    params: schemaBacked ? undefined : buildStoredImageAdapterParams(options),
    userParams,
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
    hasCreativeUserParams(effectiveOptions.userParams) ||
    (!!effectiveOptions.model && hasRuntimeParameterSchema(effectiveOptions.model));
  const userParams = effectiveOptions.userParams || (schemaBacked ? {} : undefined);
  const persistedTaskParams = buildStoredImageTaskParams(
    sanitizedParams.prompt,
    effectiveOptions,
    schemaBacked
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
  options.onTaskCreated?.(taskId);

  // 构建 executor 参数
  const executorParams: ImageGenerationParams = {
    taskId,
    prompt: sanitizedParams.prompt,
    model: effectiveOptions.model,
    modelRef: effectiveOptions.modelRef || null,
    size: schemaBacked ? undefined : effectiveOptions.size,
    resolution: schemaBacked ? undefined : effectiveOptions.resolution,
    generationMode: effectiveOptions.generationMode,
    quality: schemaBacked ? undefined : effectiveOptions.quality,
    referenceImages: effectiveOptions.referenceImages,
    maskImage: effectiveOptions.maskImage,
    inputFidelity: schemaBacked ? undefined : effectiveOptions.inputFidelity,
    background: schemaBacked ? undefined : effectiveOptions.background,
    outputFormat: schemaBacked ? undefined : effectiveOptions.outputFormat,
    outputCompression: schemaBacked ? undefined : effectiveOptions.outputCompression,
    uploadedImages: effectiveOptions.uploadedImages,
    count: schemaBacked ? undefined : effectiveOptions.count,
    assetMetadata: effectiveOptions.assetMetadata,
    params: schemaBacked ? undefined : effectiveOptions.params,
    userParams,
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
