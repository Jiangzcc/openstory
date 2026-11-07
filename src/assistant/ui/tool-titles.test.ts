import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { MCP_TOOLS } from '@/platform/server/mcp/server';
import { chatToolName } from '@/assistant/server/assistant-tools';
import { REPLACE_UNSAVED_TEXT } from '@/assistant/unsaved-text-tool';
import { translateStaticLabel } from '@/platform/i18n/labels';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import en from '@/ui/i18n/locales/en/assistant.json';
import zh from '@/ui/i18n/locales/zh-CN/assistant.json';
import { toolTitle } from './tool-call-card';
import { toolInputLabel } from './tool-input-labels';

vi.mock('./mcp-app-frame', () => ({ McpAppFrame: () => null }));

const names = [
  ...MCP_TOOLS.flatMap((tool) => [tool.name, chatToolName(tool.name)]),
  REPLACE_UNSAVED_TEXT.name,
  '__lazy__tool__discovery__',
];

function canBeScalar(schema: unknown): boolean {
  if (typeof schema !== 'object' || schema === null) return false;
  if ('type' in schema) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (
      types.some((type) =>
        ['string', 'integer', 'number', 'boolean'].includes(type)
      )
    )
      return true;
  }
  return (
    ('anyOf' in schema &&
      Array.isArray(schema.anyOf) &&
      schema.anyOf.some(canBeScalar)) ||
    ('oneOf' in schema &&
      Array.isArray(schema.oneOf) &&
      schema.oneOf.some(canBeScalar))
  );
}

const scalarKeys = [
  ...new Set(
    [...MCP_TOOLS, REPLACE_UNSAVED_TEXT].flatMap((tool) => {
      if (!(tool.inputSchema instanceof z.ZodType))
        throw new Error(`Expected a Zod input schema for ${tool.name}`);
      const schema = z.toJSONSchema(tool.inputSchema, { io: 'input' });
      return Object.entries(schema.properties ?? {})
        .filter(
          ([key, property]) =>
            key !== 'confirm' && key !== 'planToken' && canBeScalar(property)
        )
        .map(([key]) => key);
    })
  ),
];

describe('assistant tool title localization', () => {
  it.each([
    ['en', en],
    ['zh-CN', zh],
  ] as const)(
    `covers all ${MCP_TOOLS.length} MCP tools and browser tool titles in %s`,
    (locale, resource) => {
      const i18n = createApplicationI18n(locale);
      const translations: Readonly<Record<string, string>> = resource;
      const missing = [...new Set(names.map(toolTitle))].filter((title) => {
        const value = translations[title];
        return (
          typeof value !== 'string' ||
          (locale === 'zh-CN' &&
            translateStaticLabel(i18n, 'assistant', title) === title)
        );
      });
      expect(missing).toEqual([]);
    }
  );

  it('localizes known tool titles in existing chat history', () => {
    const i18n = createApplicationI18n('zh-CN');
    for (const name of [
      'openstory_get_library_character',
      'openstory.get_library_character',
    ]) {
      expect(translateStaticLabel(i18n, 'assistant', toolTitle(name))).toBe(
        '查看组织角色'
      );
    }
  });

  it('keeps unknown tool titles readable without translating custom content', () => {
    const i18n = createApplicationI18n('zh-CN');
    expect(
      translateStaticLabel(
        i18n,
        'assistant',
        toolTitle('openstory_inspect_custom_archive')
      )
    ).toBe('Inspect custom archive');
  });
});

describe('assistant tool parameter localization', () => {
  it.each([
    ['en', en],
    ['zh-CN', zh],
  ] as const)(
    `covers ${scalarKeys.length} scalar parameter labels in %s`,
    (_locale, resource) => {
      const missing = scalarKeys.filter((key) => {
        const label = toolInputLabel(key);
        return label === key || !Object.hasOwn(resource, label);
      });
      expect(missing).toEqual([]);
    }
  );

  it('preserves unknown parameter names including inherited object keys', () => {
    for (const key of ['customField', 'toString', 'constructor', '__proto__']) {
      expect(toolInputLabel(key)).toBe(key);
    }
  });
});
