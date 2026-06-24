import { describe, expect, it } from 'vitest';

import { extractImagesFromElement } from '../selection-utils';

describe('selection-utils generated image metadata', () => {
  it('preserves generated image rehydrate metadata from selected image elements', () => {
    const images = extractImagesFromElement({
      id: 'image-node-1',
      url: '/__aitu_cache__/image/generated.png',
      width: 1024,
      height: 1024,
      contentUrl: '/creative/relay/v1/images/tasks/remote-1/content',
      remoteTaskId: 'remote-1',
      providerTaskId: 'provider-1',
      mimeType: 'image/png',
    } as any);

    expect(images[0]).toMatchObject({
      url: '/__aitu_cache__/image/generated.png',
      width: 1024,
      height: 1024,
      contentUrl: '/creative/relay/v1/images/tasks/remote-1/content',
      remoteTaskId: 'remote-1',
      providerTaskId: 'provider-1',
      mimeType: 'image/png',
    });
  });
});
