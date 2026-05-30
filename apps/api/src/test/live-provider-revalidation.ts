import { DEFAULT_TENANT_ID } from '../auth/types';
import { loadConfig } from '../config';
import { EnvProviderCredentialResolver } from '../providers/credentials';
import { GrsaiImageProviderAdapter } from '../providers/grsai-adapter';
import { AdminImageModelCatalog } from '../providers/model-catalog';
import { ImageProviderRegistry } from '../providers/registry';
import type {
  ImageProviderExecutionInput,
  ImageProviderResult,
  ResolvedImageModel,
} from '../providers/types';
import {
  createTestAppContext,
  createUserWithQuota,
  seedTestGrsaiModel,
  seedTestQuota,
  TEST_GRSAI_MODEL_KEY,
} from './helpers';
import { assertNoSecretLeak, liveSecretValues } from './live-provider-smoke';

export type LiveProviderRevalidationResult =
  | {
      kind: 'skipped';
      message: string;
    }
  | {
      kind: 'recovered';
      summary: LiveProviderRevalidationSummary;
    }
  | {
      kind: 'not_recovered';
      summary: LiveProviderRevalidationSummary;
    };

export interface LiveProviderRevalidationSummary {
  assetCount: number;
  finalStatus: string;
  generationRequestCount: number;
  latencyMs: number | null;
  preRecoveryHeldAmount: number;
  preRecoveryStatus: string;
  providerRequestId: string;
  quota: {
    balanceAmount: number;
    heldAmount: number;
    ledger: Array<{ amount: number; entryType: string }>;
  };
  recoveryGenerationRequestCount: number;
  recoveryReason: string | null;
  recoveryRequestCount: number;
  recoveryStatus: string;
  taskId: string;
  usageId: string | null;
}

interface LiveProviderRevalidationOptions {
  fetchImpl?: typeof fetch;
}

interface CountingFetch {
  fetchImpl: typeof fetch;
  stats: {
    generationRequests: number;
    resultRequests: number;
  };
}

const STILL_HELD_MODE = 'still-held-late-recovery';

