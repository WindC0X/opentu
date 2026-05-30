import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

import {
  assertNoKnownSecretLeak,
  databaseMetadataFromUrl,
  redactText,
} from './redaction';
import type {
  DatabaseBackupManifest,
  DatabaseBackupMode,
  DatabaseBackupRunOptions,
  DatabaseBackupRunResult,
  PgDumpRequest,
  PgDumpRunner,
} from './types';

const DEFAULT_RETENTION_DAYS = 7;

export class DatabaseBackupError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly secretValues: string[] = []
  ) {
    super(message);
    this.name = 'DatabaseBackupError';
  }
}

export async function runDatabaseBackup(
  options: DatabaseBackupRunOptions,
  runner: PgDumpRunner = new RealPgDumpRunner()
): Promise<DatabaseBackupRunResult> {
  const started = options.now?.() ?? new Date();
  const outputDir = resolve(options.outputDir);
  const baseName = `mengtu-db-${formatBackupTimestamp(started)}`;
  const dumpPath = join(outputDir, `${baseName}.dump`);
  const manifestPath = join(outputDir, `${baseName}.manifest.json`);
  const latestPath = join(outputDir, 'latest.json');
  const retentionDays = positiveInteger(
    options.retentionDays,
    DEFAULT_RETENTION_DAYS
  );
  const secretValues: string[] = [];
  let databaseHostHash: string | null = null;
  let databaseNameHash: string | null = null;
  let pgDumpVersion: string | null = null;
  let status: DatabaseBackupManifest['status'] = 'succeeded';
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  await mkdir(outputDir, { recursive: true });

  try {
    if (options.mode === 'dry-run') {
      await writeFile(
        dumpPath,
        'dry-run: no database connection was opened and pg_dump was not executed.\n',
        'utf8'
      );
    } else if (options.mode === 'test-fake-pg-dump') {
      pgDumpVersion = await runner.version(options.pgDumpBin);
      await runner.dump({
        databaseUrl: 'postgres://fake-local/[REDACTED]',
        dumpFile: dumpPath,
        pgDumpBin: options.pgDumpBin,
      });
    } else {
      if (!options.executionConfirmed) {
        throw new DatabaseBackupError(
          'BACKUP_EXECUTION_NOT_CONFIRMED',
          'Set MENGTU_DB_BACKUP_EXECUTE=1 before running a real database dump.'
        );
      }
      if (!options.databaseUrl) {
        throw new DatabaseBackupError(
          'DATABASE_URL_REQUIRED',
          'DATABASE_URL is required for a real database dump.'
        );
      }
      assertLocalDatabaseUrl(options.databaseUrl);
      const metadata = databaseMetadataFromUrl(options.databaseUrl);
      secretValues.push(...metadata.secretValues);
      databaseHostHash = metadata.databaseHostHash;
      databaseNameHash = metadata.databaseNameHash;
      pgDumpVersion = await runner.version(options.pgDumpBin);
      await runner.dump({
        databaseUrl: options.databaseUrl,
        dumpFile: dumpPath,
        pgDumpBin: options.pgDumpBin,
      });
    }
  } catch (error) {
    const backupError = toDatabaseBackupError(error);
    status = 'failed';
    errorCode = backupError.code;
    secretValues.push(...backupError.secretValues);
    errorMessage = redactText(backupError.message, secretValues);
  }

  const fileStats = await fileMetadata(dumpPath);
  const finished = options.now?.() ?? new Date();
  const manifest: DatabaseBackupManifest = {
    status,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: Math.max(0, finished.getTime() - started.getTime()),
    outputDir,
    dumpFile: dumpPath,
    manifestFile: manifestPath,
    sizeBytes: fileStats.sizeBytes,
    sha256: fileStats.sha256,
    pgDumpVersion,
    databaseHostHash,
    databaseNameHash,
    retentionDays,
    mode: options.mode,
    dryRun: options.mode !== 'dump',
    errorCode,
    errorMessage,
  };

  assertNoKnownSecretLeak(manifest, secretValues);
  await writeJsonAtomic(manifestPath, manifest);
  await writeJsonAtomic(latestPath, manifest);

  return {
    dumpPath,
    latestPath,
    manifest,
    manifestPath,
  };
}

