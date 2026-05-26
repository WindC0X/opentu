import { serve } from '@hono/node-server';

import { AssetService } from './assets/service';
import { AuthService } from './auth/service';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { DrizzleAssetRepository } from './repositories/drizzle-asset-repository';
import { DrizzleAuthRepository } from './repositories/drizzle-auth-repository';
import { DrizzleProjectRepository } from './repositories/drizzle-project-repository';
import { InMemoryAssetRepository } from './repositories/in-memory-asset-repository';
import { InMemoryAuthRepository } from './repositories/in-memory-auth-repository';
import { InMemoryProjectRepository } from './repositories/in-memory-project-repository';
import { ProjectService } from './projects/service';
import { LocalStorageService } from './storage/local-storage-service';

const config = loadConfig();
const databaseUrl = process.env.DATABASE_URL;
const runtimeDb = databaseUrl ? createDb(databaseUrl) : null;
const repository = runtimeDb
  ? new DrizzleAuthRepository(runtimeDb.db)
  : new InMemoryAuthRepository();
const projectRepository = runtimeDb
  ? new DrizzleProjectRepository(runtimeDb.db)
  : new InMemoryProjectRepository();
const assetRepository = runtimeDb
  ? new DrizzleAssetRepository(runtimeDb.db)
  : new InMemoryAssetRepository();
const storageService = new LocalStorageService(config.assetStorageLocalPath);
const authService = new AuthService(repository);
const projectService = new ProjectService(projectRepository);

const app = createApp({
  assetService: new AssetService(
    assetRepository,
    projectRepository,
    storageService,
    repository,
    {
      maxUploadBytes: config.maxUploadBytes,
      storagePrefix: config.assetStoragePrefix,
    }
  ),
  authService,
  projectService,
  secureCookies: config.secureCookies,
});

serve({
  fetch: app.fetch,
  port: config.port,
});
