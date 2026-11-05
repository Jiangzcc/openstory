/**
 * Invitation to join an organization. Server-only.
 */

import { Button, Heading, Section, Text } from '@react-email/components';
import { DEFAULT_LOCALE } from '@/platform/i18n/locale';
import type { Locale } from '@/platform/i18n/locale';
import { createI18n } from '@/platform/i18n/runtime';
import {
  buttonStyle,
  EmailLayout,
  headingStyle,
  paragraphStyle,
} from './email-layout';

interface OrganizationInvitationEmailProps {
  appName: string;
  organizationName: string;
  inviterName: string;
  acceptUrl: string;
  locale?: Locale;
}

export const OrganizationInvitationEmail: React.FC<
  OrganizationInvitationEmailProps
> = ({
  appName,
  organizationName,
  inviterName,
  acceptUrl,
  locale = DEFAULT_LOCALE,
}) => {
  const t = createI18n(locale).getFixedT(locale, 'mail');
  return (
    <EmailLayout
      appName={appName}
      locale={locale}
      preview={t('{{inviterName}} invited you to {{organizationName}}', {
        inviterName,
        organizationName,
      })}
    >
      <Section>
        <Heading as="h2" style={headingStyle}>
          {t('Join {{organizationName}}', { organizationName })}
        </Heading>
        <Text style={paragraphStyle}>
          {t(
            '{{inviterName}} invited you to the {{organizationName}} organization on {{appName}}.',
            { inviterName, organizationName, appName }
          )}
        </Text>
        <Button href={acceptUrl} style={buttonStyle}>
          {t('Join organization')}
        </Button>
      </Section>
    </EmailLayout>
  );
};
