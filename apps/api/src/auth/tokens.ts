import { createHash, randomBytes } from 'crypto';

export function generateSessionToken(): string {
  return `mt_sess_${toBase64Url(randomBytes(32))}`;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toBase64Url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
