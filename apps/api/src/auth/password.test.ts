import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './password';

describe('password hashing', () => {
  it('hashes passwords without storing plaintext', async () => {
    const password = 'correct-horse-battery-staple';
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash).toContain('scrypt$');
    expect(await verifyPassword(password, hash)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('expected-password');

    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });
});
