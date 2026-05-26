export interface ApiConfig {
  assetStorageLocalPath: string;
  assetStoragePrefix: string;
  maxUploadBytes: number;
  port: number;
  secureCookies: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    assetStorageLocalPath: env.ASSET_STORAGE_LOCAL_PATH ?? '.data/assets',
    assetStoragePrefix: env.ASSET_STORAGE_PREFIX ?? 'mengtu',
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024),
    port: Number(env.PORT ?? 4300),
    secureCookies: env.NODE_ENV === 'production',
  };
}
