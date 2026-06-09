import { unifiedCacheService, type CacheMediaType } from './unified-cache-service';
import {
  CREATIVE_ASSETS_ENDPOINT,
  getCreativeAssetSyncConfig,
  getCreativeSessionAuthHeaders,
} from './creative-mode';
import {
  isVirtualMediaUrl,
  normalizeVirtualMediaUrl,
} from '../utils/virtual-media-url';

export type CreativeAssetSyncErrorCode =
  | 'creative_asset_sync_disabled'
  | 'creative_asset_unsafe_url'
  | 'creative_asset_blob_unavailable'
  | 'creative_asset_upload_failed'
  | 'creative_asset_download_failed'
  | 'creative_asset_unsupported_mime'
  | 'creative_asset_size_exceeded'
  | 'creative_asset_quota_exceeded';

export interface CreativeAssetSyncErrorStatus {
  code: CreativeAssetSyncErrorCode;
  reason: string;
  recordedAt: number;
}

export class CreativeAssetSyncError extends Error {
  constructor(
    readonly code: CreativeAssetSyncErrorCode,
    readonly reason: string,
    _cause?: unknown
  ) {
    super(`Creative asset sync blocked: ${reason}`);
    this.name = 'CreativeAssetSyncError';
  }
}

export interface CreativeAssetUploadMetadata {
  mediaType?: CacheMediaType;
  mimeType?: string;
  sourceUrl?: string;
}

export interface CreativeAssetCloudAdapterLike {
  upload?(
    blob: Blob,
    metadata?: CreativeAssetUploadMetadata
  ): Promise<string>;
  download?(contentUrl: string): Promise<Blob>;
}

export interface CreativeAssetCacheLike {
  getCachedBlob(url: string): Promise<Blob | null>;
  cacheLocalMediaByContent(
    blob: Blob,
    type: CacheMediaType,
    metadata?: Record<string, unknown>
  ): Promise<{ url: string; contentHash: string; reused: boolean }>;
}

export interface CreativeDocumentAssetSyncOptions {
  assetSyncEnabled?: boolean;
  assetAdapter?: CreativeAssetCloudAdapterLike;
  cache?: CreativeAssetCacheLike;
  fetcher?: typeof fetch;
  maxAssetBytes?: number;
}

interface AssetUrlFinding {
  path: string;
  kind: string;
}

type UrlRewriter = (
  value: string,
  path: string
) => Promise<string> | string;

const REQUIRED_URL_FIELDS = new Set([
  'url',
  'imageUrl',
  'videoUrl',
  'audioUrl',
  'poster',
  'src',
  'thumbnail',
  'thumbnailUrl',
  'previewImageUrl',
  'coverUrl',
  'imageLargeUrl',
]);

const REQUIRED_URL_ARRAY_FIELDS = new Set(['urls', 'thumbnailUrls']);

const SIGNED_OR_CREDENTIAL_QUERY_PARAMS = new Set([
  'access_token',
  'apikey',
  'api_key',
  'api-key',
  'authorization',
  'credential',
  'expires',
  'key',
  'policy',
  'security_token',
  'sig',
  'signature',
  'token',
  'x-amz-algorithm',
  'x-amz-credential',
  'x-amz-date',
  'x-amz-expires',
  'x-amz-security-token',
  'x-amz-signature',
  'x-amz-signedheaders',
  'x-goog-algorithm',
  'x-goog-credential',
  'x-goog-date',
  'x-goog-expires',
  'x-goog-signature',
  'x-goog-signedheaders',
  'ossaccesskeyid',
  'x-oss-credential',
  'x-oss-date',
  'x-oss-expires',
  'x-oss-security-token',
  'x-oss-signature',
  'x-oss-signature-version',
]);

const STORAGE_HOST_PATTERNS = [
  /\.s3[.-][a-z0-9-]+\.amazonaws\.com$/i,
  /\.s3\.amazonaws\.com$/i,
  /^s3[.-][a-z0-9-]+\.amazonaws\.com$/i,
  /^s3\.amazonaws\.com$/i,
  /\.r2\.cloudflarestorage\.com$/i,
  /\.backblazeb2\.com$/i,
  /\.digitaloceanspaces\.com$/i,
  /\.storage\.googleapis\.com$/i,
  /^storage\.googleapis\.com$/i,
  /\.aliyuncs\.com$/i,
  /\.tigrisstorage\.cloud$/i,
];

