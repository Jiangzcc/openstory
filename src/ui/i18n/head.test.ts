import { describe, expect, it } from 'vitest';
import { createApplicationI18n } from './runtime';
import {
  localizeMeta,
  translateHeadText,
  translateMarkedHeadText,
} from './head';

const AGENT_DESCRIPTION =
  'Connect an MCP client or script to OpenStory — inspect a production, edit a scene, plan and approve generation, poll it, and export';
const CHINESE_AGENT_DESCRIPTION =
  '将 MCP 客户端或脚本接入 OpenStory，查看作品、编辑场景、规划并确认生成、查询进度和导出成片';

describe('localized document metadata', () => {
  it('translates a complete description before considering title suffixes', () => {
    const i18n = createApplicationI18n();
    const entries = localizeMeta(i18n, 'documentation', [
      { name: 'description', content: AGENT_DESCRIPTION },
      { property: 'og:description', content: AGENT_DESCRIPTION },
    ]);

    expect(entries.map((entry) => entry.content)).toEqual([
      CHINESE_AGENT_DESCRIPTION,
      CHINESE_AGENT_DESCRIPTION,
    ]);
  });

  it('preserves documentation and brand suffixes on composed titles', () => {
    const i18n = createApplicationI18n();
    expect(translateHeadText(i18n, 'pages', 'Pricing — OpenStory')).toBe(
      '价格 — OpenStory'
    );
    expect(
      translateHeadText(
        i18n,
        'documentation',
        'Frequently Asked Questions - OpenStory Docs'
      )
    ).toBe('常见问题 - OpenStory 文档');
  });

  it('retranslates marked metadata in its original namespace after switching', async () => {
    const i18n = createApplicationI18n();
    const entries = localizeMeta(i18n, 'auth', [{ title: 'Welcome' }]);
    const entry = entries[0];
    expect(entry).toBeDefined();
    expect(translateMarkedHeadText(i18n, entry ?? {})).toBe(
      '欢迎使用 OpenStory'
    );

    await i18n.changeLanguage('en');
    expect(translateMarkedHeadText(i18n, entry ?? {})).toBe('Welcome');
    expect(
      translateMarkedHeadText(i18n, { title: 'User title' })
    ).toBeUndefined();
  });

  it('preserves non-text metadata and unknown source text', () => {
    const i18n = createApplicationI18n();
    const image = { property: 'og:image', content: '/preview.jpg' };
    const robots = { name: 'robots', content: 'noindex' };
    const entries = localizeMeta(i18n, 'pages', [image, robots]);

    expect(entries).toEqual([image, robots]);
    expect(translateHeadText(i18n, 'pages', 'Future page title')).toBe(
      'Future page title'
    );
  });
});
