import { describe, expect, it } from 'vitest';
import { promptLocaleFromRequest } from './prompt-locale';

function request(cookie?: string) {
  return new Request('https://openstory.test/create', {
    headers: cookie === undefined ? undefined : { cookie },
  });
}

describe('prompt locale from the website request', () => {
  it.each([
    [undefined, 'zh-CN'],
    ['openstory_locale=zh-CN', 'zh-CN'],
    ['openstory_locale=en', 'en'],
    ['session=abc; openstory_locale=en; theme=dark', 'en'],
    ['openstory_locale=%65%6E', 'en'],
    ['openstory_locale=fr', 'zh-CN'],
    ['openstory_locale=%E0%A4%A', 'zh-CN'],
    ['other_openstory_locale=en', 'zh-CN'],
    ['openstory_locale_extra=en', 'zh-CN'],
  ])('resolves cookie %s to %s', (cookie, expected) => {
    expect(promptLocaleFromRequest(request(cookie))).toBe(expected);
  });

  it('keeps concurrent requests independent', async () => {
    const cookies = ['openstory_locale=en', 'openstory_locale=zh-CN'];
    const locales = await Promise.all(
      cookies.map(async (cookie) => {
        await Promise.resolve();
        return promptLocaleFromRequest(request(cookie));
      })
    );
    expect(locales).toEqual(['en', 'zh-CN']);
    expect(promptLocaleFromRequest(request())).toBe('zh-CN');
  });
});
