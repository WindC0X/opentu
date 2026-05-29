import { randomUUID } from 'crypto';

import { Hono, type Context, type Next } from 'hono';

import { AdminService } from './admin/service';
import type {
  AdminImageTaskOperationType,
  ModelHealthStatus,
  ModelSupportLevel,
  ModelVisibility,
  PricePolicyStatus,
  PricePolicyUnit,
  ProviderStatus,
} from './admin/types';
import { AssetService } from './assets/service';
import type { AssetVariantType } from './assets/types';
import { AuthService } from './auth/service';
import { AppError, toAppError } from './errors';
import {
  clearSessionCookie,
  readSessionCookie,
  writeSessionCookie,
} from './http/cookies';
import { fail, ok } from './http/response';
import type { AppEnv } from './http/types';
import { ImageTaskService } from './image-tasks/service';
import type {
  CreateImageTaskInput,
  ImageTaskOperationType,
  ImageTaskReferenceAssetInput,
  ImageTaskStatus,
} from './image-tasks/types';
import { ProjectService } from './projects/service';

export interface AppDependencies {
  adminService?: AdminService;
  assetService: AssetService;
  authService: AuthService;
  imageTaskService: ImageTaskService;
  projectService: ProjectService;
  secureCookies?: boolean;
}

export function createApp(dependencies: AppDependencies): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    c.set('requestId', c.req.header('x-request-id') ?? `req_${randomUUID()}`);
    await next();
  });

  app.onError((error, c) => {
    const appError = toAppError(error);
    return fail(c, appError.code, appError.message, appError.status);
  });

  app.get('/api/health', (c) => ok(c, { status: 'ok' }));

  app.post('/api/auth/login', async (c) => {
    const body = await readJson(c);
    const result = await dependencies.authService.login(
      requiredString(body, 'login'),
      requiredString(body, 'password')
    );
    writeSessionCookie(
      c,
      result.session.token,
      result.session.expiresAt,
      Boolean(dependencies.secureCookies)
    );
    return ok(c, {
      quota: result.quota,
      user: result.user,
    });
  });

  app.post('/api/auth/logout', requireAuth(dependencies), async (c) => {
    await dependencies.authService.logout(c.get('auth'));
    clearSessionCookie(c, Boolean(dependencies.secureCookies));
    return ok(c, { loggedOut: true });
  });

  app.get('/api/me', requireAuth(dependencies), async (c) => {
    return ok(c, await dependencies.authService.getMe(c.get('auth')));
  });

  app.get('/api/home/summary', requireAuth(dependencies), async (c) => {
    return ok(c, await dependencies.projectService.homeSummary(c.get('auth')));
  });

  app.get('/api/models', requireAuth(dependencies), async (c) => {
    return ok(c, await dependencies.imageTaskService.listModels());
  });

  app.get('/api/prices/quote', requireAuth(dependencies), async (c) => {
    return ok(
      c,
      await dependencies.imageTaskService.quote({
        batchSize: queryBatchSize(c),
        modelKey:
          c.req.query('model_key') ??
          c.req.query('modelKey') ??
          'mock-image-v1',
        operationType: queryOperationType(c),
        ratio: c.req.query('ratio') ?? '1:1',
      })
    );
  });

  app.post('/api/image-tasks/quote', requireAuth(dependencies), async (c) => {
    const body = await readJson(c);
    return ok(
      c,
      await dependencies.imageTaskService.quote(
        imageTaskQuoteBody(body),
        c.get('auth')
      )
    );
  });

  app.post('/api/image-tasks', requireAuth(dependencies), async (c) => {
    const body = await readJson(c);
    return ok(
      c,
      await dependencies.imageTaskService.createTask(
        c.get('auth'),
        imageTaskCreateBody(body)
      ),
      201
    );
  });

  app.get('/api/image-tasks/:taskId', requireAuth(dependencies), async (c) => {
    return ok(
      c,
      await dependencies.imageTaskService.getTask(
        c.get('auth'),
        requiredParam(c, 'taskId')
      )
    );
  });

  app.get(
    '/api/projects/:projectId/image-tasks',
    requireAuth(dependencies),
    async (c) => {
      return ok(
        c,
        await dependencies.imageTaskService.listProjectTasks(
          c.get('auth'),
          requiredParam(c, 'projectId')
        )
      );
    }
  );

  app.post(
    '/api/image-tasks/:taskId/cancel',
    requireAuth(dependencies),
    async (c) => {
      return ok(
        c,
        await dependencies.imageTaskService.cancelTask(
          c.get('auth'),
          requiredParam(c, 'taskId')
        )
      );
    }
  );

  app.post(
    '/api/image-tasks/:taskId/retry',
    requireAuth(dependencies),
    async (c) => {
      return ok(
        c,
        await dependencies.imageTaskService.retryTask(
          c.get('auth'),
          requiredParam(c, 'taskId')
        ),
        201
      );
    }
  );

  app.post(
    '/api/image-tasks/:taskId/insert-to-canvas',
    requireAuth(dependencies),
    async (c) => {
      return ok(
        c,
        await dependencies.imageTaskService.insertToCanvas(
          c.get('auth'),
          requiredParam(c, 'taskId')
        )
      );
    }
  );

  app.post('/api/assets/upload', requireAuth(dependencies), async (c) => {
    const upload = await readUpload(c);
    return ok(
      c,
      await dependencies.assetService.uploadAsset(c.get('auth'), upload),
      201
    );
  });

  app.get('/api/assets', requireAuth(dependencies), async (c) => {
    const projectId = c.req.query('project_id') ?? undefined;
    return ok(
      c,
      await dependencies.assetService.listAssets(c.get('auth'), { projectId })
    );
  });

  app.get('/api/assets/:assetId', requireAuth(dependencies), async (c) => {
    return ok(
      c,
      await dependencies.assetService.getAsset(
        c.get('auth'),
        requiredParam(c, 'assetId')
      )
    );
  });

  app.get(
    '/api/assets/:assetId/variants/:variantType',
    requireAuth(dependencies),
    async (c) => {
      const result = await dependencies.assetService.readVariant(
        c.get('auth'),
        requiredParam(c, 'assetId'),
        requiredVariantType(c)
      );
      return new Response(result.body, {
        headers: {
          'cache-control': 'private, max-age=60',
          'content-length': String(result.variant.sizeBytes),
          'content-type': result.variant.mimeType,
          'x-mengtu-asset-id': result.asset.id,
          'x-mengtu-variant-type': result.variant.variantType,
        },
      });
    }
  );

  app.patch('/api/assets/:assetId', requireAuth(dependencies), async (c) => {
    const body = await readJson(c);
    return ok(
      c,
      await dependencies.assetService.updateAsset(
        c.get('auth'),
        requiredParam(c, 'assetId'),
        {
          favorite: optionalBoolean(body, 'favorite'),
          selected: optionalBoolean(body, 'selected'),
          visibilityStatus: optionalAssetVisibilityStatus(body),
        }
      )
    );
  });

  app.delete('/api/assets/:assetId', requireAuth(dependencies), async (c) => {
    return ok(
      c,
      await dependencies.assetService.softDeleteAsset(
        c.get('auth'),
        requiredParam(c, 'assetId')
      )
    );
  });

  app.post(
    '/api/assets/:assetId/restore',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) => {
      return ok(
        c,
        await dependencies.assetService.restoreAsset(
          c.get('auth'),
          requiredParam(c, 'assetId')
        )
      );
    }
  );

  app.get('/api/projects', requireAuth(dependencies), async (c) => {
    return ok(c, await dependencies.projectService.listProjects(c.get('auth')));
  });

  app.post('/api/projects', requireAuth(dependencies), async (c) => {
    const body = await readJson(c);
    return ok(
      c,
      await dependencies.projectService.createProject(c.get('auth'), {
        title: requiredProjectTitle(body),
      }),
      201
    );
  });

  app.get('/api/projects/:projectId', requireAuth(dependencies), async (c) => {
    return ok(
      c,
      await dependencies.projectService.getProject(
        c.get('auth'),
        requiredParam(c, 'projectId')
      )
    );
  });

  app.post(
    '/api/projects/:projectId/open-canvas',
    requireAuth(dependencies),
    async (c) => {
      return ok(
        c,
        await dependencies.projectService.openCanvas(
          c.get('auth'),
          requiredParam(c, 'projectId')
        )
      );
    }
  );

  app.post('/api/me/terms/accept', requireAuth(dependencies), async (c) => {
    const body = await readJson(c);
    return ok(
      c,
      await dependencies.authService.acceptTerms(
        c.get('auth'),
        requiredString(body, 'termsVersion'),
        requiredString(body, 'privacyVersion')
      )
    );
  });

  app.post('/api/invitations/accept', async (c) => {
    const body = await readJson(c);
    const result = await dependencies.authService.acceptInvitation({
      code: requiredString(body, 'code'),
      email: requiredString(body, 'email'),
      password: requiredString(body, 'password'),
      privacyVersion: requiredString(body, 'privacyVersion'),
      termsVersion: requiredString(body, 'termsVersion'),
      username: requiredString(body, 'username'),
    });
    writeSessionCookie(
      c,
      result.session.token,
      result.session.expiresAt,
      Boolean(dependencies.secureCookies)
    );
    return ok(
      c,
      {
        quota: result.quota,
        user: result.user,
      },
      201
    );
  });

  app.post('/api/redemptions/redeem', requireAuth(dependencies), async (c) => {
    const body = await readJson(c);
    return ok(
      c,
      await dependencies.authService.redeemCode(
        c.get('auth'),
        requiredString(body, 'code')
      )
    );
  });

  app.get(
    '/api/admin/users',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) => ok(c, await dependencies.authService.listUsers(c.get('auth')))
  );

  app.post(
    '/api/admin/users',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) => {
      const body = await readJson(c);
      return ok(
        c,
        await dependencies.authService.adminCreateUser(c.get('auth'), {
          email: requiredString(body, 'email'),
          initialQuotaAmount: optionalInteger(body, 'initialQuotaAmount'),
          password: requiredString(body, 'password'),
          privacyVersion: optionalString(body, 'privacyVersion'),
          role: optionalRole(body),
          termsVersion: optionalString(body, 'termsVersion'),
          username: requiredString(body, 'username'),
        }),
        201
      );
    }
  );

  app.patch(
    '/api/admin/users/:userId',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) => {
      const body = await readJson(c);
      return ok(
        c,
        await dependencies.authService.adminUpdateUser(
          c.get('auth'),
          requiredParam(c, 'userId'),
          {
            password: optionalString(body, 'password'),
            status: optionalUserStatus(body),
          }
        )
      );
    }
  );

  app.post(
    '/api/admin/users/:userId/quota-adjustments',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) => {
      const body = await readJson(c);
      return ok(
        c,
        await dependencies.authService.adminAdjustQuota(
          c.get('auth'),
          requiredParam(c, 'userId'),
          requiredInteger(body, 'amount'),
          requiredString(body, 'reason')
        ),
        201
      );
    }
  );

  app.post(
    '/api/admin/invite-codes',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) => {
      const body = await readJson(c);
      return ok(
        c,
        await dependencies.authService.adminCreateInviteCode(c.get('auth'), {
          code: optionalString(body, 'code'),
          expiresAt: optionalDate(body, 'expiresAt'),
          initialQuotaAmount: optionalInteger(body, 'initialQuotaAmount'),
          maxUses: optionalInteger(body, 'maxUses'),
        }),
        201
      );
    }
  );

  app.post(
    '/api/admin/redemption-codes',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) => {
      const body = await readJson(c);
      return ok(
        c,
        await dependencies.authService.adminCreateRedemptionCode(
          c.get('auth'),
          {
            code: optionalString(body, 'code'),
            expiresAt: optionalDate(body, 'expiresAt'),
            maxUses: optionalInteger(body, 'maxUses'),
            quotaAmount: requiredInteger(body, 'quotaAmount'),
          }
        ),
        201
      );
    }
  );

  app.get(
    '/api/admin/image-tasks',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) =>
      ok(
        c,
        await dependencies.imageTaskService.listAdminTasks(c.get('auth'), {
          status: optionalImageTaskStatusQuery(c),
        })
      )
  );

  app.post(
    '/api/admin/image-tasks/:taskId/cancel',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) =>
      ok(
        c,
        await dependencies.imageTaskService.adminCancelTask(
          c.get('auth'),
          requiredParam(c, 'taskId')
        )
      )
  );

  app.post(
    '/api/admin/image-tasks/:taskId/retry',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) =>
      ok(
        c,
        await dependencies.imageTaskService.adminRetryTask(
          c.get('auth'),
          requiredParam(c, 'taskId')
        ),
        201
      )
  );

  app.get(
    '/api/admin/assets',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) =>
      ok(
        c,
        await dependencies.assetService.listAdminAssets(c.get('auth'), {
          includeDeleted: optionalBooleanQuery(c, 'includeDeleted', 'include_deleted'),
          ownerUserId: c.req.query('ownerUserId') ?? c.req.query('owner_user_id'),
          projectId: c.req.query('projectId') ?? c.req.query('project_id'),
        })
      )
  );

  app.get(
    '/api/admin/assets/:assetId/original',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) => {
      const result = await dependencies.assetService.readVariant(
        c.get('auth'),
        requiredParam(c, 'assetId'),
        'original'
      );
      return new Response(result.body, {
        headers: {
          'cache-control': 'private, max-age=60',
          'content-length': String(result.variant.sizeBytes),
          'content-type': result.variant.mimeType,
          'x-mengtu-asset-id': result.asset.id,
          'x-mengtu-variant-type': result.variant.variantType,
        },
      });
    }
  );

  app.get(
    '/api/admin/providers',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) =>
      ok(c, await requireAdminService(dependencies).listProviders(c.get('auth')))
  );

  app.post(
    '/api/admin/providers',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) => {
      const body = await readJson(c);
      return ok(
        c,
        await requireAdminService(dependencies).createProvider(
          c.get('auth'),
          providerCreateBody(body)
        ),
        201
      );
    }
  );

  app.patch(
    '/api/admin/providers/:providerKey',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) => {
      const body = await readJson(c);
      return ok(
        c,
        await requireAdminService(dependencies).updateProvider(
          c.get('auth'),
          requiredParam(c, 'providerKey'),
          providerPatchBody(body)
        )
      );
    }
  );

  app.post(
    '/api/admin/providers/:providerKey/credentials',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) => {
      const body = await readJson(c);
      return ok(
        c,
        await requireAdminService(dependencies).rotateProviderCredential(
          c.get('auth'),
          requiredParam(c, 'providerKey'),
          {
            credentialKind: optionalString(body, 'credentialKind'),
            secret: requiredString(body, 'secret'),
          }
        ),
        201
      );
    }
  );

  app.get(
    '/api/admin/models',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) =>
      ok(c, await requireAdminService(dependencies).listModels(c.get('auth')))
  );

  app.patch(
    '/api/admin/models/:modelKey',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) => {
      const body = await readJson(c);
      return ok(
        c,
        await requireAdminService(dependencies).updateModel(
          c.get('auth'),
          requiredParam(c, 'modelKey'),
          modelPatchBody(body)
        )
      );
    }
  );

  app.get(
    '/api/admin/price-policies',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) =>
      ok(
        c,
        await requireAdminService(dependencies).listPricePolicies(c.get('auth'))
      )
  );

  app.post(
    '/api/admin/price-policies',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) => {
      const body = await readJson(c);
      return ok(
        c,
        await requireAdminService(dependencies).createPricePolicy(
          c.get('auth'),
          pricePolicyCreateBody(body)
        ),
        201
      );
    }
  );

  app.get(
    '/api/admin/audit-logs',
    requireAuth(dependencies),
    requireAdmin(),
    async (c) =>
      ok(
        c,
        await dependencies.authService.listAuditLogs(c.get('auth'), {
          action: c.req.query('action'),
          actorUserId: c.req.query('actorUserId') ?? c.req.query('actor_user_id'),
          limit: optionalIntegerQuery(c, 'limit'),
          targetId: c.req.query('targetId') ?? c.req.query('target_id'),
          targetType: c.req.query('targetType') ?? c.req.query('target_type'),
        })
      )
  );

  return app;
}

