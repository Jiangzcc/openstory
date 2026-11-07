import { test as base } from 'playwright/test';
import { E2E_COVERAGE, addClientCoverage } from '../coverage';
import { pinEnglishLocale } from './test-utils';

export { expect } from 'playwright/test';

/** Playwright `test` that records browser coverage under E2E_COVERAGE (#2243). */
export const test = base.extend({
  page: async ({ page }, use) => {
    await pinEnglishLocale(page);
    if (!E2E_COVERAGE) return use(page);
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
    await use(page);
    await addClientCoverage(await page.coverage.stopJSCoverage());
  },
});
