import { describe, expect, it } from 'vitest';
import type { VideoShot } from '../../../services/video-analysis-service';
import { updateActiveVersionShotsInRecord } from './versioned-shots';

describe('versioned-shots', () => {
  it('updates edited shots and active version shots together', () => {
    const updatedShots: VideoShot[] = [
      {
        id: 'shot_1',
        startTime: 0,
        endTime: 3,
        description: 'new',
        type: 'opening',
        label: '开场',
      },
    ];

    const record = {
      activeVersionId: 'v2',
      editedShots: [] as VideoShot[],
      scriptVersions: [
        {
          id: 'v1',
          shots: [
            {
              id: 'shot_1',
              startTime: 0,
              endTime: 3,
              description: 'old',
              type: 'opening' as const,
              label: '开场',
            },
          ],
        },
        {
          id: 'v2',
          shots: [
            {
              id: 'shot_1',
              startTime: 0,
              endTime: 3,
              description: 'old',
              type: 'opening' as const,
              label: '开场',
            },
          ],
        },
      ],
    };

    const patch = updateActiveVersionShotsInRecord(record, 'scriptVersions', updatedShots);

    expect(patch.editedShots).toEqual(updatedShots);
    expect(patch.scriptVersions?.[0].shots[0].description).toBe('old');
    expect(patch.scriptVersions?.[1].shots).toEqual(updatedShots);
  });

  it('only updates edited shots when no active version exists', () => {
    const updatedShots: VideoShot[] = [
      {
        id: 'shot_1',
        startTime: 0,
        endTime: 3,
        description: 'new',
        type: 'opening',
        label: '开场',
      },
    ];

    const patch = updateActiveVersionShotsInRecord(
      {
        editedShots: [] as VideoShot[],
        storyboardVersions: undefined,
      },
      'storyboardVersions',
      updatedShots
    );

    expect(patch).toEqual({
      editedShots: updatedShots,
    });
  });
});