function requireAuth(dependencies: AppDependencies) {
  return async (c: Context<AppEnv>, next: Next) => {
    c.set(
      'auth',
      await dependencies.authService.authenticateSession(readSessionCookie(c))
    );
    await next();
  };
}

function requireAdmin() {
  return async (c: Context<AppEnv>, next: Next) => {
    if (c.get('auth').user.role !== 'admin') {
      throw new AppError('FORBIDDEN', 403, 'Forbidden');
    }
    await next();
  };
}

function requireAdminService(dependencies: AppDependencies): AdminService {
  if (!dependencies.adminService) {
    throw new AppError('NOT_IMPLEMENTED', 501, 'Admin service is not configured');
  }
  return dependencies.adminService;
}

async function readJson(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    if (!isObject(body)) {
      throw new AppError('BAD_REQUEST', 400, 'JSON body must be an object');
    }
    return body;
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }
    throw new AppError('BAD_REQUEST', 400, 'Invalid JSON body');
  }
}

function requiredString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('BAD_REQUEST', 400, `${field} is required`);
  }
  return value;
}

function requiredProjectTitle(body: Record<string, unknown>): string {
  const value = body.title;
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('PROJECT_TITLE_REQUIRED', 400, '请输入项目名称');
  }
  return value;
}

function requiredParam(c: Context<AppEnv>, field: string): string {
  const value = c.req.param(field);
  if (!value) {
    throw new AppError('BAD_REQUEST', 400, `${field} is required`);
  }
  return value;
}

