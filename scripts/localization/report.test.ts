import { describe, expect, it } from 'vitest';
import { localizationReport } from './report';
import type { SourceSnapshot } from './git-snapshot';

const UI_FILE = 'src/example/ui/page.tsx';
const ENGLISH = 'src/platform/server/ai/workflow-prompts.ts';
const CHINESE = 'src/platform/server/ai/prompts/zh-CN/text.ts';
const RESOURCE = 'src/ui/i18n/locales/en/image-channels.json';

// Synthetic source snapshots are parsed as data and never executed.
function snapshot(
  files: Record<string, string>,
  revision: string
): SourceSnapshot {
  return {
    revision,
    files: new Set(Object.keys(files)),
    read: (file) => {
      const source = files[file];
      if (source === undefined) throw new Error('Missing mock source: ' + file);
      return source;
    },
  };
}

function report(before: Record<string, string>, after: Record<string, string>) {
  return localizationReport(
    snapshot(before, 'mock-before'),
    snapshot(after, 'mock-after'),
    [...Object.keys(before), ...Object.keys(after)]
  );
}

describe('UI change candidates', () => {
  it('keeps English punctuation and interpolation keys instead of rewriting them', () => {
    const result = report(
      {},
      { [UI_FILE]: "t('Welcome, {{name}}!', { ns: 'shots' });" }
    );
    expect(result.uiCopy[0]?.added).toEqual([
      expect.objectContaining({
        kind: 'translation-key',
        text: 'Welcome, {{name}}!',
        namespace: 'shots',
      }),
    ]);
    expect(result.status).toBe('report-only');
  });

  it('keeps duplicate copy counts while ignoring line movement', () => {
    const result = report(
      { [UI_FILE]: "t('Save'); t('Save');" },
      { [UI_FILE]: "\n\nt('Save');" }
    );
    expect(result.uiCopy[0]?.added).toEqual([]);
    expect(result.uiCopy[0]?.removed).toEqual([
      expect.objectContaining({ text: 'Save' }),
    ]);
  });

  it('reports a namespace change even when the English key is unchanged', () => {
    const result = report(
      { [UI_FILE]: "t('Save', { ns: 'shots' });" },
      { [UI_FILE]: "t('Save', { ns: 'cast' });" }
    );
    expect(result.uiCopy[0]?.removed[0]?.namespace).toBe('shots');
    expect(result.uiCopy[0]?.added[0]?.namespace).toBe('cast');
  });

  it('does not turn JSX whitespace or CRLF changes into added copy', () => {
    const result = report(
      { [UI_FILE]: '<div>Save changes</div>;' },
      { [UI_FILE]: '<div>\r\n  Save changes\r\n</div>;' }
    );
    expect(result.uiCopy).toEqual([]);
  });
});

describe('dynamic and excluded UI sources', () => {
  it('keeps dynamic translation keys unresolved', () => {
    const result = report(
      { [UI_FILE]: 't(previous);' },
      { [UI_FILE]: 't(next);' }
    );
    expect(result.uiCopy[0]?.added).toEqual([]);
    expect(result.uiCopy[0]?.dynamicKeys).toEqual([
      expect.objectContaining({ kind: 'dynamic-translation-key' }),
    ]);
  });

  it('lists UI code it cannot classify instead of treating it as reviewed', () => {
    const result = report(
      {},
      { [UI_FILE]: "const labels = ['User supplied label'];" }
    );
    expect(result.uiCopy).toEqual([]);
    expect(result.unclassifiedUiFiles).toEqual([UI_FILE]);
  });

  it.each(['page.test.tsx', 'page.stories.tsx', 'page.gen.tsx'])(
    'excludes %s from production copy',
    (name) => {
      const result = report(
        {},
        { ['src/example/ui/' + name]: 'INVALID TEST SOURCE' }
      );
      expect(result.sources).toEqual([]);
      expect(result.uiCopy).toEqual([]);
    }
  );

  it('never imports or executes the source it inspects', () => {
    const result = report(
      {},
      {
        [UI_FILE]:
          "import 'missing-mock-module'; throw new Error('Do not execute'); t('Visible');",
      }
    );
    expect(result.uiCopy[0]?.added[0]?.text).toBe('Visible');
  });
});

