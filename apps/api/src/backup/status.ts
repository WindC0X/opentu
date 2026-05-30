import { readFile } from 'node:fs/promises';
import { basename, join, normalize, resolve } from 'node:path';

import { redactText } from './redaction';
import type { DatabaseBackupManifest, DatabaseBackupMode } from './types';

export interface DatabaseBackupStatusView {
  databaseHostHash: string | null;
  databaseNameHash: string | null;
  dryRun: boolean;
  dumpFile: string;
  durationMs: number;
  errorCode: string | null;
  errorMessage: string | null;
  finishedAt: string;
  manifestFile: string;
  mode: DatabaseBackupMode;
  outputDir: string;
  pgDumpVersion: string | null;
  retentionDays: number;
  sha256: string | null;
  sizeBytes: number | null;
  startedAt: string;
  status: DatabaseBackupManifest['status'];
}

export interface DatabaseBackupStatusReader {
  readLatest(): Promise<DatabaseBackupStatusView>;
}

export class DatabaseBackupStatusError extends Error {
  constructor(
    public readonly code:
      | 'BACKUP_STATUS_NOT_FOUND'
      | 'BACKUP_STATUS_UNAVAILABLE',
    public readonly status: 404 | 500,
    message: string
  ) {
    super(message);
    this.name = 'DatabaseBackupStatusError';
  }
}

export class FileDatabaseBackupStatusReader
  implements DatabaseBackupStatusReader
{
  constructor(private readonly outputDir: string) {}

  async readLatest(): Promise<DatabaseBackupStatusView> {
    return readLatestDatabaseBackupStatus(this.outputDir);
  }
}

export async function readLatestDatabaseBackupStatus(
  outputDir: string
): Promise<DatabaseBackupStatusView> {
  const resolvedOutputDir = resolve(outputDir);
  const latestPath = join(resolvedOutputDir, 'latest.json');
  let raw: string;

  try {
    raw = await readFile(latestPath, 'utf8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new DatabaseBackupStatusError(
        'BACKUP_STATUS_NOT_FOUND',
        404,
        '暂无备份记录'
      );
    }
    throw new DatabaseBackupStatusError(
      'BACKUP_STATUS_UNAVAILABLE',
      500,
      '备份状态暂不可用'
    );
  }

  try {
    return sanitizeManifest(
      parseManifest(raw),
      outputDir,
      resolvedOutputDir
    );
  } catch (error) {
    if (error instanceof DatabaseBackupStatusError) {
      throw error;
    }
    throw new DatabaseBackupStatusError(
      'BACKUP_STATUS_UNAVAILABLE',
      500,
      '备份状态暂不可用'
    );
  }
}

function parseManifest(raw: string): DatabaseBackupManifest {
  const parsed = JSON.parse(raw) as unknown;
  if (!isObject(parsed)) {
    throw new Error('latest backup status must be an object');
  }

  const status = requireStatus(parsed.status);
  const mode = requireMode(parsed.mode);
  return {
    databaseHostHash: nullableString(parsed.databaseHostHash),
    databaseNameHash: nullableString(parsed.databaseNameHash),
    dryRun: requireBoolean(parsed.dryRun),
    dumpFile: requireString(parsed.dumpFile),
    durationMs: requireNumber(parsed.durationMs),
    errorCode: nullableString(parsed.errorCode),
    errorMessage: nullableString(parsed.errorMessage),
    finishedAt: requireString(parsed.finishedAt),
    manifestFile: requireString(parsed.manifestFile),
    mode,
    outputDir: requireString(parsed.outputDir),
    pgDumpVersion: nullableString(parsed.pgDumpVersion),
    retentionDays: requireNumber(parsed.retentionDays),
    sha256: nullableString(parsed.sha256),
    sizeBytes: nullableNumber(parsed.sizeBytes),
    startedAt: requireString(parsed.startedAt),
    status,
  };
}

function sanitizeManifest(
  manifest: DatabaseBackupManifest,
  configuredOutputDir: string,
  resolvedOutputDir: string
): DatabaseBackupStatusView {
  return {
    databaseHostHash: manifest.databaseHostHash,
    databaseNameHash: manifest.databaseNameHash,
    dryRun: manifest.dryRun,
    dumpFile: basename(manifest.dumpFile),
    durationMs: manifest.durationMs,
    errorCode: manifest.errorCode,
    errorMessage: manifest.errorMessage
      ? redactText(manifest.errorMessage)
      : null,
    finishedAt: manifest.finishedAt,
    manifestFile: basename(manifest.manifestFile),
    mode: manifest.mode,
    outputDir: displayOutputDir(
      manifest.outputDir,
      configuredOutputDir,
      resolvedOutputDir
    ),
    pgDumpVersion: manifest.pgDumpVersion
      ? redactText(manifest.pgDumpVersion)
      : null,
    retentionDays: manifest.retentionDays,
    sha256: manifest.sha256,
    sizeBytes: manifest.sizeBytes,
    startedAt: manifest.startedAt,
    status: manifest.status,
  };
}

function displayOutputDir(
  manifestOutputDir: string,
  configuredOutputDir: string,
  resolvedOutputDir: string
): string {
  return (
    dataRelativePath(configuredOutputDir) ??
    dataRelativePath(manifestOutputDir) ??
    dataRelativePath(resolvedOutputDir) ??
    basename(resolvedOutputDir)
  );
}

function dataRelativePath(value: string): string | null {
  const normalized = normalize(value).replace(/\\/g, '/');
  const dataIndex = normalized.indexOf('/.data/');
  if (dataIndex >= 0) {
    return normalized.slice(dataIndex + 1);
  }
  if (normalized.startsWith('.data/')) {
    return normalized;
  }
  const relativeDataIndex = normalized.indexOf('.data/');
  if (relativeDataIndex >= 0) {
    return normalized.slice(relativeDataIndex);
  }
  return null;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('backup status field must be a string');
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) {
    return null;
  }
  return requireString(value);
}

function requireNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error('backup status field must be a number');
  }
  return value;
}

function nullableNumber(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  return requireNumber(value);
}

function requireBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new Error('backup status field must be a boolean');
  }
  return value;
}

function requireStatus(value: unknown): DatabaseBackupManifest['status'] {
  if (value === 'succeeded' || value === 'failed') {
    return value;
  }
  throw new Error('backup status is invalid');
}

function requireMode(value: unknown): DatabaseBackupMode {
  if (
    value === 'dry-run' ||
    value === 'test-fake-pg-dump' ||
    value === 'dump'
  ) {
    return value;
  }
  throw new Error('backup mode is invalid');
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
