import { describe, expect, it, vi } from 'vitest';
import { TaskType, type Task } from '../../../types/task.types';
import {
  extractGeneratedClipsFromAudioTask,
  mergeGeneratedClips,
  syncGeneratedClipsForRecord,
} from './audio-task-sync';

type GeneratedClip = {
  clipId: string;
  audioUrl: string;
  imageUrl?: string;
  title?: string;
  duration?: number | null;
  taskId: string;
};

interface TestRecord {
  id: string;
  generatedClips?: GeneratedClip[];
}

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_1',
    type: TaskType.AUDIO,
    status: 'completed',
    params: {},
    createdAt: 1,
    updatedAt: 1,
    result: {
      url: '',
      format: 'mp3',
      size: 1,
    },
    ...overrides,
  } as Task;
}

describe('audio-task-sync', () => {
  it('extracts clip arrays from completed audio tasks', () => {
    const task = createTask({
      id: 'task_clip',
      remoteId: 'remote_clip',
      result: {
        url: '',
        format: 'mp3',
        size: 1,
        providerTaskId: 'provider_clip',
        clips: [
          {
            clipId: 'clip_1',
            audioUrl: 'https://example.com/audio.mp3',
            imageLargeUrl: 'https://example.com/cover.png',
            title: 'Demo',
            duration: 12,
          },
        ],
      },
    });

    expect(extractGeneratedClipsFromAudioTask(task)).toEqual([
      {
        clipId: 'clip_1',
        audioUrl: 'https://example.com/audio.mp3',
        imageUrl: 'https://example.com/cover.png',
        title: 'Demo',
        duration: 12,
        taskId: 'provider_clip',
      },
    ]);
  });

  it('falls back to single-url audio result payloads', () => {
    const task = createTask({
      id: 'task_url',
      result: {
        url: 'https://example.com/single.mp3',
        format: 'mp3',
        size: 1,
        title: 'Single',
        duration: 30,
        previewImageUrl: 'https://example.com/single.png',
        primaryClipId: 'clip_single',
      },
    });

    expect(extractGeneratedClipsFromAudioTask(task)).toEqual([
      {
        clipId: 'clip_single',
        audioUrl: 'https://example.com/single.mp3',
        imageUrl: 'https://example.com/single.png',
        title: 'Single',
        duration: 30,
        taskId: 'task_url',
      },
    ]);
  });

  it('merges clips by clipId and reports changes', () => {
    const merged = mergeGeneratedClips(
      [
        {
          clipId: 'clip_1',
          audioUrl: 'https://example.com/old.mp3',
          taskId: 'task_old',
        },
      ],
      [
        {
          clipId: 'clip_1',
          audioUrl: 'https://example.com/new.mp3',
          imageUrl: 'https://example.com/cover.png',
          taskId: 'task_new',
        },
      ]
    );

    expect(merged.changed).toBe(true);
    expect(merged.clips).toEqual([
      {
        clipId: 'clip_1',
        audioUrl: 'https://example.com/new.mp3',
        imageUrl: 'https://example.com/cover.png',
        taskId: 'task_new',
      },
    ]);
  });

  it('updates records with merged generated clips', async () => {
    const loadRecords = vi.fn<() => Promise<TestRecord[]>>(async () => [
      {
        id: 'record_1',
        generatedClips: [],
      },
    ]);
    const updateRecord = vi.fn<(id: string, patch: Partial<TestRecord>) => Promise<TestRecord[]>>(async (_id, patch) => [
      {
        id: 'record_1',
        generatedClips: patch.generatedClips,
      },
    ]);

    const result = await syncGeneratedClipsForRecord(createTask({
      id: 'task_sync',
      result: {
        url: 'https://example.com/sync.mp3',
        format: 'mp3',
        size: 1,
        primaryClipId: 'clip_sync',
      },
    }), 'record_1', {
      loadRecords,
      updateRecord,
    });

    expect(updateRecord).toHaveBeenCalledWith('record_1', {
      generatedClips: [
        {
          clipId: 'clip_sync',
          audioUrl: 'https://example.com/sync.mp3',
          duration: null,
          taskId: 'task_sync',
        },
      ],
    });
    expect(result).toEqual({
      records: [
        {
          id: 'record_1',
          generatedClips: [
            {
              clipId: 'clip_sync',
              audioUrl: 'https://example.com/sync.mp3',
              duration: null,
              taskId: 'task_sync',
            },
          ],
        },
      ],
      record: {
        id: 'record_1',
        generatedClips: [
          {
            clipId: 'clip_sync',
            audioUrl: 'https://example.com/sync.mp3',
            duration: null,
            taskId: 'task_sync',
          },
        ],
      },
    });
  });

  it('returns current record when merged clips are unchanged', async () => {
    const loadRecords = vi.fn<() => Promise<TestRecord[]>>(async () => [
      {
        id: 'record_1',
        generatedClips: [
          {
            clipId: 'clip_1',
            audioUrl: 'https://example.com/audio.mp3',
            taskId: 'task_keep',
          },
        ],
      },
    ]);
    const updateRecord = vi.fn<(id: string, patch: Partial<TestRecord>) => Promise<TestRecord[]>>();

    const result = await syncGeneratedClipsForRecord(createTask({
      id: 'task_keep',
      result: {
        url: 'https://example.com/audio.mp3',
        format: 'mp3',
        size: 1,
        primaryClipId: 'clip_1',
      },
    }), 'record_1', {
      loadRecords,
      updateRecord,
    });

    expect(updateRecord).not.toHaveBeenCalled();
    expect(result).toEqual({
      records: [
        {
          id: 'record_1',
          generatedClips: [
            {
              clipId: 'clip_1',
              audioUrl: 'https://example.com/audio.mp3',
              taskId: 'task_keep',
            },
          ],
        },
      ],
      record: {
        id: 'record_1',
        generatedClips: [
          {
            clipId: 'clip_1',
            audioUrl: 'https://example.com/audio.mp3',
            taskId: 'task_keep',
          },
        ],
      },
    });
  });
});