export async function runLiveProviderRevalidation(
  env: NodeJS.ProcessEnv = process.env,
  options: LiveProviderRevalidationOptions = {}
): Promise<LiveProviderRevalidationResult> {
  const config = loadConfig(env);
  if (!config.liveProviderRevalidationEnabled) {
    return {
      kind: 'skipped',
      message:
        'Q48 live provider revalidation skipped: set MENGTU_LIVE_PROVIDER_REVALIDATION=1 to opt in.',
    };
  }

  if (config.liveProviderRevalidationMode !== STILL_HELD_MODE) {
    throw new Error(
      `Q48 live provider revalidation requires MENGTU_LIVE_PROVIDER_REVALIDATION_MODE=${STILL_HELD_MODE}.`
    );
  }

  const secretValues = liveSecretValues(env);
  if (secretValues.length === 0) {
    throw new Error(
      'Q48 live provider revalidation requires a server-side GrsAI credential env key.'
    );
  }

  const countingFetch = createCountingFetch(options.fetchImpl ?? fetch);
  const seedAdapter = new GrsaiImageProviderAdapter({
    deferTerminalStatusUntilTimeout: true,
    fetchImpl: countingFetch.fetchImpl,
    pollIntervalMs: config.liveProviderRevalidationPollIntervalMs,
    timeoutMs: config.liveProviderRevalidationSeedTimeoutMs,
  });
  const recoveryAdapter = new GrsaiImageProviderAdapter({
    deferTerminalStatusUntilTimeout: true,
    fetchImpl: countingFetch.fetchImpl,
    pollIntervalMs: config.liveProviderRevalidationPollIntervalMs,
    timeoutMs: config.liveProviderRevalidationTimeoutMs,
  });
  const credentialResolver = new EnvProviderCredentialResolver(env);
  const context = await createTestAppContext({
    credentialResolver,
    imageTaskAutoRunWorker: false,
    providerRegistry: new ImageProviderRegistry([recoveryAdapter]),
  });
  seedTestGrsaiModel(context.adminRepository);

  const user = await createUserWithQuota(context.repository, {
    email: 'q48-live-revalidation@mengtu.local',
    password: 'user-password',
    username: 'q48-live-revalidation',
  });
  await seedTestQuota(context.repository, user.id, 100);

  const login = await context.service.login(
    'q48-live-revalidation@mengtu.local',
    'user-password'
  );
  const auth = await context.service.authenticateSession(login.session.token);
  const project = await context.projectService.createProject(auth, {
    title: 'Q48 Live Provider Revalidation',
  });
  const input = {
    batchSize: 1 as const,
    idempotencyKey: `q48-live-revalidation:${Date.now()}`,
    modelKey: TEST_GRSAI_MODEL_KEY,
    operationType: 'text_to_image' as const,
    projectId: project.project.id,
    prompt: 'minimal still-held late recovery revalidation image',
    ratio: '1:1',
  };

  const created = await context.imageTaskService.createTask(auth, input);
  const catalog = new AdminImageModelCatalog(context.adminRepository);
  const { model } = await catalog.quote(input);
  const credentialSecret = await credentialResolver.resolve({
    credential: model.credential,
    model,
  });
  const task = await context.imageTaskRepository.findTaskById(
    DEFAULT_TENANT_ID,
    created.task.id
  );
  if (!task || !credentialSecret) {
    throw new Error('Q48 live provider revalidation could not prepare task.');
  }

  const seedResult = await seedAdapter.execute({
    credentialSecret,
    input,
    maskImage: null,
    model,
    referenceImages: [],
    sourceImage: null,
    task,
  });
  const providerRequestId = seedResult.providerRequestId;
  if (!providerRequestId) {
    throw new Error(
      'Q48 live provider revalidation did not receive a provider request id.'
    );
  }

  const seedUsage = await createProviderUsageFromResult({
    imageTaskId: task.id,
    input,
    model,
    providerResult: seedResult,
  });
  const persistedSeedUsage =
    await context.imageTaskRepository.createProviderUsage(seedUsage);
  await context.imageTaskRepository.updateTask(task.id, {
    actualModelKey: model.modelKey,
    actualProvider: model.providerKey,
    providerUsageId: persistedSeedUsage.id,
    status: 'running',
  });

  const preRecoveryTask = await context.imageTaskRepository.findTaskById(
    DEFAULT_TENANT_ID,
    task.id
  );
  const preRecoveryAccount =
    await context.repository.findQuotaAccountByUserId(
      DEFAULT_TENANT_ID,
      auth.user.id
    );
  if (!preRecoveryTask || !preRecoveryAccount) {
    throw new Error('Q48 live provider revalidation lost pre-recovery state.');
  }
  if (
    preRecoveryTask.status === 'failed' ||
    preRecoveryTask.status === 'cancelled' ||
    preRecoveryTask.status === 'succeeded'
  ) {
    throw new Error(
      `Q48 live provider revalidation task is not still-held: ${preRecoveryTask.status}`
    );
  }
  if (preRecoveryAccount.heldAmount < created.task.quotedPriceAmount) {
    throw new Error('Q48 live provider revalidation held quota is insufficient.');
  }

  const generationRequestsBeforeRecovery =
    countingFetch.stats.generationRequests;
  const resultRequestsBeforeRecovery = countingFetch.stats.resultRequests;
  const recovered = await context.imageTaskService.reconcileLateProviderResult(
    auth,
    task.id
  );
  const finalTask = await context.imageTaskRepository.findTaskById(
    DEFAULT_TENANT_ID,
    task.id
  );
  const finalAccount = await context.repository.findQuotaAccountByUserId(
    DEFAULT_TENANT_ID,
    auth.user.id
  );
  const recoveredUsage = finalTask?.providerUsageId
    ? await context.imageTaskRepository.findProviderUsageById(
        DEFAULT_TENANT_ID,
        finalTask.providerUsageId
      )
    : null;
  if (!finalTask || !finalAccount) {
    throw new Error('Q48 live provider revalidation lost final state.');
  }

  const ledger = [...context.repository.quotaLedger.values()]
    .filter((entry) => entry.relatedTaskId === task.id)
    .map((entry) => ({ amount: entry.amount, entryType: entry.entryType }));
  const summary: LiveProviderRevalidationSummary = {
    assetCount: recovered.task.assets.length,
    finalStatus: recovered.task.status,
    generationRequestCount: countingFetch.stats.generationRequests,
    latencyMs: recoveredUsage?.latencyMs ?? null,
    preRecoveryHeldAmount: preRecoveryAccount.heldAmount,
    preRecoveryStatus: preRecoveryTask.status,
    providerRequestId,
    quota: {
      balanceAmount: finalAccount.balanceAmount,
      heldAmount: finalAccount.heldAmount,
      ledger,
    },
    recoveryGenerationRequestCount:
      countingFetch.stats.generationRequests - generationRequestsBeforeRecovery,
    recoveryReason: recovered.reason,
    recoveryRequestCount:
      countingFetch.stats.resultRequests - resultRequestsBeforeRecovery,
    recoveryStatus: recovered.status,
    taskId: task.id,
    usageId: recoveredUsage?.id ?? null,
  };

  assertNoSecretLeak(
    { recoveredUsage, seedUsage: persistedSeedUsage, summary, task: recovered.task },
    secretValues
  );

  if (recovered.status !== 'recovered') {
    return { kind: 'not_recovered', summary };
  }
  assertRecoveredSummary(summary, recoveredUsage);
  return { kind: 'recovered', summary };
}

