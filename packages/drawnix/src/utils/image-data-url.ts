const BASE64_IMAGE_SIGNATURES: Array<{ prefix: string; mimeType: string }> = [
  { prefix: 'iVBORw0KGgo', mimeType: 'image/png' },
  { prefix: '/9j/', mimeType: 'image/jpeg' },
  { prefix: 'R0lGOD', mimeType: 'image/gif' },
  { prefix: 'UklGR', mimeType: 'image/webp' },
  { prefix: 'Qk', mimeType: 'image/bmp' },
  { prefix: 'PHN2Zy', mimeType: 'image/svg+xml' },
  { prefix: 'PD94bWwg', mimeType: 'image/svg+xml' },
  { prefix: 'AAAAIGZ0eXBhdmlm', mimeType: 'image/avif' },
  { prefix: 'AAAAGGZ0eXBhdmlm', mimeType: 'image/avif' },
  { prefix: 'AAABAA', mimeType: 'image/x-icon' },
];

const BASE64_IMAGE_BODY_REGEX = /^[A-Za-z0-9+/=\r\n]+$/;

function sanitizeBase64Payload(base64: string): string {
  return base64.trim().replace(/\s+/g, '');
}

function inferImageMimeTypeFromBase64(base64: string): string | undefined {
  const normalized = sanitizeBase64Payload(base64);
  if (!normalized) {
    return undefined;
  }
  return BASE64_IMAGE_SIGNATURES.find(({ prefix }) =>
    normalized.startsWith(prefix)
  )?.mimeType;
}

export function normalizeImageDataUrl(
  value: string,
  fallbackMimeType = 'image/png'
): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return value;
  }

  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('blob:') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://')
  ) {
    return trimmed;
  }

  if (
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    if (!inferImageMimeTypeFromBase64(trimmed)) {
      return trimmed;
    }
  }

  const normalized = sanitizeBase64Payload(trimmed);
  if (!BASE64_IMAGE_BODY_REGEX.test(normalized) || normalized.length < 32) {
    return trimmed;
  }

  const mimeType = inferImageMimeTypeFromBase64(normalized) || fallbackMimeType;
  return `data:${mimeType};base64,${normalized}`;
}
