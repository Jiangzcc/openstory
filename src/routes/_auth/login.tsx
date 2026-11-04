/**
 * Login Page
 * Email OTP and Google OAuth authentication
 */

import { AuthForm } from '@/platform/ui/auth/auth-form';
import { usePageTitle } from '@/ui/i18n/use-page-title';
import { useTranslation } from 'react-i18next';
import { OpenStoryLogo } from '@/ui/icons/openstory-logo';
import { PageContainer } from '@/ui/layout/page-container';
import { loginRedirect } from '@/platform/ui/auth/last-page';
import { useHydrated } from '@/ui/use-hydrated';
import { Link, createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';

const searchSchema = z.object({
  redirectTo: z.string().optional(),
  email: z.string().optional(),
});

export const Route = createFileRoute('/_auth/login')({
  validateSearch: searchSchema,
  head: ({ match }) => ({
    meta: [
      { title: match.context.i18n.t('Sign in · OpenStory', { ns: 'auth' }) },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { t } = useTranslation('auth');
  usePageTitle(t('Sign in · OpenStory'));
  const search = Route.useSearch();
  const { authOptions } = Route.useRouteContext();
  const hydrated = useHydrated();
  const redirectTo = loginRedirect(search.redirectTo, hydrated);
  const email = search.email || '';

  return (
    <PageContainer className="min-h-0 flex-1">
      <div className="flex h-full items-center justify-center">
        <div className="w-full max-w-md space-y-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <Link to="/">
              <OpenStoryLogo size="lg" />
            </Link>
            <p className="text-muted-foreground">
              {t('AI video production, from script to screen.')}
            </p>
          </div>
          <AuthForm
            emailEntered={email}
            redirectTo={redirectTo}
            authOptions={authOptions}
          />
        </div>
      </div>
    </PageContainer>
  );
}
