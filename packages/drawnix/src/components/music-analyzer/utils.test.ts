import { describe, expect, it, vi } from 'vitest';
import {
  buildLyricsRewritePrompt,
  buildSunoLyricsPrompt,
  collectLyricsDraftModels,
  isSunoLyricsModel,
  parseLyricsRewriteResult,
} from './utils';
import {
  formatMusicBriefPromptBlock,
  MUSIC_BRIEF_GENRE_OPTIONS,
  MUSIC_BRIEF_PURPOSE_OPTIONS,
  mergeMusicBriefStyleTags,
} from './music-brief';

vi.hoisted(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) || null,
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
    },
  });
});

describe('music-analyzer utils', () => {
  it('embeds Suno metatag guidance in rewrite prompts', () => {
    const prompt = buildLyricsRewritePrompt({
      analysis: {
        summary: '副歌抓耳',
        language: '中文',
        mood: '热血',
        genreTags: ['edm'],
        structure: ['[Intro]', '[Chorus]'],
        hook: '副歌上扬',
        lyricRewriteBrief: '强化副歌',
        titleSuggestions: ['燃夜'],
        sunoTitle: '燃夜',
        sunoStyleTags: ['edm'],
        sunoLyricsDraft: '[Intro]\n燃夜开始',
      },
      userPrompt: '改成更适合短视频传播的版本',
    });

    expect(prompt).toContain('Suno 元标签规则');
    expect(prompt).toContain('[Intro]');
    expect(prompt).toContain('只返回合法 JSON');
  });

  it('builds Suno-ready create prompts for text lyric drafting', () => {
    const prompt = buildLyricsRewritePrompt({
      userPrompt: '写一首适合夏夜海边的中文女声流行歌',
      musicBrief: {
        purpose: '短视频爆点：10 秒内建立记忆点',
        genreStyle: 'EDM Pop',
        vocalStyle: 'female vocal',
        energyMood: '高能上扬',
        lyricGoal: '副歌第一句必须像标题一样可记忆',
      },
      mode: 'create',
    });

    expect(prompt).toContain('用户创作要求');
    expect(prompt).toContain('直接用于 Suno 音乐生成');
    expect(prompt).toContain('title: 适合歌曲发布与生成的标题');
    expect(prompt).toContain('主动补全合理的歌曲结构');
    expect(prompt).toContain('歌曲定位');
    expect(prompt).toContain('核心曲风：EDM Pop');
    expect(prompt).toContain('副歌第一句必须像标题一样可记忆');
  });

  it('includes the first-step creation prompt in rewrite context', () => {
    const prompt = buildLyricsRewritePrompt({
      userPrompt: '保留情绪核心，但副歌更抓耳',
      originalPrompt: '写一首关于深夜城市奔跑感的热血流行歌',
      currentLyrics: '[Verse]\n霓虹在背后流动',
      musicBrief: {
        genreStyle: 'Synth Pop',
        vocalStyle: 'male vocal',
      },
    });

    expect(prompt).toContain('第一步创作提示词');
    expect(prompt).toContain('深夜城市奔跑感');
    expect(prompt).toContain('当前已有歌词草稿');
    expect(prompt).toContain('核心曲风：Synth Pop');
  });

  it('formats music brief for Suno lyrics prompts', () => {
    const prompt = buildSunoLyricsPrompt({
      userPrompt: '写一首关于冲破低谷的歌',
      musicBrief: {
        purpose: '短视频爆点：10 秒内建立记忆点',
        genreStyle: 'EDM Pop',
        vocalStyle: 'female vocal',
      },
      mode: 'create',
    });

    expect(prompt).toContain('歌曲定位');
    expect(prompt).toContain('音乐用途：短视频爆点');
    expect(prompt).toContain('用户创作要求');
    expect(prompt).toContain('冲破低谷');
  });

  it('provides broader purpose presets with scenario-specific prompt guidance', () => {
    expect(MUSIC_BRIEF_PURPOSE_OPTIONS).toEqual(
      expect.arrayContaining([
        '普通歌曲创作：面向完整单曲发布，结构完整，旋律与歌词都要好唱',
        '广告歌/Jingle：短句洗脑，品牌名或口号自然进入 hook',
        '儿歌/亲子：旋律简单，词句安全、重复、易学',
        '游戏/二次元角色曲：贴合世界观、人设口吻和燃点',
      ])
    );

    const songPrompt = formatMusicBriefPromptBlock({
      purpose: '歌曲创作',
    });
    const jinglePrompt = formatMusicBriefPromptBlock({
      purpose: '广告歌/Jingle：短句洗脑，品牌名或口号自然进入 hook',
    });

    expect(songPrompt).toContain('用途场景提示');
    expect(songPrompt).toContain('普通歌曲创作：按完整单曲构思');
    expect(jinglePrompt).toContain('广告歌/Jingle：结构要短促高记忆');
    expect(jinglePrompt).not.toContain('普通歌曲创作：按完整单曲构思');
  });

  it('adds genre-specific prompt guidance for Mozart-style music', () => {
    expect(MUSIC_BRIEF_GENRE_OPTIONS).toEqual(
      expect.arrayContaining([
        'Mozart Classical（莫扎特古典主义）',
        'Classical Orchestra（古典管弦乐）',
        'Chamber Classical（室内乐古典）',
      ])
    );

    const prompt = formatMusicBriefPromptBlock({
      genreStyle: '莫扎特风格',
    });

    expect(prompt).toContain('曲风创作提示');
    expect(prompt).toContain('Mozart Classical');
    expect(prompt).toContain('钢琴、弦乐、木管');
    expect(prompt).toContain('避免现代 EDM 鼓点');
  });

  it('merges music brief style tags after model output', () => {
    expect(
      mergeMusicBriefStyleTags(['dance pop', 'female vocal'], {
        genreStyle: 'EDM Pop（电子流行）',
        vocalStyle: 'female vocal（女声）',
        energyMood: '高能上扬',
      })
    ).toEqual(['dance pop', 'female vocal', 'EDM Pop', '高能上扬']);
  });

  it('omits empty music brief prompt blocks', () => {
    expect(formatMusicBriefPromptBlock({})).toBe('');
  });

  it('extracts lyrics rewrite payload from JSON text', () => {
    const result = parseLyricsRewriteResult(`说明文字
{
  "title": "燃夜",
  "styleTags": ["edm pop", "female vocal"],
  "lyricsDraft": "[Verse]\\n我们迎着光奔跑"
}
后缀`);

    expect(result).toEqual({
      title: '燃夜',
      styleTags: ['edm pop', 'female vocal'],
      lyricsDraft: '[Verse]\n我们迎着光奔跑',
    });
  });

  it('extracts lyrics rewrite payload after model thinking text', () => {
    const result = parseLyricsRewriteResult(`<think>{"title": 123}</think>
最终 JSON：
{
  "title": "星河",
  "styleTags": ["synth pop"],
  "lyricsDraft": "[Chorus]\\n向星河奔跑"
}`);

    expect(result).toEqual({
      title: '星河',
      styleTags: ['synth pop'],
      lyricsDraft: '[Chorus]\n向星河奔跑',
    });
  });

  it('merges text models and Suno models without duplicates', () => {
    const models = collectLyricsDraftModels(
      [
        { id: 'gemini-2.5-pro', selectionKey: 'text:g2p' } as any,
        { id: 'gpt-4.1-mini', selectionKey: 'text:gpt' } as any,
      ],
      [
        { id: 'suno_lyric', selectionKey: 'audio:suno-lyric' } as any,
        { id: 'suno_lyric', selectionKey: 'audio:suno-lyric' } as any,
        { id: 'suno-music', selectionKey: 'audio:suno-music' } as any,
      ]
    );

    expect(models.map((item) => item.id)).toEqual([
      'gemini-2.5-pro',
      'gpt-4.1-mini',
      'suno_lyric',
      'suno-music',
    ]);
  });

  it('detects Suno lyric models', () => {
    expect(isSunoLyricsModel('suno_lyric')).toBe(true);
    expect(isSunoLyricsModel('gemini-2.5-pro')).toBe(false);
  });
});
