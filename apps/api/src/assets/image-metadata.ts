import { createHash } from 'crypto';

import { AppError } from '../errors';

export interface ImageMetadata {
  height: number;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  sha256: string;
  sizeBytes: number;
  width: number;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PNG_METADATA_CHUNKS = new Set(['eXIf', 'tEXt', 'zTXt', 'iTXt', 'iCCP']);
const WEBP_METADATA_CHUNKS = new Set(['EXIF', 'XMP ', 'ICCP']);
const WEBP_VP8X_METADATA_FLAGS = 0x20 | 0x08 | 0x04;

interface WebpChunk {
  chunkEnd: number;
  dataLength: number;
  dataStart: number;
  offset: number;
  type: string;
}

interface WebpChunkReadOptions {
  requireExactRiffSize?: boolean;
}

export function inspectImage(buffer: Buffer): ImageMetadata {
  const mimeType = detectMimeType(buffer);
  const dimensions = readDimensions(buffer, mimeType);
  return {
    ...dimensions,
    mimeType,
    sha256: sha256(buffer),
    sizeBytes: buffer.byteLength,
  };
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function sanitizeImageForProvider(buffer: Buffer, mimeType: string): Buffer {
  switch (mimeType) {
    case 'image/jpeg':
      return stripJpegExif(buffer);
    case 'image/png':
      return stripPngMetadata(buffer);
    case 'image/webp':
      return stripWebpMetadata(buffer);
    default:
      return buffer;
  }
}

export function detectMimeType(
  buffer: Buffer
): 'image/jpeg' | 'image/png' | 'image/webp' {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'image/jpeg';
  }
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'image/png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  throw new AppError('UPLOAD_INVALID_FORMAT', 400, '不支持的图片格式');
}

function readDimensions(
  buffer: Buffer,
  mimeType: ImageMetadata['mimeType']
): { height: number; width: number } {
  switch (mimeType) {
    case 'image/png':
      return {
        height: buffer.readUInt32BE(20),
        width: buffer.readUInt32BE(16),
      };
    case 'image/jpeg':
      return readJpegDimensions(buffer);
    case 'image/webp':
      return readWebpDimensions(buffer);
  }
}

function readJpegDimensions(buffer: Buffer): { height: number; width: number } {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      break;
    }
    const marker = buffer[offset + 1];
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2) {
      break;
    }
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + segmentLength;
  }
  throw new AppError('UPLOAD_INVALID_FORMAT', 400, '无法解析图片尺寸');
}

function readWebpDimensions(buffer: Buffer): { height: number; width: number } {
  for (const chunk of readWebpChunks(buffer, '无法解析图片尺寸')) {
    if (chunk.type === 'VP8X' && chunk.dataLength >= 10) {
      return {
        height: 1 + buffer.readUIntLE(chunk.dataStart + 7, 3),
        width: 1 + buffer.readUIntLE(chunk.dataStart + 4, 3),
      };
    }
    if (chunk.type === 'VP8 ' && chunk.dataLength >= 10) {
      return {
        height: buffer.readUInt16LE(chunk.dataStart + 8) & 0x3fff,
        width: buffer.readUInt16LE(chunk.dataStart + 6) & 0x3fff,
      };
    }
    if (chunk.type === 'VP8L' && chunk.dataLength >= 5) {
      const bits = buffer.readUInt32LE(chunk.dataStart + 1);
      return {
        height: ((bits >> 14) & 0x3fff) + 1,
        width: (bits & 0x3fff) + 1,
      };
    }
  }
  throw new AppError('UPLOAD_INVALID_FORMAT', 400, '无法解析图片尺寸');
}

function stripJpegExif(buffer: Buffer): Buffer {
  if (buffer.length < 4) {
    return buffer;
  }

  const chunks: Buffer[] = [buffer.subarray(0, 2)];
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      chunks.push(buffer.subarray(offset));
      break;
    }

    const marker = buffer[offset + 1];
    if (marker === 0xda) {
      chunks.push(buffer.subarray(offset));
      break;
    }

    const segmentLength = buffer.readUInt16BE(offset + 2);
    const segmentEnd = offset + 2 + segmentLength;
    if (segmentLength < 2 || segmentEnd > buffer.length) {
      chunks.push(buffer.subarray(offset));
      break;
    }

    const isExifApp1 =
      marker === 0xe1 &&
      buffer.subarray(offset + 4, offset + 10).toString('ascii') ===
        'Exif\u0000\u0000';
    if (!isExifApp1) {
      chunks.push(buffer.subarray(offset, segmentEnd));
    }
    offset = segmentEnd;
  }

  return Buffer.concat(chunks);
}

