import { loadConfig } from '../config';
import { EnvProviderCredentialResolver } from '../providers/credentials';
import { createDefaultProviderRegistry } from '../providers/registry';
import {
  createTestAppContext,
  createUserWithQuota,
  seedTestGrsaiModel,
  seedTestQuota,
  TEST_GRSAI_MODEL_KEY,
} from './helpers';

export type LiveProviderSmokeResult =
  | {
      kind: 'skipped';
      message: string;
    }
  | {
      kind: 'succeeded';
      summary: LiveProviderSmokeSummary;
    }
  | {
      kind: 'provider_failed';
      summary: LiveProviderSmokeSummary;
    };

export interface LiveProviderSmokeSummary {
  assetCount: number;
  latencyMs: number | null;
  providerRequestId: string | null;
  quota: {
    balanceAmount: number;
    heldAmount: number;
    ledger: Array<{ amount: number; entryType: string }>;
  };
  status: string;
  taskId: string;
  usageId: string | null;
}

const LIVE_SECRET_ENV_KEYS = [
  'PROVIDER_SECRET_GRSAI_API_KEY',
  'PROVIDER_SECRET_GRSAI',
  'GRSAI_API_KEY',
];

export async function runLiveProviderSmoke(
  env: NodeJS.ProcessEnv = process.env
): Promise<LiveProviderSmokeResult> {
  const config = loadConfig(env);
  if (!config.liveProviderSmokeEnabled) {
    return {
      kind: 'skipped',
      message:
        'S12 live provider smoke skipped: set MENGTU_LIVE_PROVIDER_SMOKE=1 to opt in.',
    };
  }

  const secretValues = liveSecretValues(env);
  if (secretValues.length === 0) {
    throw new Error(
      'S12 live provider smoke requires a server-side GrsAI credential env key.'
    );
  }

  const context = await createTestAppContext({
    credentialResolver: new EnvProviderCredentialResolver(env),
    providerRegistry: createDefaultProviderRegistry({
      grsai: {
        deferTerminalStatusUntilTimeout: true,
        pollIntervalMs: config.liveProviderSmokePollIntervalMs,
        timeoutMs: config.liveProviderSmokeTimeoutMs,
      },
    }),
  });
  seedTestGrsaiModel(context.adminRepository);

  const user = await createUserWithQuota(context.repository, {
    email: 's12-live-smoke@mengtu.local',
    password: 'user-password',
    username: 's12-live-smoke',
  });
  await seedTestQuota(context.repository, user.id, 100);

  const login = await context.service.login(
    's12-live-smoke@mengtu.local',
    'user-password'
  );
  const auth = await context.service.authenticateSession(login.session.token);
  const project = await context.projectService.createProject(auth, {
    title: 'S12 Live Provider Smoke',
  });
  const created = await context.imageTaskService.createTask(auth, {
    batchSize: 1,
    idempotencyKey: `s12-live-smoke:${Date.now()}`,
    modelKey: TEST_GRSAI_MODEL_KEY,
    operationType: 'text_to_image',
    projectId: project.project.id,
    prompt: 'minimal readiness smoke image, plain geometric icon',
    ratio: '1:1',
  });

  const usage =
    [...context.imageTaskRepository.providerUsage.values()].find(
      (candidate) => candidate.imageTaskId === created.task.id
    ) ?? null;
  const account = await context.repository.findQuotaAccountByUserId(
    auth.user.tenantId,
    auth.user.id
  );
  if (!account) {
    throw new Error('S12 live provider smoke could not read quota account.');
  }

  assertNoSecretLeak({ task: created.task, usage }, secretValues);

  const ledger = [...context.repository.quotaLedger.values()]
    .filter((entry) => entry.relatedTaskId === created.task.id)
    .map((entry) => ({
      amount: entry.amount,
      entryType: entry.entryType,
    }));
  const summary: LiveProviderSmokeSummary = {
    assetCount: created.task.assets.length,
    latencyMs: usage?.latencyMs ?? null,
    providerRequestId: usage?.requestId ?? null,
    quota: {
      balanceAmount: account.balanceAmount,
      heldAmount: account.heldAmount,
      ledger,
    },
    status: created.task.status,
    taskId: created.task.id,
    usageId: usage?.id ?? null,
  };

  if (created.task.status === 'succeeded') {
    if (created.task.assets.length < 1) {
      throw new Error('S12 live provider smoke succeeded without persisted asset.');
    }
    if (!usage || usage.status !== 'succeeded' || !usage.requestId) {
      throw new Error('S12 live provider smoke succeeded without provider usage.');
    }
    assertQuotaLedger(ledger, ['hold', 'consume']);
    if (account.heldAmount !== 0) {
      throw new Error('S12 live provider smoke left held quota after success.');
    }
    return { kind: 'succeeded', summary };
  }

  if (created.task.status === 'failed') {
    if (!usage || usage.status !== 'failed') {
      throw new Error('S12 live provider smoke failed without provider usage.');
    }
    assertQuotaLedger(ledger, ['hold', 'release']);
    if (account.heldAmount !== 0) {
      throw new Error('S12 live provider smoke left held quota after failure.');
    }
    return { kind: 'provider_failed', summary };
  }

  throw new Error(`S12 live provider smoke ended in non-terminal state: ${created.task.status}`);
}

export function liveSecretValues(env: NodeJS.ProcessEnv): string[] {
  return LIVE_SECRET_ENV_KEYS.map((key) => env[key]?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value) => value.length >= 4);
}

export function assertNoSecretLeak(value: unknown, secrets: string[]): void {
  const serialized = JSON.stringify(value);
  for (const secret of secrets) {
    if (serialized.includes(secret)) {
      throw new Error('S12 live provider smoke detected a secret leak.');
    }
  }
}

function assertQuotaLedger(
  ledger: Array<{ entryType: string }>,
  expected: string[]
): void {
  const actual = new Set(ledger.map((entry) => entry.entryType));
  for (const entryType of expected) {
    if (!actual.has(entryType)) {
      throw new Error(`S12 live provider smoke missing quota ${entryType} entry.`);
    }
  }
}
