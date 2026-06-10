import { describe, expect, it } from 'vitest';
import {
  buildScriptRewritePrompt,
  buildVideoPromptGenerationPrompt,
  parseRewriteShotUpdates,
  parseScriptRewriteResponse,
  parseVideoPromptGenerationResponse,
} from './utils';
import { migrateProductInfo } from './types';

describe('video-analyzer utils', () => {
  it('injects creative brief into script rewrite prompt', () => {
    const prompt = buildScriptRewritePrompt({
      videoModel: 'veo3',
      productInfo: {
        prompt: '防滑拖鞋',
        targetDuration: 8,
        segmentDuration: 8,
        videoStyle: '电影感光影',
        bgmMood: '轻快治愈',
        creativeBrief: {
          purpose: '口播种草',
          directorStyle: '快节奏短视频导演',
          narrativeStyle: '痛点-解决-转化',
          negativePrompt: '不要夸大功效',
        },
      },
      recordAnalysis: {
        totalDuration: 8,
        productExposureDuration: 0,
        productExposureRatio: 0,
        shotCount: 1,
        firstProductAppearance: 0,
        suggestion: '保持画面风格与产品展示约束稳定',
        shots: [{
          id: 'shot_1',
          startTime: 0,
          endTime: 8,
          duration: 8,
          description: '旧画面',
          type: 'opening',
          label: '开场',
        }],
      },
    });

    expect(prompt).toContain('创作 Brief');
    expect(prompt).toContain('视频用途/场景：口播种草');
    expect(prompt).toContain('调整开场钩子、卖点顺序、口播密度、镜头内容形态');
    expect(prompt).toContain('避免：不要夸大功效');
    expect(prompt).toContain('画面风格：电影感光影');
    expect(prompt).toContain('BGM 情绪：轻快治愈');
    expect(prompt).toContain('整体画面风格必须统一为”电影感光影”');
    expect(prompt).toContain('故事复盘、相邻剧情、剧情续写');
    expect(prompt).toContain('用户提示词中的故事情节、相似案例或相似剧情只用于理解改编方向');
    expect(prompt).toContain('只描述当前段起始画面');
    expect(prompt).toContain('非空尾帧只写本镜头结束画面');
    expect(prompt).toContain('原创性与合规要求');
    expect(prompt).toContain('"bgm_mood"');
    expect(prompt).toContain('"characters"');
    expect(prompt).toContain('"shots"');
  });

  it('migrates old product info without creative brief', () => {
    const migrated = migrateProductInfo({ prompt: '旧提示词' }, 12);

    expect(migrated.prompt).toBe('旧提示词');
    expect(migrated.targetDuration).toBe(12);
    expect(migrated.creativeBrief).toEqual({});
  });

  it('builds prompt-start instructions with PDF context', () => {
    const prompt = buildVideoPromptGenerationPrompt({
      userPrompt: '给防滑拖鞋做一条小红书爆款视频',
      pdfAttachmentName: '品牌资料.pdf',
      videoStyle: '电影感光影',
      videoModel: 'happy-horse-1.0-r2v',
      targetDuration: 30,
      segmentDuration: 5,
      creativeBrief: {
        purpose: '口播种草',
        directorStyle: '快节奏短视频导演',
        narrativeStyle: '痛点-解决-转化',
      },
    });

    expect(prompt).toContain('参考 PDF：本次请求附带 PDF「品牌资料.pdf」');
    expect(prompt).toContain('创作 Brief');
    expect(prompt).toContain('视频用途/场景：口播种草');
    expect(prompt).toContain('画面风格：电影感光影');
    expect(prompt).toContain('视频模型：happy-horse-1.0-r2v');
    expect(prompt).toContain('目标视频总时长：30 秒');
    expect(prompt).toContain('单段视频时长：5 秒');
    expect(prompt).toContain('shots[].duration 必须等于 5');
    expect(prompt).toContain('建议生成 6 个镜头，实际总时长 30 秒');
    expect(prompt).toContain('VideoAnalysisData');
    expect(prompt).toContain('只返回 JSON，不要 markdown');
    expect(prompt).toContain('first_frame_prompt');
    expect(prompt).toContain('同一人物身份、发型、脸部特征、体型、年龄感、完整服装款式');
    expect(prompt).toContain('不得重新设计衣服');
    expect(prompt).toContain('相似剧情和歌词意象只作为背景与风格参考');
    expect(prompt).toContain('不要在 first_frame_prompt、last_frame_prompt 或 suggestion 中复述相似剧情');
    expect(prompt).toContain('只描述当前段起始画面');
    expect(prompt).toContain('不要写上一段剧情经过');
    expect(prompt).toContain('suggestion 只写稳定生成约束');
    expect(prompt).toContain('非空 last_frame_prompt 若包含角色');
    expect(prompt).toContain('不得写下一镜头剧情');
    expect(prompt).toContain('不得换脸、换发型、换衣服颜色或新增无关人物');
    expect(prompt).toContain('原创性与合规要求');
  });

  it('parses rewrite object with synced characters, style and bgm', () => {
    const result = parseScriptRewriteResponse(`\`\`\`json
{
  "video_style": "原创 3D 动画",
  "bgm_mood": "紧张滑稽",
  "suggestion": "第3步保持原创角色、红色围巾和高速场景视觉锚点一致",
  "characters": [
    { "id": "char_1", "name": "原创角色", "description": "A small original blue traveler with a red scarf." }
  ],
  "shots": [
    {
      "id": "shot_1",
      "startTime": 0,
      "endTime": 8,
      "duration": 8,
      "description": "新画面",
      "type": "opening",
      "label": "新开场",
      "character_ids": ["char_1"]
    }
  ]
}
\`\`\``, [{
      id: 'shot_1',
      startTime: 0,
      endTime: 8,
      duration: 8,
      description: '旧画面',
      type: 'opening',
      label: '开场',
    }]);

    expect(result.videoStyle).toBe('原创 3D 动画');
    expect(result.bgmMood).toBe('紧张滑稽');
    expect(result.suggestion).toContain('第3步保持原创角色');
    expect(result.hasCharacters).toBe(true);
    expect(result.characters?.[0].description).toContain('original blue traveler');
    expect(result.shots[0]).toMatchObject({
      description: '新画面',
      character_ids: ['char_1'],
    });
  });

  it('parses rewrite JSON after model thinking text', () => {
    const result = parseScriptRewriteResponse(`<think>**Considering cases** {"draft": true, "shots": "not array"}</think>
最终 JSON：
{
  "video_style": "原创卡通",
  "bgm_mood": "轻快",
  "characters": [],
  "shots": [
    {
      "id": "shot_1",
      "description": "避开受保护元素后的原创追逐桥段",
      "character_ids": []
    }
  ]
}`, [{
      id: 'shot_1',
      startTime: 0,
      endTime: 8,
      duration: 8,
      description: '旧画面',
      type: 'opening',
      label: '开场',
    }]);

    expect(result.videoStyle).toBe('原创卡通');
    expect(result.bgmMood).toBe('轻快');
    expect(result.hasCharacters).toBe(true);
    expect(result.characters).toEqual([]);
    expect(result.shots[0].description).toBe('避开受保护元素后的原创追逐桥段');
  });

  it('parses rewrite JSON from chat completion envelopes', () => {
    const result = parseScriptRewriteResponse(JSON.stringify({
      id: 'chatcmpl-test',
      object: 'chat.completion',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: JSON.stringify({
            video_style: '友好3D动画风格',
            bgm_mood: '轻快滑稽',
            characters: [{
              id: 'char_1',
              name: '团团熊',
              description: 'A chubby original cartoon bear.',
            }],
            shots: [{
              id: 'shot_1',
              description: '五一高速入口前大堵车，原创角色追逐开场',
              character_ids: ['char_1'],
            }],
          }),
        },
        finish_reason: 'stop',
      }],
    }), [{
      id: 'shot_1',
      startTime: 0,
      endTime: 8,
      duration: 8,
      description: '旧画面',
      type: 'opening',
      label: '开场',
    }]);

    expect(result.videoStyle).toBe('友好3D动画风格');
    expect(result.bgmMood).toBe('轻快滑稽');
    expect(result.characters?.[0].name).toBe('团团熊');
    expect(result.shots[0]).toMatchObject({
      description: '五一高速入口前大堵车，原创角色追逐开场',
      character_ids: ['char_1'],
    });
  });

  it('parses legacy rewrite arrays after thinking text', () => {
    const updates = parseRewriteShotUpdates(`<think>**Considering c** [not-json]</think>
说明文字
[
  { "id": "shot_1", "description": "新镜头" }
]`);

    expect(updates).toEqual([
      { id: 'shot_1', description: '新镜头' },
    ]);
  });

  it('parses prompt-start response into video analysis data', () => {
    const analysis = parseVideoPromptGenerationResponse(`\`\`\`json
{
  "totalDuration": 8,
  "productExposureDuration": 8,
  "productExposureRatio": 100,
  "shotCount": 1,
  "firstProductAppearance": 0,
  "aspect_ratio": "9x16",
  "video_style": "明亮清爽",
  "bgm_mood": "轻快",
  "suggestion": "先出首帧再生成视频",
  "characters": [],
  "shots": [
    {
      "id": "shot_1",
      "startTime": 0,
      "endTime": 8,
      "description": "雨天门口展示防滑拖鞋",
      "type": "product",
      "label": "防滑展示"
    }
  ]
}
\`\`\``);

    expect(analysis.shotCount).toBe(1);
    expect(analysis.aspect_ratio).toBe('9x16');
    expect(analysis.shots[0]).toMatchObject({
      id: 'shot_1',
      duration: 8,
      narration: '',
      speech_relation: 'none',
    });
  });
});
