// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockHoverTip = vi.fn();

vi.mock('./hover', () => ({
  HoverTip: ({
    children,
    content,
    placement,
    overlayClassName,
    overlayInnerClassName,
  }: {
    children: React.ReactNode;
    content: React.ReactNode;
    placement?: string;
    overlayClassName?: string;
    overlayInnerClassName?: string;
  }) => {
    mockHoverTip({ content, placement, overlayClassName, overlayInnerClassName });
    const isRenderablePrimitive =
      typeof content === 'string' || typeof content === 'number';

    return (
      <div data-testid="hover-tip">
        <div data-testid="hover-tip-trigger">{children}</div>
        <div data-testid="hover-tip-content">
          {isRenderablePrimitive ? content : null}
        </div>
        {React.isValidElement(content) && (
          <div data-testid="hover-tip-rich">{content}</div>
        )}
      </div>
    );
  },
}));

describe('PromptListItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it.each([
    {
      modelType: 'image' as const,
      content: '默认图片提示词',
      previewExamples: [
        {
          kind: 'image' as const,
          src: '/generated/image-01.png',
          alt: 'image example',
        },
      ],
    },
    {
      modelType: 'video' as const,
      content: '默认视频提示词',
      previewExamples: [
        {
          kind: 'video' as const,
          src: '/generated/video-01.mp4',
          posterSrc: '/generated/video-01.png',
          playable: true,
          alt: 'video example',
        },
      ],
    },
    {
      modelType: 'audio' as const,
      content: '默认音频提示词',
      previewExamples: [
        {
          kind: 'image' as const,
          src: '/generated/audio-cover-01.png',
          alt: 'audio example',
        },
      ],
    },
    {
      modelType: 'text' as const,
      content: '默认文本提示词',
      previewExamples: [
        {
          kind: 'image' as const,
          src: '/generated/text-preview-01.png',
          alt: 'text example',
        },
      ],
    },
    {
      modelType: 'agent' as const,
      content: '默认 Agent 提示词',
      previewExamples: [
        {
          kind: 'image' as const,
          src: '/generated/agent-preview-01.png',
          alt: 'agent example',
        },
      ],
    },
  ])(
    '$modelType 提示词有 previewExamples 时复用 HoverTip 展示富预览内容',
    async ({ modelType, content, previewExamples }) => {
      const { PromptListItem } = await import('./PromptListItem');
      const onPreviewExample = vi.fn();

      render(
        <PromptListItem
          content={content}
          modelType={modelType}
          previewExamples={previewExamples}
          onPreviewExample={onPreviewExample}
        />
      );

      expect(screen.getByTestId('hover-tip')).toBeTruthy();
      if (previewExamples[0].kind === 'video') {
        expect(
          screen.getByAltText(previewExamples[0].alt)
        ).toBeTruthy();
      } else {
        expect(screen.getByAltText(previewExamples[0].alt)).toBeTruthy();
      }
      expect(screen.getAllByText(content)).toHaveLength(2);
      expect(
        document.querySelector('.prompt-list-item__hover-gallery--single')
      ).toBeTruthy();
      expect(
        document.querySelector('.prompt-list-item__hover-thumb--single')
      ).toBeTruthy();
      expect(mockHoverTip).toHaveBeenCalled();

      fireEvent.mouseDown(
        screen.getByRole('button', { name: '预览示例图 1' })
      );

      expect(onPreviewExample).toHaveBeenCalledWith({
        content,
        initialIndex: 0,
        previewExamples,
      });
    }
  );

  it('视频预览 hover 时显示静态封面并使用中性预览文案', async () => {
    const { PromptListItem } = await import('./PromptListItem');

    render(
      <PromptListItem
        content="用户视频提示词"
        modelType="video"
        previewExamples={[
          {
            kind: 'video',
            src: '/generated/video-01.mp4',
            posterSrc: '/generated/video-01.png',
            playable: true,
            alt: 'video example',
          },
        ]}
        onPreviewExample={vi.fn()}
      />
    );

    const media = screen.getByAltText('video example');
    const video = screen.getByTestId('hover-tip-content').querySelector('video');

    expect(media.getAttribute('src')).toBe('/generated/video-01.png');
    expect(video).toBeNull();
    expect(screen.getByText('点击预览')).toBeTruthy();
    expect(screen.queryByText('点击播放预览')).toBeNull();
  });

  it('真实视频样片 hover 时也使用静态封面和中性预览文案', async () => {
    const { PromptListItem } = await import('./PromptListItem');

    render(
      <PromptListItem
        content="任务视频提示词"
        modelType="video"
        previewExamples={[
          {
            kind: 'video',
            src: '/generated/video-01.mp4',
            posterSrc: '/generated/video-01.png',
            playable: true,
            alt: 'video example',
          },
        ]}
        onPreviewExample={vi.fn()}
      />
    );

    const media = screen.getByAltText('video example');
    const video = screen.getByTestId('hover-tip-content').querySelector('video');

    expect(media.getAttribute('src')).toBe('/generated/video-01.png');
    expect(video).toBeNull();
    expect(screen.getByText('点击预览')).toBeTruthy();
    expect(screen.queryByText('点击播放预览')).toBeNull();
  });

  it('没有 previewExamples 时退回纯文本 HoverTip', async () => {
    const { PromptListItem } = await import('./PromptListItem');

    render(<PromptListItem content="无图历史提示词" />);

    expect(screen.getByTestId('hover-tip')).toBeTruthy();
    expect(mockHoverTip).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '无图历史提示词',
        placement: 'right-top',
        overlayClassName: 'prompt-list-item__text-tip-popover',
        overlayInnerClassName: 'prompt-list-item__text-tip',
      })
    );
  });

  it('提示词历史项显示标题并在 hover 中展示发送提示词、标签和结果预览', async () => {
    const { PromptListItem } = await import('./PromptListItem');
    const onClick = vi.fn();

    render(
      <PromptListItem
        content="发送给模型的完整提示词"
        title="初始提示词标题"
        sentPrompt="发送给模型的完整提示词"
        tags={['agent', '封面 Skill']}
        resultPreview={{
          kind: 'image',
          url: '/generated/result.png',
          title: '结果图',
        }}
        onClick={onClick}
      />
    );

    expect(screen.getAllByText('初始提示词标题').length).toBeGreaterThan(0);
    expect(screen.getByText('发送提示词')).toBeTruthy();
    expect(screen.getByText('发送给模型的完整提示词')).toBeTruthy();
    expect(screen.getByText('封面 Skill')).toBeTruthy();
    expect(screen.getByAltText('结果图')).toBeTruthy();
    expect(mockHoverTip).toHaveBeenCalledWith(
      expect.objectContaining({
        placement: 'right',
        overlayClassName: 'prompt-list-item__history-card-popover',
      })
    );

    fireEvent.click(screen.getAllByText('初始提示词标题')[0]);
    expect(onClick).toHaveBeenCalled();
  });
});
