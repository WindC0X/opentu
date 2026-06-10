import { createTestingBoard, type Point } from '@plait/core';
import { describe, expect, it } from 'vitest';
import type { PlaitFrame } from '../../types/frame.types';
import {
  getPPTFrameSnapshotElements,
  resolvePPTFramePreviewUrl,
} from '../frame-preview-snapshot';

function createBoard(children: any[] = []) {
  return createTestingBoard([], children) as any;
}

function makePoints(
  start: Point = [0, 0],
  end: Point = [1920, 1080]
): [Point, Point] {
  return [start, end];
}

function createFrame(
  id: string,
  overrides: Partial<PlaitFrame> = {}
): PlaitFrame {
  return {
    id,
    type: 'frame',
    name: id,
    points: makePoints(),
    children: [],
    ...overrides,
  };
}

describe('frame-preview-snapshot', () => {
  it('collects the frame and its bound children only', () => {
    const frame = createFrame('frame-1');
    const board = createBoard([
      frame,
      createFrame('frame-2', {
        points: makePoints([2200, 0], [4120, 1080]),
      }),
      {
        id: 'text-1',
        type: 'text',
        frameId: 'frame-1',
        points: [
          [10, 10],
          [100, 40],
        ],
        text: 'inside',
      },
      {
        id: 'image-1',
        type: 'image',
        frameId: 'frame-1',
        points: [
          [100, 100],
          [400, 300],
        ],
        url: '/inside.png',
      },
      {
        id: 'center-inside',
        type: 'text',
        points: [
          [500, 500],
          [700, 580],
        ],
        text: 'unbound inside',
      },
      {
        id: 'outside',
        type: 'text',
        points: [
          [2100, 500],
          [2200, 580],
        ],
        text: 'outside',
      },
      {
        id: 'other-frame-child',
        type: 'text',
        frameId: 'frame-2',
        points: [
          [20, 20],
          [120, 60],
        ],
        text: 'other',
      },
    ]);

    expect(
      getPPTFrameSnapshotElements(board, frame).map((element) => element.id)
    ).toEqual(['frame-1', 'text-1', 'image-1', 'center-inside']);
  });

  it('uses snapshot url before the generated slide image url', () => {
    expect(
      resolvePPTFramePreviewUrl('data:image/png;base64,snapshot', 'old')
    ).toBe('data:image/png;base64,snapshot');
    expect(resolvePPTFramePreviewUrl(undefined, 'old')).toBe('old');
    expect(resolvePPTFramePreviewUrl()).toBeUndefined();
  });
});
