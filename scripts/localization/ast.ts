import { createHash } from 'node:crypto';
import { parseAst } from '@tanstack/router-utils';
import type { generateFromAst } from '@tanstack/router-utils';

export type AstNode = Parameters<typeof generateFromAst>[0];
type Node = AstNode;

export function parseSource(source: string, file: string) {
  return parseAst({ code: source, filename: file });
}

function isNode(value: unknown): value is Node {
  return (
    value !== null &&
    typeof value === 'object' &&
    'type' in value &&
    typeof value.type === 'string'
  );
}

export function* walkAst(node: Node): Generator<Node> {
  yield node;
  for (const value of Object.values(node)) {
    const children: unknown[] = Array.isArray(value) ? value : [value];
    for (const child of children) {
      if (isNode(child)) yield* walkAst(child);
    }
  }
}

const OMIT_AST_FIELDS = new Set([
  'start',
  'end',
  'loc',
  'extra',
  'comments',
  'tokens',
  'leadingComments',
  'trailingComments',
  'innerComments',
]);

function stableAst(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableAst);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !OMIT_AST_FIELDS.has(key))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, child]) => [key, stableAst(child)])
  );
}

export function sourceFingerprint(source: string, file: string) {
  const ast = parseSource(source.replaceAll('\r\n', '\n'), file);
  return createHash('sha256')
    .update(JSON.stringify(stableAst(ast.program)))
    .digest('hex');
}
