import { loadConfig } from '../src/config';
import {
  FakePgDumpRunner,
  modeFromFlags,
  runDatabaseBackup,
} from '../src/backup/db-backup';

async function main(): Promise<void> {
  if (process.argv.includes('--help')) {
    printHelp();
    return;
  }

  const mode = modeFromFlags(process.argv.slice(2));
  const config = loadConfig(process.env);
  const result = await runDatabaseBackup(
    {
      databaseUrl: mode === 'dump' ? process.env.DATABASE_URL : undefined,
      executionConfirmed: process.env.MENGTU_DB_BACKUP_EXECUTE === '1',
      mode,
      outputDir: config.dbBackupOutputDir,
      pgDumpBin: config.dbBackupPgDumpBin,
      retentionDays: config.dbBackupRetentionDays,
    },
    mode === 'test-fake-pg-dump' ? new FakePgDumpRunner() : undefined
  );

  const output = JSON.stringify(result.manifest, null, 2);
  if (result.manifest.status === 'succeeded') {
    console.log(output);
    return;
  }

  console.error(output);
  process.exitCode = 1;
}

function printHelp(): void {
  console.log(`Usage: db-backup [--dry-run | --test-fake-pg-dump]

Modes:
  --dry-run             Write dry-run manifest/status without reading DATABASE_URL or running pg_dump.
  --test-fake-pg-dump   Generate a local fake dump and manifest without connecting to a database.

Real dump mode requires MENGTU_DB_BACKUP_EXECUTE=1, DATABASE_URL, and a local/test database host.`);
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown backup failure.';
  console.error(
    JSON.stringify(
      {
        errorCode: 'BACKUP_COMMAND_FAILED',
        errorMessage: message,
      },
      null,
      2
    )
  );
  process.exitCode = 1;
});