function optionalString(
  body: Record<string, unknown>,
  field: string
): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('BAD_REQUEST', 400, `${field} must be a string`);
  }
  return value;
}

function requiredInteger(body: Record<string, unknown>, field: string): number {
  const value = body[field];
  if (!Number.isInteger(value)) {
    throw new AppError('BAD_REQUEST', 400, `${field} must be an integer`);
  }
  return value as number;
}

function optionalInteger(
  body: Record<string, unknown>,
  field: string
): number | undefined {
  const value = body[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Number.isInteger(value)) {
    throw new AppError('BAD_REQUEST', 400, `${field} must be an integer`);
  }
  return value as number;
}

function optionalIntegerQuery(
  c: Context<AppEnv>,
  field: string
): number | undefined {
  const raw = c.req.query(field);
  if (raw === undefined || raw === '') {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw new AppError('BAD_REQUEST', 400, `${field} must be an integer`);
  }
  return value;
}

function optionalBooleanQuery(
  c: Context<AppEnv>,
  camelField: string,
  snakeField: string
): boolean | undefined {
  const raw = c.req.query(camelField) ?? c.req.query(snakeField);
  if (raw === undefined || raw === '') {
    return undefined;
  }
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  throw new AppError('BAD_REQUEST', 400, `${camelField} must be true or false`);
}