const ALLOWED_MIME_TYPES: Record<CacheMediaType, Set<string>> = {
  image: new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']),
  audio: new Set([
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/ogg',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
  ]),
  video: new Set(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']),
};

const DEFAULT_MAX_ASSET_BYTES = 64 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getRuntimeOrigin(): string {
  const locationLike =
    typeof window !== 'undefined'
      ? window.location
      : typeof self !== 'undefined'
      ? self.location
      : null;
  return locationLike?.origin || 'http://localhost';
}

function joinPath(path: string, key: string): string {
  return key.startsWith('[') ? `${path}${key}` : `${path}.${key}`;
}

function cloneJsonLike<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function isDataMediaUrl(value: string): boolean {
  return /^data:(image|audio|video)\//i.test(value);
}

function isBlobUrl(value: string): boolean {
  return value.startsWith('blob:');
}

function isLocalUploadCandidate(value: string): boolean {
  return isDataMediaUrl(value) || isBlobUrl(value) || isVirtualMediaUrl(value);
}

function normalizeMaybeVirtualUrl(value: string): string {
  return isVirtualMediaUrl(value) ? normalizeVirtualMediaUrl(value) : value;
}

export function normalizeCreativeAssetContentUrl(value: string): string | null {
  if (!value || value.startsWith('//')) {
    return null;
  }
  try {
    const url = new URL(value, getRuntimeOrigin());
    if (url.origin !== getRuntimeOrigin()) {
      return null;
    }
    if (url.search || url.hash) {
      return null;
    }
    if (
      !/^\/creative\/api\/assets\/[A-Za-z0-9_-]{1,128}\/content$/.test(
        url.pathname
      )
    ) {
      return null;
    }
    return url.pathname;
  } catch {
    return null;
  }
}

export function isCreativeAssetContentUrl(value: string): boolean {
  return normalizeCreativeAssetContentUrl(value) !== null;
}

function hasSignedOrCredentialQuery(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    if (SIGNED_OR_CREDENTIAL_QUERY_PARAMS.has(key.toLowerCase())) {
      return true;
    }
  }
  return false;
}

function isStorageProviderHost(hostname: string): boolean {
  return STORAGE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

function getUnsafeRemoteUrlKind(value: string): string | null {
  if (!value || value.startsWith('//')) {
    return value.startsWith('//') ? 'protocol-relative-url' : null;
  }
  if (!/^https?:\/\//i.test(value)) {
    return null;
  }
  try {
    const url = new URL(value);
    if (url.username || url.password) {
      return 'url-credentials';
    }
    if (hasSignedOrCredentialQuery(url)) {
      return 'signed-query';
    }
    if (isStorageProviderHost(url.hostname)) {
      return 'object-storage-url';
    }
    if (/object[_-]?key|signed[_-]?url|bucket[_-]?url/i.test(url.pathname)) {
      return 'object-storage-detail';
    }
    return null;
  } catch {
    return null;
  }
}

function isRequiredUrlField(key: string): boolean {
  return REQUIRED_URL_FIELDS.has(key) || REQUIRED_URL_ARRAY_FIELDS.has(key);
}

function collectUnsafeAssetUrlFindings(
  value: unknown,
  options: { includeLocalOnly: boolean; includeCloudRefs?: boolean },
  path = '$',
  keyHint?: string
): AssetUrlFinding[] {
  if (typeof value === 'string') {
    const unsafeKind = getUnsafeRemoteUrlKind(value);
    if (unsafeKind) {
      return [{ path, kind: unsafeKind }];
    }
    if (
      options.includeLocalOnly &&
      keyHint &&
      isRequiredUrlField(keyHint) &&
      isLocalUploadCandidate(value)
    ) {
      return [{ path, kind: 'local-only-media-url' }];
    }
    if (
      options.includeCloudRefs &&
      keyHint &&
      isRequiredUrlField(keyHint) &&
      isCreativeAssetContentUrl(value)
    ) {
      return [{ path, kind: 'cloud-asset-ref' }];
    }
    return [];
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      collectUnsafeAssetUrlFindings(
        entry,
        options,
        joinPath(path, `[${index}]`),
        keyHint
      )
    );
  }

  return Object.entries(value).flatMap(([key, entry]) =>
    collectUnsafeAssetUrlFindings(entry, options, joinPath(path, key), key)
  );
}

