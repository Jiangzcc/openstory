import { describe, expect, it } from 'vitest';
import { buildDraftMessages } from './studio-prompt-draft';

describe('buildDraftMessages', () => {
  it('numbers tokens per kind and only sends stills as image parts', async () => {
    const { messages } = await buildDraftMessages({
      promptLocale: 'en',
      activity: 'video',
      references: [
        { url: 'https://cdn.example/a.png', label: 'Ava', kind: 'image' },
        { url: 'https://cdn.example/b.mp4', label: 'Pan', kind: 'video' },
        { url: 'https://cdn.example/c.png', label: 'Bar', kind: 'image' },
        { url: 'https://cdn.example/d.mp3', label: 'Rain', kind: 'audio' },
      ],
      currentPrompt: 'slow push in',
    });
    const content = messages[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    const text = content[0];
    expect(text?.type === 'text' ? text.content : '').toContain(
      'Image1: image — "Ava"\nVideo1: video — "Pan"\nImage2: image — "Bar"\nAudio1: audio — "Rain"'
    );
    expect(text?.type === 'text' ? text.content : '').toContain('slow push in');
    expect(content.filter((part) => part.type === 'image')).toHaveLength(2);
  });

  it('selects Chinese instructions and preserves mixed-language notes and reference tokens', async () => {
    const note = '雨中的 Lena says "Stay here."';
    const { systemPrompts, messages } = await buildDraftMessages({
      promptLocale: 'zh-CN',
      activity: 'video',
      references: [
        { url: 'https://cdn.example/a.mp4', label: 'Lena 原片', kind: 'video' },
      ],
      currentPrompt: note,
    });
    expect(systemPrompts[0]).toContain('你为 AI 视频生成器撰写提示词');
    expect(systemPrompts[0]).toContain('Image1、Video2、Audio1');
    expect(systemPrompts[0]).toContain('绝不写 @ 符号');
    expect(JSON.stringify(messages)).toContain(note.replaceAll('"', '\\"'));
    expect(JSON.stringify(messages)).toContain('Video1');
    expect(JSON.stringify(messages)).toContain('Lena 原片');
  });
});
