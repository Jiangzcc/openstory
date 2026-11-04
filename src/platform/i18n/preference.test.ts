import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOCALE, LOCALE_COOKIE } from './locale';

const readCookie = vi.hoisted(() => vi.fn());
vi.mock('@/ui/cookie', () => ({ readCookie }));
const { readLocale } = await import('./preference');

beforeEach(() => {
  readCookie.mockReset();
});

describe('request locale', () => {
  it('reads only the language preference cookie', () => {
    readCookie.mockReturnValue('en');
    expect(readLocale()).toBe('en');
    expect(readCookie).toHaveBeenCalledWith(LOCALE_COOKIE);
  });

  it('uses Chinese when the preference is absent or unsupported', () => {
    expect(readLocale()).toBe(DEFAULT_LOCALE);
    readCookie.mockReturnValue('fr');
    expect(readLocale()).toBe(DEFAULT_LOCALE);
  });

  it('falls back to Chinese for malformed cookie encoding', () => {
    readCookie.mockImplementation(() => {
      throw new URIError('Malformed cookie');
    });
    expect(readLocale()).toBe(DEFAULT_LOCALE);
  });

  it('does not hide unrelated request errors', () => {
    const error = new Error('Missing request context');
    readCookie.mockImplementation(() => {
      throw error;
    });
    expect(() => readLocale()).toThrow(error);
  });
});
