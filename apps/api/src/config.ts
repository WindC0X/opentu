export interface ApiConfig {
  assetStorageLocalPath: string;
  assetStoragePrefix: string;
  liveProviderRevalidationEnabled: boolean;
  liveProviderRevalidationMode: string | null;
  liveProviderRevalidationPollIntervalMs: number;
  liveProviderRevalidationSeedTimeoutMs: number;
  liveProviderRevalidationTimeoutMs: number;
  liveProviderSmokeEnabled: boolean;
  liveProviderSmokePollIntervalMs: number;
  liveProviderSmokeTimeoutMs: number;
  maxUploadBytes: number;
  platformWorkerEnabled: boolean;
  port: number;
  secureCookies: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    assetStorageLocalPath: env.ASSET_STORAGE_LOCAL_PATH ?? '.data/assets',
    assetStoragePrefix: env.ASSET_STORAGE_PREFIX ?? 'mengtu',
    liveProviderRevalidationEnabled:
      env.MENGTU_LIVE_PROVIDER_REVALIDATION === '1',
    liveProviderRevalidationMode:
      env.MENGTU_LIVE_PROVIDER_REVALIDATION_MODE ?? null,
    liveProviderRevalidationPollIntervalMs: positiveNumber(
      env.MENGTU_LIVE_PROVIDER_REVALIDATION_POLL_INTERVAL_MS,
      5000
    ),
    liveProviderRevalidationSeedTimeoutMs: positiveNumber(
      env.MENGTU_LIVE_PROVIDER_REVALIDATION_SEED_TIMEOUT_MS,
      1000
    ),
    liveProviderRevalidationTimeoutMs: positiveNumber(
      env.MENGTU_LIVE_PROVIDER_REVALIDATION_TIMEOUT_MS,
      540000
    ),
    liveProviderSmokeEnabled: env.MENGTU_LIVE_PROVIDER_SMOKE === '1',
    liveProviderSmokePollIntervalMs: positiveNumber(
      env.MENGTU_LIVE_PROVIDER_SMOKE_POLL_INTERVAL_MS,
      5000
    ),
    liveProviderSmokeTimeoutMs: positiveNumber(
      env.MENGTU_LIVE_PROVIDER_SMOKE_TIMEOUT_MS,
      480000
    ),
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024),
    platformWorkerEnabled: env.PLATFORM_WORKER_ENABLED !== 'false',
    port: Number(env.PORT ?? 4300),
    secureCookies: env.NODE_ENV === 'production',
  };
}

function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