describe('language resource deltas', () => {
  it('reports additions, removals and value changes with exact source keys', () => {
    const result = report(
      { [RESOURCE]: JSON.stringify({ Old: 'Old', 'Keep!': 'Before' }) },
      {
        [RESOURCE]: JSON.stringify({
          'Keep!': 'After',
          'New {{count}}': 'New {{count}}',
        }),
      }
    );
    expect(result.resources[0]).toMatchObject({
      file: RESOURCE,
      locale: 'en',
      namespaceFile: 'image-channels',
      semanticReview: 'required',
      changes: [
        { kind: 'changed', key: 'Keep!', before: 'Before', after: 'After' },
        { kind: 'added', key: 'New {{count}}', after: 'New {{count}}' },
        { kind: 'removed', key: 'Old', before: 'Old' },
      ],
    });
  });

  it('preserves Chinese changes and never grants automatic semantic approval', () => {
    const file = 'src/platform/i18n/locales/zh-CN/mail.json';
    const result = report(
      { [file]: '{"Sign in":"登录"}' },
      { [file]: '{"Sign in":"登入"}' }
    );
    expect(result.resources[0]).toMatchObject({
      locale: 'zh-CN',
      semanticReview: 'required',
      changes: [{ key: 'Sign in', before: '登录', after: '登入' }],
    });
  });

  it('does not treat JSON formatting or property order as a resource change', () => {
    const result = report(
      { [RESOURCE]: '{"A":"A","B":"B"}' },
      { [RESOURCE]: '{\n  "B":"B",\n  "A":"A"\n}' }
    );
    expect(result.resources).toEqual([]);
  });
});

describe('resource input validation', () => {
  it.each(['{ invalid', '{"key":{"nested":"value"}}'])(
    'rejects invalid or unsupported resource data: %s',
    (source) => {
      expect(() => report({}, { [RESOURCE]: source })).toThrow();
    }
  );
});

describe('registered English prompt owners', () => {
  it('includes local guidance changes even when the registry entry is unchanged', () => {
    const before = {
      [ENGLISH]: 'const GUIDE = "old"; export const PROMPT = GUIDE;',
      [CHINESE]: 'export const PROMPT = "中文";',
    };
    const after = {
      ...before,
      [ENGLISH]: 'const GUIDE = "new"; export const PROMPT = GUIDE;',
    };
    const prompt = report(before, after).systemPrompts[0];
    expect(prompt).toMatchObject({
      sourceKind: 'english-owner',
      status: 'needs_review',
      semanticApproval: false,
      precision: 'whole-module-conservative-trigger',
    });
    expect(prompt?.counterparts).toContainEqual(
      expect.objectContaining({
        file: CHINESE,
        changed: false,
        existsAfter: true,
      })
    );
    expect(prompt?.counterparts).toContainEqual(
      expect.objectContaining({
        file: 'src/platform/server/ai/prompts/zh-CN/audio.ts',
        existsAfter: false,
      })
    );
  });
  it('requires review even when both English and Chinese modules change', () => {
    const result = report(
      {
        [ENGLISH]: 'export const P = "old";',
        [CHINESE]: 'export const P = "旧";',
      },
      {
        [ENGLISH]: 'export const P = "new";',
        [CHINESE]: 'export const P = "新";',
      }
    );
    const prompt = result.systemPrompts.find(({ file }) => file === ENGLISH);
    expect(prompt?.status).toBe('needs_review');
    expect(prompt?.semanticApproval).toBe(false);
    expect(prompt?.counterparts).toContainEqual(
      expect.objectContaining({ file: CHINESE, changed: true })
    );
  });
});

describe('prompt source fingerprints', () => {
  it('ignores comments, quote style and source line endings in prompt fingerprints', () => {
    const result = report(
      { [ENGLISH]: 'export const P = "same";\r\n' },
      { [ENGLISH]: "// comment\nexport const P='same';\n" }
    );
    expect(result.systemPrompts).toEqual([]);
  });
});

describe('prompt changes outside the English registry', () => {
  it('does not guess which language changed in an inline bilingual module', () => {
    const file = 'src/sequences/server/scene-split-prompts.ts';
    const result = report(
      { [file]: 'const EN = "English"; const ZH = "旧";' },
      { [file]: 'const EN = "English"; const ZH = "新";' }
    );
    expect(result.systemPrompts[0]).toMatchObject({
      sourceKind: 'bilingual-owner',
      status: 'needs_review',
      reason: 'bilingual-owner-module-changed-language-not-inferred',
    });
  });

  it('keeps newly introduced unpaired prompt files visible as candidates', () => {
    const file = 'src/new/server/new-prompt.ts';
    const result = report(
      {},
      { [file]: 'export const P = "New instruction";' }
    );
    expect(result.systemPrompts[0]).toMatchObject({
      file,
      sourceKind: 'unmapped-candidate',
      counterparts: [],
      status: 'needs_review',
      reason: 'unmapped-prompt-source-candidate',
    });
  });

  it('retains a removed English owner and its surviving Chinese counterpart', () => {
    const before = {
      [ENGLISH]: 'export const P = "Old instruction";',
      [CHINESE]: 'export const P = "中文";',
    };
    const result = report(before, { [CHINESE]: before[CHINESE] });
    expect(result.systemPrompts[0]).toMatchObject({
      file: ENGLISH,
      after: null,
      status: 'needs_review',
    });
  });
});

