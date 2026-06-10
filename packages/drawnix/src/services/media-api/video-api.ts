/**
 * 视频生成 API
 *
 * 统一的视频生成接口，SW 和主线程共用
 */

import type {
  VideoApiConfig,
  VideoGenerationParams,
  VideoGenerationResult,
  VideoStatusResponse,
  PollingOptions,
} from './types';
import {
  buildProviderContextFromApiConfig,
  normalizeApiBase,
  parseErrorMessage,
  sleep,
} from './utils';
import { providerTransport } from '../provider-routing/provider-transport';
import {
  downloadVideoContentToLocalUrl,
  extractInlineVideoUrl,
  resolveVideoPollPath,
  resolveVideoSubmission,
  shouldDownloadVideoContent,
} from '../video-binding-utils';
import { prepareVideoReferenceImageBlob } from '../video-reference-image-utils';

const DURATION_IN_MODEL_PREFIX = 'sora-2-';
const durationEncodedInModel = (model?: string | null) =>
  Boolean(model && model.startsWith(DURATION_IN_MODEL_PREFIX));
const CREATIVE_VIDEO_UNSUPPORTED_MESSAGE =
  '当前 new-api 后端暂不支持嵌入式视频生成';

function isSessionBrokerConfig(config: VideoApiConfig): boolean {
  return (
    config.provider?.authType === 'session-broker' ||
    config.authType === 'session-broker'
  );
}

function requireDirectVideoApiKey(config: VideoApiConfig): void {
  if (isSessionBrokerConfig(config)) {
    return;
  }
  const apiKey = config.provider?.apiKey ?? config.apiKey;
  if (!apiKey?.trim()) {
    throw new Error('API Key 未配置，请先配置 API Key');
  }
}

function resolveVideoApiBase(config: VideoApiConfig): string {
  if (isSessionBrokerConfig(config)) {
    return (config.provider?.baseUrl || config.baseUrl).replace(/\/+$/, '');
  }
  return normalizeApiBase(config.baseUrl);
}

function resolveSubmitPath(config: VideoApiConfig): string {
  return isSessionBrokerConfig(config) ? '/videos' : '/v1/videos';
}

function resolveStatusPath(videoId: string, config: VideoApiConfig): string {
  if (isSessionBrokerConfig(config)) {
    return `/videos/${encodeURIComponent(videoId)}`;
  }
  return resolveVideoPollPath(videoId, config.binding, config.params);
}

function resolveIdempotencyKey(
  params: VideoGenerationParams
): string | undefined {
  const explicit = params.idempotencyKey?.trim();
  if (explicit) {
    return explicit;
  }
  const fromParams = params.params?.idempotencyKey;
  return typeof fromParams === 'string' && fromParams.trim()
    ? fromParams.trim()
    : undefined;
}

