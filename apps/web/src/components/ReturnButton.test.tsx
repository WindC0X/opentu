import { describe, expect, it } from 'vitest';
import {
  RETURN_BUTTON_LEFT,
  RETURN_BUTTON_Z_INDEX,
  getReturnButtonStyle,
} from './ReturnButton';
import { isEmbeddedInNewApi } from '../utils/embed-detection';

function locationLike(pathname: string): Location {
  return { pathname } as Location;
}

describe('ReturnButton', () => {
  it('is enabled only in embedded /creative mode', () => {
    expect(isEmbeddedInNewApi(locationLike('/creative/board/demo'))).toBe(true);
    expect(isEmbeddedInNewApi(locationLike('/creative'))).toBe(true);
    expect(isEmbeddedInNewApi(locationLike('/board/demo'))).toBe(false);
  });

  it('keeps the button outside the docked left toolbar safe area', () => {
    const style = getReturnButtonStyle();

    expect(style.left).toBe(RETURN_BUTTON_LEFT);
    expect(style.zIndex).toBe(RETURN_BUTTON_Z_INDEX);
  });
});
