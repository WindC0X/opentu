import { describe, expect, it } from 'vitest';
import {
  buildVideoAnalyzerResetPayload,
  buildVideoAnalyzerWorkflowExportOptions,
} from './generate-page-helpers';
import type { AnalysisRecord, VideoShot } from './types';
import type { WorkflowExportAssetItem } from '../../utils/workflow-generation-utils';

describe('video-analyzer generate helpers', () => {
  it('builds stable workflow export options', () => {
    const shots: VideoShot[] = [
      {
        id: 'shot_1',
        startTime: 0,
        endTime: 3,
        description: '镜头描述',
        narration: '旁白',
        type: 'opening',
        label: '开场',
      },
    ];
    const record: AnalysisRecord = {
      id: 'record_1',
      createdAt: 1,
      source: 'upload',
      sourceLabel: 'test.mp4',
      model: 'gemini',
      analysis: {
        totalDuration: 3,
        productExposureDuration: 3,
        productExposureRatio: 100,
        shotCount: 1,
        firstProductAppearance: 0,
        suggestion: '',
        aspect_ratio: '9x16',
        shots,
        video_style: '纪实',
        bgm_mood: '轻快',
      },
      productInfo: {
        prompt: '卖点提示词',
        videoStyle: '电影感',
        bgmMood: '鼓舞',
        creativeBrief: {
          purpose: '种草带货',
          narrativeStyle: '痛点-解决-转化',
        },
      },
      starred: false,
    };
    const assets: WorkflowExportAssetItem[] = [
      { url: 'https://example.com/video.mp4', type: 'video', kind: 'video', shotIndex: 0 },
    ];

    const options = buildVideoAnalyzerWorkflowExportOptions(record, shots, assets);

    expect(options.recordId).toBe('record_1');
    expect(options.zipBaseName).toBe('video_analyzer_assets');
    expect(options.recordMeta).toMatchObject({
      source: 'upload',
      sourceLabel: 'test.mp4',
      prompt: '卖点提示词',
      aspectRatio: '9x16',
      videoStyle: '电影感',
      bgmMood: '鼓舞',
      creativeBriefSummary: expect.stringContaining('视频用途/场景：种草带货'),
      shotCount: 1,
    });
    expect(options.scriptMarkdown).toContain('# 视频脚本');
    expect(options.scriptMarkdown).toContain('卖点提示词');
    expect(options.scriptMarkdown).toContain('## 创作 Brief');
  });

  it('prefers persisted characters when building reset payload', () => {
    const shots: VideoShot[] = [{
      id: 'shot_1',
      startTime: 0,
      endTime: 3,
      description: '镜头描述',
      type: 'opening',
      label: '开场',
      generated_video_url: 'video-url',
    }];
    const payload = buildVideoAnalyzerResetPayload(
      {
        characters: [{
          id: 'char_1',
          name: '主角',
          description: 'persisted',
          referenceImageUrl: 'persisted-url',
        }],
        analysis: {
          totalDuration: 3,
          productExposureDuration: 3,
          productExposureRatio: 100,
          shotCount: 1,
          firstProductAppearance: 0,
          suggestion: '',
          shots,
          characters: [{
            id: 'char_1',
            name: '主角',
            description: 'analysis',
            referenceImageUrl: 'analysis-url',
          }],
        },
      },
      shots
    );

    expect(payload.shots[0].generated_video_url).toBeUndefined();
    expect(payload.shots[0].suppressed_generated_urls?.video).toBe('video-url');
    expect(payload.characters[0].description).toBe('persisted');
    expect(payload.characters[0].referenceImageUrl).toBeUndefined();
  });
});
