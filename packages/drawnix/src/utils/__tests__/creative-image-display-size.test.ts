import { describe, expect, it } from 'vitest';
import {
  fitCreativeImagePreviewBox,
  normalizeCreativeImageDisplaySize,
  resolveCreativeImageAspectRatio,
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

  it('prefers actual dimensions over target and requested ratios', () => {
    expect(
      resolveCreativeImageAspectRatio({
        width: 3840,
        height: 1648,
        targetWidth: 1024,
        targetHeight: 1024,
        userParams: { aspectRatio: '1:1' },
      })
    ).toBeCloseTo(3840 / 1648);

    expect(
      resolveCreativeImageAspectRatio({
        targetWidth: 1792,
        targetHeight: 768,
        userParams: { aspectRatio: '1:1' },
      })
    ).toBeCloseTo(1792 / 768);
  });

  it('fits task previews inside the list thumbnail box while preserving ratio', () => {
    expect(
      fitCreativeImagePreviewBox(
        { userParams: { aspectRatio: '21:9' } },
        120,
        90
      )
    ).toEqual({ width: 120, height: 51 });

    expect(
      fitCreativeImagePreviewBox(
        { userParams: { aspectRatio: '9:16' } },
        120,
        90
      )
    ).toEqual({ width: 51, height: 90 });

    expect(fitCreativeImagePreviewBox({}, 120, 90)).toEqual({
      width: 120,
      height: 90,
    });
  });
});
