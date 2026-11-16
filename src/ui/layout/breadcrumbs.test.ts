import { createElement } from 'react';
import { describe, expect, test, vi } from 'vitest';
import { translateStaticLabel } from '@/platform/i18n/labels';
import { createApplicationI18n } from '@/ui/i18n/runtime';
import {
  mobileCrumbIndex,
  resolveCrumbs,
  resolveLocalizedCrumbs,
  type BreadcrumbCrumb,
  type BreadcrumbMatch,
  type BreadcrumbValue,
} from './breadcrumbs';

const chineseI18n = createApplicationI18n('zh-CN');
const translateLabel = (source: string) =>
  translateStaticLabel(chineseI18n, 'labels', source);

function makeMatch(
  breadcrumb: BreadcrumbValue | undefined,
  overrides: Partial<BreadcrumbMatch> = {}
): BreadcrumbMatch {
  return {
    id: 'match-1',
    pathname: '/sequences',
    params: {},
    staticData: breadcrumb === undefined ? {} : { breadcrumb },
    ...overrides,
  };
}

describe('resolveCrumbs', () => {
  test('returns [] when staticData has no breadcrumb', () => {
    expect(resolveCrumbs(makeMatch(undefined))).toEqual([]);
  });

  test('wraps a string as a single crumb linking to match.pathname', () => {
    const crumbs = resolveCrumbs(makeMatch('Sequences'));
    expect(crumbs).toEqual([{ label: 'Sequences', to: '/sequences' }]);
  });

  test('passes an array through unchanged', () => {
    const value: BreadcrumbValue = [
      { label: 'Sequences', to: '/sequences' },
      { label: 'New sequence' },
    ];
    expect(resolveCrumbs(makeMatch(value))).toEqual(value);
  });

  test('wraps a single object in an array', () => {
    const crumbs = resolveCrumbs(makeMatch({ label: 'Talent' }));
    expect(crumbs).toEqual([{ label: 'Talent' }]);
  });

  test('invokes a function with the match', () => {
    const match = makeMatch(
      (m) => [{ label: 'Seq', to: `/sequences/${String(m.params.id)}` }],
      { params: { id: 'abc' } }
    );
    expect(resolveCrumbs(match)).toEqual([
      { label: 'Seq', to: '/sequences/abc' },
    ]);
  });

  test('treats null/undefined from a function as no crumbs', () => {
    expect(resolveCrumbs(makeMatch(() => null))).toEqual([]);
    expect(resolveCrumbs(makeMatch(() => undefined))).toEqual([]);
  });
});

describe('static breadcrumb localization', () => {
  test('translates a static string and preserves its destination', () => {
    expect(resolveLocalizedCrumbs(makeMatch('Images'), translateLabel)).toEqual(
      [{ label: '图像', to: '/sequences' }]
    );
  });

  test('translates static objects and arrays without changing navigation or mobile selection', () => {
    const ancestor = {
      label: 'Sequences',
      to: '/sequences',
      search: { status: 'archived' },
      keepOnMobile: true,
    } satisfies BreadcrumbCrumb;
    const value = [ancestor, { label: 'Scenes' }];
    const crumbs = resolveLocalizedCrumbs(makeMatch(value), translateLabel);
    expect(crumbs).toEqual([{ ...ancestor, label: '作品' }, { label: '场景' }]);
    expect(resolveLocalizedCrumbs(makeMatch(ancestor), translateLabel)).toEqual(
      [{ ...ancestor, label: '作品' }]
    );
    expect(mobileCrumbIndex(crumbs)).toBe(0);
    expect(ancestor.label).toBe('Sequences');
  });

  test('preserves unknown static labels and React content', () => {
    const label = createElement('span', null, 'Images');
    const values = [{ label }, { label: 'Unlisted future page' }];
    const crumbs = resolveLocalizedCrumbs(makeMatch(values), translateLabel);
    expect(crumbs[0]?.label).toBe(label);
    expect(crumbs[1]?.label).toBe('Unlisted future page');
  });

  test('uses the current language without changing the route declaration', async () => {
    const instance = createApplicationI18n('zh-CN');
    const match = makeMatch('Images');
    const translate = (source: string) =>
      translateStaticLabel(instance, 'labels', source);
    expect(resolveLocalizedCrumbs(match, translate)[0]?.label).toBe('图像');
    await instance.changeLanguage('en');
    expect(resolveLocalizedCrumbs(match, translate)[0]?.label).toBe('Images');
    expect(match.staticData.breadcrumb).toBe('Images');
  });
});

describe('dynamic breadcrumb boundaries', () => {
  test('preserves React content returned by a dynamic breadcrumb', () => {
    const label = createElement('strong', null, 'Images');
    const crumbs = resolveLocalizedCrumbs(
      makeMatch(() => ({ label, keepOnMobile: true })),
      translateLabel
    );
    expect(crumbs[0]?.label).toBe(label);
    expect(crumbs[0]?.keepOnMobile).toBe(true);
  });

  test.each<BreadcrumbValue>([
    () => 'Images',
    () => ({ label: 'Images' }),
    () => [{ label: 'Images', keepOnMobile: true }],
  ])('never translates a dynamic name matching a known label', (value) => {
    const translate = vi.fn(translateLabel);
    const crumbs = resolveLocalizedCrumbs(makeMatch(value), translate);
    expect(crumbs[0]?.label).toBe('Images');
    expect(translate).not.toHaveBeenCalled();
  });

  test('translates explicitly marked dynamic ancestors while preserving names', () => {
    const value: BreadcrumbValue = () => [
      { label: 'Sequences', translationKey: 'Sequences', to: '/sequences' },
      { label: 'Images', keepOnMobile: true },
    ];
    expect(resolveLocalizedCrumbs(makeMatch(value), translateLabel)).toEqual([
      { label: '作品', translationKey: 'Sequences', to: '/sequences' },
      { label: 'Images', keepOnMobile: true },
    ]);
  });
});

describe('mobileCrumbIndex', () => {
  test('the current page when no crumb asks', () => {
    expect(mobileCrumbIndex([{ label: 'Sequences' }, { label: 'New' }])).toBe(
      1
    );
  });

  test('an ancestor that asks beats a generic page name', () => {
    expect(
      mobileCrumbIndex([
        { label: 'Sequences' },
        { label: 'Golden Hour Surf', keepOnMobile: true },
        { label: 'Scenes' },
      ])
    ).toBe(1);
  });

  test('the deepest crumb that asks wins', () => {
    expect(
      mobileCrumbIndex([
        { label: 'Sequences' },
        { label: 'Golden Hour Surf', keepOnMobile: true },
        { label: 'John', keepOnMobile: true },
      ])
    ).toBe(2);
  });
});
