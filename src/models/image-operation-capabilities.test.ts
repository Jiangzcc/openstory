import { describe, expect, it } from 'vitest';
import { quoteConfiguredImageRequest } from '@/billing/configured-image-billing';
import { imageCostHint } from '@/billing/image-cost-hint';
import { micros } from '@/billing/money';
import { ValidationError } from '@/platform/errors';
import { imageConfigurationFixture } from './__tests__/image-model-fixture';
import type { ImageOperationBinding } from './image-channels';
import {
  createImageModelRoutingSnapshot,
  toImageModelCatalog,
} from './image-channels';
import { mergeImageModelCatalog } from './image-model-catalog';

const ERRORS = {
  operation: 'This image operation is unavailable.',
  references: 'The reference image count is unsupported by this model.',
  mask: 'Mask editing is unavailable for this image model.',
} as const;
const HINT_ISSUE =
  'Configured image parameters are unavailable for this operation.';
const GENERATE_COST = micros(100_000);
const EDIT_COST = micros(200_000);
type Scenario = {
  name: string;
  references: number;
  hasMask?: boolean;
  generate?: Partial<ImageOperationBinding> | null;
  edit?: Partial<ImageOperationBinding> | null;
  error?: (typeof ERRORS)[keyof typeof ERRORS];
  cost?: number;
};
// Synthetic capabilities and USD prices; no network or credential access.
const scenarios: Scenario[] = [
  { name: 'generation without references', references: 0, cost: GENERATE_COST },
  {
    name: 'negative zero is still no references',
    references: -0,
    cost: GENERATE_COST,
  },
  { name: 'minimum edit references', references: 1, cost: EDIT_COST },
  { name: 'maximum edit references', references: 8, cost: EDIT_COST },
  { name: 'verified edit mask', references: 1, hasMask: true, cost: EDIT_COST },
  {
    name: 'negative reference count',
    references: -1,
    error: ERRORS.references,
  },
  {
    name: 'fractional reference count',
    references: 1.5,
    error: ERRORS.references,
  },
  { name: 'NaN reference count', references: NaN, error: ERRORS.references },
  {
    name: 'infinite reference count',
    references: Infinity,
    error: ERRORS.references,
  },
  {
    name: 'negative infinity',
    references: -Infinity,
    error: ERRORS.references,
  },
  {
    name: 'unsafe integer',
    references: Number.MAX_SAFE_INTEGER + 1,
    error: ERRORS.references,
  },
  {
    name: 'safe integer beyond the binding maximum',
    references: Number.MAX_SAFE_INTEGER,
    error: ERRORS.references,
  },
  {
    name: 'below the edit minimum',
    references: 1,
    edit: { minReferenceImages: 2 },
    error: ERRORS.references,
  },
  { name: 'above the edit maximum', references: 9, error: ERRORS.references },
  {
    name: 'edit-only model without references',
    references: 0,
    generate: null,
    error: ERRORS.operation,
  },
  {
    name: 'missing edit binding',
    references: 1,
    edit: null,
    error: ERRORS.operation,
  },
  {
    name: 'unverified generation',
    references: 0,
    generate: { status: 'unverified' },
    error: ERRORS.operation,
  },
  {
    name: 'unsupported generation',
    references: 0,
    generate: { status: 'unsupported' },
    error: ERRORS.operation,
  },
  {
    name: 'unverified editing',
    references: 1,
    edit: { status: 'unverified' },
    error: ERRORS.operation,
  },
  {
    name: 'unsupported editing',
    references: 1,
    edit: { status: 'unsupported' },
    error: ERRORS.operation,
  },
  {
    name: 'mask without a reference',
    references: 0,
    hasMask: true,
    error: ERRORS.mask,
  },
  {
    name: 'unsupported edit mask',
    references: 1,
    hasMask: true,
    edit: { mask: 'unsupported' },
    error: ERRORS.mask,
  },
  {
    name: 'unverified edit mask',
    references: 1,
    hasMask: true,
    edit: { mask: 'unverified' },
    error: ERRORS.mask,
  },
  {
    name: 'reference error precedes mask error',
    references: 9,
    hasMask: true,
    edit: { mask: 'unsupported' },
    error: ERRORS.references,
  },
  {
    name: 'operation error precedes reference and mask errors',
    references: -1,
    hasMask: true,
    generate: { status: 'unverified' },
    error: ERRORS.operation,
  },
];

function snapshotFor(scenario: Pick<Scenario, 'generate' | 'edit'>) {
  const configuration = imageConfigurationFixture();
  const model = configuration.models[0];
  if (!model) throw new Error('Missing synthetic image model.');
  for (const operation of ['generate', 'edit'] as const) {
    const override = scenario[operation];
    const binding = model.operations[operation];
    if (override === null) delete model.operations[operation];
    else if (override && binding)
      model.operations[operation] = { ...binding, ...override };
  }
  return createImageModelRoutingSnapshot(configuration);
}

describe('configured image operation acceptance across billing and hints', () => {
  it.each(scenarios)('$name', (scenario) => {
    const snapshot = snapshotFor(scenario);
    const route = snapshot[0];
    if (!route) throw new Error('Missing synthetic image route.');
    const input = {
      model: route.modelId,
      aspectRatio: '1:1' as const,
      referenceImageCount: scenario.references,
      hasMask: scenario.hasMask,
    };
    const quote = () =>
      quoteConfiguredImageRequest({
        ...input,
        imageModelRouting: snapshot,
        operation: scenario.references > 0 ? 'edit' : 'generate',
      });
    const hint = imageCostHint(
      input,
      mergeImageModelCatalog(toImageModelCatalog(snapshot)),
      null
    );
    if (scenario.error) {
      expect(quote).toThrowError(new ValidationError(scenario.error));
      expect(hint).toEqual({ estimate: null, issue: HINT_ISSUE });
    } else {
      expect(quote().costMicros).toBe(scenario.cost);
      expect(hint).toEqual({ estimate: scenario.cost, issue: null });
    }
  });
});

it('keeps references pending without inferring a generation operation for an edit-only model', () => {
  const snapshot = snapshotFor({ generate: null });
  const route = snapshot[0];
  if (!route) throw new Error('Missing synthetic image route.');
  expect(
    imageCostHint(
      {
        model: route.modelId,
        aspectRatio: '1:1',
        referenceImageCount: undefined,
        hasMask: true,
      },
      mergeImageModelCatalog(toImageModelCatalog(snapshot)),
      null
    )
  ).toEqual({
    estimate: undefined,
    issue: null,
  });
});
