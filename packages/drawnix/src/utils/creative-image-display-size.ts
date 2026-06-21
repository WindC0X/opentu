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