function queryBatchSize(c: Context<AppEnv>): 1 | 2 | 4 {
  const raw = c.req.query('batch_size') ?? c.req.query('batchSize') ?? '1';
  const value = Number(raw);
  if (value === 1 || value === 2 || value === 4) {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'batch_size must be 1, 2, or 4');
}

function optionalImageTaskStatusQuery(
  c: Context<AppEnv>
): ImageTaskStatus | undefined {
  const value = c.req.query('status');
  if (value === undefined || value === '') {
    return undefined;
  }
  if (
    value === 'queued' ||
    value === 'running' ||
    value === 'persisting' ||
    value === 'succeeded' ||
    value === 'failed' ||
    value === 'cancelled'
  ) {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'status is invalid');
}

function queryOperationType(c: Context<AppEnv>): ImageTaskOperationType {
  const value =
    c.req.query('operation_type') ??
    c.req.query('operationType') ??
    'text_to_image';
  if (isImageTaskOperationType(value)) {
    return value;
  }
  throw new AppError('MODEL_UNSUPPORTED_OPERATION', 400, '模型不支持当前操作');
}

function imageTaskQuoteBody(body: Record<string, unknown>): {
  batchSize: 1 | 2 | 4;
  maskAssetId?: string | null;
  modelKey: string;
  operationType: ImageTaskOperationType;
  projectId?: string;
  referenceAssets?: ImageTaskReferenceAssetInput[];
  ratio: string;
  sourceAssetId?: string | null;
} {
  return {
    batchSize: bodyBatchSize(body),
    maskAssetId:
      optionalBodyString(body, 'mask_asset_id', 'maskAssetId') ?? null,
    modelKey:
      optionalBodyString(body, 'model_key', 'modelKey') ?? 'mock-image-v1',
    operationType: bodyOperationType(body),
    projectId: optionalBodyString(body, 'project_id', 'projectId'),
    referenceAssets: bodyReferenceAssets(body),
    ratio: optionalBodyString(body, 'ratio') ?? '1:1',
    sourceAssetId:
      optionalBodyString(body, 'source_asset_id', 'sourceAssetId') ?? null,
  };
}

