import { serve } from '@hono/node-server';

import { AssetService } from './assets/service';
import { AuthService } from './auth/service';
import { createApp } from './app';
import { loadConfig } from './config';
import { createDb } from './db/client';
import { ImageTaskService } from './image-tasks/service';
import { QuotaService } from './quota/service';
import { DrizzleAssetRepository } from './repositories/drizzle-asset-repository';
import { DrizzleAuthRepository } from './repositories/drizzle-auth-repository';
import { DrizzleImageTaskRepository } from './repositories/drizzle-image-task-repository';
import { DrizzleProjectRepository } from './repositories/drizzle-project-repository';
import { InMemoryAssetRepository } from './repositories/in-memory-asset-repository';
import { InMemoryAuthRepository } from './repositories/in-memory-auth-repository';
import { InMemoryImageTaskRepository } from './repositories/in-memory-image-task-repository';
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
const imageTaskRepository = runtimeDb
  ? new DrizzleImageTaskRepository(runtimeDb.db)
  : new InMemoryImageTaskRepository();
const storageService = new LocalStorageService(config.assetStorageLocalPath);
const authService = new AuthService(repository);
const projectService = new ProjectService(projectRepository);
const quotaService = new QuotaService(repository);
const assetService = new AssetService(
  assetRepository,
  projectRepository,
  storageService,
  repository,
  {
    maxUploadBytes: config.maxUploadBytes,
    storagePrefix: config.assetStoragePrefix,
  }
);

const app = createApp({
  assetService,
  authService,
  imageTaskService: new ImageTaskService(
    imageTaskRepository,
    projectRepository,
    assetRepository,
    assetService,
    quotaService,
    { autoRunWorker: config.platformWorkerEnabled }
  ),
  projectService,
  secureCookies: config.secureCookies,
});

serve({
  fetch: app.fetch,
  port: config.port,
});