function stripPngMetadata(buffer: Buffer): Buffer {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new AppError('UPLOAD_INVALID_FORMAT', 400, '无法解析图片 metadata');
  }

  const chunks: Buffer[] = [buffer.subarray(0, 8)];
  let offset = 8;
  let sawIend = false;
  while (offset < buffer.length) {
    if (offset + 12 > buffer.length) {
      throw new AppError('UPLOAD_INVALID_FORMAT', 400, '无法解析图片 metadata');
    }

    const dataLength = buffer.readUInt32BE(offset);
    const chunkEnd = offset + 12 + dataLength;
    if (chunkEnd > buffer.length) {
      throw new AppError('UPLOAD_INVALID_FORMAT', 400, '无法解析图片 metadata');
    }

    const chunkType = buffer.toString('ascii', offset + 4, offset + 8);
    if (!PNG_METADATA_CHUNKS.has(chunkType)) {
      chunks.push(buffer.subarray(offset, chunkEnd));
    }
    offset = chunkEnd;

    if (chunkType === 'IEND') {
      sawIend = true;
      break;
    }
  }

  if (!sawIend || offset !== buffer.length) {
    throw new AppError('UPLOAD_INVALID_FORMAT', 400, '无法解析图片 metadata');
  }

  return Buffer.concat(chunks);
}

function stripWebpMetadata(buffer: Buffer): Buffer {
  const webpChunks = readWebpChunks(buffer, '无法解析图片 metadata', {
    requireExactRiffSize: true,
  });
  const chunks: Buffer[] = [buffer.subarray(8, 12)];
  for (const chunk of webpChunks) {
    if (!WEBP_METADATA_CHUNKS.has(chunk.type)) {
      chunks.push(sanitizeWebpChunk(buffer, chunk));
    }
  }

  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(body.byteLength, 4);
  return Buffer.concat([header, body]);
}

function readWebpChunks(
  buffer: Buffer,
  errorMessage: string,
  options: WebpChunkReadOptions = {}
): WebpChunk[] {
  if (
    buffer.length < 12 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    throw new AppError('UPLOAD_INVALID_FORMAT', 400, errorMessage);
  }

  const declaredSize = buffer.readUInt32LE(4);
  if (
    declaredSize < 4 ||
    declaredSize > buffer.length - 8 ||
    (options.requireExactRiffSize && declaredSize !== buffer.length - 8)
  ) {
    throw new AppError('UPLOAD_INVALID_FORMAT', 400, errorMessage);
  }

  const chunks: WebpChunk[] = [];
  let offset = 12;
  const containerEnd = 8 + declaredSize;
  while (offset < containerEnd) {
    if (offset + 8 > containerEnd) {
      throw new AppError('UPLOAD_INVALID_FORMAT', 400, errorMessage);
    }

    const chunkType = buffer.toString('ascii', offset, offset + 4);
    const dataLength = buffer.readUInt32LE(offset + 4);
    const paddedLength = dataLength + (dataLength % 2);
    const chunkEnd = offset + 8 + paddedLength;
    if (chunkEnd > containerEnd) {
      throw new AppError('UPLOAD_INVALID_FORMAT', 400, errorMessage);
    }

    chunks.push({
      chunkEnd,
      dataLength,
      dataStart: offset + 8,
      offset,
      type: chunkType,
    });
    offset = chunkEnd;
  }

  return chunks;
}

function sanitizeWebpChunk(buffer: Buffer, chunk: WebpChunk): Buffer {
  if (chunk.type !== 'VP8X') {
    return buffer.subarray(chunk.offset, chunk.chunkEnd);
  }

  const sanitized = Buffer.from(buffer.subarray(chunk.offset, chunk.chunkEnd));
  sanitized[8] = sanitized[8] & ~WEBP_VP8X_METADATA_FLAGS;
  return sanitized;
}
