const CREATIVE_SENSITIVE_ERROR_PATTERN =
  /(authorization|bearer|api[_-]?key|apikey|upstream|credential|secret|token|x-amz-|signature|provider|channel|baseurl|base-url|callback|webhook|notify[_-]?hook|notifyhook|https?:\/\/|s3:\/\/)/i;

export function sanitizeCreativeFailureMessage(
  value: unknown,
  fallback: string
): string {
  if (typeof value !== 'string') {
    return fallback;
  }
  const text = value.trim();
  if (!text) {
    return fallback;
  }
  if (CREATIVE_SENSITIVE_ERROR_PATTERN.test(text)) {
    return fallback;
  }
  return text.length > 200 ? text.slice(0, 200) : text;
}

export function sanitizeCreativeFailureObjectMessage(
  value: unknown,
  fallback: string
): string {
  if (typeof value === 'string') {
    return sanitizeCreativeFailureMessage(value, fallback);
  }
  if (value && typeof value === 'object') {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string') {
      return sanitizeCreativeFailureMessage(message, fallback);
    }
    return sanitizeCreativeFailureMessage(JSON.stringify(value), fallback);
  }
  return fallback;
}
