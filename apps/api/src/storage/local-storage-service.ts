import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { AppError } from '../errors';
import type { PutObjectInput, StorageService, StoredObject } from './types';

export class LocalStorageService implements StorageService {
  constructor(private readonly rootDir: string) {}

  async getObject(key: string): Promise<StoredObject> {
    const filePath = this.resolveKey(key);
    try {
      const body = await readFile(filePath);
      return {
        body,
        contentLength: body.byteLength,
        contentType: contentTypeFromKey(key),
        key,
      };
    } catch {
      throw new AppError('ASSET_NOT_FOUND', 404, '资产不存在或不可访问');
    }
  }

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const filePath = this.resolveKey(input.key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, input.body);
    return {
      body: input.body,
      contentLength: input.body.byteLength,
      contentType: input.contentType,
      key: input.key,
    };
  }

  private resolveKey(key: string): string {
    const normalized = path.normalize(key).replace(/^(\.\.[/\\])+/, '');
    if (path.isAbsolute(normalized) || normalized.startsWith('..')) {
      throw new AppError('BAD_REQUEST', 400, 'Invalid storage key');
    }
    return path.join(this.rootDir, normalized);
  }
}

function contentTypeFromKey(key: string): string {
  if (key.endsWith('.jpg') || key.endsWith('.jpeg')) {
    return 'image/jpeg';
  }
  if (key.endsWith('.png')) {
    return 'image/png';
  }
  if (key.endsWith('.webp')) {
    return 'image/webp';
  }
  return 'application/octet-stream';
}