function imageTaskCreateBody(
  body: Record<string, unknown>
): CreateImageTaskInput {
  return {
    batchSize: bodyBatchSize(body),
    idempotencyKey:
      optionalBodyString(body, 'idempotency_key', 'idempotencyKey') ??
      randomUUID(),
    maskAssetId:
      optionalBodyString(body, 'mask_asset_id', 'maskAssetId') ?? null,
    modelKey:
      optionalBodyString(body, 'model_key', 'modelKey') ?? 'mock-image-v1',
    operationType: bodyOperationType(body),
    prompt: requiredBodyString(body, 'prompt'),
    projectId: requiredBodyString(body, 'project_id', 'projectId'),
    promptOptimize:
      optionalBodyBoolean(body, 'prompt_optimize', 'promptOptimize') ?? false,
    ratio: optionalBodyString(body, 'ratio') ?? '1:1',
    referenceAssets: bodyReferenceAssets(body),
    sourceAssetId:
      optionalBodyString(body, 'source_asset_id', 'sourceAssetId') ?? null,
  };
}

function bodyBatchSize(body: Record<string, unknown>): 1 | 2 | 4 {
  const value = body.batch_size ?? body.batchSize ?? 1;
  if (value === 1 || value === 2 || value === 4) {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'batch_size must be 1, 2, or 4');
}

