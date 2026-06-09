const SENSITIVE_CLOUD_FIELD_NAMES = new Set([
  'apikey',
  'api_key',
  'api-key',
  'authorization',
  'access_token',
  'token',
  'internal_token',
  'internaltoken',
  'upstream_key',
  'upstreamkey',
  'channel_id',
  'channelid',
  'base_url',
  'baseurl',
  'provider',
  'providersettings',
  'provider_settings',
  'provideroverride',
  'provider_override',
  'providerprofiles',
  'provider_profiles',
  'upstream',
  'source_url',
  'sourceurl',
  'raw_source_url',
  'rawsourceurl',
  'signed_url',
  'signedurl',
  'bucket_url',
  'bucketurl',
  'bucket',
  'object_key',
  'objectkey',
  'storage_backend',
  'storagebackend',
  's3_endpoint',
  's3endpoint',
  'access_key_id',
  'accesskeyid',
  'secret_access_key',
  'secretaccesskey',
]);

export interface CreativeCloudSecretValueFinding {
  path: string;
  kind: string;
}

interface SecretValuePattern {
  kind: string;
  pattern: RegExp;
}

const HIGH_CONFIDENCE_SECRET_VALUE_PATTERNS: SecretValuePattern[] = [
  {
    kind: 'api-key',
    pattern: /\bsk-(?:proj-|test-)?[A-Za-z0-9_-]{12,}\b/i,
  },
  {
    kind: 'bearer-token',
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/i,
  },
  {
    kind: 'github-token',
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/,
  },
  {
    kind: 'private-key',
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
];

export class CreativeCloudSecretValueError extends Error {
  readonly code = 'CREATIVE_CLOUD_SECRET_VALUE_BLOCKED';
  readonly findings: CreativeCloudSecretValueFinding[];

  constructor(
    findings: CreativeCloudSecretValueFinding[],
    context = 'creative cloud payload'
  ) {
    const locations = findings
      .slice(0, 3)
      .map((finding) => `${finding.path} (${finding.kind})`)
      .join(', ');
    super(
      [
        `Blocked ${context}: high-confidence secret value detected.`,
        locations ? `Locations: ${locations}.` : '',
        'Remove secrets before cloud sync.',
      ]
        .filter(Boolean)
        .join(' ')
    );
    this.name = 'CreativeCloudSecretValueError';
    this.findings = findings.map((finding) => ({ ...finding }));
  }
}

function normalizeFieldName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s.-]/g, '_')
    .toLowerCase();
}

function isOpaqueBrowserValue(value: object): boolean {
  return (
    (typeof Blob !== 'undefined' && value instanceof Blob) ||
    (typeof File !== 'undefined' && value instanceof File) ||
    value instanceof Date
  );
}

function joinPath(path: string, key: string): string {
  if (!path) {
    return key;
  }
  return key.startsWith('[') ? `${path}${key}` : `${path}.${key}`;
}

function detectSecretValueKind(value: string): string | null {
  return (
    HIGH_CONFIDENCE_SECRET_VALUE_PATTERNS.find(({ pattern }) =>
      pattern.test(value)
    )?.kind ?? null
  );
}

export function isSensitiveCloudFieldName(name: string): boolean {
  const normalized = normalizeFieldName(name);
  return (
    SENSITIVE_CLOUD_FIELD_NAMES.has(normalized) ||
    normalized.includes('apikey') ||
    normalized.includes('api_key') ||
    normalized.includes('authorization') ||
    normalized.endsWith('_token') ||
    normalized.includes('secret') ||
    normalized.includes('credential')
  );
}

export function removeSensitiveCloudFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => removeSensitiveCloudFields(item)) as T;
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  if (isOpaqueBrowserValue(value)) {
    return value;
  }

  return Object.entries(value as Record<string, unknown>).reduce<
    Record<string, unknown>
  >((acc, [key, entry]) => {
    if (!isSensitiveCloudFieldName(key)) {
      acc[key] = removeSensitiveCloudFields(entry);
    }
    return acc;
  }, {}) as T;
}

export function findHighConfidenceCreativeCloudSecretValues(
  value: unknown,
  path = '$'
): CreativeCloudSecretValueFinding[] {
  if (typeof value === 'string') {
    const kind = detectSecretValueKind(value);
    return kind ? [{ path, kind }] : [];
  }

  if (!value || typeof value !== 'object') {
    return [];
  }

  if (isOpaqueBrowserValue(value)) {
    return [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findHighConfidenceCreativeCloudSecretValues(
        entry,
        joinPath(path, `[${index}]`)
      )
    );
  }

  return Object.entries(value).flatMap(([key, entry]) =>
    findHighConfidenceCreativeCloudSecretValues(entry, joinPath(path, key))
  );
}

export function assertNoHighConfidenceCreativeCloudSecretValues(
  value: unknown,
  context?: string
): void {
  const findings = findHighConfidenceCreativeCloudSecretValues(value);
  if (findings.length > 0) {
    throw new CreativeCloudSecretValueError(findings, context);
  }
}
