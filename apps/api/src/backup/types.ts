export type DatabaseBackupMode = 'dry-run' | 'test-fake-pg-dump' | 'dump';

export type DatabaseBackupStatus = 'succeeded' | 'failed';

export interface DatabaseBackupManifest {
  status: DatabaseBackupStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outputDir: string;
  dumpFile: string;
  manifestFile: string;
  sizeBytes: number | null;
  sha256: string | null;
  pgDumpVersion: string | null;
  databaseHostHash: string | null;
  databaseNameHash: string | null;
  retentionDays: number;
  mode: DatabaseBackupMode;
  dryRun: boolean;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface DatabaseBackupRunOptions {
  databaseUrl?: string;
  executionConfirmed?: boolean;
  mode: DatabaseBackupMode;
  now?: () => Date;
  outputDir: string;
  pgDumpBin: string;
  retentionDays: number;
}

export interface DatabaseBackupRunResult {
  dumpPath: string;
  latestPath: string;
  manifest: DatabaseBackupManifest;
  manifestPath: string;
}

export interface PgDumpRequest {
  databaseUrl: string;
  dumpFile: string;
  pgDumpBin: string;
}

export interface PgDumpRunner {
  dump(request: PgDumpRequest): Promise<void>;
  version(pgDumpBin: string): Promise<string>;
}
