import { useLiveTranslation } from '@/ui/i18n/use-live-translation';
import { Trans, useTranslation } from 'react-i18next';
/**
 * /device — approve a device-code login (#1219). The agent shows the user a
 * short code and this URL; the user signs in, confirms the code, and approves.
 * Approval mints a normal API key, revocable under Settings → Developer.
 */

import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import { Input } from '@/ui/shadcn/input';
import { Skeleton } from '@/ui/shadcn/skeleton';
import {
  decideDeviceGrantFn,
  lookupDeviceGrantFn,
} from '@/platform/device-auth.fn';
import { requireSessionOrRedirect } from '@/platform/ui/auth/route-guards';
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

const searchSchema = z.object({ user_code: z.string().optional() });

export const Route = createFileRoute('/_app/device')({
  validateSearch: searchSchema,
  beforeLoad: async ({ context: { queryClient }, location }) => {
    await requireSessionOrRedirect(queryClient, location.href);
  },
  component: DevicePage,
  staticData: {
    breadcrumb: { label: 'Device login', translationKey: 'Device login' },
  },
});

function DevicePage() {
  const { t } = useTranslation('pages');

  const { user_code } = Route.useSearch();
  const navigate = Route.useNavigate();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const field = new FormData(e.currentTarget).get('user_code');
    const code = typeof field === 'string' ? field : '';
    void navigate({ search: { user_code: code }, replace: true });
  };

  return (
    <div className="mx-auto w-full max-w-md p-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Device login')}</CardTitle>
          <CardDescription>
            {t(
              'Enter the code shown by your agent or CLI to give it access to the OpenStory API.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={onSubmit} className="flex gap-2">
            <Input
              name="user_code"
              defaultValue={user_code ?? ''}
              placeholder={t('ABCD-EFGH')}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="font-mono uppercase"
              required
            />
            <Button type="submit" variant="outline">
              {t('Check')}
            </Button>
          </form>
          {user_code && (
            <Suspense fallback={<Skeleton className="h-20 w-full" />}>
              <GrantDecision userCode={user_code} />
            </Suspense>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function GrantDecision({ userCode }: { userCode: string }) {
  const translateEvent = useLiveTranslation('pages');
  const { t } = useTranslation('pages');

  const [decided, setDecided] = useState<'approved' | 'denied' | null>(null);
  const { data } = useSuspenseQuery({
    queryKey: ['deviceGrant', userCode],
    queryFn: () => lookupDeviceGrantFn({ data: { userCode } }),
  });
  const queryClient = useQueryClient();
  const decide = useMutation({
    mutationFn: (approve: boolean) =>
      decideDeviceGrantFn({ data: { userCode, approve } }),
    onSuccess: ({ error }, approve) => {
      if (error) {
        toast.error(
          error === 'access_denied'
            ? translateEvent(
                'This code was requested under a different account. Sign in as that account to approve it.'
              )
            : translateEvent(
                'This code is no longer valid. Ask your agent for a new one.'
              )
        );
        void queryClient.invalidateQueries({
          queryKey: ['deviceGrant', userCode],
        });
        return;
      }
      setDecided(approve ? 'approved' : 'denied');
    },
    onError: (err) =>
      toast.error(
        err instanceof Error
          ? err.message
          : translateEvent('Something went wrong')
      ),
  });

  if (decided === 'approved') {
    return (
      <output className="block">
        {t(
          'Approved. Return to your agent — it now has a key named “Agent login”, which you can revoke any time under Settings → Developer.'
        )}
      </output>
    );
  }
  if (decided === 'denied') {
    return (
      <output className="block">
        {t('Denied. The agent will not receive a key.')}
      </output>
    );
  }
  if (data.status === 'approved' || data.status === 'denied') {
    return (
      <output className="block">
        <Trans
          ns="pages"
          i18nKey="Code <0/> has already been {{value1}}."
          components={[
            <code key="0" className="font-mono">
              {userCode}
            </code>,
          ]}
          values={{ value1: t(data.status) }}
        />
      </output>
    );
  }
  if (data.status === 'invalid') {
    return (
      <p role="alert">
        <Trans
          ns="pages"
          i18nKey="Code <0/> isn’t valid or has expired. Check it and try again, or ask your agent for a new one."
          components={[
            <code key="0" className="font-mono">
              {userCode}
            </code>,
          ]}
        />
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <p>
        <Trans
          ns="pages"
          i18nKey="Give the device showing <0/> an API key for team <1>{{value1}}</1>? Only approve codes you requested yourself."
          components={[
            <code key="0" className="font-mono font-semibold">
              {userCode}
            </code>,
            <strong key="1" />,
          ]}
          values={{ value1: data.teamName }}
        />
      </p>
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          disabled={decide.isPending}
          onClick={() => decide.mutate(false)}
        >
          {t('Deny')}
        </Button>
        <Button disabled={decide.isPending} onClick={() => decide.mutate(true)}>
          {decide.isPending ? t('Working…') : t('Approve')}
        </Button>
      </div>
    </div>
  );
}
