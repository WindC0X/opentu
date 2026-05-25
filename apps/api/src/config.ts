export interface ApiConfig {
  port: number;
  secureCookies: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    port: Number(env.PORT ?? 4300),
    secureCookies: env.NODE_ENV === 'production',
  };
}