function resolveSubmitHeaders(
  params: VideoGenerationParams,
  config: VideoApiConfig
): Record<string, string> | undefined {
  if (!isSessionBrokerConfig(config)) {
    return undefined;
  }
  const idempotencyKey = resolveIdempotencyKey(params);
  if (idempotencyKey) {
    return { 'Idempotency-Key': idempotencyKey };
  }
  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  return {
    'Idempotency-Key': randomUUID
      ? `video-${randomUUID()}`
      : `video-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
}

function isUnsupportedCreativeVideoStatus(status: number): boolean {
  return status === 404 || status === 405 || status === 501;
}

class CreativeVideoUnsupportedError extends Error {
  constructor(status: number) {
    super(`${CREATIVE_VIDEO_UNSUPPORTED_MESSAGE} (${status})`);
    this.name = 'CreativeVideoUnsupportedError';
    (this as any).httpStatus = status;
    (this as any).unsupportedCreativeVideo = true;
  }
}

function getVideoContentExtensionFromMimeType(mimeType?: string): string {
  const normalized = mimeType?.toLowerCase() || '';
  if (normalized.includes('quicktime')) return 'mov';
  if (normalized.includes('webm')) return 'webm';
  if (normalized.includes('ogg')) return 'ogv';
  return 'mp4';
}

async function downloadSessionBrokerVideoContentToLocalUrl(
  remoteId: string,
  config: VideoApiConfig
): Promise<string> {
  const baseUrl = resolveVideoApiBase(config);
  const providerContext = buildProviderContextFromApiConfig(config, baseUrl);
  const response = await providerTransport.send(providerContext, {
    path: `/videos/${encodeURIComponent(remoteId)}/content`,
    method: 'GET',
    headers: {
      Accept: 'video/*,application/octet-stream',
    },
    fetcher: config.fetchImpl,
  });

  if (!response.ok) {
    if (isUnsupportedCreativeVideoStatus(response.status)) {
      throw new CreativeVideoUnsupportedError(response.status);
    }
    const errorText = await response.text().catch(() => '');
    throw new Error(
      `视频内容下载失败: ${response.status}${
        errorText ? ` - ${errorText}` : ''
      }`
    );
  }

  const blob = await response.blob();
  if (!blob.size) {
    throw new Error('视频内容下载为空');
  }
  const format = getVideoContentExtensionFromMimeType(blob.type);
  const localUrl = `/__aitu_cache__/video/${remoteId}.${format}`;
  try {
    const { unifiedCacheService } = await import('../unified-cache-service');
    await unifiedCacheService.cacheMediaFromBlob(localUrl, blob, 'video', {
      taskId: remoteId,
      model: config.defaultModel,
    });
    return localUrl;
  } catch {
    return URL.createObjectURL(blob);
  }
}

/**
 * 视频生成业务失败错误
 * 区分业务失败（不应重试）和网络错误（可重试）
 */
export class VideoGenerationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoGenerationFailedError';
  }
}

/**
 * 提交视频生成任务
 *
 * @param params 视频生成参数
 * @param config API 配置
 * @param signal 取消信号
 * @returns 远程任务 ID
 */
export async function submitVideoGeneration(
  params: VideoGenerationParams,
  config: VideoApiConfig,
  signal?: AbortSignal
): Promise<string> {
  requireDirectVideoApiKey(config);
  const fetchFn = config.fetchImpl || fetch;
  const baseUrl = resolveVideoApiBase(config);
  const providerContext = buildProviderContextFromApiConfig(config, baseUrl);
  const model = params.model || config.defaultModel || 'veo3';
  // seconds can come from duration (number/string) or explicit seconds
  const secondsParam = params.duration ?? (params as any).seconds;
  const submission = resolveVideoSubmission(
    model,
    secondsParam,
    config.binding,
    params.params as Record<string, string> | undefined
  );

  // 构建 FormData
  const formData = new FormData();
  formData.append('model', submission.model);
  formData.append('prompt', params.prompt);

  if (submission.duration && !durationEncodedInModel(submission.model)) {
    formData.append(submission.durationField, String(submission.duration));
  }

  if (params.size) {
    formData.append('size', params.size);
  }

  // 处理参考图片（体积控制在 1MB 内，与图片生成一致）
  if (params.referenceImages && params.referenceImages.length > 0) {
    for (let i = 0; i < params.referenceImages.length; i++) {
      const refImage = params.referenceImages[i];
      try {
        const response = await fetchFn(refImage, { signal });
        if (response.ok) {
          let blob = await response.blob();
          blob = await prepareVideoReferenceImageBlob(blob, params.size);
          formData.append('input_reference', blob, `reference-${i + 1}.png`);
        } else {
          formData.append('input_reference', refImage);
        }
      } catch {
        formData.append('input_reference', refImage);
      }
    }
  }

  const response = await providerTransport.send(providerContext, {
    path: resolveSubmitPath(config),
    baseUrlStrategy: isSessionBrokerConfig(config)
      ? undefined
      : config.binding?.baseUrlStrategy,
    method: 'POST',
    headers: resolveSubmitHeaders(params, config),
    body: formData,
    signal,
    fetcher: fetchFn,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Video submission failed: ${response.status} - ${errorText}`
    );
  }

  const data = await response.json();

  if (data.status === 'failed') {
    throw new VideoGenerationFailedError(
      parseErrorMessage(data.error) || '视频生成失败'
    );
  }

  if (!data.id) {
    throw new Error('No task ID returned from API');
  }

  return data.id;
}

