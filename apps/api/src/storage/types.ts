export interface PutObjectInput {
  body: Buffer;
  contentType: string;
  key: string;
}

export interface StoredObject {
  body: Buffer;
  contentLength: number;
  contentType: string;
  key: string;
}

export interface StorageService {
  getObject(key: string): Promise<StoredObject>;
  putObject(input: PutObjectInput): Promise<StoredObject>;
}