function bodyOperationType(
  body: Record<string, unknown>
): ImageTaskOperationType {
  const value = body.operation_type ?? body.operationType ?? 'text_to_image';
  if (isImageTaskOperationType(value)) {
    return value;
  }
  throw new AppError('MODEL_UNSUPPORTED_OPERATION', 400, '模型不支持当前操作');
}

function bodyReferenceAssets(
  body: Record<string, unknown>
): ImageTaskReferenceAssetInput[] {
  const value = body.reference_assets ?? body.referenceAssets;
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new AppError('BAD_REQUEST', 400, 'reference_assets must be an array');
  }
  return value.map((item, index) => {
    if (!isObject(item)) {
      throw new AppError(
        'BAD_REQUEST',
        400,
        'reference_assets item must be an object'
      );
    }
    return {
      assetId: requiredBodyString(item, 'asset_id', 'assetId'),
      order: optionalInteger(item, 'order') ?? index,
      role: bodyReferenceRole(item.role ?? item.referenceRole),
    };
  });
}

function bodyReferenceRole(
  value: unknown
): ImageTaskReferenceAssetInput['role'] {
  if (value === undefined || value === null || value === '') {
    return 'general';
  }
  if (
    value === 'general' ||
    value === 'subject' ||
    value === 'style' ||
    value === 'composition' ||
    value === 'background'
  ) {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'Invalid reference asset role');
}

function isImageTaskOperationType(
  value: unknown
): value is ImageTaskOperationType {
  return (
    value === 'text_to_image' ||
    value === 'image_to_image' ||
    value === 'inpaint' ||
    value === 'reference_generate'
  );
}

function requiredBodyString(
  body: Record<string, unknown>,
  snakeField: string,
  camelField?: string
): string {
  const value = body[snakeField] ?? (camelField ? body[camelField] : undefined);
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('BAD_REQUEST', 400, `${snakeField} is required`);
  }
  return value;
}

