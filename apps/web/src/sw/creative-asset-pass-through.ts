export const CREATIVE_ASSET_API_PATH_PREFIX = '/creative/api/assets';

export function isCreativeAssetApiPath(pathname: string): boolean {
  return (
    pathname === CREATIVE_ASSET_API_PATH_PREFIX ||
    pathname.startsWith(`${CREATIVE_ASSET_API_PATH_PREFIX}/`)
  );
}
