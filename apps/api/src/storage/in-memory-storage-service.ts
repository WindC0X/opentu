import { AppError } from '../errors';
import type { PutObjectInput, StorageService, StoredObject } from './types';

export class InMemoryStorageService implements StorageService {
  readonly objects = new Map<string, StoredObject>();

  async getObject(key: string): Promise<StoredObject> {
    const object = this.objects.get(key);
    if (!object) {
      throw new AppError('ASSET_NOT_FOUND', 404, '资产不存在或不可访问');
    }
    return object;
  }

  async putObject(input: PutObjectInput): Promise<StoredObject> {
    const object: StoredObject = {
      body: input.body,
      contentLength: input.body.byteLength,
      contentType: input.contentType,
      key: input.key,
    };
    this.objects.set(input.key, object);
    return object;
  }
}
