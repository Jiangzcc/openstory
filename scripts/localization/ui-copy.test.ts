import { describe, expect, it } from 'vitest';
import type { UiCopyEntry, UiCopyScan } from './ui-copy';
import { extractUiCopy } from './ui-copy';

// Synthetic sources keep this report scanner independent of application code.
const SYNTHETIC_FILE = 'synthetic-ui.tsx';

function scan(source: string, file = SYNTHETIC_FILE): UiCopyScan {
  return extractUiCopy(source, file);
}

function copies(source: string): Omit<UiCopyEntry, 'line'>[] {
  return scan(source).entries.map(({ line: _line, ...entry }) => entry);
}

describe('static translation keys', () => {
  it('preserves punctuation and i18next interpolation verbatim', () => {
    const result = scan("t('Version 2.1: Save {{count}} files… (yes/no)?');");
    expect(result).toEqual({
      entries: [
        {
          kind: 'translation-key',
          text: 'Version 2.1: Save {{count}} files… (yes/no)?',
          line: 1,
        },
      ],
      dynamicKeys: [],
      namespaceHints: [],
    });
  });

  it('recognizes member calls and static template keys', () => {
    expect(copies("i18n.t('Save.'); object.t(`Hello, {{name}}!`);")).toEqual([
      { kind: 'translation-key', text: 'Save.' },
      { kind: 'translation-key', text: 'Hello, {{name}}!' },
    ]);
  });

  it('reads escaped characters as the runtime key value', () => {
    const source = String.raw`t('Don\'t stop.\nContinue?');`;
    expect(copies(source)).toEqual([
      { kind: 'translation-key', text: "Don't stop.\nContinue?" },
    ]);
  });
});

describe('translation call syntax', () => {
  it('keeps key whitespace, separators and repeated occurrences', () => {
    expect(copies("t('  common:Save.  '); t('  common:Save.  ');")).toEqual([
      { kind: 'translation-key', text: '  common:Save.  ' },
      { kind: 'translation-key', text: '  common:Save.  ' },
    ]);
  });

  it('recognizes optional calls and static computed member names', () => {
    const source = [
      "t?.('Direct');",
      "i18n?.t('Member');",
      "i18n['t']?.('Computed');",
    ].join('\n');
    expect(scan(source).entries.map((entry) => entry.text)).toEqual([
      'Direct',
      'Member',
      'Computed',
    ]);
  });

  it('ignores differently named calls and dynamic member names', () => {
    const source = [
      "translate('Ignore'); router.navigate('/account');",
      "object[method]('Ignore'); t.label('Ignore');",
    ].join('\n');
    expect(scan(source).entries).toEqual([]);
    expect(scan(source).dynamicKeys).toEqual([]);
  });
});

describe('hook namespace hints', () => {
  it('deduplicates static hook namespaces in encounter order', () => {
    const source = [
      "useTranslation('interface');",
      'useLabelTranslation(`labels`);',
      "useTranslation('interface');",
    ].join('\n');
    expect(scan(source)).toEqual({
      entries: [],
      dynamicKeys: [],
      namespaceHints: ['interface', 'labels'],
    });
  });

  it('retains static members of namespace arrays without evaluating others', () => {
    const source = [
      'useTranslation(["primary", runtime, `secondary`, "primary"]);',
      'useLabelTranslation(namespace);',
    ].join('\n');
    expect(scan(source).namespaceHints).toEqual(['primary', 'secondary']);
    expect(scan(source).dynamicKeys).toEqual([]);
  });

  it('ignores interpolated hook namespaces', () => {
    const result = scan('useTranslation(`ns-${tenant}`);');
    expect(result.namespaceHints).toEqual([]);
    expect(result.dynamicKeys).toEqual([]);
  });
});

