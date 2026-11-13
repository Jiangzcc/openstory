// Executes the real handler source with every external collaborator stubbed.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const SOURCE_EVALUATION_TIMEOUT_MS = 1000;

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();
const require = createRequire(resolve(root, 'package.json'));
const { parse } = require('@babel/parser');
const { mediaUrlSchema } = require(
  resolve(root, 'src/platform/schemas/media-url.schemas.ts')
);
const path = 'src/cast/sequence-elements.fn.ts';
const before = '315081f74472c72ad02e9523d86019193327e68f';
const upstream = '2f38e52c1548708b8a6ba30fb9c0d01cdd3896a0';
const gitSource = (ref) =>
  execFileSync('git', ['show', ref + ':' + path], {
    cwd: root,
    encoding: 'utf8',
  });
const sha256 = (source) => createHash('sha256').update(source).digest('hex');
const normalize = (source) => source.replaceAll('\r\n', '\n');
const current = readFileSync(resolve(root, path), 'utf8');
assert.equal(
  normalize(current),
  normalize(gitSource(before)),
  'The reviewed entry point changed; audit the new source first'
);

function handlerSource(source) {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  for (const statement of ast.program.body) {
    const declarations = statement.declaration?.declarations ?? [];
    const declaration = declarations.find(
      (item) => item.id.name === 'analyzeDraftElementFn'
    );
    if (!declaration) continue;
    const handler = declaration.init.arguments[0];
    assert.equal(declaration.init.callee.property.name, 'handler');
    return source.slice(handler.start, handler.end);
  }
  throw new Error('The reviewed handler was not found');
}

async function execute(source, publicUrl) {
  const events = [];
  const model = 'stub-vision-model';
  const dependencies = {
    ELEMENT_VISION_MODEL: model,
    estimateLLMCost: () => 1,
    InsufficientCreditsError: Error,
    reportMissingBillingCost: () => {
      throw new Error('Unexpected missing cost');
    },
    describeElementImage: async (input) => {
      events.push({ boundary: 'vision-collaborator', url: input.imageUrl });
      return {
        description: 'Stub description',
        consistencyTag: 'stub',
        suggestedToken: 'STUB',
        model,
        costMicros: 1,
        usedOwnKey: false,
      };
    },
  };
  const handler = runInNewContext('(' + source + ')', dependencies, {
    timeout: SOURCE_EVALUATION_TIMEOUT_MS,
  });
  const context = contextFor(events, model);
  await handler({ context, data: { publicUrl, filename: 'fixture.png' } });
  assert.equal(events.filter((item) => item.boundary === 'ledger').length, 0);
  assert.equal(
    events.filter((item) => item.boundary === 'vision-collaborator').length,
    1
  );
  assert.equal(
    events.filter((item) => item.boundary === 'deduct-collaborator').length,
    1
  );
  return events;
}

function contextFor(events, model) {
  return {
    organizationId: '01J00000000000000000000001',
    user: { id: '01J00000000000000000000003' },
    promptLocale: 'zh-CN',
    scopedDb: {
      modelConfiguration: { get: async () => ({ vision: model }) },
      compliance: {
        attestations: {
          listForSubject: async () => {
            events.push({ boundary: 'ledger' });
            return [];
          },
        },
      },
      apiKeys: {
        resolveLlmKey: async () => {
          events.push({ boundary: 'credentials-collaborator' });
          return { source: 'platform', via: 'openrouter', key: 'stub-key' };
        },
      },
      billing: {
        hasEnoughCredits: async () => {
          events.push({ boundary: 'balance-collaborator' });
          return true;
        },
        deductCredits: async () => {
          events.push({ boundary: 'deduct-collaborator' });
        },
      },
    },
  };
}

const cases = [
  {
    kind: 'own-object-no-verdict',
    url: '/r2/elements/01J00000000000000000000001/uploads/fixture.png',
  },
  {
    kind: 'other-organization-object',
    url: '/r2/elements/01J00000000000000000000002/uploads/fixture.png',
  },
];
const results = [];
for (const [label, source] of [
  ['sourceBefore', current],
  ['upstreamBase', gitSource(upstream)],
]) {
  const handler = handlerSource(source);
  for (const testCase of cases) {
    assert.equal(mediaUrlSchema.safeParse(testCase.url).success, true);
    results.push({
      source: label,
      ...testCase,
      handlerSha256: sha256(handler),
      events: await execute(handler, testCase.url),
    });
  }
}
process.stdout.write(
  JSON.stringify(
    {
      before,
      upstream,
      path,
      boundary:
        'Extracted source handler only; trusted context supplied. Actual URL schema; ledger, storage, model, credentials and billing are stubs. No middleware, HTTP, real provider or actual debit executed.',
      meaning:
        'Exit zero confirms an inherited open guard path, not a passed protection assertion.',
      results,
    },
    null,
    2
  ) + '\n'
);
