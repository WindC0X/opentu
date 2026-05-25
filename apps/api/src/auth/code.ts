import { createHash, randomBytes } from 'crypto';

export function generateOneTimeCode(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

export function hashAccessCode(code: string): string {
  return createHash('sha256').update(normalizeAccessCode(code)).digest('hex');
}

export function normalizeAccessCode(code: string): string {
  return code.trim();
}
