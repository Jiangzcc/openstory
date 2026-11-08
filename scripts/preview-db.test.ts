import { writeFileSync } from 'node:fs';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createTestDb } from '@/platform/server/db/test-d1';

vi.hoisted(() => {
  process.env.CLOUDFLARE_ACCOUNT_ID = 'test-account';
  process.env.CLOUDFLARE_API_TOKEN = 'test-token';
});

const exec = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFileSync: exec }));

const {
  fork,
  promote,
  markReady,
  discard,
  changesMigrations,
  planMergedPreviewClose,
  sweepCandidate,
  sweep,
} = await import('./preview-db');

type PreviewFork = {
  pr: number;
  revision: number;
  database_id: string;
  ready: number;
};
const { db, close } = await createTestDb();
const registryDb = db.$client;
await registryDb.exec(
  "CREATE TABLE preview_base (id INTEGER PRIMARY KEY CHECK (id = 1), revision INTEGER NOT NULL, database_id TEXT); INSERT INTO preview_base VALUES (1, 2, 'base-id'); CREATE TABLE preview_forks (pr INTEGER PRIMARY KEY, revision INTEGER NOT NULL, database_id TEXT NOT NULL, ready INTEGER NOT NULL DEFAULT 0)"
);
afterAll(close);

async function forkRecord() {
  return registryDb
    .prepare('SELECT * FROM preview_forks WHERE pr = 12')
    .first<PreviewFork>();
}

async function baseRecord() {
  return registryDb
    .prepare('SELECT revision, database_id FROM preview_base WHERE id = 1')
    .first<{ revision: number; database_id: string | null }>();
}

async function setFork(revision: number, ready = 1, databaseId = 'pr-db') {
  await registryDb
    .prepare('INSERT INTO preview_forks VALUES (12, ?, ?, ?)')
    .bind(revision, databaseId, ready)
    .run();
}

let queries: string[];
let previewExists: boolean;
let previewHasTables: boolean;
let registrySplitAcrossPages: boolean;

function response(result: unknown): Response {
  return new Response(JSON.stringify({ success: true, result }), {
    status: 200,
  });
}

function requestSql(init?: RequestInit): string {
  const body: unknown = JSON.parse(
    typeof init?.body === 'string' ? init.body : '{}'
  );
  return body &&
    typeof body === 'object' &&
    'sql' in body &&
    typeof body.sql === 'string'
    ? body.sql
    : '';
}

function interceptRequest(
  matches: (url: URL, init?: RequestInit) => boolean,
  action: () => Promise<void>
) {
  const originalFetch = vi.mocked(fetch).getMockImplementation();
  if (!originalFetch) throw new Error('Missing fetch mock');
  let intercepted = false;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (!intercepted && matches(url, init)) {
      intercepted = true;
      await action();
    }
    return originalFetch(input, init);
  });
}

beforeEach(async () => {
  await registryDb.exec(
    "DELETE FROM preview_forks; UPDATE preview_base SET revision = 2, database_id = 'base-id' WHERE id = 1"
  );
  queries = [];
  previewExists = true;
  previewHasTables = false;
  registrySplitAcrossPages = false;
  exec.mockReset();
  exec.mockImplementation((_bin: string, args: string[]) => {
    if (args.includes('--no-schema') || args.includes('--no-data')) {
      const output = args.find((arg) => arg.startsWith('--output='));
      if (output) writeFileSync(output.slice('--output='.length), '');
    }
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      const listedName = parsed.searchParams.get('name');
      const page = Number(parsed.searchParams.get('page') ?? '1');
      if (listedName === 'openstory-preview-registry') {
        if (registrySplitAcrossPages && page === 1) {
          return new Response(
            JSON.stringify({
              success: true,
              result: [
                { name: 'openstory-preview-registry-old', uuid: 'wrong' },
              ],
              result_info: { page: 1, per_page: 1, total_count: 2 },
            }),
            { status: 200 }
          );
        }
        return response([
          { name: 'openstory-preview-registry', uuid: 'registry-id' },
        ]);
      }
      if (listedName === 'openstory-pr-12')
        return response(
          previewExists
            ? [
                { name: 'openstory-pr-120', uuid: 'other' },
                { name: 'openstory-pr-12', uuid: 'pr-db' },
              ]
            : [{ name: 'openstory-pr-120', uuid: 'other' }]
        );
      if (url.endsWith('/pr-db') && init?.method === 'DELETE') {
        previewExists = false;
        return response(null);
      }
      if (url.endsWith('/base-id')) return response({ name: 'openstory-pr-1' });
      // Mocked D1 query payload has a known shape.
      // oxlint-disable typescript/no-unsafe-type-assertion
      const { sql, params = [] } = JSON.parse(
        typeof init?.body === 'string' ? init.body : '{}'
      ) as {
        sql: string;
        params?: (number | string)[];
      };
      // oxlint-enable typescript/no-unsafe-type-assertion
      queries.push(sql);
      if (url.endsWith('/registry-id/query'))
        return response([
          await registryDb
            .prepare(sql)
            .bind(...params)
            .all(),
        ]);
      if (sql.includes('sqlite_schema'))
        return response([
          {
            success: true,
            results: previewHasTables ? [{ name: 'organization' }] : [],
            meta: { changes: 0 },
          },
        ]);
      throw new Error(`Unmocked Cloudflare request: ${url}`);
    })
  );
});

