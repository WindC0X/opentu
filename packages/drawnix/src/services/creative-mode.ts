export const CREATIVE_MANAGED_PROFILE_ID = 'new-api-creative';
export const CREATIVE_MANAGED_PROFILE_NAME = 'New API Creative';
export const CREATIVE_RELAY_BASE_URL = '/creative/relay/v1';
export const CREATIVE_BOOTSTRAP_ENDPOINT = '/creative/api/bootstrap';
export const CREATIVE_MODELS_ENDPOINT = '/creative/api/models';
export const CREATIVE_MODEL_PREFERENCE_ENDPOINT =
  '/creative/api/preferences/model';
export const CREATIVE_MANAGED_CATALOG_UPDATED_EVENT =
  'creative:managed-catalog-updated';
export const CREATIVE_DOCUMENTS_ENDPOINT = '/creative/api/documents';
export const CREATIVE_ASSETS_ENDPOINT = '/creative/api/assets';
export const CREATIVE_CSRF_HEADER = 'X-Creative-CSRF';
export const CREATIVE_NONCE_HEADER = 'X-Creative-Nonce';

export interface CreativeSessionAuthMaterial {
  csrfToken: string;
  nonce: string;
}

let creativeSessionAuthMaterial: CreativeSessionAuthMaterial | null = null;

export interface CreativeAssetSyncConfig {
  assetSyncEnabled: boolean;
  disabledReason?: string;
}

let creativeAssetSyncConfig: CreativeAssetSyncConfig = {
  assetSyncEnabled: false,
  disabledReason: 'bootstrap_pending',
};

function normalizeSessionAuthValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function setCreativeSessionAuthMaterial(
  material: Partial<CreativeSessionAuthMaterial> | null | undefined
): void {
  const csrfToken = normalizeSessionAuthValue(material?.csrfToken);
  const nonce = normalizeSessionAuthValue(material?.nonce);
  creativeSessionAuthMaterial =
    csrfToken && nonce ? { csrfToken, nonce } : null;
}

export function clearCreativeSessionAuthMaterial(): void {
  creativeSessionAuthMaterial = null;
}

export function getCreativeSessionAuthMaterial():
  | CreativeSessionAuthMaterial
  | null {
  return creativeSessionAuthMaterial
    ? { ...creativeSessionAuthMaterial }
    : null;
}

export function getCreativeSessionAuthHeaders(): Record<string, string> {
  const material = getCreativeSessionAuthMaterial();
  if (!material) {
    return {};
  }
  return {
    [CREATIVE_CSRF_HEADER]: material.csrfToken,
    [CREATIVE_NONCE_HEADER]: material.nonce,
  };
}

export function requireCreativeSessionAuthHeaders(): Record<string, string> {
  const headers = getCreativeSessionAuthHeaders();
  if (!headers[CREATIVE_CSRF_HEADER] || !headers[CREATIVE_NONCE_HEADER]) {
    throw new Error(
      'Creative unsafe mutation requires CSRF and nonce session auth material'
    );
  }
  return headers;
}

function normalizeDisabledReason(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  const trimmed = value.trim();
  if (
    /https?:|blob:|data:|bucket|object[_-]?key|secret|token|signature|credential|access[_-]?key/i.test(
      trimmed
    )
  ) {
    return 'disabled';
  }
  return trimmed.replace(/[^\w:.-]+/g, '_').slice(0, 120);
}

export function setCreativeAssetSyncConfig(
  config: Partial<CreativeAssetSyncConfig> | null | undefined
): void {
  creativeAssetSyncConfig = {
    assetSyncEnabled: config?.assetSyncEnabled === true,
    ...(normalizeDisabledReason(config?.disabledReason)
      ? { disabledReason: normalizeDisabledReason(config?.disabledReason) }
      : config?.assetSyncEnabled === true
      ? {}
      : { disabledReason: 'disabled' }),
  };
}

export function getCreativeAssetSyncConfig(): CreativeAssetSyncConfig {
  return { ...creativeAssetSyncConfig };
}

export function resetCreativeAssetSyncConfigForTests(): void {
  creativeAssetSyncConfig = {
    assetSyncEnabled: false,
    disabledReason: 'bootstrap_pending',
  };
}

export function isCreativeEmbeddedMode(
  locationLike: Pick<Location, 'pathname'> | null | undefined =
    typeof window !== 'undefined' ? window.location : null
): boolean {
  const pathname = locationLike?.pathname || '';
  return pathname === '/creative' || pathname.startsWith('/creative/');
}
