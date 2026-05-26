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
  if (mimeType !== 'image/jpeg') {
    return buffer;
  }
  return stripJpegExif(buffer);
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
  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType === 'VP8X' && buffer.length >= 30) {
    return {
      height: 1 + buffer.readUIntLE(27, 3),
      width: 1 + buffer.readUIntLE(24, 3),
    };
  }
  if (chunkType === 'VP8 ' && buffer.length >= 30) {
    return {
      height: buffer.readUInt16LE(28) & 0x3fff,
      width: buffer.readUInt16LE(26) & 0x3fff,
    };
  }
  if (chunkType === 'VP8L' && buffer.length >= 25) {
    const bits = buffer.readUInt32LE(21);
    return {
      height: ((bits >> 14) & 0x3fff) + 1,
      width: (bits & 0x3fff) + 1,
    };
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
