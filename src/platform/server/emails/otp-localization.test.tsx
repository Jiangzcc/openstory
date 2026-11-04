import { beforeEach, describe, expect, it, vi } from 'vitest';
const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('#env', () => ({
  getEnv: () => ({
    EMAIL_FROM: 'noreply@example.test',
    VITE_APP_NAME: 'OpenStory',
  }),
}));
vi.mock('cloudflare:workers', () => ({ env: { SEND_EMAIL: { send } } }));
vi.mock('@/platform/flags', () => ({ IS_PRODUCTION_DEPLOYMENT: false }));
import { sendOtpEmail } from './email-service';

describe('sign-in email localization', () => {
  beforeEach(() =>
    send.mockReset().mockResolvedValue({ messageId: 'mock-message' })
  );
  it('defaults the subject, HTML and text to Chinese', async () => {
    expect(await sendOtpEmail('demo@example.test', '123456')).toEqual({
      success: true,
    });
    expect(send).toHaveBeenCalledOnce();
    const message = send.mock.calls[0]?.[0];
    expect(message.subject).toBe('你的登录验证码');
    expect(message.html).toContain('lang="zh-CN"');
    expect(message.html).toContain('123456');
    expect(message.text).toContain('验证码将在 5 分钟后失效');
  });
  it('isolates concurrent Chinese and English messages', async () => {
    await Promise.all([
      sendOtpEmail('zh@example.test', '111222', 'zh-CN'),
      sendOtpEmail('en@example.test', '333444', 'en'),
    ]);
    const chinese = send.mock.calls.find(
      ([message]) => message.to === 'zh@example.test'
    )?.[0];
    const english = send.mock.calls.find(
      ([message]) => message.to === 'en@example.test'
    )?.[0];
    expect(chinese.subject).toBe('你的登录验证码');
    expect(chinese.text).toContain('111222');
    expect(chinese.text).not.toContain('333444');
    expect(english.subject).toBe('Your sign-in code');
    expect(english.text).toContain('This code expires in 5 minutes');
    expect(english.html).toContain('lang="en"');
  });
});
