import { describe, expect, it } from 'vitest';

describe('generated image canvas metadata', () => {
  it('keeps only durable image rehydrate fields for canvas nodes', async () => {
    const { getGeneratedImageCanvasMetadata } = await import(
      '../generated-image-canvas-metadata'
    );

    expect(
      getGeneratedImageCanvasMetadata({
        contentUrl: '/creative/relay/v1/images/tasks/remote-1/content',
        remoteTaskId: 'remote-1',
        providerTaskId: 'provider-1',
        mimeType: 'image/png',
        ignored: 'not-persisted',
      })
    ).toEqual({
      contentUrl: '/creative/relay/v1/images/tasks/remote-1/content',
      remoteTaskId: 'remote-1',
      providerTaskId: 'provider-1',
      mimeType: 'image/png',
    });
  });
});