export function hasRequiredCreativeAssetUploadCandidates(value: unknown): boolean {
  return (
    collectUnsafeAssetUrlFindings(value, { includeLocalOnly: true }).length > 0
  );
}

export function hasCreativeAssetContentRefs(value: unknown): boolean {
  return (
    collectUnsafeAssetUrlFindings(value, {
      includeLocalOnly: false,
      includeCloudRefs: true,
    }).length > 0
  );
}

function assertNoUnsafeRemoteUrls(value: unknown): void {
  const findings = collectUnsafeAssetUrlFindings(value, {
    includeLocalOnly: false,
  });
  if (findings.length > 0) {
    throw new CreativeAssetSyncError(
      'creative_asset_unsafe_url',
      summarizeFindings(findings)
    );
  }
}

function assertNoRequiredLocalOnlyUrls(value: unknown): void {
  const findings = collectUnsafeAssetUrlFindings(value, {
    includeLocalOnly: true,
  }).filter((finding) => finding.kind === 'local-only-media-url');
  if (findings.length > 0) {
    throw new CreativeAssetSyncError(
      'creative_asset_sync_disabled',
      summarizeFindings(findings)
    );
  }
}

export function assertNoUnsafeCreativeAssetPersistenceRefs(value: unknown): void {
  assertNoUnsafeRemoteUrls(value);
  assertNoRequiredLocalOnlyUrls(value);
}

function summarizeFindings(findings: AssetUrlFinding[]): string {
  const summary = findings
    .slice(0, 5)
    .map((finding) => `${finding.path}:${finding.kind}`)
    .join(',');
  return summary || 'unsafe_asset_reference';
}

async function rewriteRequiredUrlFields<T>(
  value: T,
  rewriter: UrlRewriter,
  path = '$',
  keyHint?: string
): Promise<T> {
  if (typeof value === 'string') {
    if (keyHint && isRequiredUrlField(keyHint)) {
      return (await rewriter(value, path)) as T;
    }
    return value;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      value[index] = await rewriteRequiredUrlFields(
        value[index],
        rewriter,
        joinPath(path, `[${index}]`),
        keyHint
      );
    }
    return value;
  }

  const record = value as Record<string, unknown>;
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry === 'string' && REQUIRED_URL_FIELDS.has(key)) {
      record[key] = await rewriter(entry, joinPath(path, key));
      continue;
    }

    if (Array.isArray(entry) && REQUIRED_URL_ARRAY_FIELDS.has(key)) {
      record[key] = await rewriteRequiredUrlFields(
        entry,
        rewriter,
        joinPath(path, key),
        key
      );
      continue;
    }

    if (entry && typeof entry === 'object') {
      record[key] = await rewriteRequiredUrlFields(
        entry,
        rewriter,
        joinPath(path, key),
        key
      );
    }
  }

  return value;
}