describe('report evidence and existing help checks', () => {
  it('points changed standard help files at existing checks without claiming they ran', () => {
    const result = report(
      {},
      {
        'docs/user-guide/new.md': '# Help',
        'docs/secondary-development/example.md': '# Development note',
      }
    );
    expect(result.helpMarkdown).toEqual(['docs/user-guide/new.md']);
    expect(result.existingChecks.executedByReport).toBe(false);
    expect(result.existingChecks.command).toContain(
      'src/ui/i18n/markdown.test.ts'
    );
  });

  it('binds added and deleted files to raw source hashes without rewriting them', () => {
    const file = 'docs/getting-started.md';
    const result = report({}, { [file]: '# Help' });
    expect(result.sources).toEqual([
      { file, before: null, after: expect.stringMatching(/^[a-f0-9]{64}$/) },
    ]);
    expect(result.base).toBe('mock-before');
    expect(result.head).toBe('mock-after');
  });

  it('surfaces parse errors instead of presenting an empty successful scan', () => {
    expect(() => report({}, { [UI_FILE]: 'export const = ;' })).toThrow();
  });
});

describe('maintenance report coverage boundaries', () => {
  it('surfaces hook namespace changes without assigning them to unrelated keys', () => {
    const result = report(
      { [UI_FILE]: "useTranslation('shots'); t('Save');" },
      { [UI_FILE]: "useTranslation('cast'); t('Save');" }
    );
    expect(result.uiCopy[0]).toMatchObject({
      added: [],
      removed: [],
      namespaceHints: { before: ['shots'], after: ['cast'] },
    });
  });

  it('flags new resources under a prompt directory even without prompt in the basename', () => {
    const file = 'src/platform/server/ai/prompts/zh-CN/new.ts';
    const result = report({}, { [file]: 'export const P = "新指令";' });
    expect(result.systemPrompts[0]).toMatchObject({
      file,
      status: 'needs_review',
      counterparts: [],
    });
  });

  it('does not decode binary or generated media as source text', () => {
    const result = report(
      {},
      { 'src/example/ui/photo.png': 'Not TypeScript or UTF-8 source' }
    );
    expect(result.sources).toEqual([]);
  });
});

describe('localized counterpart source roles', () => {
  it('does not infer a changed language from a mixed-language counterpart module', () => {
    const owner = 'src/models/ai.fn.ts';
    const counterpart = 'src/models/server/auxiliary-prompts.ts';
    const result = report(
      {
        [owner]: 'export const P = "English";',
        [counterpart]: 'export const EN = "old"; export const ZH = "中文";',
      },
      {
        [owner]: 'export const P = "English";',
        [counterpart]: 'export const EN = "new"; export const ZH = "中文";',
      }
    );
    expect(result.systemPrompts[0]).toMatchObject({
      file: counterpart,
      sourceKind: 'localized-counterpart',
      status: 'needs_review',
    });
    expect(result.systemPrompts[0]).not.toHaveProperty('sourceLanguage');
  });
});

describe('repository UI paths and generated sources', () => {
  it.each(['src/ui/localize-upload-error.ts', 'src/example/ui/copy.ts'])(
    'detects static translation key changes at %s',
    (file) => {
      const result = report(
        { [file]: "i18n.t('Old hint');" },
        { [file]: "i18n.t('New hint');" }
      );
      expect(result.uiCopy[0]?.added[0]?.text).toBe('New hint');
      expect(result.uiCopy[0]?.removed[0]?.text).toBe('Old hint');
    }
  );

  it.each([
    'src/look/ui/style-brief-variants.generated.ts',
    'src/look/style-briefs.generated.ts',
    'src/test/setup.ts',
  ])('excludes generated output and test support: %s', (file) => {
    const result = report({}, { [file]: 'NOT A PRODUCTION SOURCE MODULE' });
    expect(result.sources).toEqual([]);
    expect(result.uiCopy).toEqual([]);
    expect(result.unclassifiedUiFiles).toEqual([]);
  });
});
