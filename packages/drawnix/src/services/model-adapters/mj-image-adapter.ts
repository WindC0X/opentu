import type {
  AdapterContext,
  ImageGenerationRequest,
  ImageModelAdapter,
} from './types';
import { registerModelAdapter } from './registry';
import { sendAdapterRequest } from './context';
import { IMAGE_GENERATION_TIMEOUT_MS } from '../../constants/TASK_CONSTANTS';

type MJSubmitResponse = {
  code: number;
  description: string;
  result: number | string;
};

type MJQueryResponse = {
  status?: string;
  imageUrl?: string;
  imageUrls?: Array<{ url: string }>;
  failReason?: string;
  progress?: string;
};

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_POLL_MAX_ATTEMPTS = Math.ceil(
  IMAGE_GENERATION_TIMEOUT_MS / DEFAULT_POLL_INTERVAL_MS
);

const CREATIVE_MJ_UNSUPPORTED_MESSAGE =
  '当前 new-api 后端暂不支持嵌入式 MJ 图片生成';

const isSessionBrokerContext = (context: AdapterContext): boolean =>
  context.authType === 'session-broker' ||
  context.provider?.authType === 'session-broker';

const requireMJProviderApiKey = (context: AdapterContext): void => {
  if (!context.apiKey && !isSessionBrokerContext(context)) {
    throw new Error('API Key 未配置，请先配置 API Key');
  }
};

const normalizeBaseUrl = (context: AdapterContext): string => {
  if (!context.baseUrl) {
    throw new Error('Missing baseUrl for MJ adapter');
  }
  const trimmed = context.baseUrl.replace(/\/$/, '');
  if (isSessionBrokerContext(context)) {
    return trimmed;
  }
  return trimmed.endsWith('/v1') ? trimmed.slice(0, -3) : trimmed;
};

const isCreativeMJUnsupportedStatus = (status: number): boolean =>
  status === 404 || status === 405 || status === 501;

const createCreativeMJUnsupportedError = (status: number): Error => {
  const error = new Error(`${CREATIVE_MJ_UNSUPPORTED_MESSAGE} (${status})`);
  (error as any).code = 'unsupported-backend';
  (error as any).unsupportedBackend = true;
  (error as any).unsupportedCreativeMJ = true;
  (error as any).httpStatus = status;
  return error;
};

const createMJIdempotencyKey = (preferredKey?: string): string => {
  const trimmedPreferredKey = preferredKey?.trim();
  if (trimmedPreferredKey) {
    return trimmedPreferredKey;
  }

  const randomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (randomUUID) {
    return `opentu-image-${randomUUID()}`;
  }
  return `opentu-image-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const resolveMJIdempotencySource = (
  request: ImageGenerationRequest
): string | undefined => {
  if (typeof request.idempotencyKey === 'string') {
    return request.idempotencyKey;
  }
  if (typeof request.params?.idempotencyKey === 'string') {
    return request.params.idempotencyKey;
  }
  return undefined;
};

const sessionBrokerMJSubmitHeaders = (
  context: AdapterContext,
  request: ImageGenerationRequest
): Record<string, string> => {
  if (!isSessionBrokerContext(context)) {
    return {};
  }

  return {
    'Idempotency-Key': createMJIdempotencyKey(
      resolveMJIdempotencySource(request)
    ),
  };
};

const stripDataUrlPrefix = (value: string): string => {
  const match = value.match(/^data:[^;]+;base64,(.*)$/);
  return match ? match[1] : value;
};

const isSuccessStatus = (status?: string): boolean => {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return ['success', 'succeed', 'completed', 'done'].includes(normalized);
};

const isFailureStatus = (status?: string): boolean => {
  if (!status) return false;
  const normalized = status.toLowerCase();
  return ['fail', 'failed', 'failure', 'error'].includes(normalized);
};

const submitMJImagine = async (
  context: AdapterContext,
  request: ImageGenerationRequest,
  body: Record<string, unknown>
): Promise<MJSubmitResponse> => {
  const baseUrl = normalizeBaseUrl(context);
  const response = await sendAdapterRequest(
    context,
    {
      path: '/mj/submit/imagine',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...sessionBrokerMJSubmitHeaders(context, request),
      },
      body: JSON.stringify(body),
    },
    baseUrl
  );

  if (!response.ok) {
    if (
      isSessionBrokerContext(context) &&
      isCreativeMJUnsupportedStatus(response.status)
    ) {
      throw createCreativeMJUnsupportedError(response.status);
    }

    const errorText = await response.text();
    throw new Error(`MJ submit failed: ${response.status} - ${errorText}`);
  }

  return response.json();
};

const queryMJTask = async (
  context: AdapterContext,
  taskId: string
): Promise<MJQueryResponse> => {
  const baseUrl = normalizeBaseUrl(context);
  const response = await sendAdapterRequest(
    context,
    {
      path: `/mj/task/${taskId}/fetch`,
      method: 'GET',
    },
    baseUrl
  );

  if (!response.ok) {
    if (
      isSessionBrokerContext(context) &&
      isCreativeMJUnsupportedStatus(response.status)
    ) {
      throw createCreativeMJUnsupportedError(response.status);
    }

    const errorText = await response.text();
    throw new Error(`MJ query failed: ${response.status} - ${errorText}`);
  }

  return response.json();
};

export const mjImageAdapter: ImageModelAdapter = {
  id: 'mj-image-adapter',
  label: 'Midjourney Image',
  kind: 'image',
  docsUrl: 'https://tuzi-api.apifox.cn',
  matchProtocols: ['mj.imagine'],
  matchRequestSchemas: ['mj.imagine.base64-array'],
  matchTags: ['mj'],
  supportedModels: ['mj-imagine'],
  defaultModel: 'mj-imagine',
  async generateImage(context, request: ImageGenerationRequest) {
    requireMJProviderApiKey(context);

    const base64Array = (request.referenceImages || []).map((img) =>
      stripDataUrlPrefix(img)
    );

    const submitResponse = await submitMJImagine(
      context,
      request,
      {
        botType: 'MID_JOURNEY',
        prompt: request.prompt,
        base64Array,
      }
    );

    const taskId = submitResponse.result?.toString();
    if (!taskId) {
      throw new Error('MJ submit missing task id');
    }

    const handleSubmitted = request.params?.onSubmitted;
    if (typeof handleSubmitted === 'function') {
      handleSubmitted(taskId);
    }

    for (let attempt = 0; attempt < DEFAULT_POLL_MAX_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) =>
        setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS)
      );
      const statusResponse = await queryMJTask(context, taskId);

      if (isSuccessStatus(statusResponse.status) && statusResponse.imageUrl) {
        const urls = statusResponse.imageUrls
          ?.map(item => item.url)
          .filter(Boolean);
        return {
          url: statusResponse.imageUrl,
          urls: urls?.length ? urls : undefined,
          format: 'jpg',
          raw: statusResponse,
        };
      }

      if (isFailureStatus(statusResponse.status)) {
        throw new Error(statusResponse.failReason || 'MJ generation failed');
      }
    }

    throw new Error('MJ generation timeout');
  },
};

export const registerMJImageAdapter = (): void => {
  registerModelAdapter(mjImageAdapter);
};