describe('namespace attribution', () => {
  it('never guesses a namespace from multiple hooks in the same file', () => {
    const source = [
      "function A() { useTranslation('one'); return t('First.'); }",
      "function B() { useTranslation('two'); return object.t('Second.'); }",
      "useLabelTranslation('labels');",
    ].join('\n');
    expect(copies(source)).toEqual([
      { kind: 'translation-key', text: 'First.' },
      { kind: 'translation-key', text: 'Second.' },
    ]);
    expect(scan(source).namespaceHints).toEqual(['one', 'two', 'labels']);
  });

  it('uses explicit call options for each entry independently', () => {
    const source = [
      "t('First.', { ns: 'interface' });",
      "object.t('Second.', { ns: `labels` });",
    ].join('\n');
    expect(copies(source)).toEqual([
      { kind: 'translation-key', text: 'First.', namespace: 'interface' },
      { kind: 'translation-key', text: 'Second.', namespace: 'labels' },
    ]);
    expect(scan(source).namespaceHints).toEqual([]);
  });

  it('supports the default-value overload without collecting fallback copy', () => {
    const source = "t('Key.', 'Fallback', { ns: 'interface' });";
    expect(copies(source)).toEqual([
      { kind: 'translation-key', text: 'Key.', namespace: 'interface' },
    ]);
  });
});

describe('namespace options boundaries', () => {
  it('accepts quoted and static computed ns property names', () => {
    const source = [
      "t('One', { 'ns': 'first' });",
      "t('Two', { [`ns`]: 'second' });",
    ].join('\n');
    expect(scan(source).entries.map((entry) => entry.namespace)).toEqual([
      'first',
      'second',
    ]);
  });

  it('does not infer a single namespace from variables or arrays', () => {
    const source = [
      "t('One', { ns });",
      "t('Two', { ns: ['first', 'second'] });",
    ].join('\n');
    expect(copies(source)).toEqual([
      { kind: 'translation-key', text: 'One' },
      { kind: 'translation-key', text: 'Two' },
    ]);
  });

  it('respects unknown spreads and later explicit namespace overrides', () => {
    const source = [
      "t('One', { ns: 'first', ...options });",
      "t('Two', { ...options, ns: 'second' });",
      "t('Three', { ns: 'first', ns: runtime });",
    ].join('\n');
    expect(scan(source).entries.map((entry) => entry.namespace)).toEqual([
      undefined,
      'second',
      undefined,
    ]);
  });
});

describe('dynamic translation keys', () => {
  it('marks identifiers, member values and conditionals as dynamic', () => {
    const source = [
      't(key);',
      'i18n.t(user.label);',
      "t(condition ? 'First' : 'Second');",
    ].join('\n');
    expect(scan(source)).toEqual({
      entries: [],
      dynamicKeys: [
        { line: 1, kind: 'dynamic-translation-key' },
        { line: 2, kind: 'dynamic-translation-key' },
        { line: 3, kind: 'dynamic-translation-key' },
      ],
      namespaceHints: [],
    });
  });

  it('marks interpolated templates without extracting their fragments', () => {
    const source = 't(`Hello ${user.name}!`); object.t(`Saved ${count}.`);';
    expect(scan(source).entries).toEqual([]);
    expect(scan(source).dynamicKeys).toEqual([
      { line: 1, kind: 'dynamic-translation-key' },
      { line: 1, kind: 'dynamic-translation-key' },
    ]);
  });

  it('does not turn fallback values or key arrays into missing static keys', () => {
    const source = [
      "t(keys, 'Fallback', { ns: 'common', defaultValue: 'Other' });",
      "t(['First', 'Second']);",
    ].join('\n');
    expect(scan(source).entries).toEqual([]);
    expect(scan(source).dynamicKeys).toHaveLength(2);
  });
});

describe('Trans static keys', () => {
  it('recognizes i18nKey and an explicit namespace', () => {
    const source = '<Trans i18nKey="Hello, {{name}}!" ns="common" />;';
    expect(copies(source)).toEqual([
      {
        kind: 'translation-key',
        text: 'Hello, {{name}}!',
        namespace: 'common',
      },
    ]);
  });

  it('supports static JSX expressions and preserves key separators', () => {
    const source = [
      '<Trans i18nKey={"common:Read."} />;',
      '<Trans i18nKey={`Wait… {{name}}`} ns={"interface"} />;',
    ].join('\n');
    expect(copies(source)).toEqual([
      { kind: 'translation-key', text: 'common:Read.' },
      {
        kind: 'translation-key',
        text: 'Wait… {{name}}',
        namespace: 'interface',
      },
    ]);
  });

  it('recognizes a member Trans component', () => {
    expect(copies('<i18n.Trans i18nKey="Done?" ns={`labels`} />;')).toEqual([
      { kind: 'translation-key', text: 'Done?', namespace: 'labels' },
    ]);
  });
});