/**
 * 查询视频状态（单次）
 *
 * @param videoId 视频 ID
 * @param config API 配置
 * @param signal 取消信号
 * @returns 视频状态响应
 */
export async function queryVideoStatus(
  videoId: string,
  config: VideoApiConfig,
  signal?: AbortSignal
): Promise<VideoStatusResponse> {
  requireDirectVideoApiKey(config);
  const fetchFn = config.fetchImpl || fetch;
  const baseUrl = resolveVideoApiBase(config);
  const providerContext = buildProviderContextFromApiConfig(config, baseUrl);

  const response = await providerTransport.send(providerContext, {
    path: resolveStatusPath(videoId, config),
    baseUrlStrategy: isSessionBrokerConfig(config)
      ? undefined
      : config.binding?.baseUrlStrategy,
    method: 'GET',
    signal,
    fetcher: fetchFn,
  });

  if (!response.ok) {
    if (
      isSessionBrokerConfig(config) &&
      isUnsupportedCreativeVideoStatus(response.status)
    ) {
      throw new CreativeVideoUnsupportedError(response.status);
    }
    throw new Error(`Video status query failed: ${response.status}`);
  }

  return response.json();
}

/**
 * 轮询视频生成状态直到完成
 *
 * @param videoId 视频 ID
 * @param config API 配置
 * @param options 轮询配置
 * @returns 完成的视频状态响应
 */
export async function pollVideoUntilComplete(
  videoId: string,
  config: VideoApiConfig,
  options: PollingOptions = {}
): Promise<VideoStatusResponse> {
  requireDirectVideoApiKey(config);
  const { onProgress, signal, interval = 5000 } = options;
  const fetchFn = config.fetchImpl || fetch;
  const baseUrl = resolveVideoApiBase(config);
  const providerContext = buildProviderContextFromApiConfig(config, baseUrl);

  let attempts = 0;
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 10;

  for (;;) {
    if (signal?.aborted) {
      throw new Error('Video generation cancelled');
    }

    try {
      const response = await providerTransport.send(providerContext, {
        path: resolveStatusPath(videoId, config),
        baseUrlStrategy: isSessionBrokerConfig(config)
          ? undefined
          : config.binding?.baseUrlStrategy,
        signal,
        fetcher: fetchFn,
      });

      if (!response.ok) {
        if (
          isSessionBrokerConfig(config) &&
          isUnsupportedCreativeVideoStatus(response.status)
        ) {
          throw new CreativeVideoUnsupportedError(response.status);
        }
        // 轮询接口临时错误，增加间隔继续重试
        consecutiveErrors++;
        console.warn(
          `[VideoAPI] Status query failed (${response.status}), attempt ${consecutiveErrors}/${maxConsecutiveErrors}`
        );

        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(
            `Failed to get video status after ${maxConsecutiveErrors} consecutive errors: ${response.status}`
          );
        }

        // 指数退避
        const backoffInterval = Math.min(
          interval * Math.pow(1.5, consecutiveErrors),
          60000
        );
        await sleep(backoffInterval, signal);
        attempts++;
        continue;
      }

      // 请求成功，重置连续错误计数
      consecutiveErrors = 0;

      const data: VideoStatusResponse = await response.json();
      const status =
        data.status?.toLowerCase() as VideoStatusResponse['status'];

      // 更新进度
      const progress = data.progress ?? Math.min(10 + attempts * 2, 90);
      onProgress?.(progress);

      // 检查完成状态
      if (status === 'completed' || status === 'succeeded') {
        onProgress?.(100);
        return data;
      }

      // 检查失败状态 - 业务失败不应重试
      if (status === 'failed' || status === 'error') {
        throw new VideoGenerationFailedError(
          parseErrorMessage(data.error) || '视频生成失败'
        );
      }

      // 等待下一次轮询
      await sleep(interval, signal);
      attempts++;
    } catch (err) {
      // 业务失败错误直接抛出
      if (
        err instanceof VideoGenerationFailedError ||
        err instanceof CreativeVideoUnsupportedError
      ) {
        throw err;
      }

      // 取消信号
      if (signal?.aborted) {
        throw new Error('Video generation cancelled');
      }

      // 网络错误等可重试
      consecutiveErrors++;
      console.warn(
        `[VideoAPI] Network error during status query, attempt ${consecutiveErrors}/${maxConsecutiveErrors}:`,
        err
      );

      if (consecutiveErrors >= maxConsecutiveErrors) {
        throw err;
      }

      const backoffInterval = Math.min(
        interval * Math.pow(1.5, consecutiveErrors),
        60000
      );
      await sleep(backoffInterval, signal);
      attempts++;
    }
  }
}

