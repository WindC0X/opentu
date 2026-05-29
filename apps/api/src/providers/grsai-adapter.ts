import { AppError } from '../errors';
import type {
  ImageProviderAdapter,
  ImageProviderExecutionInput,
  ImageProviderResult,
  ProviderInputImage,
} from './types';

export interface GrsaiAdapterOptions {
  baseUrl?: string;
  deferTerminalStatusUntilTimeout?: boolean;
  fetchImpl?: typeof fetch;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

type GrsaiStatus = 'running' | 'succeeded' | 'failed' | 'violation';

interface GrsaiAsyncStart {
  id?: string;
  taskId?: string;
  task_id?: string;
  requestId?: string;
  request_id?: string;
  status?: GrsaiStatus;
  data?: {
    id?: string;
    taskId?: string;
    task_id?: string;
  };
}

interface GrsaiResult {
  data?: unknown;
  error?: {
    code?: string;
    message?: string;
  };
  id?: string;
  message?: string;
  output?: unknown;
  status?: string;
  url?: string;
  urls?: string[];
}

const DEFAULT_BASE_URL = 'https://grsaiapi.com';

export class GrsaiImageProviderAdapter implements ImageProviderAdapter {
  readonly providerKey = 'grsai';
  readonly requiresCredential = true;
  private readonly baseUrl: string;
  private readonly deferTerminalStatusUntilTimeout: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(options: GrsaiAdapterOptions = {}) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.deferTerminalStatusUntilTimeout =
      options.deferTerminalStatusUntilTimeout ?? false;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.timeoutMs = options.timeoutMs ?? 120000;
  }

  async execute(input: ImageProviderExecutionInput): Promise<ImageProviderResult> {
    if (!input.credentialSecret) {
      throw new AppError(
        'PROVIDER_CREDENTIAL_MISSING',
        500,
        'Provider credential is not configured'
      );
    }

    const startedAt = Date.now();
    const requestBody = await this.buildRequestBody(input);
    const start = await this.postGenerate(input.credentialSecret, requestBody);
    const requestId = extractRequestId(start);
    if (!requestId) {
      return failedResult({
        code: 'PROVIDER_BAD_RESPONSE',
        elapsedMs: Date.now() - startedAt,
        failureCount: input.input.batchSize,
        message: 'Provider response did not include a request id',
        requestId: null,
        status: 'failed',
      });
    }

    const result = await this.pollResult(input.credentialSecret, requestId, startedAt);
    if (result.status !== 'succeeded') {
      return failedResult({
        code:
          result.status === 'violation'
            ? 'PROVIDER_VIOLATION'
            : result.status === 'failed'
              ? 'PROVIDER_FAILED'
              : 'PROVIDER_TIMEOUT',
        elapsedMs: Date.now() - startedAt,
        failureCount: input.input.batchSize,
        message: sanitizeMessage(
          result.error?.message ?? result.message ?? 'Provider generation failed'
        ),
        requestId,
        status: result.status === 'running' ? 'timeout' : 'failed',
      });
    }

    const urls = extractResultUrls(result);
    if (urls.length === 0) {
      return failedResult({
        code: 'PROVIDER_EMPTY_RESULT',
        elapsedMs: Date.now() - startedAt,
        failureCount: input.input.batchSize,
        message: 'Provider returned no image result URL',
        requestId,
        status: 'failed',
      });
    }

    const images = await Promise.all(
      urls.slice(0, input.input.batchSize).map(async (url, index) => {
        const response = await this.fetchImpl(url);
        if (!response.ok) {
          throw new AppError(
            'PROVIDER_RESULT_DOWNLOAD_FAILED',
            502,
            'Provider result image download failed'
          );
        }
        const mimeType = normalizeImageMimeType(response.headers.get('content-type'));
        const body = Buffer.from(await response.arrayBuffer());
        return { body, candidateIndex: index, mimeType };
      })
    );

    return {
      failureCount: input.input.batchSize - images.length,
      images,
      latencyMs: Date.now() - startedAt,
      providerCostAmount: null,
      providerCostCurrency: null,
      providerRequestId: requestId,
      rawErrorCode: null,
      rawErrorMessage: null,
      responseSnapshot: {
        imageCount: images.length,
        providerStatus: result.status,
        resultUrlCount: urls.length,
      },
      status: images.length === input.input.batchSize ? 'succeeded' : 'partial_succeeded',
      successCount: images.length,
    };
  }

  private async buildRequestBody(input: ImageProviderExecutionInput) {
    return {
      aspectRatio: resolveGrsaiAspectRatio(input.input.ratio),
      images: imageInputs(input),
      model: input.model.providerModelId,
      prompt: input.input.prompt,
      quality: 'auto',
      replyType: 'async',
    };
  }

