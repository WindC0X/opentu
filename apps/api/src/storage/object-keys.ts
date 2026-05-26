import { AppError } from '../errors';
import type { AssetVariantType } from '../assets/types';

export function extensionForMimeType(mimeType: string): 'jpg' | 'png' | 'webp' {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      throw new AppError('UPLOAD_INVALID_FORMAT', 400, '不支持的图片格式');
  }
}

export function buildAssetObjectKey(input: {
  assetId: string;
  mimeType: string;
  projectId: string;
  prefix?: string;
  tenantId: string;
  userId: string;
  variantType: AssetVariantType;
}): string {
  const extension = extensionForMimeType(input.mimeType);
  const prefix = input.prefix ? `${trimSlashes(input.prefix)}/` : '';
  return `${prefix}tenants/${input.tenantId}/users/${input.userId}/projects/${input.projectId}/assets/${input.assetId}/${input.variantType}.${extension}`;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}
