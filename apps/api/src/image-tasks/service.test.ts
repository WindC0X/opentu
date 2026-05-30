import { describe, expect, it } from 'vitest';

import { DEFAULT_TENANT_ID } from '../auth/types';
import { StaticProviderCredentialResolver } from '../providers/credentials';
import type {
  ImageProviderAdapter,
  ImageProviderExecutionInput,
  ImageProviderLateResultInput,
  ImageProviderResult,
} from '../providers/types';
import { AppError } from '../errors';
import {
  createTestAppContext,
  createUserWithQuota,
  seedTestGrsaiModel,
  seedTestQuota,
  TEST_GRSAI_MODEL_KEY,
  TEST_GRSAI_PROVIDER_CONFIG_ID,
  TEST_GRSAI_PROVIDER_MODEL_ID,
} from '../test/helpers';

describe('S12 late provider result reconciliation', () => {
  it('recovers late success with held quota and is idempotent on duplicate reconciliation', async () => {
    const secret = 'q46-secret-token';
    const adapter = new FakeLateResultAdapter(async () =>
      successfulResult({
        providerRequestId: 'late-req-success',
        responseSnapshot: {
          echoedCredential: secret,
          bearer: `Bearer ${secret}`,
          providerStatus: 'succeeded',
        },
      })
    );
    const { auth, context, taskId } = await createRecoverableTask(adapter, secret);

    const result = await context.imageTaskService.reconcileLateProviderResult(
      auth,
      taskId
    );

    expect(result.status).toBe('recovered');
    expect(result.providerRequestId).toBe('late-req-success');
    expect(result.task).toMatchObject({
      assets: [expect.objectContaining({ aiGenerated: true })],
      settledPriceAmount: 10,
      status: 'succeeded',
      successCount: 1,
    });
    expect(adapter.executeCalls).toHaveLength(0);
    expect(adapter.recoverCalls).toHaveLength(1);

    const task = context.imageTaskRepository.tasks.get(taskId);
    expect(task?.providerUsageId).toBeTruthy();
    const recoveredUsage = context.imageTaskRepository.providerUsage.get(
      task!.providerUsageId!
    );
    expect(recoveredUsage).toMatchObject({
      requestId: 'late-req-success',
      status: 'succeeded',
    });
    expect(JSON.stringify(recoveredUsage)).not.toContain(secret);
    expect(JSON.stringify(recoveredUsage)).not.toContain(`Bearer ${secret}`);

    const account = await context.repository.findQuotaAccountByUserId(
      DEFAULT_TENANT_ID,
      auth.user.id
    );
    expect(account).toMatchObject({ balanceAmount: 90, heldAmount: 0 });
    expect([...context.repository.quotaLedger.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 10, entryType: 'hold' }),
        expect.objectContaining({ amount: 10, entryType: 'consume' }),
      ])
    );

    const assetCount = context.assetRepository.assets.size;
    const ledgerCount = context.repository.quotaLedger.size;
    const usageCount = context.imageTaskRepository.providerUsage.size;
    const duplicate =
      await context.imageTaskService.reconcileLateProviderResult(auth, taskId);

    expect(duplicate.status).toBe('already_succeeded');
    expect(context.assetRepository.assets.size).toBe(assetCount);
    expect(context.repository.quotaLedger.size).toBe(ledgerCount);
    expect(context.imageTaskRepository.providerUsage.size).toBe(usageCount);
    expect(adapter.recoverCalls).toHaveLength(1);
  });

  it.each([
    {
      name: 'missing result URL',
      result: failedResult('PROVIDER_EMPTY_RESULT', 'Provider returned no URL'),
      reason: 'PROVIDER_EMPTY_RESULT',
    },
    {
      name: 'provider failed',
      result: failedResult('PROVIDER_FAILED', 'Provider failed'),
      reason: 'PROVIDER_FAILED',
    },
    {
      name: 'provider violation',
      result: failedResult('PROVIDER_VIOLATION', 'Provider violation'),
      reason: 'PROVIDER_VIOLATION',
    },
    {
      name: 'provider timeout',
      result: failedResult('PROVIDER_TIMEOUT', 'Provider timed out', 'timeout'),
      reason: 'PROVIDER_TIMEOUT',
    },
  ])('keeps the task non-successful for $name', async ({ result, reason }) => {
    const adapter = new FakeLateResultAdapter(async () => result);
    const { auth, context, taskId } = await createRecoverableTask(
      adapter,
      'q46-secret-token'
    );

    const reconciled =
      await context.imageTaskService.reconcileLateProviderResult(auth, taskId);

    expect(reconciled).toMatchObject({
      reason,
      status: 'not_recoverable',
    });
    expect(reconciled.task).toMatchObject({
      assets: [],
      status: 'running',
      successCount: 0,
    });
    expect(context.imageTaskRepository.providerUsage.size).toBe(1);
    expect([...context.repository.quotaLedger.values()]).toEqual([
      expect.objectContaining({ amount: 10, entryType: 'hold' }),
    ]);
  });

  it('handles late result download failure without consuming quota', async () => {
    const adapter = new FakeLateResultAdapter(async () => {
      throw new AppError(
        'PROVIDER_RESULT_DOWNLOAD_FAILED',
        502,
        'Provider result image download failed for Bearer q46-secret-token'
      );
    });
    const { auth, context, taskId } = await createRecoverableTask(
      adapter,
      'q46-secret-token'
    );

    const reconciled =
      await context.imageTaskService.reconcileLateProviderResult(auth, taskId);

    expect(reconciled).toMatchObject({
      reason: 'PROVIDER_RESULT_DOWNLOAD_FAILED',
      status: 'not_recoverable',
    });
    expect(reconciled.task).toMatchObject({
      assets: [],
      status: 'running',
    });
    const account = await context.repository.findQuotaAccountByUserId(
      DEFAULT_TENANT_ID,
      auth.user.id
    );
    expect(account).toMatchObject({ balanceAmount: 90, heldAmount: 10 });
    expect(providerUsageSnapshot(context)).not.toContain('q46-secret-token');
  });

  it('blocks late success when held quota is no longer available', async () => {
    const adapter = new FakeLateResultAdapter(async () =>
      successfulResult({ providerRequestId: 'late-req-success' })
    );
    const { auth, context, taskId } = await createRecoverableTask(
      adapter,
      'q46-secret-token'
    );
    const account = await context.repository.findQuotaAccountByUserId(
      DEFAULT_TENANT_ID,
      auth.user.id
    );
    await context.repository.updateQuotaAccount(account!.id, {
      balanceAmount: account!.balanceAmount,
      heldAmount: 0,
    });

    const usageCount = context.imageTaskRepository.providerUsage.size;
    const reconciled =
      await context.imageTaskService.reconcileLateProviderResult(auth, taskId);

    expect(reconciled).toMatchObject({
      providerRequestId: 'late-req-success',
      reason: 'insufficient_held_quota',
      status: 'blocked_released',
    });
    expect(reconciled.task).toMatchObject({
      assets: [],
      status: 'running',
      successCount: 0,
    });
    expect(context.imageTaskRepository.providerUsage.size).toBe(usageCount);
    expect([...context.repository.quotaLedger.values()]).toEqual([
      expect.objectContaining({ amount: 10, entryType: 'hold' }),
    ]);
  });

  it('blocks already failed and released tasks instead of converting them to succeeded plus consume', async () => {
    const adapter = new FakeLateResultAdapter(
      async () => successfulResult({ providerRequestId: 'late-req-released' }),
      async () =>
        failedResult(
          'PROVIDER_TIMEOUT',
          'Provider timed out',
          'timeout',
          'late-req-released'
        )
    );
    const { auth, context, taskId } = await createAutoFailedTask(
      adapter,
      'q46-secret-token'
    );

    const reconciled =
      await context.imageTaskService.reconcileLateProviderResult(auth, taskId);

    expect(reconciled).toMatchObject({
      providerRequestId: 'late-req-released',
      reason: 'task_already_finalized_without_held_quota',
      status: 'blocked_released',
    });
    expect(reconciled.task).toMatchObject({
      assets: [],
      status: 'failed',
      successCount: 0,
    });
    expect(adapter.recoverCalls).toHaveLength(0);
    expect([...context.repository.quotaLedger.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: 10, entryType: 'hold' }),
        expect.objectContaining({ amount: 10, entryType: 'release' }),
      ])
    );
    expect([...context.repository.quotaLedger.values()]).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ entryType: 'consume' })])
    );
  });
});

