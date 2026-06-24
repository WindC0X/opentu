import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeCanvasInsertion, setCanvasBoard } from '../canvas-insertion';

const mocks = vi.hoisted(() => ({
  insertMediaIntoSelectedFrame: vi.fn(),
}));

vi.mock('../../../utils/frame-insertion-utils', () => ({
  insertMediaIntoSelectedFrame: mocks.insertMediaIntoSelectedFrame,
}));

describe('executeCanvasInsertion selected frame path', () => {
  afterEach(() => {
    setCanvasBoard(null);
    mocks.insertMediaIntoSelectedFrame.mockReset();
  });

  it('passes generated image metadata into selected-frame insertion', async () => {
    const board = { children: [] } as any;
    const metadata = {
      contentUrl: '/creative/relay/v1/images/tasks/remote-1/content',
      remoteTaskId: 'remote-1',
      providerTaskId: 'provider-1',
      mimeType: 'image/png',
    };
    mocks.insertMediaIntoSelectedFrame.mockResolvedValueOnce({
      point: [10, 20],
      elementId: 'image-1',
      size: { width: 512, height: 512 },
    });
    setCanvasBoard(board);

    const result = await executeCanvasInsertion({
      items: [
        {
          type: 'image',
          content: '/__aitu_cache__/image/generated.png',
          dimensions: { width: 512, height: 512 },
          metadata,
        },
      ],
    });

    expect(mocks.insertMediaIntoSelectedFrame).toHaveBeenCalledWith(
      board,
      '/__aitu_cache__/image/generated.png',
      'image',
      { width: 512, height: 512 },
      { metadata }
    );
    expect(result).toMatchObject({
      success: true,
      data: {
        insertedCount: 1,
        firstElementId: 'image-1',
      },
    });
  });
});