function optionalBodyString(
  body: Record<string, unknown>,
  snakeField: string,
  camelField?: string
): string | undefined {
  const value = body[snakeField] ?? (camelField ? body[camelField] : undefined);
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('BAD_REQUEST', 400, `${snakeField} must be a string`);
  }
  return value;
}

function optionalBodyBoolean(
  body: Record<string, unknown>,
  snakeField: string,
  camelField?: string
): boolean | undefined {
  const value = body[snakeField] ?? (camelField ? body[camelField] : undefined);
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new AppError('BAD_REQUEST', 400, `${snakeField} must be a boolean`);
  }
  return value;
}

function optionalDate(
  body: Record<string, unknown>,
  field: string
): Date | null | undefined {
  const value = body[field];
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new AppError('BAD_REQUEST', 400, `${field} must be an ISO date`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new AppError('BAD_REQUEST', 400, `${field} must be an ISO date`);
  }
  return date;
}

function optionalRole(
  body: Record<string, unknown>
): 'admin' | 'user' | undefined {
  const value = body.role;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value !== 'admin' && value !== 'user') {
    throw new AppError('BAD_REQUEST', 400, 'role must be admin or user');
  }
  return value;
}

function optionalUserStatus(
  body: Record<string, unknown>
): 'active' | 'disabled' | undefined {
  const value = body.status;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value !== 'active' && value !== 'disabled') {
    throw new AppError('BAD_REQUEST', 400, 'status must be active or disabled');
  }
  return value;
}

function providerCreateBody(body: Record<string, unknown>) {
  return {
    dataRegion: optionalNullableString(body, 'dataRegion'),
    dataRetentionPolicy: optionalNullableString(body, 'dataRetentionPolicy'),
    dataTrainingUsage: optionalNullableString(body, 'dataTrainingUsage'),
    displayName: requiredString(body, 'displayName'),
    isDefault: optionalBoolean(body, 'isDefault'),
    lastReviewedAt: optionalDate(body, 'lastReviewedAt'),
    privacyUrl: optionalNullableString(body, 'privacyUrl'),
    providerKey: requiredString(body, 'providerKey'),
    reviewNotes: optionalNullableString(body, 'reviewNotes'),
    status: optionalProviderStatus(body),
    termsUrl: optionalNullableString(body, 'termsUrl'),
  };
}

function providerPatchBody(body: Record<string, unknown>) {
  return {
    dataRegion: optionalNullableString(body, 'dataRegion'),
    dataRetentionPolicy: optionalNullableString(body, 'dataRetentionPolicy'),
    dataTrainingUsage: optionalNullableString(body, 'dataTrainingUsage'),
    displayName: optionalString(body, 'displayName'),
    isDefault: optionalBoolean(body, 'isDefault'),
    lastReviewedAt: optionalDate(body, 'lastReviewedAt'),
    privacyUrl: optionalNullableString(body, 'privacyUrl'),
    reviewNotes: optionalNullableString(body, 'reviewNotes'),
    status: optionalProviderStatus(body),
    termsUrl: optionalNullableString(body, 'termsUrl'),
  };
}

function modelPatchBody(body: Record<string, unknown>) {
  return {
    displayName: optionalString(body, 'displayName'),
    healthStatus: optionalModelHealthStatus(body),
    supportLevel: optionalModelSupportLevel(body),
    visibility: optionalModelVisibility(body),
  };
}

function pricePolicyCreateBody(body: Record<string, unknown>) {
  return {
    amount: requiredInteger(body, 'amount'),
    modelKey: optionalNullableString(body, 'modelKey'),
    operationType: requiredAdminOperationType(body),
    policyKey: requiredString(body, 'policyKey'),
    status: optionalPricePolicyStatus(body),
    unit: requiredPricePolicyUnit(body),
  };
}

function optionalNullableString(
  body: Record<string, unknown>,
  field: string
): string | null | undefined {
  const value = body[field];
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError('BAD_REQUEST', 400, `${field} must be a string`);
  }
  return value;
}

