import type { Context } from 'hono';

import type { AppEnv } from './types';

export function ok(c: Context<AppEnv>, data: unknown, status = 200): Response {
  return c.json(
    {
      data,
      error: null,
      request_id: c.get('requestId'),
    },
    status as 200
  );
}

export function fail(
  c: Context<AppEnv>,
  code: string,
  message: string,
  status: number
): Response {
  return c.json(
    {
      data: null,
      error: {
        code,
        message,
      },
      request_id: c.get('requestId'),
    },
    status as 400
  );
}
