export const CREATIVE_ASSET_API_PATH_PREFIX = '/creative/api/assets';
export const CREATIVE_API_PATH_PREFIX = '/creative/api';
export const CREATIVE_RELAY_PATH_PREFIX = '/creative/relay';

function matchesPathPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function isCreativeAssetApiPath(pathname: string): boolean {
  return matchesPathPrefix(pathname, CREATIVE_ASSET_API_PATH_PREFIX);
}

export function isCreativePrivateApiPath(pathname: string): boolean {
  return (
    matchesPathPrefix(pathname, CREATIVE_API_PATH_PREFIX) ||
    matchesPathPrefix(pathname, CREATIVE_RELAY_PATH_PREFIX)
  );
}
