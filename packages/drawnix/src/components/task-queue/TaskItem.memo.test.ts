// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { TaskStatus, TaskType, type Task } from '../../types/task.types';
import { areTaskItemPropsEqual, type TaskItemProps } from './TaskItem';

function createFailedTask(originalError: string): Task {
  return {
    id: 'task-error-memo',
    type: TaskType.IMAGE,
    status: TaskStatus.FAILED,
    params: {
      prompt: 'bad prompt',
      model: 'mock:gpt-image-2:preview',
    },
    error: {
      code: 'ERR',
      message: '生成失败',
      details: {
        originalError,
        timestamp: 1,
      },
    },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('TaskItem memo comparator', () => {
  it('rerenders when rendered original error details change', () => {
    const prev: TaskItemProps = {
      task: createFailedTask('provider rejected prompt'),
    };
    const next: TaskItemProps = {
      task: createFailedTask('provider rejected prompt: image policy violation'),
    };

    expect(areTaskItemPropsEqual(prev, next)).toBe(false);
  });

  it('rerenders when remote task identity changes', () => {
    const prevTask = createFailedTask('provider rejected prompt');
    const nextTask = {
      ...prevTask,
      remoteId: 'remote-next',
    };

    expect(
      areTaskItemPropsEqual({ task: prevTask }, { task: nextTask })
    ).toBe(false);
  });

  it('rerenders when rendered task params change', () => {
    const prevTask = createFailedTask('provider rejected prompt');
    const nextTask = {
      ...prevTask,
      params: {
        ...prevTask.params,
        model: 'mock:gpt-image-2-vip',
      },
    };

    expect(
      areTaskItemPropsEqual({ task: prevTask }, { task: nextTask })
    ).toBe(false);
  });

  it('keeps memoization when task object and controls are unchanged', () => {
    const task = createFailedTask('provider rejected prompt');
    const onRetry = () => undefined;
    const props: TaskItemProps = {
      task,
      isSelected: false,
      selectionMode: false,
      onRetry,
    };

    expect(areTaskItemPropsEqual(props, { ...props })).toBe(true);
  });
});
