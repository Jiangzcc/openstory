import { describe, expect, it } from 'vitest';
import { createInstance } from 'i18next';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import { mcpAppHostContext, mcpResultStyleId } from './mcp-app-context';

const STYLE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('MCP App display context', () => {
  it('translates a server-confirmed template in the interface language', () => {
    const style = { id: STYLE_ID, name: 'Animated', isTemplate: true };
    expect(mcpAppHostContext(createApplicationI18n('zh-CN'), style)).toEqual({
      locale: 'zh-CN',
      'openstory/styleNames': { [STYLE_ID]: '动画' },
    });
    expect(mcpAppHostContext(createApplicationI18n('en'), style)).toEqual({
      locale: 'en',
      'openstory/styleNames': { [STYLE_ID]: 'Animated' },
    });
    expect(style.name).toBe('Animated');
  });

  it('leaves a custom style with the same name unmapped', () => {
    const style = { id: STYLE_ID, name: 'Animated', isTemplate: false };
    expect(mcpAppHostContext(createApplicationI18n('zh-CN'), style)).toEqual({
      locale: 'zh-CN',
      'openstory/styleNames': {},
    });
    expect(style.name).toBe('Animated');
  });

  it('sends the current locale before the optional style is available', async () => {
    const i18n = createApplicationI18n('zh-CN');
    expect(mcpAppHostContext(i18n)).toEqual({
      locale: 'zh-CN',
      'openstory/styleNames': {},
    });
    await i18n.changeLanguage('en');
    expect(mcpAppHostContext(i18n, null)).toEqual({
      locale: 'en',
      'openstory/styleNames': {},
    });
  });

  it('defaults to Chinese without a resolved host language', () => {
    expect(mcpAppHostContext(createInstance())).toEqual({
      locale: 'zh-CN',
      'openstory/styleNames': {},
    });
  });

  it('extracts only the style id without changing tool or user data', () => {
    const result = {
      title: 'Animated',
      style: { id: STYLE_ID, name: 'Animated', isTemplate: true },
      userText: '用户保留的剧本',
    };
    const content = JSON.stringify(result);
    expect(mcpResultStyleId(content)).toBe(STYLE_ID);
    expect(mcpResultStyleId(result)).toBe(STYLE_ID);
    expect(JSON.stringify(result)).toBe(content);
  });

  it.each([
    'not json',
    'null',
    '[]',
    '{}',
    '{"style":null}',
    '{"style":{"name":"Animated"}}',
    '{"style":{"id":"invalid"}}',
    { style: { id: 123 } },
    undefined,
  ])(
    'disables the style lookup for malformed or absent data: %j',
    (content) => {
      expect(mcpResultStyleId(content)).toBe('');
    }
  );
});