describe('Trans attribution boundaries', () => {
  it('marks dynamic Trans keys without collecting user interpolation', () => {
    const source = [
      '<Trans i18nKey={key} />;',
      '<Trans i18nKey={`Hello ${user.name}!`} />;',
    ].join('\n');
    expect(scan(source).entries).toEqual([]);
    expect(scan(source).dynamicKeys).toEqual([
      { line: 1, kind: 'dynamic-translation-key' },
      { line: 2, kind: 'dynamic-translation-key' },
    ]);
  });

  it('keeps hook hints separate from a Trans with a dynamic namespace', () => {
    const source = [
      "useTranslation('one'); useTranslation('two');",
      '<Trans i18nKey="Read." ns={activeNamespace} />;',
    ].join('\n');
    expect(copies(source)).toEqual([
      { kind: 'translation-key', text: 'Read.' },
    ]);
    expect(scan(source).namespaceHints).toEqual(['one', 'two']);
  });

  it('ignores i18nKey on other components and Trans without i18nKey', () => {
    const source = '<><Panel i18nKey="Ignore" /><Trans ns="common" /></>;';
    expect(scan(source).entries).toEqual([]);
    expect(scan(source).dynamicKeys).toEqual([]);
  });
});

describe('Trans namespace overrides', () => {
  it('does not claim a namespace that can be overwritten by a spread', () => {
    const source = '<Trans ns="common" {...props} i18nKey="Read." />;';
    expect(copies(source)).toEqual([
      { kind: 'translation-key', text: 'Read.' },
    ]);
  });

  it('accepts a namespace explicitly set after a spread', () => {
    const source = '<Trans {...props} i18nKey="Read." ns="common" />;';
    expect(copies(source)).toEqual([
      { kind: 'translation-key', text: 'Read.', namespace: 'common' },
    ]);
  });
});

describe('JSX text whitespace', () => {
  it('extracts inline text with a one-based source line', () => {
    expect(scan('<h1>Save, then go!</h1>;').entries).toEqual([
      { kind: 'jsx-text', text: 'Save, then go!', line: 1 },
    ]);
  });

  it('normalizes multiline indentation and tabs using JSX rules', () => {
    const source = [
      'const view = <div>',
      '\t Save,',
      '    then go!',
      '</div>;',
    ].join('\n');
    expect(copies(source)).toEqual([
      { kind: 'jsx-text', text: 'Save, then go!' },
    ]);
  });

  it('preserves intentional inline edge and internal spaces', () => {
    expect(copies('<span>  Save  now!  </span>;')).toEqual([
      { kind: 'jsx-text', text: '  Save  now!  ' },
    ]);
  });
});

describe('JSX text content', () => {
  it('retains visible Unicode and decodes JSX entities', () => {
    const source = '<p>Tom &amp; Jerry’s Café…&nbsp;继续！</p>;';
    expect(copies(source)).toEqual([
      { kind: 'jsx-text', text: 'Tom & Jerry’s Café…\u00a0继续！' },
    ]);
  });

  it('ignores user expressions, JSX comments and ordinary child strings', () => {
    const source = [
      '<div>Hello, {user.name}!{/* t("Comment") */}',
      '{"Ordinary JS"}{`Template ${name}`}</div>;',
    ].join('');
    expect(copies(source)).toEqual([
      { kind: 'jsx-text', text: 'Hello, ' },
      { kind: 'jsx-text', text: '!' },
    ]);
    expect(scan(source).dynamicKeys).toEqual([]);
  });

  it('ignores whitespace-only text and fragment indentation', () => {
    const source = 'const view = <>\n  <span> \t </span>\n \t \n</>;';
    expect(scan(source).entries).toEqual([]);
  });
});

describe('visible JSX attributes', () => {
  it.each([
    'label',
    'title',
    'placeholder',
    'aria-label',
    'alt',
    'description',
    'heading',
    'emptyMessage',
    'tooltip',
    'loadingText',
    'comment',
  ])('extracts static %s copy', (attribute) => {
    const source = `<Panel ${attribute}="Ready, {{name}}!" />;`;
    expect(copies(source)).toEqual([
      { kind: 'jsx-attribute', text: 'Ready, {{name}}!', attribute },
    ]);
  });
});