  private async postGenerate(secret: string, body: Record<string, unknown>) {
    const response = await this.fetchImpl(`${this.baseUrl}/v1/api/generate`, {
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${secret}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    });
    const json = await readJson<GrsaiAsyncStart>(response);
    if (!response.ok) {
      throw providerHttpError(response.status, json);
    }
    return json;
  }

  private async pollResult(
    secret: string,
    requestId: string,
    startedAt: number
  ): Promise<GrsaiResult> {
    let lastDeferredResult: GrsaiResult | null = null;
    while (Date.now() - startedAt <= this.timeoutMs) {
      const response = await this.fetchImpl(
        `${this.baseUrl}/v1/api/result?id=${encodeURIComponent(requestId)}`,
        {
          headers: { authorization: `Bearer ${secret}` },
          method: 'GET',
        }
      );
      const json = await readJson<GrsaiResult>(response);
      if (!response.ok) {
        throw providerHttpError(response.status, json);
      }
      if (
        json.status === 'succeeded' &&
        this.deferTerminalStatusUntilTimeout &&
        extractResultUrls(json).length === 0
      ) {
        lastDeferredResult = json;
        await sleep(this.pollIntervalMs);
        continue;
      }
      if (json.status !== 'running') {
        if (
          this.deferTerminalStatusUntilTimeout &&
          json.status !== 'succeeded'
        ) {
          lastDeferredResult = json;
          await sleep(this.pollIntervalMs);
          continue;
        }
        return json;
      }
      await sleep(this.pollIntervalMs);
    }
    return lastDeferredResult ?? { id: requestId, status: 'running' };
  }
}

function imageInputs(input: ImageProviderExecutionInput): string[] {
  const images = [
    input.sourceImage,
    ...input.referenceImages,
    input.maskImage,
  ].filter((image): image is ProviderInputImage => Boolean(image));
  return images.map(
    (image) => `data:${image.mimeType};base64,${image.body.toString('base64')}`
  );
}

function resolveGrsaiAspectRatio(ratio: string): string {
  if (ratio === '16:9') {
    return '1792x1024';
  }
  if (ratio === '9:16') {
    return '1024x1792';
  }
  return '1024x1024';
}

function extractRequestId(response: GrsaiAsyncStart): string | null {
  return (
    response.id ??
    response.taskId ??
    response.task_id ??
    response.requestId ??
    response.request_id ??
    response.data?.id ??
    response.data?.taskId ??
    response.data?.task_id ??
    null
  );
}

function extractResultUrls(result: GrsaiResult): string[] {
  const values: unknown[] = [result.url, result.urls, result.output, result.data];
  const urls: string[] = [];
  for (const value of values) {
    collectUrls(value, urls);
  }
  return [...new Set(urls)].filter((url) => /^https?:\/\//i.test(url));
}

function collectUrls(value: unknown, urls: string[]): void {
  if (typeof value === 'string') {
    urls.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectUrls(item, urls);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectUrls(item, urls);
    }
  }
}

async function readJson<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}

function providerHttpError(status: number, body: unknown): AppError {
  const error = body && typeof body === 'object' ? (body as GrsaiResult).error : null;
  return new AppError(
    'PROVIDER_HTTP_ERROR',
    status >= 500 ? 502 : 400,
    sanitizeMessage(error?.message ?? `Provider HTTP ${status}`)
  );
}

function failedResult(input: {
  code: string;
  elapsedMs: number;
  failureCount: number;
  message: string;
  requestId: string | null;
  status: 'failed' | 'timeout';
}): ImageProviderResult {
  return {
    failureCount: input.failureCount,
    images: [],
    latencyMs: input.elapsedMs,
    providerCostAmount: null,
    providerCostCurrency: null,
    providerRequestId: input.requestId,
    rawErrorCode: input.code,
    rawErrorMessage: sanitizeMessage(input.message),
    responseSnapshot: {
      errorCode: input.code,
      message: sanitizeMessage(input.message),
    },
    status: input.status,
    successCount: 0,
  };
}

function sanitizeMessage(message: string): string {
  return message.replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]').slice(0, 500);
}

function normalizeImageMimeType(value: string | null): 'image/png' | 'image/jpeg' | 'image/webp' {
  const mimeType = value?.split(';')[0]?.trim().toLowerCase();
  if (mimeType === 'image/jpeg' || mimeType === 'image/webp') {
    return mimeType;
  }
  return 'image/png';
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}