async function createRecoverableTask(
  adapter: FakeLateResultAdapter,
  secret: string
) {
  const prepared = await createPreparedContext(adapter, secret, false);
  const { auth, context, taskId } = prepared;
  await context.imageTaskRepository.updateTask(taskId, {
    actualModelKey: TEST_GRSAI_MODEL_KEY,
    actualProvider: 'grsai',
    status: 'running',
  });
  const usage = await context.imageTaskRepository.createProviderUsage({
    imageTaskId: taskId,
    latencyMs: 480000,
    providerConfigId: TEST_GRSAI_PROVIDER_CONFIG_ID,
    providerCostAmount: null,
    providerCostCurrency: null,
    providerModelId: TEST_GRSAI_PROVIDER_MODEL_ID,
    rawErrorCode: 'PROVIDER_TIMEOUT',
    rawErrorMessage: 'Provider timed out before late reconciliation',
    requestId: 'late-req-success',
    requestSnapshot: {
      modelKey: TEST_GRSAI_MODEL_KEY,
      providerKey: 'grsai',
    },
    responseSnapshot: { providerStatus: 'timeout' },
    status: 'timeout',
    tenantId: DEFAULT_TENANT_ID,
  });
  await context.imageTaskRepository.updateTask(taskId, {
    providerUsageId: usage.id,
  });
  return prepared;
}

