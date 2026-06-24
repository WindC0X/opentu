import { describe, expect, it } from 'vitest';
import {
  shouldClearPendingPersistenceAfterSave,
  shouldFlushBoardBeforeLeave,
  selectViewportForBoardPersistence,
  shouldIgnoreViewportChangeDuringRestore,
  shouldPersistViewportChange,
} from './viewport-persistence';

describe('viewport persistence before leave', () => {
  it('flushes viewport-only dirty state on visibilitychange', () => {
    expect(
      shouldFlushBoardBeforeLeave('visibilitychange', {
        hasPendingPersistence: true,
        hasLocalDirty: true,
      })
    ).toBe(true);
  });

  it('skips visibilitychange when there is no pending viewport or board change', () => {
    expect(
      shouldFlushBoardBeforeLeave('visibilitychange', {
        hasPendingPersistence: false,
        hasLocalDirty: false,
      })
    ).toBe(false);
  });

  it('flushes pending state on pagehide even if local dirty flag was already reset', () => {
    expect(
      shouldFlushBoardBeforeLeave('pagehide', {
        hasPendingPersistence: true,
        hasLocalDirty: false,
      })
    ).toBe(true);
  });
});

describe('viewport persistence guard', () => {
  it('skips viewport persistence before board data is ready', () => {
    expect(
      shouldPersistViewportChange({
        isDataReady: false,
        isSyncing: false,
        hasCurrentBoard: true,
        hasMatchingSnapshot: true,
      })
    ).toBe(false);
  });

  it('skips viewport persistence while tab sync is applying remote data', () => {
    expect(
      shouldPersistViewportChange({
        isDataReady: true,
        isSyncing: true,
        hasCurrentBoard: true,
        hasMatchingSnapshot: true,
      })
    ).toBe(false);
  });

  it('skips viewport persistence when only metadata fallback or stale snapshot is available', () => {
    expect(
      shouldPersistViewportChange({
        isDataReady: true,
        isSyncing: false,
        hasCurrentBoard: false,
        hasMatchingSnapshot: true,
      })
    ).toBe(false);

    expect(
      shouldPersistViewportChange({
        isDataReady: true,
        isSyncing: false,
        hasCurrentBoard: true,
        hasMatchingSnapshot: false,
      })
    ).toBe(false);
  });

  it('allows viewport persistence only with ready data and matching full snapshot', () => {
    expect(
      shouldPersistViewportChange({
        isDataReady: true,
        isSyncing: false,
        hasCurrentBoard: true,
        hasMatchingSnapshot: true,
      })
    ).toBe(true);
  });

  it('ignores non-user viewport scroll noise while restored viewport is stabilizing', () => {
    expect(
      shouldIgnoreViewportChangeDuringRestore({
        hasRestoredViewport: true,
        sameBoard: true,
        userInteracted: false,
        now: 1_000,
        ignoreUntil: 2_000,
      })
    ).toBe(true);
  });

  it('does not ignore viewport changes after restore guard expires or user interacts', () => {
    expect(
      shouldIgnoreViewportChangeDuringRestore({
        hasRestoredViewport: true,
        sameBoard: true,
        userInteracted: false,
        now: 2_001,
        ignoreUntil: 2_000,
      })
    ).toBe(false);

    expect(
      shouldIgnoreViewportChangeDuringRestore({
        hasRestoredViewport: true,
        sameBoard: true,
        userInteracted: true,
        now: 1_000,
        ignoreUntil: 2_000,
      })
    ).toBe(false);
  });

  it('can keep restored viewport authoritative until explicit user interaction', () => {
    expect(
      shouldIgnoreViewportChangeDuringRestore({
        hasRestoredViewport: true,
        sameBoard: true,
        userInteracted: false,
        now: 60_000,
        ignoreUntil: Number.POSITIVE_INFINITY,
      })
    ).toBe(true);
  });

  it('preserves the restored viewport when a board change carries non-user viewport noise', () => {
    const restored = { zoom: 0.42, origination: [321, 654] };
    const noisy = { zoom: 0.42, origination: [-639.52, -360.85] };

    expect(
      selectViewportForBoardPersistence({
        incomingViewport: noisy,
        restoredViewport: restored,
        ignoreIncomingViewport: true,
      })
    ).toBe(restored);
  });

  it('keeps the incoming viewport when restore guard is not active', () => {
    const restored = { zoom: 0.42, origination: [321, 654] };
    const incoming = { zoom: 0.5, origination: [100, 200] };

    expect(
      selectViewportForBoardPersistence({
        incomingViewport: incoming,
        restoredViewport: restored,
        ignoreIncomingViewport: false,
      })
    ).toBe(incoming);
  });
});

describe('viewport persistence save ordering', () => {
  it('does not let an older async save clear pending state for a newer board change', () => {
    expect(
      shouldClearPendingPersistenceAfterSave({
        completedSaveVersion: 4,
        latestChangeVersion: 5,
      })
    ).toBe(false);
  });

  it('clears pending state only when the completed save covered the latest change', () => {
    expect(
      shouldClearPendingPersistenceAfterSave({
        completedSaveVersion: 5,
        latestChangeVersion: 5,
      })
    ).toBe(true);
  });
});
