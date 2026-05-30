import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import { redactText } from './redaction';
import { FakePgDumpRunner, runDatabaseBackup } from './db-backup';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe('database backup script core', () => {
  it('writes a dry-run manifest without reading database credentials', async () => {
    const outputDir = await tempBackupDir();

    const result = await runDatabaseBackup({
      mode: 'dry-run',
      now: fixedClock(),
      outputDir,
      pgDumpBin: 'pg_dump',
      retentionDays: 7,
    });

    const latest = JSON.parse(await readFile(result.latestPath, 'utf8'));
    expect(result.manifest).toMatchObject({
      databaseHostHash: null,
      databaseNameHash: null,
      dryRun: true,
      errorCode: null,
      errorMessage: null,
      mode: 'dry-run',
      pgDumpVersion: null,
      retentionDays: 7,
      status: 'succeeded',
    });
    expect(latest).toEqual(result.manifest);
    await expect(stat(result.dumpPath)).resolves.toMatchObject({
      size: expect.any(Number),
    });
    expect(result.manifest.sizeBytes).toBeGreaterThan(0);
  });

  it('uses fake pg_dump to create dump, manifest, latest status, size, and checksum', async () => {
    const outputDir = await tempBackupDir();

    const result = await runDatabaseBackup(
      {
        mode: 'test-fake-pg-dump',
        now: fixedClock(),
        outputDir,
        pgDumpBin: 'pg_dump',
        retentionDays: 7,
      },
      new FakePgDumpRunner()
    );

    const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
    const latest = JSON.parse(await readFile(result.latestPath, 'utf8'));
    expect(manifest).toEqual(result.manifest);
    expect(latest).toEqual(result.manifest);
    expect(result.manifest).toMatchObject({
      dryRun: true,
      errorCode: null,
      errorMessage: null,
      mode: 'test-fake-pg-dump',
      pgDumpVersion: 'fake-pg_dump 0.0.0',
      retentionDays: 7,
      status: 'succeeded',
    });
    expect(result.manifest.dumpFile).toMatch(
      /mengtu-db-20260531T010203Z\.dump$/
    );
    expect(result.manifest.manifestFile).toMatch(
      /mengtu-db-20260531T010203Z\.manifest\.json$/
    );
    expect(result.manifest.sizeBytes).toBeGreaterThan(0);
    expect(result.manifest.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('redacts database credentials and provider-style secrets from failures', async () => {
    const outputDir = await tempBackupDir();
    const username = ['db', 'user'].join('_');
    const password = ['super-secret', 'password'].join('-');
    const databaseUrl = [
      'postgres://',
      username,
      ':',
      password,
      '@localhost:5432/mengtu_test',
    ].join('');

    const result = await runDatabaseBackup({
      databaseUrl,
      executionConfirmed: false,
      mode: 'dump',
      now: fixedClock(),
      outputDir,
      pgDumpBin: 'pg_dump',
      retentionDays: 7,
    });

    const serialized = JSON.stringify(result.manifest);
    expect(result.manifest.status).toBe('failed');
    expect(result.manifest.errorCode).toBe('BACKUP_EXECUTION_NOT_CONFIRMED');
    expect(serialized).not.toContain(databaseUrl);
    expect(serialized).not.toContain(username);
    expect(serialized).not.toContain(password);
    expect(redactText('api_key=sk-test-1234567890')).toBe('api_key=[REDACTED]');
  });
});

async function tempBackupDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'mengtu-db-backup-'));
  tempDirs.push(dir);
  return dir;
}

function fixedClock(): () => Date {
  return () => new Date('2026-05-31T01:02:03.000Z');
}