function createCountingFetch(fetchImpl: typeof fetch): CountingFetch {
  const stats = {
    generationRequests: 0,
    resultRequests: 0,
  };
  const countedFetch: typeof fetch = async (input, init) => {
    const url = urlFromFetchInput(input);
    if (url.includes('/v1/api/generate')) {
      stats.generationRequests += 1;
    }
    if (url.includes('/v1/api/result')) {
      stats.resultRequests += 1;
    }
    return fetchImpl(input, init);
  };
  return { fetchImpl: countedFetch, stats };
}

function urlFromFetchInput(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.toString();
  }
  return input.url;
}

function createProviderUsageFromResult(input: {
  imageTaskId: string;
  input: ImageProviderExecutionInput['input'];
  model: ResolvedImageModel;
  providerResult: ImageProviderResult;
}) {
  return {
    imageTaskId: input.imageTaskId,
    latencyMs: input.providerResult.latencyMs,
    providerConfigId: input.model.providerConfigId,
    providerCostAmount: input.providerResult.providerCostAmount,
    providerCostCurrency: input.providerResult.providerCostCurrency,
    providerModelId: input.model.providerModelId,
    rawErrorCode: input.providerResult.rawErrorCode,
    rawErrorMessage: input.providerResult.rawErrorMessage,
    requestId: input.providerResult.providerRequestId,
    requestSnapshot: {
      batchSize: input.input.batchSize,
      modelKey: input.input.modelKey,
      operationType: input.input.operationType,
      providerKey: input.model.providerKey,
      promptLength: input.input.prompt.length,
      referenceAssetCount: input.input.referenceAssets?.length ?? 0,
    },
    responseSnapshot: input.providerResult.responseSnapshot,
    status: input.providerResult.status,
    tenantId: DEFAULT_TENANT_ID,
  };
}

function assertRecoveredSummary(
  summary: LiveProviderRevalidationSummary,
  recoveredUsage: { requestId: string | null; status: string } | null
): void {
  if (summary.preRecoveryStatus !== 'running') {
    throw new Error('Q48 live provider revalidation did not start still-held.');
  }
  if (summary.preRecoveryHeldAmount <= 0) {
    throw new Error('Q48 live provider revalidation had no held quota.');
  }
  if (summary.recoveryGenerationRequestCount !== 0) {
    throw new Error('Q48 live provider revalidation issued a second generation.');
  }
  if (summary.generationRequestCount !== 1) {
    throw new Error('Q48 live provider revalidation generation count changed.');
  }
  if (summary.recoveryRequestCount < 1) {
    throw new Error('Q48 live provider revalidation did not query recovery.');
  }
  if (summary.assetCount < 1 || summary.finalStatus !== 'succeeded') {
    throw new Error('Q48 live provider revalidation did not persist success.');
  }
  if (
    !recoveredUsage ||
    recoveredUsage.status !== 'succeeded' ||
    recoveredUsage.requestId !== summary.providerRequestId
  ) {
    throw new Error('Q48 live provider revalidation usage is not succeeded.');
  }
  assertQuotaLedger(summary.quota.ledger, ['hold', 'consume']);
  if (summary.quota.heldAmount !== 0) {
    throw new Error('Q48 live provider revalidation left held quota.');
  }
}

function assertQuotaLedger(
  ledger: Array<{ entryType: string }>,
  expected: string[]
): void {
  const actual = new Set(ledger.map((entry) => entry.entryType));
  for (const entryType of expected) {
    if (!actual.has(entryType)) {
      throw new Error(`Q48 live provider revalidation missing quota ${entryType}.`);
    }
  }
}
