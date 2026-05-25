import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';

import type { AppEnv } from './types';

export const SESSION_COOKIE_NAME = 'mt_session';

export function readSessionCookie(c: Context<AppEnv>): string | undefined {
  return getCookie(c, SESSION_COOKIE_NAME);
}

export function writeSessionCookie(
  c: Context<AppEnv>,
  token: string,
  expiresAt: Date,
  secure: boolean
): void {
  setCookie(c, SESSION_COOKIE_NAME, token, {
    expires: expiresAt,
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure,
  });
}

export function clearSessionCookie(c: Context<AppEnv>, secure: boolean): void {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    httpOnly: true,
    path: '/',
    sameSite: 'Lax',
    secure,
  });
}