describe('preview D1 lineage', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, '', 'missing-slash', 'owner/repo/extra'])(
    'refuses sweep without a valid repository before accessing D1: %s',
    async (repository) => {
      vi.stubEnv('GITHUB_REPOSITORY', repository);
      vi.stubEnv('GH_TOKEN', 'test-github-token');
      await expect(sweep(true)).rejects.toThrow('GITHUB_REPOSITORY');
      expect(fetch).not.toHaveBeenCalled();
      expect(queries).toEqual([]);
    }
  );

  it('refuses sweep without a GitHub token before accessing D1', async () => {
    vi.stubEnv('GITHUB_REPOSITORY', 'fork-owner/story');
    vi.stubEnv('GH_TOKEN', undefined);
    vi.stubEnv('GITHUB_TOKEN', undefined);
    await expect(sweep(false)).rejects.toThrow('GH_TOKEN or GITHUB_TOKEN');
    expect(fetch).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });

  it('checks the configured fork and preserves an open PR database', async () => {
    vi.stubEnv('GITHUB_REPOSITORY', 'fork-owner/story');
    vi.stubEnv('GH_TOKEN', 'test-github-token');
    const originalFetch = vi.mocked(fetch).getMockImplementation();
    if (!originalFetch) throw new Error('Missing fetch mock');
    vi.mocked(fetch).mockImplementation(async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.hostname === 'api.github.com') {
        return new Response(JSON.stringify({ state: 'open' }));
      }
      if (url.searchParams.has('per_page') && !url.searchParams.has('name')) {
        return response([{ name: 'openstory-pr-12', uuid: 'pr-db' }]);
      }
      return originalFetch(input, init);
    });
    await sweep(true);
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/fork-owner/story/pulls/12',
      expect.anything()
    );
    expect(
      vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'DELETE')
    ).toBe(false);
    expect(previewExists).toBe(true);
  });

  it('records an occupied database instead of importing into it', async () => {
    previewHasTables = true;
    await fork(12, 'pr-db');
    expect(exec).not.toHaveBeenCalled();
    expect(await forkRecord()).toEqual({
      pr: 12,
      revision: 2,
      database_id: 'pr-db',
      ready: 0,
    });
  });

  it('ignores a name-search hit that is not the registry', async () => {
    registrySplitAcrossPages = true;
    await fork(12, 'pr-db');
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/registry-id/query'),
      expect.anything()
    );
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/wrong/'),
      expect.anything()
    );
  });

  it('forks only once, preserving the PR database on redeploy', async () => {
    await fork(12, 'pr-db');
    expect(exec).toHaveBeenCalledTimes(4); // schema/data export and import
    expect(await forkRecord()).toEqual({
      pr: 12,
      revision: 2,
      database_id: 'pr-db',
      ready: 0,
    });
    await fork(12, 'pr-db');
    expect(exec).toHaveBeenCalledTimes(4);
  });

  it('promotes a matching fork and treats retries as successful', async () => {
    await setFork(2);
    await promote(12);
    expect(await baseRecord()).toEqual({ revision: 3, database_id: 'pr-db' });
    await promote(12);
    expect(
      queries.filter((sql) => sql.startsWith('UPDATE preview_base'))
    ).toHaveLength(1);
  });

  it('preserves the PR database if another merge advanced the base', async () => {
    await setFork(1);
    await expect(promote(12)).rejects.toThrow('Preview DB conflict');
    expect(await baseRecord()).toMatchObject({ database_id: 'base-id' });
    expect(previewExists).toBe(true);
    expect(queries).not.toContainEqual(
      expect.stringMatching(/^UPDATE preview_base/)
    );
  });

  it('deletes a merged preview that changed no migrations', async () => {
    await setFork(1);
    await promote(12, false);
    expect(previewExists).toBe(false);
    expect(await forkRecord()).toBeNull();
    expect(await baseRecord()).toEqual({ revision: 2, database_id: 'base-id' });
  });

  it('still refuses to delete a no-migration preview that is the base', async () => {
    await setFork(2);
    await registryDb.exec("UPDATE preview_base SET database_id = 'pr-db'");
    await expect(promote(12, false)).rejects.toThrow('active preview base');
    expect(previewExists).toBe(true);
  });

  it('refuses to promote a preview with no completed fork', async () => {
    await expect(promote(12)).rejects.toThrow('no completed fork');
  });

  it('refuses to promote a preview that never deployed', async () => {
    await setFork(2, 0);
    await expect(promote(12)).rejects.toThrow('never deployed');
    await markReady(12, 'pr-db');
    await promote(12);
    expect(await baseRecord()).toMatchObject({ database_id: 'pr-db' });
  });

  it('discards an unmerged PR and lets reopening fork the current base', async () => {
    await setFork(1);
    await discard(12);
    expect(previewExists).toBe(false);
    expect(await forkRecord()).toBeNull();
    await fork(12, 'new-pr-db');
    expect(await forkRecord()).toMatchObject({
      revision: 2,
      database_id: 'new-pr-db',
    });
  });

  it('plans promotion from migration changes and fork freshness', () => {
    expect(
      changesMigrations(['src/app.ts', 'drizzle/migrations-wrangler/x.sql'])
    ).toBe(false);
    expect(
      changesMigrations(['drizzle/migrations/20261108_x/migration.sql'])
    ).toBe(true);
    expect(
      planMergedPreviewClose({
        changesMigrations: false,
        forkRevision: 1,
        baseRevision: 4,
        alreadyBase: false,
      })
    ).toBe('discard');
    expect(
      planMergedPreviewClose({
        changesMigrations: true,
        forkRevision: 1,
        baseRevision: 4,
        alreadyBase: false,
      })
    ).toBe('conflict');
    expect(
      planMergedPreviewClose({
        changesMigrations: true,
        forkRevision: 4,
        baseRevision: 4,
        alreadyBase: false,
      })
    ).toBe('promote');
  });

  it('sweeps only closed preview databases that are not the base', () => {
    expect(
      sweepCandidate('openstory-prd', 'prod', 'base', 'closed')
    ).toBeUndefined();
    expect(
      sweepCandidate('openstory-preview-registry', 'reg', 'base', 'closed')
    ).toBeUndefined();
    expect(
      sweepCandidate('openstory-pr-12', 'pr-db', 'pr-db', 'closed')
    ).toBeUndefined();
    expect(
      sweepCandidate('openstory-pr-12', 'pr-db', 'base', 'open')
    ).toBeUndefined();
    expect(sweepCandidate('openstory-pr-120', 'other', 'base', 'closed')).toBe(
      120
    );
    expect(sweepCandidate('openstory-pr-12', 'pr-db', 'base', 'closed')).toBe(
      12
    );
  });

  it('does not clear the record or delete the current base', async () => {
    await setFork(2);
    await registryDb.exec("UPDATE preview_base SET database_id = 'pr-db'");
    await expect(discard(12)).rejects.toThrow('active preview base');
    expect(previewExists).toBe(true);
    expect(await forkRecord()).not.toBeNull();
  });

  it('preserves the base when promotion wins before the deletion claim', async () => {
    await setFork(2);
    interceptRequest(
      (_url, init) => requestSql(init).includes('ON CONFLICT(pr)'),
      () => promote(12)
    );
    await expect(discard(12)).rejects.toThrow('active preview base');
    expect(await baseRecord()).toEqual({ revision: 3, database_id: 'pr-db' });
    expect(await forkRecord()).toMatchObject({ ready: 1 });
    expect(previewExists).toBe(true);
  });

  it('rejects a stale promotion when deletion wins before its CAS', async () => {
    await setFork(2);
    interceptRequest(
      (_url, init) => requestSql(init).startsWith('UPDATE preview_base'),
      () => discard(12)
    );
    await expect(promote(12)).rejects.toThrow('lost a race');
    expect(await baseRecord()).toEqual({ revision: 2, database_id: 'base-id' });
    expect(await forkRecord()).toBeNull();
    expect(previewExists).toBe(false);
  });

  it('reserves an orphan before deletion and refuses readiness or reuse', async () => {
    interceptRequest(
      (url, init) =>
        url.pathname.endsWith('/pr-db') && init?.method === 'DELETE',
      async () => {
        expect(await forkRecord()).toMatchObject({
          database_id: 'pr-db',
          revision: 2,
          ready: -1,
        });
        await expect(markReady(12, 'pr-db')).rejects.toThrow('deleting');
        await expect(fork(12, 'pr-db')).rejects.toThrow(
          'deletion is in progress'
        );
        await expect(promote(12)).rejects.toThrow('never deployed');
      }
    );
    await discard(12);
    expect(await forkRecord()).toBeNull();
    expect(previewExists).toBe(false);
  });

  it('claims a fork registered after an orphan lookup before deleting', async () => {
    interceptRequest(
      (_url, init) => requestSql(init).includes('ON CONFLICT(pr)'),
      () => setFork(2)
    );
    interceptRequest(
      (url, init) =>
        url.pathname.endsWith('/pr-db') && init?.method === 'DELETE',
      async () => {
        expect(await forkRecord()).toMatchObject({ ready: -1 });
        await expect(markReady(12, 'pr-db')).rejects.toThrow('deleting');
      }
    );
    await discard(12);
    expect(previewExists).toBe(false);
    expect(await forkRecord()).toBeNull();
  });

  it('preserves an orphan promoted after its initial fork lookup', async () => {
    interceptRequest(
      (_url, init) => requestSql(init).includes('ON CONFLICT(pr)'),
      async () => {
        await setFork(2);
        await promote(12);
      }
    );
    await expect(discard(12)).rejects.toThrow('active preview base');
    expect(await baseRecord()).toMatchObject({ database_id: 'pr-db' });
    expect(previewExists).toBe(true);
  });

  it.each([false, true])(
    'retains a retryable deletion claim after a failed delete, existing fork: %s',
    async (hasFork) => {
      if (hasFork) await setFork(2);
      interceptRequest(
        (url, init) =>
          url.pathname.endsWith('/pr-db') && init?.method === 'DELETE',
        async () => {
          throw new Error('mocked delete connection failure');
        }
      );
      await expect(discard(12)).rejects.toThrow('mocked delete connection');
      expect(await forkRecord()).toMatchObject({ ready: -1 });
      expect(previewExists).toBe(true);
      await expect(markReady(12, 'pr-db')).rejects.toThrow('deleting');
      await expect(fork(12, 'pr-db')).rejects.toThrow(
        'deletion is in progress'
      );
      await discard(12);
      expect(previewExists).toBe(false);
      expect(await forkRecord()).toBeNull();
    }
  );

  it('clears a deletion claim after the remote database is already gone', async () => {
    await setFork(2, -1);
    previewExists = false;
    await discard(12);
    expect(await forkRecord()).toBeNull();
    expect(
      vi.mocked(fetch).mock.calls.some(([, init]) => init?.method === 'DELETE')
    ).toBe(false);
  });

  it('claims an orphan while the initial base is null', async () => {
    await registryDb.exec('UPDATE preview_base SET database_id = NULL');
    await discard(12);
    expect(previewExists).toBe(false);
    expect(await forkRecord()).toBeNull();
  });

  it('does not overwrite a different fork registered during deletion', async () => {
    interceptRequest(
      (_url, init) => requestSql(init).includes('ON CONFLICT(pr)'),
      () => setFork(2, 1, 'replacement-db')
    );
    await expect(discard(12)).rejects.toThrow('fork record changed');
    expect(await forkRecord()).toMatchObject({
      database_id: 'replacement-db',
      ready: 1,
    });
    expect(previewExists).toBe(true);
  });

  it.each(['ready = 1', "database_id = 'replacement-db'"])(
    'clears only its matching deletion claim: %s',
    async (replacement) => {
      await setFork(2);
      interceptRequest(
        (_url, init) =>
          requestSql(init).startsWith('DELETE FROM preview_forks'),
        async () => {
          await registryDb.exec(`UPDATE preview_forks SET ${replacement}`);
        }
      );
      await discard(12);
      expect(await forkRecord()).not.toBeNull();
    }
  );
});