export class RealPgDumpRunner implements PgDumpRunner {
  async version(pgDumpBin: string): Promise<string> {
    const result = await runCommand(pgDumpBin, ['--version'], {});
    return redactText(result.stdout.trim() || result.stderr.trim());
  }

  async dump(request: PgDumpRequest): Promise<void> {
    const metadata = databaseMetadataFromUrl(request.databaseUrl);
    await runCommand(
      request.pgDumpBin,
      ['--format=custom', '--file', request.dumpFile],
      {
        env: metadata.env,
        secretValues: metadata.secretValues,
      }
    );
  }
}

export class FakePgDumpRunner implements PgDumpRunner {
  async version(): Promise<string> {
    return 'fake-pg_dump 0.0.0';
  }

  async dump(request: PgDumpRequest): Promise<void> {
    await writeFile(
      request.dumpFile,
      `fake pg_dump output for ${basename(request.dumpFile)}\n`,
      'utf8'
    );
  }
}

export function modeFromFlags(args: string[]): DatabaseBackupMode {
  const dryRun = args.includes('--dry-run');
  const fakePgDump = args.includes('--test-fake-pg-dump');
  if (dryRun && fakePgDump) {
    throw new DatabaseBackupError(
      'BACKUP_MODE_CONFLICT',
      'Use only one backup mode flag.'
    );
  }
  if (dryRun) {
    return 'dry-run';
  }
  if (fakePgDump) {
    return 'test-fake-pg-dump';
  }
  return 'dump';
}

function assertLocalDatabaseUrl(databaseUrl: string): void {
  if (process.env.NODE_ENV === 'production') {
    throw new DatabaseBackupError(
      'BACKUP_PRODUCTION_ENV_FORBIDDEN',
      'Refusing to run a database dump while NODE_ENV=production.'
    );
  }

  const metadata = databaseMetadataFromUrl(databaseUrl);
  const host = metadata.env.PGHOST?.toLowerCase() ?? '';
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
    throw new DatabaseBackupError(
      'BACKUP_DATABASE_NOT_LOCAL',
      'Real database dump is limited to local or test database hosts.',
      metadata.secretValues
    );
  }
}

async function fileMetadata(
  filePath: string
): Promise<{ sha256: string | null; sizeBytes: number | null }> {
  try {
    const [fileStat, body] = await Promise.all([
      stat(filePath),
      readFile(filePath),
    ]);
    return {
      sha256: createHash('sha256').update(body).digest('hex'),
      sizeBytes: fileStat.size,
    };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      return {
        sha256: null,
        sizeBytes: null,
      };
    }
    throw error;
  }
}

function formatBackupTimestamp(date: Date): string {
  return date
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[-:]/g, '');
}

function positiveInteger(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

async function writeJsonAtomic(
  filePath: string,
  value: DatabaseBackupManifest
): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
}

interface CommandResult {
  stderr: string;
  stdout: string;
}

function runCommand(
  command: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; secretValues?: string[] }
): Promise<CommandResult> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      env: {
        ...process.env,
        ...options.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      rejectCommand(
        new DatabaseBackupError(
          'PG_DUMP_SPAWN_FAILED',
          redactText(error.message, options.secretValues ?? []),
          options.secretValues
        )
      );
    });
    child.on('close', (code) => {
      const safeStderr = redactText(stderr, options.secretValues ?? []);
      if (code === 0) {
        resolveCommand({
          stderr: safeStderr,
          stdout: redactText(stdout, options.secretValues ?? []),
        });
        return;
      }
      rejectCommand(
        new DatabaseBackupError(
          'PG_DUMP_FAILED',
          safeStderr || `pg_dump exited with code ${code ?? 'unknown'}.`,
          options.secretValues
        )
      );
    });
  });
}

function toDatabaseBackupError(error: unknown): DatabaseBackupError {
  if (error instanceof DatabaseBackupError) {
    return error;
  }
  if (error instanceof Error) {
    return new DatabaseBackupError('BACKUP_FAILED', error.message);
  }
  return new DatabaseBackupError('BACKUP_FAILED', 'Unknown backup failure.');
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