function optionalProviderStatus(
  body: Record<string, unknown>
): ProviderStatus | undefined {
  const value = body.status;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value === 'active' || value === 'degraded' || value === 'disabled') {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'status is invalid');
}

function optionalModelVisibility(
  body: Record<string, unknown>
): ModelVisibility | undefined {
  const value = body.visibility;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (
    value === 'public' ||
    value === 'beta' ||
    value === 'admin_only' ||
    value === 'disabled'
  ) {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'visibility is invalid');
}

function optionalModelHealthStatus(
  body: Record<string, unknown>
): ModelHealthStatus | undefined {
  const value = body.healthStatus;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value === 'healthy' || value === 'degraded' || value === 'disabled') {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'healthStatus is invalid');
}

function optionalModelSupportLevel(
  body: Record<string, unknown>
): ModelSupportLevel | undefined {
  const value = body.supportLevel;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (
    value === 'native' ||
    value === 'wrapped' ||
    value === 'experimental' ||
    value === 'unsupported'
  ) {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'supportLevel is invalid');
}

function requiredAdminOperationType(
  body: Record<string, unknown>
): AdminImageTaskOperationType {
  const value = body.operationType;
  if (
    value === 'text_to_image' ||
    value === 'image_to_image' ||
    value === 'inpaint' ||
    value === 'reference_generate' ||
    value === 'prompt_optimize'
  ) {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'operationType is invalid');
}

function requiredPricePolicyUnit(
  body: Record<string, unknown>
): PricePolicyUnit {
  const value = body.unit;
  if (value === 'per_task' || value === 'per_image' || value === 'fixed') {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'unit is invalid');
}

function optionalPricePolicyStatus(
  body: Record<string, unknown>
): PricePolicyStatus | undefined {
  const value = body.status;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value === 'draft' || value === 'active' || value === 'retired') {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'status is invalid');
}

function optionalBoolean(
  body: Record<string, unknown>,
  field: string
): boolean | undefined {
  const value = body[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'boolean') {
    throw new AppError('BAD_REQUEST', 400, `${field} must be a boolean`);
  }
  return value;
}

function optionalAssetVisibilityStatus(
  body: Record<string, unknown>
): 'normal' | 'discarded' | 'hidden' | undefined {
  const value = body.visibilityStatus;
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value !== 'normal' && value !== 'discarded' && value !== 'hidden') {
    throw new AppError(
      'BAD_REQUEST',
      400,
      'visibilityStatus must be normal, discarded, or hidden'
    );
  }
  return value;
}

function requiredVariantType(c: Context<AppEnv>): AssetVariantType {
  const value = requiredParam(c, 'variantType');
  if (
    value === 'original' ||
    value === 'provider_input' ||
    value === 'thumb' ||
    value === 'preview'
  ) {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'Invalid asset variant type');
}

async function readUpload(c: Context<AppEnv>): Promise<{
  assetKind?: 'image' | 'mask';
  body: Buffer;
  fileName: string;
  mimeType: string;
  projectId: string;
}> {
  const form = await c.req.parseBody();
  const assetKind = form.assetKind ?? form.asset_kind;
  const projectId = form.projectId;
  const file = form.file;
  if (typeof projectId !== 'string' || !projectId.trim()) {
    throw new AppError('BAD_REQUEST', 400, 'projectId is required');
  }
  if (!isUploadFile(file)) {
    throw new AppError('BAD_REQUEST', 400, 'file is required');
  }
  return {
    assetKind: optionalUploadAssetKind(assetKind),
    body: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    mimeType: file.type,
    projectId,
  };
}

function optionalUploadAssetKind(value: unknown): 'image' | 'mask' | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (value === 'image' || value === 'mask') {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'assetKind must be image or mask');
}

interface UploadFileLike {
  arrayBuffer(): Promise<ArrayBuffer>;
  name: string;
  size: number;
  type: string;
}

function isUploadFile(value: unknown): value is UploadFileLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as UploadFileLike).arrayBuffer === 'function' &&
    typeof (value as UploadFileLike).name === 'string' &&
    typeof (value as UploadFileLike).size === 'number' &&
    typeof (value as UploadFileLike).type === 'string'
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
