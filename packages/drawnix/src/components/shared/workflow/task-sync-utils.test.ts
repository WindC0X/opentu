import { describe, expect, it } from 'vitest';
import { TaskType, type Task } from '../../../types/task.types';
import {
  extractBatchRecordId,
  parseStructuredOrChatJson,
  readTaskAction,
  readTaskChatResponse,
  readTaskStringParam,
} from './task-sync-utils';

function createTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_1',
    type: TaskType.CHAT,
    status: 'completed',
    params: {},
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Task;
}

describe('task-sync-utils', () => {
  it('reads allowed task action only when matched', () => {
    const task = createTask({
      params: {
        prompt: '',
        workflowAction: 'rewrite',
      },
    });

    expect(readTaskAction(task, 'workflowAction', ['analyze', 'rewrite'] as const)).toBe('rewrite');
    expect(readTaskAction(task, 'workflowAction', ['analyze'] as const)).toBeNull();
  });

  it('reads trimmed string params and chat response', () => {
    const task = createTask({
      params: {
        prompt: '',
        recordId: ' record_1 ',
      },
      result: {
        url: '',
        format: 'json',
        size: 1,
        chatResponse: '  hello  ',
      },
    });

    expect(readTaskStringParam(task, 'recordId')).toBe('record_1');
    expect(readTaskChatResponse(task)).toBe('hello');
  });

  it('extracts record id from workflow batch ids', () => {
    expect(extractBatchRecordId('ma_record-1_gen_2', { prefix: 'ma_' })).toBe('record-1');
    expect(extractBatchRecordId('mv_record_1_music_2', {
      prefix: 'mv_',
      marker: '_music_',
    })).toBe('record_1');
    expect(extractBatchRecordId('xx_record_1_music_2', {
      prefix: 'mv_',
      marker: '_music_',
    })).toBeNull();
  });

  it('parses structured result before chat json fallback', () => {
    const structuredTask = createTask({
      result: {
        url: '',
        format: 'json',
        size: 1,
        analysisData: {
          value: 'structured',
        },
      },
    });
    const chatTask = createTask({
      result: {
        url: '',
        format: 'json',
        size: 1,
        chatResponse: '{"value":"chat"}',
      },
    });

    expect(parseStructuredOrChatJson(structuredTask, {
      missingMessage: 'missing',
      fromStructured: (structured) => structured as { value: string },
    })).toEqual({ value: 'structured' });

    expect(parseStructuredOrChatJson(chatTask, {
      missingMessage: 'missing',
      fromStructured: (structured) => structured as { value: string },
    })).toEqual({ value: 'chat' });
  });

  it('extracts chat json from model thinking text', () => {
    const task = createTask({
      result: {
        url: '',
        format: 'json',
        size: 1,
        chatResponse: '<think>{"value":"draft"}</think>\n最终：{"value":"chat"}',
      },
    });

    expect(parseStructuredOrChatJson(task, {
      missingMessage: 'missing',
      fromStructured: (structured) => structured as { value: string },
    })).toEqual({ value: 'chat' });
  });

  it('throws when both structured and chat json are missing', () => {
    expect(() => parseStructuredOrChatJson(createTask(), {
      missingMessage: '缺少结果',
      fromStructured: (structured) => structured,
    })).toThrow('缺少结果');
  });
});
