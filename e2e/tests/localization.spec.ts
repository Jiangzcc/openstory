import { LOCALE_COOKIE } from '../../src/platform/i18n/locale';
import { expect, test } from '../fixtures/base';
import { HYDRATION_TIMEOUT } from '../fixtures/test-utils';

test.use({ storageState: { cookies: [], origins: [] } });

test('defaults to Chinese and remembers a language change after reload', async ({
  page,
  context,
}) => {
  await context.clearCookies({ name: LOCALE_COOKIE });
  await page.goto('/docs/deployment/cloudflare');
  await expect(
    page.getByRole('heading', { name: '日志', exact: true })
  ).toBeVisible();

  const language = page.getByRole('button', { name: '语言 / Language' });
  await expect(language).toBeEnabled({ timeout: HYDRATION_TIMEOUT });
  await language.click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(
    page.getByRole('heading', { name: 'Logs', exact: true })
  ).toBeVisible();

  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Logs', exact: true })
  ).toBeVisible();
  await expect(language).toBeEnabled({ timeout: HYDRATION_TIMEOUT });
  await language.click();
  await page.getByRole('menuitemradio', { name: '简体中文' }).click();
  await expect(
    page.getByRole('heading', { name: '日志', exact: true })
  ).toBeVisible();
});
