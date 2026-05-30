import { createHash } from 'node:crypto';

export interface DatabaseUrlMetadata {
  databaseHostHash: string | null;
  databaseNameHash: string | null;
  env: NodeJS.ProcessEnv;
  secretValues: string[];
}

export function hashDatabaseIdentifier(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return `sha256:${createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, 16)}`;
}

export function databaseMetadataFromUrl(
  databaseUrl: string
): DatabaseUrlMetadata {
  const parsed = new URL(databaseUrl);
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  const username = decodeURIComponent(parsed.username);
  const password = decodeURIComponent(parsed.password);
  const env: NodeJS.ProcessEnv = {
    PGDATABASE: databaseName,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || undefined,
    PGUSER: username || undefined,
    PGPASSWORD: password || undefined,
  };
  const secretValues = [
    databaseUrl,
    parsed.href,
    parsed.username,
    parsed.password,
    username,
    password,
  ].filter((value): value is string => Boolean(value));

  return {
    databaseHostHash: hashDatabaseIdentifier(parsed.hostname),
    databaseNameHash: hashDatabaseIdentifier(databaseName || null),
    env,
    secretValues,
  };
}

export function redactText(
  value: string | null | undefined,
  explicitSecrets: string[] = []
): string {
  if (!value) {
    return '';
  }

  let redacted = value;
  for (const secret of explicitSecrets) {
    if (!secret) {
      continue;
    }
    redacted = redacted.split(secret).join('[REDACTED]');
  }

  return redacted
    .replace(/postgres(?:ql)?:\/\/[^@\s]+@/gi, 'postgres://[REDACTED]@')
    .replace(
      /\b(password|passwd|pwd|secret|api[_-]?key|token|credential)=([^\s&]+)/gi,
      '$1=[REDACTED]'
    )
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[REDACTED]');
}

export function assertNoKnownSecretLeak(
  value: unknown,
  explicitSecrets: string[]
): void {
  const serialized = JSON.stringify(value);
  for (const secret of explicitSecrets) {
    if (secret && serialized.includes(secret)) {
      throw new Error('Database backup output contains an unredacted secret.');
    }
  }
}
