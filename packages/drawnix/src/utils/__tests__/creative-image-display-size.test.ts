import { describe, expect, it } from 'vitest';
import {
  normalizeCreativeImageDisplaySize,
  resolveCreativeImageDisplaySize,
} from '../creative-image-display-size';
import { parseSizeToPixels } from '../size-ratio';

describe('creative image display size', () => {
  it('normalizes schema aspect ratios for local display only', () => {
    expect(normalizeCreativeImageDisplaySize('21:9')).toBe('21x9');
    expect(normalizeCreativeImageDisplaySize('1792x768')).toBe('1792x768');
    expect(normalizeCreativeImageDisplaySize('auto')).toBeUndefined();
  });

  it('resolves backend userParams aspectRatio when legacy size is absent', () => {
    expect(
      resolveCreativeImageDisplaySize({
        userParams: {
          aspectRatio: '9:16',
          imageSize: '1K',
          quality: 'high',
        },
      })
    ).toBe('9x16');
  });

  it('keeps ratio geometry usable by the existing size parser', () => {
    expect(parseSizeToPixels('21:9')).toEqual({ width: 400, height: 171 });
    expect(parseSizeToPixels('21x9')).toEqual({ width: 400, height: 171 });
  });
});
