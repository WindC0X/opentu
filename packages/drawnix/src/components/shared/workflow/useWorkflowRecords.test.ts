import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useWorkflowRecords,
  type WorkflowRecordBase,
} from './useWorkflowRecords';

interface TestRecord extends WorkflowRecordBase {
  label: string;
}

const firstRecord: TestRecord = {
  id: 'record_1',
  label: 'First',
  starred: false,
};

const starredRecord: TestRecord = {
  id: 'record_2',
  label: 'Starred',
  starred: true,
};

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useWorkflowRecords', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('loads records and counts starred records', async () => {
    const loadRecords = vi.fn(async () => [firstRecord, starredRecord]);

    const { result } = renderHook(() => useWorkflowRecords<TestRecord>({ loadRecords }));
    await flushEffects();

    expect(loadRecords).toHaveBeenCalledTimes(1);
    expect(result.current.records).toEqual([firstRecord, starredRecord]);
    expect(result.current.starredCount).toBe(1);
  });

  it('selects, updates, and restarts the current record', async () => {
    const loadRecords = vi.fn(async () => [firstRecord]);
    const { result } = renderHook(() => useWorkflowRecords<TestRecord>({ loadRecords }));
    await flushEffects();

    act(() => {
      result.current.selectRecord(firstRecord);
    });
    expect(result.current.currentRecord).toEqual(firstRecord);

    const updatedRecord = { ...firstRecord, label: 'Updated' };
    act(() => {
      result.current.updateCurrentRecord(updatedRecord);
    });
    expect(result.current.currentRecord).toEqual(updatedRecord);

    act(() => {
      result.current.restart();
    });
    expect(result.current.currentRecord).toBeNull();
  });

  it('toggles starred history state', async () => {
    const loadRecords = vi.fn(async () => [firstRecord]);
    const { result } = renderHook(() => useWorkflowRecords<TestRecord>({ loadRecords }));
    await flushEffects();

    act(() => {
      result.current.setShowStarred(true);
    });

    expect(result.current.showStarred).toBe(true);
  });

  it('applies synced records to matching current record only', async () => {
    const loadRecords = vi.fn(async () => [firstRecord]);
    const { result } = renderHook(() => useWorkflowRecords<TestRecord>({ loadRecords }));
    await flushEffects();

    act(() => {
      result.current.selectRecord(firstRecord);
    });

    const syncedRecord = { ...firstRecord, label: 'Synced' };
    act(() => {
      result.current.applySyncedRecord({
        records: [syncedRecord],
        record: syncedRecord,
      });
    });

    expect(result.current.records).toEqual([syncedRecord]);
    expect(result.current.currentRecord).toEqual(syncedRecord);

    act(() => {
      result.current.applySyncedRecord({
        records: [starredRecord],
        record: starredRecord,
      });
    });

    expect(result.current.records).toEqual([starredRecord]);
    expect(result.current.currentRecord).toEqual(syncedRecord);
  });

  it('can select synced record when no current record is active', async () => {
    const loadRecords = vi.fn(async () => []);
    const { result } = renderHook(() => useWorkflowRecords<TestRecord>({ loadRecords }));
    await flushEffects();

    act(() => {
      result.current.applySyncedRecord({
        records: [firstRecord],
        record: firstRecord,
        selectWhenNoCurrent: true,
      });
    });

    expect(result.current.currentRecord).toEqual(firstRecord);
  });

  it('falls back to an empty list for invalid load results and load failures', async () => {
    const invalidLoad = vi.fn(async () => null as unknown as TestRecord[]);
    const invalidView = renderHook(() =>
      useWorkflowRecords<TestRecord>({ loadRecords: invalidLoad })
    );
    await flushEffects();
    expect(invalidView.result.current.records).toEqual([]);
    invalidView.unmount();

    const failingLoad = vi.fn(async () => {
      throw new Error('load failed');
    });
    const failingView = renderHook(() =>
      useWorkflowRecords<TestRecord>({ loadRecords: failingLoad })
    );
    await flushEffects();
    expect(failingView.result.current.records).toEqual([]);
    failingView.unmount();
  });
});
