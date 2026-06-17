import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  isCreativeAssetApiPath,
  isCreativePrivateApiPath,
} from './creative-asset-pass-through';

describe('creative asset service worker pass-through', () => {
  it('recognizes creative asset upload, content, and metadata API paths', () => {
    expect(isCreativeAssetApiPath('/creative/api/assets')).toBe(true);
    expect(isCreativeAssetApiPath('/creative/api/assets/asset_1')).toBe(true);
    expect(isCreativeAssetApiPath('/creative/api/assets/asset_1/content')).toBe(
      true
    );
    expect(isCreativeAssetApiPath('/creative/api/documents')).toBe(false);
    expect(isCreativeAssetApiPath('/__aitu_cache__/image/a.png')).toBe(false);
  });

  it('recognizes all private Creative API and relay paths for debug-log bypass', () => {
    expect(isCreativePrivateApiPath('/creative/api/bootstrap')).toBe(true);
    expect(isCreativePrivateApiPath('/creative/api/documents/doc-1')).toBe(
      true
    );
    expect(
      isCreativePrivateApiPath('/creative/api/assets/asset-1/content')
    ).toBe(true);
    expect(isCreativePrivateApiPath('/creative/relay/v1/images/tasks')).toBe(
      true
    );
    expect(isCreativePrivateApiPath('/creative/assets/app.js')).toBe(false);
    expect(isCreativePrivateApiPath('/api/creative')).toBe(false);
  });

  it('keeps the pass-through branch before virtual media, media, static, and debug cache handlers', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, 'index.ts'),
      'utf-8'
    );
    const fetchHandler = source.indexOf("sw.addEventListener('fetch'");
    const fetchSource = source.slice(fetchHandler);
    const passThrough = fetchSource.indexOf(
      'isCreativePrivateApiPath(url.pathname)'
    );

    expect(passThrough).toBeGreaterThanOrEqual(0);
    expect(passThrough).toBeLessThan(
      fetchSource.indexOf('url.pathname.startsWith(CACHE_URL_PREFIX)')
    );
    expect(passThrough).toBeLessThan(fetchSource.indexOf('isVideoRequest(url'));
    expect(passThrough).toBeLessThan(
      fetchSource.indexOf('handleStaticRequest')
    );
    expect(passThrough).toBeLessThan(fetchSource.indexOf('XHR/API request'));
  });
});
