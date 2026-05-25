import { serve } from '@hono/node-server';

import { AuthService } from './auth/service';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { DrizzleAuthRepository } from './repositories/drizzle-auth-repository';
import { InMemoryAuthRepository } from './repositories/in-memory-auth-repository';

const config = loadConfig();
const databaseUrl = process.env.DATABASE_URL;
const runtimeDb = databaseUrl ? createDb(databaseUrl) : null;
const repository = runtimeDb
  ? new DrizzleAuthRepository(runtimeDb.db)
  : new InMemoryAuthRepository();

const app = createApp({
  authService: new AuthService(repository),
  secureCookies: config.secureCookies,
});

serve({
  fetch: app.fetch,
  port: config.port,
});