/**
 * 完整的视频生成流程：提交 + 轮询
 *
 * @param params 视频生成参数
 * @param config API 配置
 * @param options 轮询选项
 * @param onRemoteId 提交成功后的回调，返回远程任务 ID
 * @returns 视频生成结果
 */
export async function generateVideo(
  params: VideoGenerationParams,
  config: VideoApiConfig,
  options: PollingOptions = {},
  onRemoteId?: (remoteId: string) => void
): Promise<VideoGenerationResult> {
  const { signal } = options;

  // 提交任务
  options.onProgress?.(5);
  const remoteId = await submitVideoGeneration(params, config, signal);
  onRemoteId?.(remoteId);

  // 轮询等待完成
  const result = await pollVideoUntilComplete(remoteId, config, options);
  const videoUrl = isSessionBrokerConfig(config)
    ? await downloadSessionBrokerVideoContentToLocalUrl(remoteId, config)
    : extractInlineVideoUrl(result as Record<string, any>) ||
      (shouldDownloadVideoContent(
        result.model || params.model,
        config.binding,
        result as Record<string, any>
      )
        ? await downloadVideoContentToLocalUrl({
            videoId: remoteId,
            provider: buildProviderContextFromApiConfig(
              config,
              resolveVideoApiBase(config)
            ),
            binding: config.binding,
            modelId: result.model || params.model,
            cacheKey: remoteId,
          })
        : undefined);
  if (!videoUrl) {
    throw new Error('No video URL in completed response');
  }

  return {
    url: videoUrl,
    format: 'mp4',
    width: result.width,
    height: result.height,
    duration: result.seconds ? parseInt(result.seconds, 10) : undefined,
  };
}

/**
 * 恢复视频轮询
 * 用于页面刷新后继续轮询已提交的任务
 *
 * @param remoteId 远程任务 ID
 * @param config API 配置
 * @param options 轮询选项
 * @returns 视频生成结果
 */
export async function resumeVideoPolling(
  remoteId: string,
  config: VideoApiConfig,
  options: PollingOptions = {}
): Promise<VideoGenerationResult> {
  const result = await pollVideoUntilComplete(remoteId, config, options);
  const videoUrl = isSessionBrokerConfig(config)
    ? await downloadSessionBrokerVideoContentToLocalUrl(remoteId, config)
    : extractInlineVideoUrl(result as Record<string, any>) ||
      (shouldDownloadVideoContent(
        result.model || config.defaultModel,
        config.binding,
        result as Record<string, any>
      )
        ? await downloadVideoContentToLocalUrl({
            videoId: remoteId,
            provider: buildProviderContextFromApiConfig(
              config,
              resolveVideoApiBase(config)
            ),
            binding: config.binding,
            modelId: result.model || config.defaultModel,
            cacheKey: remoteId,
          })
        : undefined);
  if (!videoUrl) {
    throw new Error('No video URL in completed response');
  }

  return {
    url: videoUrl,
    format: 'mp4',
    width: result.width,
    height: result.height,
    duration: result.seconds ? parseInt(result.seconds, 10) : undefined,
  };
}
