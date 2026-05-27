import { randomUUID } from 'crypto';

import { Hono, type Context, type Next } from 'hono';

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
import type { CreateImageTaskInput } from './image-tasks/types';
import { ProjectService } from './projects/service';

export interface AppDependencies {
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
    return ok(c, dependencies.imageTaskService.listModels());
  });

  app.get('/api/prices/quote', requireAuth(dependencies), async (c) => {
    return ok(
      c,
      dependencies.imageTaskService.quote({
        batchSize: queryBatchSize(c),
        modelKey: c.req.query('model_key') ?? c.req.query('modelKey') ?? 'mock-image-v1',
        operationType: queryOperationType(c),
        ratio: c.req.query('ratio') ?? '1:1',
      })
    );
  });

  app.post('/api/image-tasks/quote', requireAuth(dependencies), async (c) => {
    const body = await readJson(c);
    return ok(c, dependencies.imageTaskService.quote(imageTaskQuoteBody(body)));
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

function queryBatchSize(c: Context<AppEnv>): 1 | 2 | 4 {
  const raw = c.req.query('batch_size') ?? c.req.query('batchSize') ?? '1';
  const value = Number(raw);
  if (value === 1 || value === 2 || value === 4) {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'batch_size must be 1, 2, or 4');
}

function queryOperationType(c: Context<AppEnv>): 'text_to_image' {
  const value =
    c.req.query('operation_type') ?? c.req.query('operationType') ?? 'text_to_image';
  if (value === 'text_to_image') {
    return value;
  }
  throw new AppError(
    'MODEL_UNSUPPORTED_OPERATION',
    400,
    'S07 仅支持文生图任务'
  );
}

function imageTaskQuoteBody(body: Record<string, unknown>): {
  batchSize: 1 | 2 | 4;
  modelKey: string;
  operationType: 'text_to_image';
  ratio: string;
} {
  return {
    batchSize: bodyBatchSize(body),
    modelKey: optionalBodyString(body, 'model_key', 'modelKey') ?? 'mock-image-v1',
    operationType: bodyOperationType(body),
    ratio: optionalBodyString(body, 'ratio') ?? '1:1',
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
    modelKey: optionalBodyString(body, 'model_key', 'modelKey') ?? 'mock-image-v1',
    operationType: bodyOperationType(body),
    prompt: requiredBodyString(body, 'prompt'),
    projectId: requiredBodyString(body, 'project_id', 'projectId'),
    promptOptimize:
      optionalBodyBoolean(body, 'prompt_optimize', 'promptOptimize') ?? false,
    ratio: optionalBodyString(body, 'ratio') ?? '1:1',
  };
}

function bodyBatchSize(body: Record<string, unknown>): 1 | 2 | 4 {
  const value = body.batch_size ?? body.batchSize ?? 1;
  if (value === 1 || value === 2 || value === 4) {
    return value;
  }
  throw new AppError('BAD_REQUEST', 400, 'batch_size must be 1, 2, or 4');
}

function bodyOperationType(body: Record<string, unknown>): 'text_to_image' {
  const value = body.operation_type ?? body.operationType ?? 'text_to_image';
  if (value === 'text_to_image') {
    return value;
  }
  throw new AppError(
    'MODEL_UNSUPPORTED_OPERATION',
    400,
    'S07 仅支持文生图任务'
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
  body: Buffer;
  fileName: string;
  mimeType: string;
  projectId: string;
}> {
  const form = await c.req.parseBody();
  const projectId = form.projectId;
  const file = form.file;
  if (typeof projectId !== 'string' || !projectId.trim()) {
    throw new AppError('BAD_REQUEST', 400, 'projectId is required');
  }
  if (!isUploadFile(file)) {
    throw new AppError('BAD_REQUEST', 400, 'file is required');
  }
  return {
    body: Buffer.from(await file.arrayBuffer()),
    fileName: file.name,
    mimeType: file.type,
    projectId,
  };
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
