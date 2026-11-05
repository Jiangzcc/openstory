import { beforeEach, expect, it, vi } from 'vitest';

interface MockEmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const { send } = vi.hoisted(() => ({
  send: vi.fn<(message: MockEmailMessage) => Promise<{ messageId: string }>>(),
}));

vi.mock('#env', () => ({
  getEnv: () => ({
    EMAIL_FROM: 'noreply@example.test',
    VITE_APP_NAME: 'OpenStory',
  }),
}));
vi.mock('cloudflare:workers', () => ({ env: { SEND_EMAIL: { send } } }));
vi.mock('@/platform/flags', () => ({ IS_PRODUCTION_DEPLOYMENT: false }));

import { sendOrganizationInvitationEmail } from './email-service';

type InvitationInput = Parameters<typeof sendOrganizationInvitationEmail>[0];

const invitation = {
  to: 'member@example.test',
  organizationName: '星河工作室',
  inviterName: '林晓',
  acceptUrl:
    'https://example.test/organization/accept-invitation?id=mock-invite',
} satisfies InvitationInput;

beforeEach(() =>
  send.mockReset().mockResolvedValue({ messageId: 'mock-invitation-message' })
);

function messageTo(to: string) {
  const message = send.mock.calls.find(([message]) => message.to === to)?.[0];
  if (!message)
    throw new Error('Mock SEND_EMAIL did not receive the invitation');
  return message;
}

it.each([
  [undefined, 'zh-CN', '加入 星河工作室', '加入组织'],
  ['en', 'en', 'Join 星河工作室', 'Join organization'],
] as const)(
  'localizes invitation subject, HTML and text with locale %s',
  async (locale, language, subject, action) => {
    const input = locale === undefined ? invitation : { ...invitation, locale };
    expect(await sendOrganizationInvitationEmail(input)).toEqual({
      success: true,
    });
    expect(send).toHaveBeenCalledOnce();
    const message = messageTo(invitation.to);
    expect(message.subject).toBe(subject);
    expect(message.html).toContain('lang="' + language + '"');
    expect(message.html).toContain(action);
    expect(message.text).toContain(action);
    expect(message.text).toContain(invitation.organizationName);
    expect(message.text).toContain(invitation.inviterName);
    expect(message.html).toContain('href="' + invitation.acceptUrl + '"');
    expect(message.text).toContain(invitation.acceptUrl);
    expect(message.text).toContain(
      locale === 'en'
        ? '林晓 invited you to the 星河工作室 organization on OpenStory.'
        : '林晓 邀请你加入 OpenStory 上的 星河工作室 组织。'
    );
  }
);

it('isolates concurrent Chinese and English invitation messages', async () => {
  const chinese = {
    ...invitation,
    to: 'zh@example.test',
    locale: 'zh-CN',
    acceptUrl: 'https://example.test/organization/accept-invitation?id=mock-zh',
  } satisfies InvitationInput;
  const english = {
    ...invitation,
    to: 'en@example.test',
    organizationName: 'English Studio',
    inviterName: 'Alice',
    locale: 'en',
    acceptUrl: 'https://example.test/organization/accept-invitation?id=mock-en',
  } satisfies InvitationInput;
  expect(
    await Promise.all([
      sendOrganizationInvitationEmail(chinese),
      sendOrganizationInvitationEmail(english),
    ])
  ).toEqual([{ success: true }, { success: true }]);
  expect(send).toHaveBeenCalledTimes(2);
  const zh = messageTo(chinese.to);
  const en = messageTo(english.to);
  expect(zh.subject).toBe('加入 星河工作室');
  expect(zh.html).toContain('lang="zh-CN"');
  expect(zh.text).toContain('林晓 邀请你加入 OpenStory 上的 星河工作室 组织。');
  expect(zh.text).toContain(chinese.acceptUrl);
  expect(zh.text).not.toContain(english.organizationName);
  expect(zh.text).not.toContain(english.inviterName);
  expect(zh.html).not.toContain(english.acceptUrl);
  expect(en.subject).toBe('Join English Studio');
  expect(en.html).toContain('lang="en"');
  expect(en.text).toContain(
    'Alice invited you to the English Studio organization on OpenStory.'
  );
  expect(en.text).toContain(english.acceptUrl);
  expect(en.text).not.toContain(chinese.organizationName);
  expect(en.text).not.toContain(chinese.inviterName);
  expect(en.html).not.toContain(chinese.acceptUrl);
});

it.each(['zh-CN', 'en'] as const)(
  'escapes names in %s HTML while preserving names and invitation links',
  async (locale) => {
    const input = {
      ...invitation,
      organizationName: 'Studio <North> & "Friends"',
      inviterName: 'Alice <Owner> & "Guest"',
      acceptUrl:
        'https://example.test/organization/accept-invitation?id=mock&from=invite',
      locale,
    } satisfies InvitationInput;
    expect(await sendOrganizationInvitationEmail(input)).toEqual({
      success: true,
    });
    expect(send).toHaveBeenCalledOnce();
    const message = messageTo(input.to);
    expect(message.subject).toBe(
      (locale === 'en' ? 'Join ' : '加入 ') + input.organizationName
    );
    expect(message.html).toContain(
      'Studio &lt;North&gt; &amp; &quot;Friends&quot;'
    );
    expect(message.html).toContain(
      'Alice &lt;Owner&gt; &amp; &quot;Guest&quot;'
    );
    expect(message.html).not.toContain('<North>');
    expect(message.html).not.toContain('<Owner>');
    expect(message.html).toContain(
      'href="https://example.test/organization/accept-invitation?id=mock&amp;from=invite"'
    );
    expect(message.text).toContain(input.organizationName);
    expect(message.text).toContain(input.inviterName);
    expect(message.text).toContain(input.acceptUrl);
  }
);
