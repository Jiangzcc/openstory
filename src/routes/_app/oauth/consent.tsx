import { useLiveTranslation } from '@/ui/i18n/use-live-translation';
import { Trans, useTranslation } from 'react-i18next';
import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
/**
 * /oauth/consent — approve an app's request for access (#1456).
 *
 * Better Auth sends the signed query to `/oauth/consent-start`, which packs it
 * into `q` and 302s here so TanStack cannot collapse repeated `ba_param`.
 *
 * Who is asking, for what, and the organizations it can bill to load in the
 * route loader so the first HTML already has Approve — no client fetch, no
 * skeleton.
 */

import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import {
  decideOAuthConsentFn,
  getOAuthConsentContextFn,
  type OAuthConsentContext,
} from '@/platform/oauth-consent.fn';
import {
  consentPageHref,
  displayFieldsFromOAuthQuery,
  needsOAuthQueryPack,
  pickOAuthQuery,
  resolveOAuthQuery,
} from '@/platform/auth/oauth-query-snapshot';
import { requireSessionOrRedirect } from '@/platform/ui/auth/route-guards';
import { OrganizationSelect } from '@/platform/ui/organization-select';
import { errorMessage } from '@/platform/errors';
import { useHydrated } from '@/ui/use-hydrated';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

const CONSENT_STALE_MESSAGE =
  'This request is no longer valid. Start again from the app.';

declare global {
  interface Window {
    __OPENSTORY_OAUTH_QUERY__?: string;
  }
}

/**
 * Prefer the incoming request URL (server) or a head-script snapshot (client)
 * over TanStack's parsed `location.search`. Packed `q` is immune to qss;
 * this still covers a stray hit on `/oauth/consent` with the raw signed query.
 */
const readConsentOAuthQuery = createIsomorphicFn()
  .server(() => new URL(getRequest().url).search)
  .client(() => window.__OPENSTORY_OAUTH_QUERY__ || window.location.search);

export const Route = createFileRoute('/_app/oauth/consent')({
  head: () => ({
    scripts: [
      {
        children:
          'window.__OPENSTORY_OAUTH_QUERY__=window.__OPENSTORY_OAUTH_QUERY__||window.location.search',
      },
    ],
  }),
  // One-shot signed request — don't background-refetch after SSR.
  staleTime: Infinity,
  loader: async () => {
    const oauthQuery = resolveOAuthQuery(readConsentOAuthQuery());
    const { clientId, scope, redirectUri } =
      displayFieldsFromOAuthQuery(oauthQuery);
    const consent: OAuthConsentContext | null = clientId
      ? await getOAuthConsentContextFn({
          data: { clientId, scope, redirectUri },
        })
      : null;
    return { oauthQuery, consent };
  },
  beforeLoad: async ({ context: { queryClient } }) => {
    const rawSearch = readConsentOAuthQuery();
    const href = consentPageHref(rawSearch);
    if (needsOAuthQueryPack(rawSearch)) {
      throw redirect({ href });
    }
    await requireSessionOrRedirect(queryClient, href);
  },
  component: ConsentPage,
  staticData: {
    breadcrumb: { label: 'Authorize app', translationKey: 'Authorize app' },
  },
});

function ConsentPage() {
  const { t } = useTranslation('pages');

  const { oauthQuery: loaderQuery, consent } = Route.useLoaderData();
  const oauthQuery = pickOAuthQuery([
    resolveOAuthQuery(loaderQuery),
    typeof window !== 'undefined'
      ? resolveOAuthQuery(
          window.__OPENSTORY_OAUTH_QUERY__ || window.location.search
        )
      : undefined,
  ]);

  return (
    <div className="mx-auto w-full max-w-md p-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('Authorize app')}</CardTitle>
          <CardDescription>
            {t(
              'An app wants to use your OpenStory account. Only approve requests you started yourself.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {consent ? (
            <ConsentDecision consent={consent} oauthQuery={oauthQuery} />
          ) : (
            <p role="alert">
              {t(
                'This page is missing its authorization request. Start again from the app that sent you here.'
              )}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ConsentDecision({
  consent,
  oauthQuery,
}: {
  consent: OAuthConsentContext;
  oauthQuery: string;
}) {
  const { t } = useTranslation('pages');
  const translateScope = useLabelTranslation('interface');
  const translateError = useLabelTranslation('pages');
  const translateEvent = useLiveTranslation('pages');

  const hydrated = useHydrated();
  const [outcome, setOutcome] = useState<'granted' | 'denied' | null>(null);
  const [organizationId, setOrganizationId] = useState(
    consent.activeOrganizationId
  );

  const decide = useMutation({
    // Suppress the global MutationCache toast — we render our own below.
    mutationFn: (accept: boolean) =>
      decideOAuthConsentFn({
        data: { accept, oauthQuery, organizationId },
      }),
    onSuccess: ({ url }, accept) => {
      if (!url || (!/^https?:\/\//i.test(url) && !url.startsWith('/'))) {
        toast.error(translateEvent(CONSENT_STALE_MESSAGE));
        return;
      }
      setOutcome(accept ? 'granted' : 'denied');
      window.setTimeout(() => {
        window.location.assign(url);
      }, 800);
    },
    onError: (err) => {
      const fallback = translateEvent(CONSENT_STALE_MESSAGE);
      const text = errorMessage(err, fallback).trim();
      toast.error(translateError(text || fallback));
    },
  });

  if (!consent.client) {
    return (
      <p role="alert">
        {t(
          'This app isn’t registered with OpenStory, or its registration has expired. Start again from the app.'
        )}
      </p>
    );
  }

  if (outcome) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Check className="h-5 w-5" aria-hidden />
          <p className="font-semibold">
            {outcome === 'granted' ? t('Access granted') : t('Request denied')}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('You can close this tab. Sending you back to the app…')}
        </p>
      </div>
    );
  }

  const { client, scopes, organizations } = consent;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        {client.logoUri ? (
          <img
            src={client.logoUri}
            alt=""
            width={40}
            height={40}
            className="h-10 w-10 rounded-md object-cover"
          />
        ) : null}
        <div className="flex flex-col">
          <span className="font-semibold">{client.name}</span>
          {client.redirectOrigin ? (
            <span className="text-sm text-muted-foreground">
              <Trans
                ns="pages"
                i18nKey="Sends you back to <0/>"
                components={[
                  <code key="0" className="font-mono">
                    {client.redirectOrigin}
                  </code>,
                ]}
              />
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <p className="text-sm">
          {t('This will let it, on behalf of the organization below:')}
        </p>
        <ul className="list-disc pl-5 text-sm">
          {scopes.length > 0 ? (
            scopes.map((scope) => (
              <li key={scope.id}>{translateScope(scope.description)}</li>
            ))
          ) : (
            <li>{t('Confirm who you are')}</li>
          )}
        </ul>
      </div>

      <OrganizationSelect
        organizations={organizations}
        value={organizationId}
        onValueChange={setOrganizationId}
      />

      <p className="text-sm text-muted-foreground">
        {t(
          'Anything it generates spends this organization’s credits. To use another organization, connect again and pick it. You can revoke access any time under Settings → Developer.'
        )}
      </p>

      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          disabled={!hydrated || decide.isPending}
          onClick={() => decide.mutate(false)}
        >
          {t('Deny')}
        </Button>
        <Button
          disabled={!hydrated || decide.isPending}
          onClick={() => decide.mutate(true)}
        >
          {!hydrated
            ? t('Loading…')
            : decide.isPending
              ? t('Working…')
              : t('Approve')}
        </Button>
      </div>
    </div>
  );
}
