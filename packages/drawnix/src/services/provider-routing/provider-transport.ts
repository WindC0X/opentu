import type {
  PreparedProviderTransportRequest,
  ProviderBaseUrlStrategy,
  ProviderTransportRequest,
  ResolvedProviderContext,
} from './types';
import {
  CREATIVE_CSRF_HEADER,
  CREATIVE_NONCE_HEADER,
  getCreativeSessionAuthHeaders,
} from '../creative-mode';

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function applyBaseUrlStrategy(
  baseUrl: string,
  strategy: ProviderBaseUrlStrategy = 'preserve'
): string {
  const normalizedBaseUrl = trimTrailingSlashes(baseUrl);

  switch (strategy) {
    case 'trim-v1':
      return normalizedBaseUrl.replace(/\/v1$/i, '');
    case 'preserve':
    default:
      return normalizedBaseUrl;
  }
}

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }

  const normalizedBase = trimTrailingSlashes(baseUrl);
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${normalizedBase}${normalizedPath}`;
}

function splitPathQuery(path: string): {
  path: string;
  query: Record<string, string>;
} {
  const queryStart = path.indexOf('?');
  if (queryStart < 0) {
    return { path, query: {} };
  }

  const pathWithoutQuery = path.slice(0, queryStart) || '/';
  const queryString = path.slice(queryStart + 1).split('#')[0] || '';
  const params = new URLSearchParams(queryString);
  const query: Record<string, string> = {};
  params.forEach((value, key) => {
    query[key] = value;
  });

  return { path: pathWithoutQuery, query };
}

function buildQueryString(
  query?: Record<string, string | number | boolean | null | undefined>
): string {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null || key.trim() === '') {
      continue;
    }
    params.set(key, String(value));
  }

  const result = params.toString();
  return result ? `?${result}` : '';
}

function mergeHeaders(
  baseHeaders?: Record<string, string>,
  overrideHeaders?: Record<string, string>
): Record<string, string> {
  return {
    ...(baseHeaders || {}),
    ...(overrideHeaders || {}),
  };
}

function isSessionBrokerAuth(context: ResolvedProviderContext): boolean {
  return context.authType === 'session-broker';
}

function isUnsafeRequestMethod(method: string | undefined): boolean {
  const normalized = (method || 'GET').trim().toUpperCase();
  return (
    normalized === 'POST' ||
    normalized === 'PUT' ||
    normalized === 'PATCH' ||
    normalized === 'DELETE'
  );
}

function isSensitiveAuthHeaderName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return (
    normalized === 'authorization' ||
    normalized === 'proxy-authorization' ||
    normalized.endsWith('-authorization') ||
    normalized === 'x-api-key' ||
    normalized === 'api-key' ||
    normalized === 'apikey' ||
    normalized === 'openai-api-key' ||
    normalized === 'anthropic-api-key' ||
    normalized === 'x-goog-api-key' ||
    normalized.includes('api-key') ||
    normalized.includes('apikey')
  );
}

function normalizeSessionBrokerMaterialKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[-_\s]/g, '');
}

function isSensitiveSessionBrokerRoutingHeaderName(name: string): boolean {
  const normalized = normalizeSessionBrokerMaterialKey(name);
  if (
    normalized.startsWith('upstream') ||
    normalized.replace(/^x/, '').startsWith('upstream')
  ) {
    return true;
  }
  return (
    normalized === 'provider' ||
    normalized === 'xprovider' ||
    normalized === 'providerid' ||
    normalized === 'xproviderid' ||
    normalized === 'providername' ||
    normalized === 'xprovidername' ||
    normalized === 'provideroverride' ||
    normalized === 'xprovideroverride' ||
    normalized === 'channel' ||
    normalized === 'xchannel' ||
    normalized === 'channelid' ||
    normalized === 'xchannelid' ||
    normalized === 'group' ||
    normalized === 'xgroup' ||
    normalized === 'groupid' ||
    normalized === 'xgroupid' ||
    normalized === 'baseurl' ||
    normalized === 'xbaseurl' ||
    normalized === 'model' ||
    normalized === 'xmodel' ||
    normalized === 'modelid' ||
    normalized === 'xmodelid' ||
    normalized === 'modeloverride' ||
    normalized === 'xmodeloverride' ||
    normalized === 'selectedkey' ||
    normalized === 'xselectedkey' ||
    normalized === 'notifyhook' ||
    normalized === 'xnotifyhook' ||
    normalized === 'notifyurl' ||
    normalized === 'xnotifyurl' ||
    normalized === 'callback' ||
    normalized === 'xcallback' ||
    normalized === 'callbackurl' ||
    normalized === 'xcallbackurl' ||
    normalized === 'webhook' ||
    normalized === 'xwebhook' ||
    normalized === 'webhookurl' ||
    normalized === 'xwebhookurl' ||
    normalized === 'endpoint' ||
    normalized === 'xendpoint' ||
    normalized === 'url' ||
    normalized === 'xurl' ||
    normalized === 'proxy' ||
    normalized === 'xproxy'
  );
}

function isSensitiveSessionBrokerHeaderName(name: string): boolean {
  return (
    isSensitiveAuthHeaderName(name) ||
    isSensitiveSessionBrokerRoutingHeaderName(name)
  );
}

function stripSessionBrokerAuthHeaders(
  headers: Record<string, string>
): Record<string, string> {
  return Object.entries(headers).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      if (!isSensitiveSessionBrokerHeaderName(key)) {
        acc[key] = value;
      }
      return acc;
    },
    {}
  );
}

function applyAuthHeaders(
  context: ResolvedProviderContext,
  headers: Record<string, string>,
  method?: string
): Record<string, string> {
  if (isSessionBrokerAuth(context)) {
    const sessionHeaders = getCreativeSessionAuthHeaders();
    if (
      isUnsafeRequestMethod(method) &&
      (!sessionHeaders[CREATIVE_CSRF_HEADER] ||
        !sessionHeaders[CREATIVE_NONCE_HEADER])
    ) {
      throw new Error(
        'session-broker unsafe request requires Creative CSRF and nonce auth material'
      );
    }
    return {
      ...stripSessionBrokerAuthHeaders(headers),
      ...sessionHeaders,
    };
  }

  if (!context.apiKey) {
    return headers;
  }

  switch (context.authType) {
    case 'bearer':
      return { ...headers, Authorization: `Bearer ${context.apiKey}` };
    case 'header':
      if (
        headers.Authorization ||
        headers.authorization ||
        headers['X-API-Key'] ||
        headers['x-api-key']
      ) {
        return headers;
      }
      return { ...headers, 'X-API-Key': context.apiKey };
    case 'custom':
    case 'query':
    default:
      return headers;
  }
}

function isSensitiveSessionBrokerQueryKey(
  key: string,
  options: { stripModel?: boolean } = {}
): boolean {
  const normalized = normalizeSessionBrokerMaterialKey(key);
  const dePrefixed = normalized.startsWith('x')
    ? normalized.slice(1)
    : normalized;
  if (
    normalized.startsWith('upstream') ||
    dePrefixed.startsWith('upstream')
  ) {
    return true;
  }
  return (
    dePrefixed === 'apikey' ||
    dePrefixed === 'apisecret' ||
    dePrefixed === 'baseurl' ||
    dePrefixed === 'channel' ||
    dePrefixed === 'channelid' ||
    dePrefixed === 'group' ||
    dePrefixed === 'groupid' ||
    dePrefixed === 'provideroverride' ||
    dePrefixed === 'providerid' ||
    dePrefixed === 'providername' ||
    dePrefixed === 'accesstoken' ||
    dePrefixed === 'refreshtoken' ||
    dePrefixed === 'idtoken' ||
    dePrefixed === 'internaltoken' ||
    dePrefixed === 'upstreamkey' ||
    dePrefixed === 'authorization' ||
    dePrefixed === 'proxyauthorization' ||
    dePrefixed === 'token' ||
    dePrefixed === 'key' ||
    dePrefixed === 'provider' ||
    dePrefixed === 'selectedkey' ||
    dePrefixed === 'notifyhook' ||
    dePrefixed === 'notifyurl' ||
    dePrefixed === 'callback' ||
    dePrefixed === 'callbackurl' ||
    dePrefixed === 'webhook' ||
    dePrefixed === 'webhookurl' ||
    dePrefixed === 'endpoint' ||
    dePrefixed === 'url' ||
    dePrefixed === 'proxy' ||
    (options.stripModel === true &&
      (dePrefixed === 'model' ||
        dePrefixed === 'modelid' ||
        dePrefixed === 'modeloverride'))
  );
}

function stripSessionBrokerAuthQuery(
  query: Record<string, string | number | boolean | null | undefined>,
  options: { stripModel?: boolean } = {}
): Record<string, string | number | boolean | null | undefined> {
  return Object.entries(query).reduce<
    Record<string, string | number | boolean | null | undefined>
  >((acc, [key, value]) => {
    if (!isSensitiveSessionBrokerQueryKey(key, options)) {
      acc[key] = value;
    }
    return acc;
  }, {});
}

function applyAuthQuery(
  context: ResolvedProviderContext,
  query: Record<string, string | number | boolean | null | undefined>,
  options: { stripModel?: boolean } = {}
): Record<string, string | number | boolean | null | undefined> {
  if (isSessionBrokerAuth(context)) {
    return stripSessionBrokerAuthQuery(query, options);
  }

  if (!context.apiKey || context.authType !== 'query') {
    return query;
  }

  if (query.api_key !== undefined || query.key !== undefined) {
    return query;
  }

  const authQueryKey =
    context.providerType === 'gemini-compatible' ? 'key' : 'api_key';

  return {
    ...query,
    [authQueryKey]: context.apiKey,
  };
}

function isServerSelectedModelRelayPath(path: string): boolean {
  return /(^|\/)(videos?|suno|mj)(\/|$)/i.test(path);
}

const SESSION_BROKER_BASE_URL = '/creative/relay/v1';

function isAbsoluteRequestPath(path: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//');
}

function assertSessionBrokerBaseUrl(context: ResolvedProviderContext): void {
  const normalizedBaseUrl = trimTrailingSlashes(context.baseUrl);
  if (
    /^[a-z][a-z0-9+.-]*:/i.test(normalizedBaseUrl) ||
    normalizedBaseUrl.startsWith('//')
  ) {
    throw new Error(
      'session-broker transport requires baseUrl to be /creative/relay/v1'
    );
  }
  if (normalizedBaseUrl !== SESSION_BROKER_BASE_URL) {
    throw new Error(
      'session-broker transport requires baseUrl to be /creative/relay/v1'
    );
  }
}

function createTimeoutSignal(
  upstreamSignal: AbortSignal | undefined,
  timeoutMs: number | undefined
): {
  signal: AbortSignal | undefined;
  didTimeout: () => boolean;
  cleanup: () => void;
} {
  if (!timeoutMs || timeoutMs <= 0) {
    return {
      signal: upstreamSignal,
      didTimeout: () => false,
      cleanup: () => undefined,
    };
  }

  const controller = new AbortController();
  let didTimeout = false;

  const abortFromUpstream = () => {
    controller.abort(upstreamSignal?.reason);
  };

  if (upstreamSignal?.aborted) {
    controller.abort(upstreamSignal.reason);
  } else if (upstreamSignal) {
    upstreamSignal.addEventListener('abort', abortFromUpstream, { once: true });
  }

  const timeoutId = setTimeout(() => {
    didTimeout = true;
    const error = new Error(`Request timeout after ${timeoutMs}ms`);
    error.name = 'TimeoutError';
    controller.abort(error);
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeout: () => didTimeout,
    cleanup: () => {
      clearTimeout(timeoutId);
      upstreamSignal?.removeEventListener('abort', abortFromUpstream);
    },
  };
}

export class ProviderTransport {
  prepareRequest(
    context: ResolvedProviderContext,
    request: ProviderTransportRequest
  ): PreparedProviderTransportRequest {
    if (isSessionBrokerAuth(context)) {
      if (isAbsoluteRequestPath(request.path)) {
        throw new Error(
          'session-broker transport requires a relative path to keep relay calls same-origin'
        );
      }
      assertSessionBrokerBaseUrl(context);
    }

    const pathParts = splitPathQuery(request.path);
    const method = request.method || 'GET';
    const mergedHeaders = mergeHeaders(context.extraHeaders, request.headers);
    const authenticatedHeaders = applyAuthHeaders(
      context,
      mergedHeaders,
      method
    );
    const query = applyAuthQuery(
      context,
      {
        ...pathParts.query,
        ...(request.query || {}),
      },
      { stripModel: isServerSelectedModelRelayPath(pathParts.path) }
    );
    const resolvedBaseUrl = isSessionBrokerAuth(context)
      ? trimTrailingSlashes(context.baseUrl)
      : applyBaseUrlStrategy(context.baseUrl, request.baseUrlStrategy);
    const url = `${joinUrl(resolvedBaseUrl, pathParts.path)}${buildQueryString(
      query
    )}`;

    return {
      url,
      headers: authenticatedHeaders,
      init: {
        method,
        headers: authenticatedHeaders,
        body: request.body,
        signal: request.signal,
        credentials: isSessionBrokerAuth(context)
          ? 'same-origin'
          : request.credentials,
      },
    };
  }

  async send(
    context: ResolvedProviderContext,
    request: ProviderTransportRequest
  ): Promise<Response> {
    const timeoutControl = createTimeoutSignal(
      request.signal,
      request.timeoutMs
    );
    const prepared = this.prepareRequest(context, {
      ...request,
      signal: timeoutControl.signal,
    });
    const fetcher = request.fetcher || fetch;

    try {
      return await fetcher(prepared.url, prepared.init);
    } catch (error) {
      if (timeoutControl.didTimeout()) {
        const timeoutMinutes = Math.floor((request.timeoutMs || 0) / 60000);
        const timeoutError = new Error(`请求超时（>${timeoutMinutes} 分钟）`);
        timeoutError.name = 'TimeoutError';
        throw timeoutError;
      }
      throw error;
    } finally {
      timeoutControl.cleanup();
    }
  }
}

export const providerTransport = new ProviderTransport();