async function createAutoFailedTask(
  adapter: FakeLateResultAdapter,
  secret: string
) {
  return createPreparedContext(adapter, secret, true);
}

async function createPreparedContext(
  adapter: FakeLateResultAdapter,
  secret: string,
  imageTaskAutoRunWorker: boolean
) {
  const context = await createTestAppContext({
    credentialResolver: new StaticProviderCredentialResolver({
      GRSAI_API_KEY: secret,
    }),
    imageTaskAutoRunWorker,
    providerAdapters: [adapter],
  });
  seedTestGrsaiModel(context.adminRepository);
  const user = await createUserWithQuota(context.repository, {
    email: `q46-${imageTaskAutoRunWorker ? 'failed' : 'held'}@mengtu.local`,
    password: 'user-password',
    username: `q46-${imageTaskAutoRunWorker ? 'failed' : 'held'}`,
  });
  await seedTestQuota(context.repository, user.id, 100);
  const login = await context.service.login(user.email, 'user-password');
  const auth = await context.service.authenticateSession(login.session.token);
  const project = await context.projectService.createProject(auth, {
    title: 'Q46 Late Reconciliation',
  });
  const created = await context.imageTaskService.createTask(auth, {
    batchSize: 1,
    idempotencyKey: `q46-late:${imageTaskAutoRunWorker}`,
    modelKey: TEST_GRSAI_MODEL_KEY,
    operationType: 'text_to_image',
    projectId: project.project.id,
    prompt: 'q46 deterministic late reconciliation',
    ratio: '1:1',
  });
  return { auth, context, taskId: created.task.id };
}

function successfulResult(input: {
  providerRequestId: string;
  responseSnapshot?: Record<string, unknown>;
}): ImageProviderResult {
  return {
    failureCount: 0,
    images: [
      {
        body: tinyPng(),
        candidateIndex: 0,
        mimeType: 'image/png',
      },
    ],
    latencyMs: 25,
    providerCostAmount: 1300,
    providerCostCurrency: 'GRSAI_CREDITS',
    providerRequestId: input.providerRequestId,
    rawErrorCode: null,
    rawErrorMessage: null,
    responseSnapshot: input.responseSnapshot ?? { providerStatus: 'succeeded' },
    status: 'succeeded',
    successCount: 1,
  };
}

function failedResult(
  code: string,
  message: string,
  status: 'failed' | 'timeout' = 'failed',
  providerRequestId = 'late-req-success'
): ImageProviderResult {
  return {
    failureCount: 1,
    images: [],
    latencyMs: 25,
    providerCostAmount: null,
    providerCostCurrency: null,
    providerRequestId,
    rawErrorCode: code,
    rawErrorMessage: message,
    responseSnapshot: {
      errorCode: code,
      message,
    },
    status,
    successCount: 0,
  };
}

function tinyPng(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
    'base64'
  );
}

function providerUsageSnapshot(context: Awaited<ReturnType<typeof createTestAppContext>>) {
  return JSON.stringify([...context.imageTaskRepository.providerUsage.values()]);
}

class FakeLateResultAdapter implements ImageProviderAdapter {
  readonly executeCalls: ImageProviderExecutionInput[] = [];
  readonly providerKey = 'grsai';
  readonly recoverCalls: ImageProviderLateResultInput[] = [];

  constructor(
    private readonly recoverHandler: (
      input: ImageProviderLateResultInput
    ) => Promise<ImageProviderResult>,
    private readonly executeHandler: (
      input: ImageProviderExecutionInput
    ) => Promise<ImageProviderResult> = async () => {
      throw new Error('execute should not be called');
    }
  ) {}

  async execute(input: ImageProviderExecutionInput): Promise<ImageProviderResult> {
    this.executeCalls.push(input);
    return this.executeHandler(input);
  }

  async recoverLateResult(
    input: ImageProviderLateResultInput
  ): Promise<ImageProviderResult> {
    this.recoverCalls.push(input);
    return this.recoverHandler(input);
  }
}
