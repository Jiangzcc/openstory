import { parseSource, walkAst } from './ast';
import type { AstNode as Node } from './ast';

type JSXAttribute = Extract<Node, { type: 'JSXAttribute' }>;
type JSXOpeningElement = Extract<Node, { type: 'JSXOpeningElement' }>;

export type UiCopyEntry = {
  kind: 'translation-key' | 'jsx-text' | 'jsx-attribute';
  text: string;
  line: number;
  attribute?: string;
  namespace?: string;
};

export type UiCopyScan = {
  entries: UiCopyEntry[];
  dynamicKeys: Array<{ line: number; kind: 'dynamic-translation-key' }>;
  namespaceHints: string[];
};

type TranslationCall = Extract<
  Node,
  { type: 'CallExpression' | 'OptionalCallExpression' }
>;

const FIRST_SOURCE_LINE = 1;
const TRANSLATION_HOOKS = new Set(['useTranslation', 'useLabelTranslation']);
const VISIBLE_ATTRIBUTES = new Set([
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
]);

function sourceLine(node: Node): number {
  return node.loc?.start.line ?? FIRST_SOURCE_LINE;
}

function unwrapExpression(node: Node | null | undefined): Node | undefined {
  if (!node) return undefined;
  switch (node.type) {
    case 'TSAsExpression':
    case 'TSSatisfiesExpression':
    case 'TSTypeAssertion':
    case 'TSNonNullExpression':
    case 'ParenthesizedExpression':
      return unwrapExpression(node.expression);
    default:
      return node;
  }
}

function staticText(node: Node | null | undefined): string | undefined {
  const value = unwrapExpression(node);
  if (value?.type === 'StringLiteral') return value.value;
  if (value?.type !== 'TemplateLiteral') return undefined;
  if (value.expressions.length !== 0) return undefined;
  return value.quasis[0]?.value.cooked ?? undefined;
}

function propertyName(node: Node, computed: boolean): string | undefined {
  if (!computed && node.type === 'Identifier') return node.name;
  return staticText(node);
}

function callableName(node: Node): string | undefined {
  const callee = unwrapExpression(node);
  if (callee?.type === 'Identifier') return callee.name;
  if (
    callee?.type !== 'MemberExpression' &&
    callee?.type !== 'OptionalMemberExpression'
  ) {
    return undefined;
  }
  return propertyName(callee.property, callee.computed);
}

function explicitCallNamespace(call: TranslationCall): string | undefined {
  const options = unwrapExpression(call.arguments.at(-1));
  if (options?.type !== 'ObjectExpression') return undefined;
  for (const property of [...options.properties].reverse()) {
    if (property.type === 'SpreadElement') return undefined;
    const name = propertyName(property.key, property.computed);
    if (name === undefined) return undefined;
    if (name !== 'ns') continue;
    return property.type === 'ObjectProperty'
      ? staticText(property.value)
      : undefined;
  }
  return undefined;
}

function collectTranslation(
  key: Node | undefined,
  location: Node,
  namespace: string | undefined,
  scan: UiCopyScan
): void {
  const text = staticText(key);
  const line = sourceLine(location);
  if (text === undefined) {
    scan.dynamicKeys.push({ line, kind: 'dynamic-translation-key' });
    return;
  }
  const entry: UiCopyEntry = { kind: 'translation-key', text, line };
  if (namespace !== undefined) entry.namespace = namespace;
  scan.entries.push(entry);
}

function staticNamespaces(node: Node | null | undefined): string[] {
  const value = unwrapExpression(node);
  if (value?.type === 'ArrayExpression') {
    return value.elements
      .map(staticText)
      .filter((namespace): namespace is string => namespace !== undefined);
  }
  const namespace = staticText(value);
  return namespace === undefined ? [] : [namespace];
}

function collectCall(
  call: TranslationCall,
  scan: UiCopyScan,
  namespaceHints: Set<string>
): void {
  const name = callableName(call.callee);
  if (name === 't') {
    collectTranslation(
      call.arguments[0],
      call,
      explicitCallNamespace(call),
      scan
    );
  }
  if (name === undefined || !TRANSLATION_HOOKS.has(name)) return;
  for (const namespace of staticNamespaces(call.arguments[0])) {
    namespaceHints.add(namespace);
  }
}

function attributeValue(attribute: JSXAttribute): Node | undefined {
  const value = attribute.value;
  if (value?.type === 'JSXExpressionContainer') return value.expression;
  return value ?? undefined;
}

function explicitAttribute(
  opening: JSXOpeningElement,
  name: string
): JSXAttribute | undefined {
  for (const attribute of [...opening.attributes].reverse()) {
    if (attribute.type === 'JSXSpreadAttribute') return undefined;
    if (attribute.name.type !== 'JSXIdentifier') continue;
    if (attribute.name.name === name) return attribute;
  }
  return undefined;
}

function collectTrans(opening: JSXOpeningElement, scan: UiCopyScan): void {
  const name = opening.name;
  const component = name.type === 'JSXMemberExpression' ? name.property : name;
  if (component.type !== 'JSXIdentifier' || component.name !== 'Trans') return;
  const key = explicitAttribute(opening, 'i18nKey');
  if (!key) return;
  const namespace = explicitAttribute(opening, 'ns');
  collectTranslation(
    attributeValue(key),
    key,
    namespace ? staticText(attributeValue(namespace)) : undefined,
    scan
  );
}

function normalizeJsxLine(
  line: string,
  index: number,
  lastLine: number,
  lastContentLine: number
): string {
  let text = line.replace(/\t/g, ' ');
  if (index !== 0) text = text.replace(/^ +/, '');
  if (index !== lastLine) text = text.replace(/ +$/, '');
  if (text && index !== lastContentLine) text += ' ';
  return text;
}

function normalizeJsxText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/);
  let lastContentLine = 0;
  for (const [index, line] of lines.entries()) {
    if (/[^ \t]/.test(line)) lastContentLine = index;
  }
  return lines
    .map((line, index) =>
      normalizeJsxLine(line, index, lines.length - 1, lastContentLine)
    )
    .join('');
}

function collectAttribute(attribute: JSXAttribute, scan: UiCopyScan): void {
  if (attribute.name.type !== 'JSXIdentifier') return;
  const name = attribute.name.name;
  if (!VISIBLE_ATTRIBUTES.has(name)) return;
  const text = staticText(attributeValue(attribute));
  if (text === undefined || !text.trim()) return;
  scan.entries.push({
    kind: 'jsx-attribute',
    text,
    line: sourceLine(attribute),
    attribute: name,
  });
}

function collectNode(
  node: Node,
  scan: UiCopyScan,
  namespaceHints: Set<string>
): void {
  switch (node.type) {
    case 'CallExpression':
    case 'OptionalCallExpression':
      collectCall(node, scan, namespaceHints);
      break;
    case 'JSXOpeningElement':
      collectTrans(node, scan);
      break;
    case 'JSXAttribute':
      collectAttribute(node, scan);
      break;
    case 'JSXText': {
      const text = normalizeJsxText(node.value);
      if (text.trim()) {
        scan.entries.push({ kind: 'jsx-text', text, line: sourceLine(node) });
      }
      break;
    }
  }
}

export function extractUiCopy(source: string, file: string): UiCopyScan {
  const scan: UiCopyScan = {
    entries: [],
    dynamicKeys: [],
    namespaceHints: [],
  };
  const namespaceHints = new Set<string>();
  for (const node of walkAst(parseSource(source, file))) {
    collectNode(node, scan, namespaceHints);
  }
  scan.namespaceHints = [...namespaceHints];
  return scan;
}