describe('JSX attribute expressions', () => {
  it('accepts literal expressions without normalizing their text', () => {
    const source = '<Panel title={" Save. "} label={`Wait… {{name}}`} />;';
    expect(copies(source)).toEqual([
      { kind: 'jsx-attribute', text: ' Save. ', attribute: 'title' },
      { kind: 'jsx-attribute', text: 'Wait… {{name}}', attribute: 'label' },
    ]);
  });

  it('does not duplicate keys in translated attribute expressions', () => {
    const source = [
      '<Input title={t("Use {{name}}", { ns: "common" })}',
      ' aria-label={i18n.t("Name")} />;',
    ].join('');
    expect(copies(source)).toEqual([
      { kind: 'translation-key', text: 'Use {{name}}', namespace: 'common' },
      { kind: 'translation-key', text: 'Name' },
    ]);
  });

  it('ignores dynamic attributes without labeling them as dynamic keys', () => {
    const source = [
      '<Panel label={user.label} title={`Hi ${name}`}',
      ' alt={"Photo: " + subject} />;',
    ].join('');
    expect(scan(source).entries).toEqual([]);
    expect(scan(source).dynamicKeys).toEqual([]);
  });
});

describe('non-copy syntax', () => {
  it('ignores technical attributes and blank visible attributes', () => {
    const source = [
      '<Input src="/image.png" className="flex" href="/home" id="input"',
      ' name="email" value="saved" data-copy="Ignore"',
      ' aria-labelledby="caption" label="" title="  " placeholder />;',
    ].join('');
    expect(scan(source).entries).toEqual([]);
  });

  it('ignores comments, imports, config values and ordinary strings', () => {
    const source = [
      '// t("Comment");',
      '/* <Trans i18nKey="Comment" /> */',
      'import x from "some-package";',
      'const config = { label: "Config", title: "Meta" };',
      'const click = () => alert("Internal");',
      'const template = `Not UI ${name}`;',
      'const markup = "<div>Not JSX</div>";',
    ].join('\n');
    expect(scan(source)).toEqual({
      entries: [],
      dynamicKeys: [],
      namespaceHints: [],
    });
  });

  it('ignores TypeScript literal types', () => {
    const source = 'type Copy = { label: "Label"; t: "Method" };';
    expect(scan(source, 'synthetic.ts').entries).toEqual([]);
  });
});

describe('formatting stability', () => {
  it('returns the same scan for LF and CRLF source', () => {
    const source = [
      "useTranslation('common');",
      'const view = <Panel title="Ready?">',
      '  Hello,',
      '  world!',
      '  {t("Welcome, {{name}}!", { ns: "common" })}',
      '</Panel>;',
    ].join('\n');
    expect(scan(source.replace(/\n/g, '\r\n'))).toEqual(scan(source));
  });

  it('keeps copy unchanged when calls and JSX text are reformatted', () => {
    const compact = [
      '<div title="Status">',
      '{t("Welcome.", { ns: "common" })}Hello, world!</div>;',
    ].join('');
    const formatted = [
      '<div',
      '  title="Status"',
      '>',
      '  {t(',
      '    "Welcome.",',
      '    { ns: "common" },',
      '  )}',
      '  Hello,',
      '  world!',
      '</div>;',
    ].join('\n');
    expect(copies(formatted)).toEqual(copies(compact));
  });
});

describe('source coordinates and parsing', () => {
  it('reports call, attribute, text and dynamic key source lines', () => {
    const source = [
      "const first = t('First');",
      '',
      'const view = <Panel',
      '  title="Title"',
      '>{t(key)}<span>Visible</span></Panel>;',
    ].join('\n');
    expect(scan(source).entries).toEqual([
      { kind: 'translation-key', text: 'First', line: 1 },
      { kind: 'jsx-attribute', text: 'Title', line: 4, attribute: 'title' },
      { kind: 'jsx-text', text: 'Visible', line: 5 },
    ]);
    expect(scan(source).dynamicKeys).toEqual([
      { line: 5, kind: 'dynamic-translation-key' },
    ]);
  });

  it('passes the TypeScript filename through and unwraps literal assertions', () => {
    const source = [
      'const identity = <T>(value: T): T => value;',
      "t(('Typed, {{count}}.' as const), { ns: 'types' as const });",
    ].join('\n');
    expect(scan(source, 'synthetic.ts').entries).toEqual([
      {
        kind: 'translation-key',
        text: 'Typed, {{count}}.',
        line: 2,
        namespace: 'types',
      },
    ]);
  });

  it('lets syntax errors reach the report caller', () => {
    expect(() => scan('const view = <div>')).toThrow();
  });
});
