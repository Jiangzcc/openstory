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

test('isolates concurrent Chinese and English document requests', async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) throw new Error('The browser test needs its local app URL');
  const contexts = await Promise.all(
    ['zh-CN', 'en'].map(async (locale) => {
      const context = await browser.newContext({ baseURL });
      await context.addCookies([
        { name: LOCALE_COOKIE, value: locale, url: baseURL },
      ]);
      return { context, locale };
    })
  );
  try {
    await Promise.all(
      contexts.map(async ({ context, locale }) => {
        const response = await context.request.get(
          '/docs/deployment/cloudflare'
        );
        expect(response.ok()).toBe(true);
        expect(await response.text()).toContain(`lang="${locale}"`);
        const page = await context.newPage();
        await page.goto('/docs/deployment/cloudflare#logs');
        await expect(
          page.getByRole('button', { name: '语言 / Language' })
        ).toBeEnabled({
          timeout: HYDRATION_TIMEOUT,
        });
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(
          page.getByRole('heading', {
            name: locale === 'en' ? 'Logs' : '日志',
            exact: true,
          })
        ).toBeVisible();
        await expect(page.locator('#logs')).toBeVisible();
      })
    );
  } finally {
    await Promise.all(contexts.map(({ context }) => context.close()));
  }
});

test('shows a rejected preference write without losing the current language', async ({
  page,
  context,
}) => {
  await context.clearCookies({ name: LOCALE_COOKIE });
  // A synthetic rejected cookie write exercises the real switcher and reload.
  await context.addInitScript(() => {
    const cookie = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'cookie'
    );
    if (!cookie?.get) throw new Error('Missing browser cookie getter');
    Object.defineProperty(document, 'cookie', {
      get: () => cookie.get?.call(document),
      set() {
        // Simulate the browser refusing this write.
      },
    });
  });
  await page.goto('/docs/deployment/cloudflare#logs');
  const language = page.getByRole('button', { name: '语言 / Language' });
  await expect(language).toBeEnabled({ timeout: HYDRATION_TIMEOUT });
  await language.click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(
    page.getByRole('heading', { name: 'Logs', exact: true })
  ).toBeVisible();
  await expect(
    page.getByText(
      'Language changed, but your browser could not save the preference. Refreshing may restore the previous language.'
    )
  ).toBeVisible();
  expect(
    (await context.cookies()).some((cookie) => cookie.name === LOCALE_COOKIE)
  ).toBe(false);
  await expect(page).toHaveURL(/#logs$/);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: '日志', exact: true })
  ).toBeVisible();
});

const LOGIN_TITLES = [
  ['zh-CN', '登录 · OpenStory'],
  ['en', 'Sign in · OpenStory'],
] as const;

for (const [locale, title] of LOGIN_TITLES) {
  test(`keeps the ${locale} login title through SSR, hydration and back navigation`, async ({
    page,
    context,
    baseURL,
  }) => {
    if (!baseURL) throw new Error('The browser test needs its local app URL');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.addCookies([
      { name: LOCALE_COOKIE, value: locale, url: baseURL },
    ]);
    const response = await page.request.get('/login');
    expect(response.ok()).toBe(true);
    const html = await response.text();
    const titles = Array.from(
      html.matchAll(/<title[^>]*>([\s\S]*?)<\/title>/g),
      (match) => match[1]
    );
    expect(titles).toEqual([title]);
    await page.goto('/login');
    await expect(page.locator('input[name="email"]')).toBeEnabled({
      timeout: HYDRATION_TIMEOUT,
    });
    await expect(page).toHaveTitle(title);
    await page.locator('a[href="/"]').first().click();
    await expect(page).toHaveURL(new URL('/', baseURL).href);
    await page.goBack();
    await expect(page.locator('input[name="email"]')).toBeEnabled({
      timeout: HYDRATION_TIMEOUT,
    });
    await expect(page).toHaveTitle(title);
    await expect(
      page.getByRole('button', { name: '语言 / Language' })
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
