import type { CreativeUserParams } from '../constants/model-config';

function stringParam(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Normalize backend schema-backed Creative image sizing controls into the
 * local Drawnix display-size syntax used by anchors and canvas insertion.
 *
 * This value is display-only. Schema-backed requests must still submit the
 * backend-owned typed userParams instead of legacy `size` provider params.
 */
export function normalizeCreativeImageDisplaySize(
  value: unknown
): string | undefined {
  const raw = stringParam(value);
  if (!raw || raw.toLowerCase() === 'auto') {
    return undefined;
  }

  const ratio = raw.match(/^(\d+)\s*[:x]\s*(\d+)$/i);
  if (!ratio) {
    return undefined;
  }

  return `${ratio[1]}x${ratio[2]}`.toLowerCase();
}

export function resolveCreativeImageDisplaySize(input: {
  size?: string;
  userParams?: CreativeUserParams | null;
}): string | undefined {
  return (
    normalizeCreativeImageDisplaySize(input.size) ||
    normalizeCreativeImageDisplaySize(input.userParams?.aspectRatio) ||
    normalizeCreativeImageDisplaySize(input.userParams?.size)
  );
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined;
}

function ratioFromSize(value: string | undefined): number | undefined {
  const size = normalizeCreativeImageDisplaySize(value);
  const match = size?.match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) {
    return undefined;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? width / height : undefined;
}

export function resolveCreativeImageAspectRatio(input: {
  width?: number;
  height?: number;
  targetWidth?: number;
  targetHeight?: number;
  size?: string;
  userParams?: CreativeUserParams | null;
}): number | undefined {
  const width = positiveNumber(input.width);
  const height = positiveNumber(input.height);
  if (width && height) {
    return width / height;
  }

  const targetWidth = positiveNumber(input.targetWidth);
  const targetHeight = positiveNumber(input.targetHeight);
  if (targetWidth && targetHeight) {
    return targetWidth / targetHeight;
  }

  return ratioFromSize(
    resolveCreativeImageDisplaySize({
      size: input.size,
      userParams: input.userParams,
    })
  );
}

export function fitCreativeImagePreviewBox(
  input: {
    width?: number;
    height?: number;
    targetWidth?: number;
    targetHeight?: number;
    size?: string;
    userParams?: CreativeUserParams | null;
  },
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  const ratio = resolveCreativeImageAspectRatio(input);
  if (!ratio) {
    return { width: maxWidth, height: maxHeight };
  }

  const maxRatio = maxWidth / maxHeight;
  if (ratio >= maxRatio) {
    return {
      width: maxWidth,
      height: Math.max(1, Math.round(maxWidth / ratio)),
    };
  }

  return {
    width: Math.max(1, Math.round(maxHeight * ratio)),
    height: maxHeight,
  };
}
