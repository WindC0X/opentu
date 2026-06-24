export type LeaveFlushReason = 'visibilitychange' | 'pagehide' | 'beforeunload';

export interface LeaveFlushState {
  hasPendingPersistence: boolean;
  hasLocalDirty: boolean;
}

export interface ViewportPersistState {
  isDataReady: boolean;
  isSyncing: boolean;
  hasCurrentBoard: boolean;
  hasMatchingSnapshot: boolean;
}

export interface SaveCompletionState {
  completedSaveVersion: number;
  latestChangeVersion: number;
}

export interface ViewportRestoreGuardState {
  hasRestoredViewport: boolean;
  sameBoard: boolean;
  userInteracted: boolean;
  now: number;
  ignoreUntil: number;
}

export interface BoardChangeViewportState<TViewport> {
  incomingViewport: TViewport | undefined;
  restoredViewport: TViewport | undefined;
  ignoreIncomingViewport: boolean;
}

export function shouldPersistViewportChange(
  state: ViewportPersistState
): boolean {
  return (
    state.isDataReady &&
    !state.isSyncing &&
    state.hasCurrentBoard &&
    state.hasMatchingSnapshot
  );
}

/**
 * Viewport-only pan/zoom changes are user-local edits. They must be flushed
 * before page hide just like element edits, otherwise a refresh can restore the
 * old/default viewport even though the board content is current.
 */
export function shouldFlushBoardBeforeLeave(
  reason: LeaveFlushReason,
  state: LeaveFlushState
): boolean {
  if (!state.hasPendingPersistence) {
    return false;
  }

  if (reason === 'visibilitychange') {
    return state.hasLocalDirty;
  }

  return true;
}

export function shouldClearPendingPersistenceAfterSave(
  state: SaveCompletionState
): boolean {
  return state.completedSaveVersion >= state.latestChangeVersion;
}

export function shouldIgnoreViewportChangeDuringRestore(
  state: ViewportRestoreGuardState
): boolean {
  return (
    state.hasRestoredViewport &&
    state.sameBoard &&
    !state.userInteracted &&
    state.now <= state.ignoreUntil
  );
}

export function selectViewportForBoardPersistence<TViewport>(
  state: BoardChangeViewportState<TViewport>
): TViewport | undefined {
  if (state.ignoreIncomingViewport && state.restoredViewport) {
    return state.restoredViewport;
  }

  return state.incomingViewport;
}