function dataUrlToBlob(value: string): Blob {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(value);
  if (!match) {
    throw new CreativeAssetSyncError(
      'creative_asset_blob_unavailable',
      'invalid_data_url'
    );
  }
  const mimeType = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const data = match[3] || '';
  const binary = isBase64 ? atob(data) : decodeURIComponent(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

async function fetchBlob(
  url: string,
  fetcher: typeof fetch,
  credentials: RequestCredentials = 'same-origin'
): Promise<Blob> {
  const response = await fetcher(url, {
    method: 'GET',
    credentials,
  });
  if (!response.ok) {
    throw new CreativeAssetSyncError(
      'creative_asset_blob_unavailable',
      `fetch_http_${response.status}`
    );
  }
  return await response.blob();
}

async function resolveBlobForLocalUrl(
  value: string,
  options: Required<Pick<CreativeDocumentAssetSyncOptions, 'cache' | 'fetcher'>>
): Promise<Blob> {
  if (isDataMediaUrl(value)) {
    return dataUrlToBlob(value);
  }
  if (isBlobUrl(value)) {
    return await fetchBlob(value, options.fetcher, 'same-origin');
  }
  if (isVirtualMediaUrl(value)) {
    const normalized = normalizeVirtualMediaUrl(value);
    const cached = await options.cache.getCachedBlob(normalized);
    if (cached) {
      return cached;
    }
    return await fetchBlob(normalized, options.fetcher, 'same-origin');
  }
  throw new CreativeAssetSyncError(
    'creative_asset_blob_unavailable',
    'unsupported_local_media_url'
  );
}

function inferMimeTypeFromUrl(value: string): string | null {
  const pathname = (() => {
    try {
      return new URL(value, getRuntimeOrigin()).pathname.toLowerCase();
    } catch {
      return value.toLowerCase();
    }
  })();

  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.gif')) return 'image/gif';
  if (pathname.endsWith('.mp3')) return 'audio/mpeg';
  if (pathname.endsWith('.wav')) return 'audio/wav';
  if (pathname.endsWith('.ogg') || pathname.endsWith('.oga')) return 'audio/ogg';
  if (pathname.endsWith('.webm')) return pathname.includes('/video/') ? 'video/webm' : 'audio/webm';
  if (pathname.endsWith('.m4a')) return 'audio/mp4';
  if (pathname.endsWith('.aac')) return 'audio/aac';
  if (pathname.endsWith('.mp4')) return pathname.includes('/audio/') ? 'audio/mp4' : 'video/mp4';
  if (pathname.endsWith('.mov')) return 'video/quicktime';
  if (pathname.endsWith('.m4v')) return 'video/x-m4v';
  return null;
}

function inferMediaType(mimeType: string, sourceUrl?: string): CacheMediaType {
  const normalizedMime = mimeType.toLowerCase();
  if (normalizedMime.startsWith('image/')) return 'image';
  if (normalizedMime.startsWith('audio/')) return 'audio';
  if (normalizedMime.startsWith('video/')) return 'video';
  const fallbackMime = sourceUrl ? inferMimeTypeFromUrl(sourceUrl) : null;
  if (fallbackMime) {
    return inferMediaType(fallbackMime);
  }
  throw new CreativeAssetSyncError(
    'creative_asset_unsupported_mime',
    'missing_media_mime'
  );
}

function validateAssetBlob(
  blob: Blob,
  sourceUrl: string,
  maxAssetBytes: number
): { mediaType: CacheMediaType; mimeType: string } {
  if (blob.size > maxAssetBytes) {
    throw new CreativeAssetSyncError(
      'creative_asset_size_exceeded',
      'asset_size_exceeded'
    );
  }

  const mimeType = (blob.type || inferMimeTypeFromUrl(sourceUrl) || '').toLowerCase();
  const mediaType = inferMediaType(mimeType, sourceUrl);
  if (!ALLOWED_MIME_TYPES[mediaType].has(mimeType)) {
    throw new CreativeAssetSyncError(
      'creative_asset_unsupported_mime',
      `${mediaType}_mime_not_allowed`
    );
  }

  return { mediaType, mimeType };
}

function getAssetSyncEnabled(option: boolean | undefined): boolean {
  return option ?? getCreativeAssetSyncConfig().assetSyncEnabled;
}

function getCache(option: CreativeAssetCacheLike | undefined): CreativeAssetCacheLike {
  return option || unifiedCacheService;
}

function getFetcher(option: typeof fetch | undefined): typeof fetch {
  return option || fetch;
}

async function normalizeUploadedContentUrl(value: string): Promise<string> {
  const normalized = normalizeCreativeAssetContentUrl(value);
  if (!normalized) {
    throw new CreativeAssetSyncError(
      'creative_asset_upload_failed',
      'invalid_asset_content_url'
    );
  }
  return normalized;
}

export async function prepareCreativeDocumentAssetsForSync<T>(
  payload: T,
  options: CreativeDocumentAssetSyncOptions = {}
): Promise<T> {
  const copy = cloneJsonLike(payload);
  assertNoUnsafeRemoteUrls(copy);

  if (!getAssetSyncEnabled(options.assetSyncEnabled)) {
    assertNoRequiredLocalOnlyUrls(copy);
    return copy;
  }

  const upload = options.assetAdapter?.upload;
  if (!upload) {
    throw new CreativeAssetSyncError(
      'creative_asset_upload_failed',
      'asset_upload_adapter_unavailable'
    );
  }

  const cache = getCache(options.cache);
  const fetcher = getFetcher(options.fetcher);
  const uploadPromises = new Map<string, Promise<string>>();
  const maxAssetBytes = options.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES;

  await rewriteRequiredUrlFields(copy, async (value) => {
    const normalizedCloudRef = normalizeCreativeAssetContentUrl(value);
    if (normalizedCloudRef) {
      return normalizedCloudRef;
    }

    const unsafeKind = getUnsafeRemoteUrlKind(value);
    if (unsafeKind) {
      throw new CreativeAssetSyncError(
        'creative_asset_unsafe_url',
        unsafeKind
      );
    }

    if (!isLocalUploadCandidate(value)) {
      return value;
    }

    const uploadKey = normalizeMaybeVirtualUrl(value);
    let uploadPromise = uploadPromises.get(uploadKey);
    if (!uploadPromise) {
      uploadPromise = (async () => {
        const blob = await resolveBlobForLocalUrl(value, { cache, fetcher });
        const { mediaType, mimeType } = validateAssetBlob(
          blob,
          value,
          maxAssetBytes
        );
        try {
          const contentUrl = await upload(blob, {
            mediaType,
            mimeType,
            sourceUrl: value,
          });
          return await normalizeUploadedContentUrl(contentUrl);
        } catch (error) {
          if (error instanceof CreativeAssetSyncError) {
            throw error;
          }
          throw new CreativeAssetSyncError(
            'creative_asset_upload_failed',
            'asset_upload_failed',
            error
          );
        }
      })();
      uploadPromises.set(uploadKey, uploadPromise);
    }

    return await uploadPromise;
  });

  assertNoUnsafeRemoteUrls(copy);
  assertNoRequiredLocalOnlyUrls(copy);
  return copy;
}

export async function hydrateCreativeDocumentAssets<T>(
  payload: T,
  options: CreativeDocumentAssetSyncOptions = {}
): Promise<T> {
  const copy = cloneJsonLike(payload);

  if (!hasCreativeAssetContentRefs(copy)) {
    return copy;
  }

  if (!getAssetSyncEnabled(options.assetSyncEnabled)) {
    throw new CreativeAssetSyncError(
      'creative_asset_sync_disabled',
      'cloud_asset_hydration_disabled'
    );
  }

  const download = options.assetAdapter?.download;
  if (!download) {
    throw new CreativeAssetSyncError(
      'creative_asset_download_failed',
      'asset_download_adapter_unavailable'
    );
  }

  const cache = getCache(options.cache);
  const maxAssetBytes = options.maxAssetBytes ?? DEFAULT_MAX_ASSET_BYTES;
  const hydrationPromises = new Map<string, Promise<string>>();

  await rewriteRequiredUrlFields(copy, async (value) => {
    const cloudRef = normalizeCreativeAssetContentUrl(value);
    if (!cloudRef) {
      const unsafeKind = getUnsafeRemoteUrlKind(value);
      if (unsafeKind) {
        throw new CreativeAssetSyncError(
          'creative_asset_unsafe_url',
          unsafeKind
        );
      }
      return value;
    }

    let hydrationPromise = hydrationPromises.get(cloudRef);
    if (!hydrationPromise) {
      hydrationPromise = (async () => {
        try {
          const blob = await download(cloudRef);
          const { mediaType } = validateAssetBlob(
            blob,
            cloudRef,
            maxAssetBytes
          );
          const cached = await cache.cacheLocalMediaByContent(blob, mediaType, {
            creativeCloudAssetRef: cloudRef,
          });
          return cached.url;
        } catch (error) {
          if (error instanceof CreativeAssetSyncError) {
            throw error;
          }
          throw new CreativeAssetSyncError(
            'creative_asset_download_failed',
            'asset_hydration_failed',
            error
          );
        }
      })();
      hydrationPromises.set(cloudRef, hydrationPromise);
    }

    return await hydrationPromise;
  });

  return copy;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  return text.trim() ? JSON.parse(text) : {};
}

function unwrapResponseData(payload: unknown): unknown {
  return isRecord(payload) && isRecord(payload.data) ? payload.data : payload;
}

function unwrapAssetContentUrl(payload: unknown): string | null {
  const data = unwrapResponseData(payload);
  const asset = isRecord(data) && isRecord(data.asset) ? data.asset : data;
  if (!isRecord(asset)) {
    return null;
  }
  const candidate =
    typeof asset.url === 'string'
      ? asset.url
      : typeof asset.contentUrl === 'string'
      ? asset.contentUrl
      : null;
  return candidate ? normalizeCreativeAssetContentUrl(candidate) : null;
}

function getUploadFileName(metadata?: CreativeAssetUploadMetadata): string {
  const extension = metadata?.mimeType?.split('/')[1]?.replace('jpeg', 'jpg');
  return `creative-asset.${extension || 'bin'}`;
}

export class CreativeAssetCloudAdapter implements CreativeAssetCloudAdapterLike {
  constructor(
    private readonly fetcher: typeof fetch = fetch,
    private readonly endpoint = CREATIVE_ASSETS_ENDPOINT
  ) {}

  async upload(
    blob: Blob,
    metadata: CreativeAssetUploadMetadata = {}
  ): Promise<string> {
    const formData = new FormData();
    formData.append('file', blob, getUploadFileName(metadata));
    if (metadata.mediaType) {
      formData.append('mediaType', metadata.mediaType);
    }

    const response = await this.fetcher(this.endpoint, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...getCreativeSessionAuthHeaders(),
      },
      body: formData,
    });

    if (!response.ok) {
      throw new CreativeAssetSyncError(
        response.status === 413
          ? 'creative_asset_size_exceeded'
          : 'creative_asset_upload_failed',
        `asset_upload_http_${response.status}`
      );
    }

    const contentUrl = unwrapAssetContentUrl(await readJson(response));
    if (!contentUrl) {
      throw new CreativeAssetSyncError(
        'creative_asset_upload_failed',
        'asset_upload_response_missing_content_url'
      );
    }
    return contentUrl;
  }

  async download(contentUrl: string): Promise<Blob> {
    const normalized = normalizeCreativeAssetContentUrl(contentUrl);
    if (!normalized) {
      throw new CreativeAssetSyncError(
        'creative_asset_download_failed',
        'invalid_asset_content_url'
      );
    }

    const response = await this.fetcher(normalized, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: '*/*' },
    });

    if (!response.ok) {
      const code =
        response.status === 413
          ? 'creative_asset_size_exceeded'
          : response.status === 507
          ? 'creative_asset_quota_exceeded'
          : 'creative_asset_download_failed';
      throw new CreativeAssetSyncError(code, `asset_download_http_${response.status}`);
    }

    return await response.blob();
  }
}

export const creativeAssetCloudAdapter = new CreativeAssetCloudAdapter();

export function toCreativeAssetSyncErrorStatus(
  error: unknown
): CreativeAssetSyncErrorStatus {
  if (error instanceof CreativeAssetSyncError) {
    return {
      code: error.code,
      reason: error.reason,
      recordedAt: Date.now(),
    };
  }

  return {
    code: 'creative_asset_upload_failed',
    reason: 'asset_sync_failed',
    recordedAt: Date.now(),
  };
}

export function getSafeCreativeAssetSyncErrorMessage(error: unknown): string {
  if (error instanceof CreativeAssetSyncError) {
    return `${error.code}:${error.reason}`;
  }
  if (error instanceof Error) {
    return `${error.name || 'Error'}:asset_sync_failed`;
  }
  return 'asset_sync_failed';
}
