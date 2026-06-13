export const ASSET_LIBRARY_URL_PREFIX = '/asset-library/';
export const CACHE_URL_PREFIX = '/__aitu_cache__/';
export const AI_GENERATED_URL_PREFIX = '/__aitu_generated__/';
export const AI_GENERATED_AUDIO_URL_PREFIX = `${AI_GENERATED_URL_PREFIX}audio/`;

export function normalizeVirtualMediaUrl(url: string): string {
  if (!url) return url;

  try {
    const parsed = new URL(url, 'http://aitu.local');
    return parsed.pathname;
  } catch {
    return url;
  }
}

export function isAssetLibraryUrl(url: string): boolean {
  return normalizeVirtualMediaUrl(url).startsWith(ASSET_LIBRARY_URL_PREFIX);
}

export function isLegacyCacheUrl(url: string): boolean {
  return normalizeVirtualMediaUrl(url).startsWith(CACHE_URL_PREFIX);
}

export function isAIGeneratedAudioUrl(url: string): boolean {
  return normalizeVirtualMediaUrl(url).startsWith(AI_GENERATED_AUDIO_URL_PREFIX);
}

export function isAIGeneratedVirtualUrl(url: string): boolean {
  return normalizeVirtualMediaUrl(url).startsWith(AI_GENERATED_URL_PREFIX);
}

export function isVirtualMediaUrl(url: string): boolean {
  return (
    isAssetLibraryUrl(url) ||
    isLegacyCacheUrl(url) ||
    isAIGeneratedVirtualUrl(url)
  );
}
