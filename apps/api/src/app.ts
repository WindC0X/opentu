import { randomUUID } from 'crypto';

import { Hono, type Context, type Next } from 'hono';

import { AuthService } from './auth/service';
import { AppError, toAppError } from './errors';
import {
  clearSessionCookie,
  readSessionCookie,
  writeSessionCookie,
} from './http/cookies';
import { fail, ok } from './http/response';
import type { AppEnv } from './http/types';

export interface AppDependencies {
  authService: AuthService;
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
