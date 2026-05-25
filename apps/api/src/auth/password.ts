import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCallback);
const SCRYPT_KEY_LENGTH = 64;
const PASSWORD_HASH_PREFIX = 'scrypt';
const PASSWORD_HASH_VERSION = 'v1';

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derivedKey = (await scrypt(
    password,
    salt,
    SCRYPT_KEY_LENGTH
  )) as Buffer;

  return [
    PASSWORD_HASH_PREFIX,
    PASSWORD_HASH_VERSION,
    salt.toString('base64'),
    derivedKey.toString('base64'),
  ].join('$');
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<boolean> {
  const parts = storedHash.split('$');
  if (
    parts.length !== 4 ||
    parts[0] !== PASSWORD_HASH_PREFIX ||
    parts[1] !== PASSWORD_HASH_VERSION
  ) {
    return false;
  }

  const [, , saltBase64, keyBase64] = parts;
  const expectedKey = Buffer.from(keyBase64, 'base64');
  const actualKey = (await scrypt(
    password,
    Buffer.from(saltBase64, 'base64'),
    expectedKey.length
  )) as Buffer;

  return (
    actualKey.length === expectedKey.length &&
    timingSafeEqual(actualKey, expectedKey)
  );
}
