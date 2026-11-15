import { eq, sql } from 'drizzle-orm';
import { vi } from 'vitest';
import { generateId } from '@/platform/id';
import type { Database } from '@/platform/server/db/client';
import {
  organization,
  sequenceElements,
  sequences,
  styles,
} from '@/platform/server/db/schema';
import { DEFAULT_STYLE_TEMPLATES } from '@/look/style-templates';
import type { NewSequenceElement, Sequence } from '@/platform/server/db/schema';
import type { GeneratedElementPublication } from './element-sheet-publication';

// Synthetic payloads and boundary faults; rows and batches execute on migrated test D1.
export type Graph = Awaited<ReturnType<typeof seedPublicationGraph>>;
export const COUNT = {
  none: 0,
  one: 1,
  two: 2,
  statements: 3,
  boundLimit: 100,
} as const;
export const STATUS = {
  processing: 'processing',
  failed: 'failed',
  completed: 'completed',
  draft: 'draft',
  archived: 'archived',
} as const;
export const VISION = {
  pending: 'pending',
  completed: 'completed',
  failed: 'failed',
} as const;
export const KIND = { image: 'image', video: 'video' } as const;
export const MOMENT = {
  original: new Date('2026-11-14T08:00:00.000Z'),
  generated: new Date('2026-11-14T08:01:00.000Z'),
} as const;
export const MEDIA = {
  uploaded: '/r2/synthetic/uploaded.png',
  uploadPath: 'synthetic/uploaded.png',
  generated: '/r2/synthetic/生成.png',
  generatedPath: 'synthetic/生成.png',
  competing: '/r2/synthetic/competing.png',
  competingPath: 'synthetic/competing.png',
} as const;
export const SQL_TARGET = {
  ownership: /^select "id" from "sequences" where /i,
  update: /^update "sequence_elements"/i,
  insert: /^insert into "sequence_elements"/i,
  read: /publication_result/i,
} as const;
export const SQL_FAULT = {
  trigger: 'synthetic_element_publication_fault',
  message: 'Synthetic element publication refused',
} as const;

export function publicationInput(
  graph: Pick<Graph, 'sequenceId'>
): GeneratedElementPublication {
  return {
    id: generateId(),
    sequenceId: graph.sequenceId,
    token: 'SYNTHETIC_ELEMENT',
    uploadedFilename: 'generated-synthetic_element.png',
    imageUrl: MEDIA.generated,
    imagePath: MEDIA.generatedPath,
    description: '合成描述："引号"\n第二行；不可执行 SQL。',
    consistencyTag: 'synthetic-element-tag',
    visionStatus: VISION.completed,
    visionGeneratedAt: MOMENT.generated,
    firstMentionSceneId: generateId(),
    firstMentionText: '合成元素首次出现',
    firstMentionLine: COUNT.one,
  };
}

export async function seedElement(
  db: Database,
  data: GeneratedElementPublication,
  patch: Partial<NewSequenceElement> = {}
) {
  const [element] = await db
    .insert(sequenceElements)
    .values({
      ...data,
      imageUrl: null,
      imagePath: null,
      createdAt: MOMENT.original,
      updatedAt: MOMENT.original,
      ...patch,
    })
    .returning();
  if (!element) throw new Error('Synthetic element fixture was not inserted');
  return element;
}

export function elementsSnapshot(db: Database) {
  return db.select().from(sequenceElements).orderBy(sequenceElements.id);
}

export function elementById(db: Database, id: string) {
  return db.select().from(sequenceElements).where(eq(sequenceElements.id, id));
}

export function setRoot(db: Database, graph: Graph, patch: Partial<Sequence>) {
  return db
    .update(sequences)
    .set(patch)
    .where(eq(sequences.id, graph.sequenceId));
}

export function beforeBatch(db: Database, before: () => Promise<unknown>) {
  const batch = db.$client.batch.bind(db.$client);
  return vi
    .spyOn(db.$client, 'batch')
    .mockImplementationOnce(async (statements) => {
      await before();
      return batch(statements);
    });
}

export function observeStatements(db: Database) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const prepare = db.$client.prepare.bind(db.$client);
  vi.spyOn(db.$client, 'prepare').mockImplementation(
    (query) =>
      new Proxy(prepare(query), {
        get(target, key) {
          if (key === 'bind')
            return (...params: unknown[]) => {
              calls.push({ sql: query, params });
              return target.bind(...params);
            };
          const value = Reflect.get(target, key);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      })
  );
  return calls;
}

export function failSql(db: Database, operation: 'INSERT' | 'UPDATE') {
  return db.run(
    sql.raw(
      `CREATE TRIGGER ${SQL_FAULT.trigger}_before BEFORE ${operation} ON sequence_elements ` +
        `BEGIN SELECT RAISE(ABORT, '${SQL_FAULT.message}'); END`
    )
  );
}

export function afterMutation(
  db: Database,
  operation: 'INSERT' | 'UPDATE',
  body: string
) {
  return db.run(
    sql.raw(
      `CREATE TRIGGER ${SQL_FAULT.trigger}_after AFTER ${operation} ON sequence_elements ` +
        `BEGIN ${body}; END`
    )
  );
}

export async function dropFault(db: Database) {
  await db.run(sql.raw(`DROP TRIGGER IF EXISTS ${SQL_FAULT.trigger}_before`));
  await db.run(sql.raw(`DROP TRIGGER IF EXISTS ${SQL_FAULT.trigger}_after`));
}

export async function failureFrom(
  write: () => Promise<unknown>
): Promise<Error> {
  try {
    await write();
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
  throw new Error('Expected synthetic element publication to reject');
}

async function seedSpace(db: Database) {
  const organizationId = generateId();
  const styleId = generateId();
  const [template] = DEFAULT_STYLE_TEMPLATES;
  if (!template) throw new Error('Synthetic cast fixture needs a style');
  await db.insert(organization).values({
    id: organizationId,
    slug: organizationId,
    name: 'Synthetic cast organization',
  });
  await db.insert(styles).values({
    id: styleId,
    organizationId,
    name: 'Synthetic cast style',
    config: template.config,
  });
  return { organizationId, styleId };
}

async function seedPublicationSequence(
  db: Database,
  space: Awaited<ReturnType<typeof seedSpace>>
) {
  const sequenceId = generateId();
  const workflowRunId = 'synthetic-storyboard-' + generateId();
  await db.insert(sequences).values({
    ...space,
    id: sequenceId,
    workflowRunId,
    title: 'Synthetic cast sequence',
    status: STATUS.processing,
    createdAt: MOMENT.original,
    updatedAt: MOMENT.original,
  });
  return { ...space, sequenceId, workflowRunId, rawClaimId: generateId() };
}

export async function seedPublicationGraph(db: Database) {
  const space = await seedSpace(db);
  const foreignSpace = await seedSpace(db);
  const own = await seedPublicationSequence(db, space);
  const sibling = await seedPublicationSequence(db, space);
  const foreign = await seedPublicationSequence(db, foreignSpace);
  return { ...own, sibling, foreign, userId: generateId() };
}
