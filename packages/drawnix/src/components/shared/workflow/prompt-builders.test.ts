import { describe, expect, it } from 'vitest';
import {
  buildCharacterReferencePrompt,
  buildFramePrompt,
  buildVideoPrompt,
  buildVideoReferenceImageDescriptions,
  MAX_VIDEO_GENERATION_PROMPT_LENGTH,
} from './prompt-builders';

describe('prompt-builders', () => {
  it('builds video prompt with style, bgm and character anchor', () => {
    const prompt = buildVideoPrompt(
      {
        id: 'shot_1',
        startTime: 0,
        endTime: 3,
        description: '城市夜景。',
        narration: '旁白内容。',
        dialogue: '你好。',
        dialogue_speakers: '主角',
        speech_relation: 'both',
        first_frame_prompt: '首帧描述。',
        last_frame_prompt: '尾帧描述。',
        camera_movement: '缓慢推近。',
        transition_hint: 'cut',
        character_description: 'young woman with short hair.',
        type: 'opening',
        label: '开场',
      },
      {
        totalDuration: 10,
        productExposureDuration: 0,
        productExposureRatio: 0,
        shotCount: 0,
        firstProductAppearance: 0,
        suggestion: '',
        aspect_ratio: '16x9',
        shots: [],
        video_style: '赛博朋克',
        bgm_mood: '紧张',
      }
    );

    expect(prompt).toContain('画面风格：赛博朋克');
    expect(prompt).toContain('BGM情绪：紧张');
    expect(prompt).toContain('角色一致性：The same young woman with short hair');
    expect(prompt).toContain('镜头主题：城市夜景');
  });

  it('separates context, user requirements and reference image meanings in video prompts', () => {
    const prompt = buildVideoPrompt(
      {
        id: 'shot_2',
        startTime: 5,
        endTime: 10,
        description: '妈妈抱住大女儿，二女儿从右侧跑入画面。',
        first_frame_prompt: '妈妈和大女儿站在家门口。',
        last_frame_prompt: '二女儿加入拥抱。',
        camera_movement: '横向轻移跟随二女儿冲入画面',
        transition_hint: 'cut',
        type: 'scene',
        label: '二女儿加入',
      },
      {
        totalDuration: 15,
        productExposureDuration: 0,
        productExposureRatio: 0,
        shotCount: 0,
        firstProductAppearance: 0,
        suggestion: '',
        aspect_ratio: '9x16',
        shots: [],
        video_style: '童话电影动画风格',
        bgm_mood: '温暖欢快',
      },
      {
        prompt: '突出二女儿加入这个动作，不要只拍成静态合影',
        generationTopic: '家庭拥抱短片',
        generationContext: '傍晚集市门口，妈妈提着水果篮。',
      },
      {
        referenceImageDescriptions: [
          '参考图1：首帧图，只表示视频起始画面状态，视频必须从这张图开始，优先于故事上下文。',
          '参考图2：尾帧图，只表示视频结束画面状态，视频应自然过渡到这张图，优先于故事上下文。',
        ],
      }
    );

    expect(prompt).toContain('优先级协议');
    expect(prompt).toContain('当前镜头任务/首尾关键帧 > 参考图说明 > 角色一致性 > 用户要求');
    expect(prompt).toContain('故事情节、相似案例、歌词意象或全局剧情只作低权重背景');
    expect(prompt).toContain('上下文内容');
    expect(prompt).toContain('用户要求');
    expect(prompt).toContain('参考图说明');
    expect(prompt).toContain('参考图1：首帧图');
    expect(prompt).toContain('参考图2：尾帧图');
    expect(prompt).toContain('当前镜头任务');
    expect(prompt).toContain('镜头身份：ID shot_2 · 二女儿加入 · 5s-10s');
    expect(prompt).toContain('突出二女儿加入这个动作');
    expect(prompt).toContain('参考图使用方式');
    expect(prompt).toContain('参考图优先级');
  });

  it('describes manual video reference images by their names', () => {
    expect(
      buildVideoReferenceImageDescriptions([
        { url: 'first-url', name: '首帧' },
        { url: 'last-url', name: '尾帧' },
        { url: 'char-url', name: '角色-妈妈' },
        { url: 'style-url', name: '风格参考' },
      ])
    ).toEqual([
      '参考图1：首帧图，只表示视频起始画面状态，视频必须从这张图开始，优先于故事上下文。',
      '参考图2：尾帧图，只表示视频结束画面状态，视频应自然过渡到这张图，优先于故事上下文。',
      '参考图3：角色参考图（角色-妈妈），仅用于锁定人物身份、发型、服装、材质和气质，不表示时间顺序、动作或剧情。',
      '参考图4：风格参考，仅用于主体、产品、场景、风格或色彩一致性，不表示时间顺序、动作或剧情。',
    ]);
  });

  it('prefixes frame prompt with product video style', () => {
    const prompt = buildFramePrompt('角色站在雨夜街头', undefined, {
      videoStyle: '电影感光影',
    });

    expect(prompt).toContain('当前关键帧（最高优先级）：角色站在雨夜街头');
    expect(prompt).toContain('关键帧优先级：当前关键帧优先于故事/剧情上下文');
    expect(prompt).toContain('电影感光影');
  });

  it('injects creative brief into video and frame prompts', () => {
    const creativeBrief = {
      purpose: '口播种草',
      directorStyle: '快节奏短视频导演',
      narrativeStyle: '痛点-解决-转化',
      targetPlatform: '竖屏短视频信息流',
      audience: '年轻女性',
      pacing: '前三秒强钩子，全程快节奏',
      negativePrompt: '不要硬广口吻',
    };
    const shot = {
      id: 'shot_1',
      startTime: 0,
      endTime: 3,
      description: '展示产品。',
      type: 'product' as const,
      label: '卖点',
    };

    const videoPrompt = buildVideoPrompt(shot, undefined, { creativeBrief });
    const framePrompt = buildFramePrompt('产品放在桌面上', undefined, { creativeBrief });

    expect(videoPrompt).toContain('创作 Brief');
    expect(videoPrompt).toContain('视频用途/场景：口播种草');
    expect(videoPrompt).toContain('导演风格：快节奏短视频导演');
    expect(videoPrompt).toContain('目标平台：竖屏短视频信息流');
    expect(videoPrompt).toContain('避免：不要硬广口吻');
    expect(framePrompt).toContain('单镜头生成必须继承导演风格');
    expect(framePrompt).toContain('当前关键帧（最高优先级）：产品放在桌面上');
  });

  it('injects generation context and frame characters', () => {
    const prompt = buildFramePrompt(
      '主角站在舞台中央',
      {
        totalDuration: 8,
        productExposureDuration: 0,
        productExposureRatio: 0,
        shotCount: 0,
        firstProductAppearance: 0,
        suggestion: '',
        aspect_ratio: '9x16',
        shots: [],
        bgm_mood: 'Synth Pop',
      },
      {
        prompt: '只把鞋换成红色',
        generationTopic: '城市夜跑 MV',
        generationContext: '音乐标题：追光\n歌词/意象：穿过雨夜',
        generationAdvice: '保持霓虹雨夜与跑步动作连贯',
      },
      {
        shot: {
          id: 'shot_1',
          label: '主角登场',
          startTime: 0,
          endTime: 8,
          description: '主角站在舞台中央',
          character_ids: ['char_1'],
        },
        characters: [
          {
            id: 'char_1',
            name: '主角',
            description: 'young woman in a silver running jacket',
            referenceImageUrl: 'https://example.com/character.png',
          },
        ],
        continueFromPreviousFrame: true,
      }
    );

    expect(prompt).toContain('上下文内容');
    expect(prompt).toContain('创作主题：城市夜跑 MV');
    expect(prompt).toContain('音乐标题：追光');
    expect(prompt).toContain('生成建议：保持霓虹雨夜与跑步动作连贯');
    expect(prompt).not.toContain('用户目标/主题');
    expect(prompt).not.toContain('只把鞋换成红色');
    expect(prompt).toContain('画面内角色：主角: young woman in a silver running jacket');
    expect(prompt).toContain('以参考图为最高优先级锁定同一人物身份');
    expect(prompt).toContain('服装款式、服装颜色、材质和配饰');
    expect(prompt).toContain('若关键帧文字与角色参考图冲突，保留参考图中的人物与服装');
    expect(prompt).toContain('禁止：换脸、换发型、换发色');
    expect(prompt).toContain('重设计服装');
    expect(prompt).toContain('连续性要求');
    expect(prompt).toContain('不要复述上一镜头剧情经过');
  });

  it('injects shot identity into frame prompts to separate similar shots', () => {
    const prompt = buildFramePrompt(
      '一家人在门口团抱',
      undefined,
      { videoStyle: '童话电影动画风格' },
      {
        shot: {
          id: 'shot_3',
          label: '三女儿爬入团抱',
          startTime: 10,
          endTime: 15,
          description: '三女儿从画面下方慢慢爬来，抬头笑着抓住姐姐裙角。',
          camera_movement: '轻微俯拍后回落，最后定住形成三层团抱画面',
          transition_hint: 'match_cut',
          character_ids: [],
        },
      }
    );

    expect(prompt).toContain('当前关键帧（最高优先级）：一家人在门口团抱');
    expect(prompt).toContain('片段区分锚点');
    expect(prompt).toContain('ID shot_3 · 三女儿爬入团抱 · 10s-15s');
    expect(prompt).toContain('三女儿从画面下方慢慢爬来');
    expect(prompt).toContain('轻微俯拍后回落');
    expect(prompt).toContain('优先表现本镜头独有的动作阶段');
  });

  it('drops low-weight video context before required shot prompt when too long', () => {
    const longBrief = '创意上下文'.repeat(140);
    const prompt = buildVideoPrompt(
      {
        id: 'shot_1',
        startTime: 0,
        endTime: 5,
        description: '核心镜头画面。',
        first_frame_prompt: '核心首帧。',
        last_frame_prompt: '核心尾帧。',
        camera_movement: '缓慢推进。',
        type: 'scene',
        label: '重点镜头',
      },
      {
        totalDuration: 10,
        productExposureDuration: 0,
        productExposureRatio: 0,
        shotCount: 0,
        firstProductAppearance: 0,
        suggestion: '',
        aspect_ratio: '9x16',
        shots: [],
      },
      {
        videoStyle: '电影感',
        bgmMood: '振奋',
        generationContext: '背景资料'.repeat(180),
        creativeBrief: {
          purpose: longBrief,
          directorStyle: longBrief,
          narrativeStyle: longBrief,
          targetPlatform: longBrief,
          audience: longBrief,
          pacing: longBrief,
          negativePrompt: longBrief,
        },
      }
    );

    expect(prompt.length).toBeLessThanOrEqual(MAX_VIDEO_GENERATION_PROMPT_LENGTH);
    expect(prompt).toContain('背景信息：背景资料');
    expect(prompt).toContain('镜头主题：核心镜头画面');
    expect(prompt).toContain('开场关键帧：核心首帧');
    expect(prompt).toContain('结束关键帧：核心尾帧');
    expect(prompt).not.toContain('视频用途/场景：');
    expect(prompt).not.toContain('导演风格：');
  });

  it('keeps empty frame prompt empty when only creative brief exists', () => {
    expect(
      buildFramePrompt('', undefined, {
        creativeBrief: { purpose: '品牌广告' },
      })
    ).toBe('');
  });

  it('keeps character reference prompts free of shot-specific action', () => {
    const prompt = buildCharacterReferencePrompt({
      id: 'char_1',
      name: '大女儿',
      description: 'a cheerful girl in a pink dress',
    });

    expect(prompt).toContain('可复用的角色参考图');
    expect(prompt).toContain('角色参考图优先级');
    expect(prompt).toContain('故事/MV剧情/歌词意象仅用于微调情绪与风格');
    expect(prompt).toContain('中性站姿或半身展示');
    expect(prompt).toContain('不要演绎具体镜头动作');
  });
});
