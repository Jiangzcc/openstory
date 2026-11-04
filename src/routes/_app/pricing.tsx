import { localizeMeta } from '@/ui/i18n/head';
import { localizePricingText } from '@/billing/ui/localize-pricing';
import { Trans, useTranslation } from 'react-i18next';
/**
 * Public model pricing catalog — lives in the app shell so it matches the
 * rest of the product chrome (sidebar, breadcrumbs). Anonymous-browsable.
 */

import { useAuthGate } from '@/platform/ui/auth/auth-gate-provider';
import { createFileRoute } from '@tanstack/react-router';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
  formatPlatformFeePercent,
  PLATFORM_FEE_PERCENT,
} from '@/billing/constants';
import { getPricingCatalogFn } from '@/billing/pricing.fn';
import { openAddCreditsDialog } from '@/billing/ui/use-add-credits-dialog';
import { SITE_CONFIG } from '@/ui/marketing/constants';
import { ArrowUpRight, KeyRound } from 'lucide-react';

const title = `Pricing — ${SITE_CONFIG.name}`;
const description =
  'Pay providers as you go. Estimates before every spend. Bring your own keys to skip the wallet.';

export const Route = createFileRoute('/_app/pricing')({
  component: PricingPage,
  loader: () => getPricingCatalogFn(),
  staticData: { breadcrumb: { label: 'Pricing', translationKey: 'Pricing' } },
  head: ({ match }) => ({
    meta: localizeMeta(match.context.i18n, 'pages', [
      { title },
      { name: 'description', content: description },
      { property: 'og:title', content: title },
      { property: 'og:description', content: description },
      { property: 'og:url', content: `${SITE_CONFIG.url}/pricing` },
      { name: 'twitter:title', content: title },
      { name: 'twitter:description', content: description },
    ]),
  }),
});

function PricingPage() {
  const { t, i18n } = useTranslation('pages');
  const displayText = (source: string) => localizePricingText(i18n, source);

  const { sections, lastUpdated, filmCosts } = Route.useLoaderData();
  const { requireAuth } = useAuthGate();
  const feePercent = formatPlatformFeePercent();
  const chargeFor100 = (100 * (1 + PLATFORM_FEE_PERCENT)).toFixed(0);
  const onAddCredits = () => {
    requireAuth(() => openAddCreditsDialog('pricing'));
  };

  return (
    <div className="mx-auto w-full max-w-5xl p-6 pb-16">
      <header className="max-w-2xl">
        <h1 className="font-heading text-3xl font-bold tracking-tight">
          {t('Pricing')}
        </h1>
        <p className="mt-3 text-base leading-relaxed text-muted-foreground">
          {t(
            'Pay providers as you go. We show an estimate under each action before you spend.'
          )}
        </p>
      </header>

      {filmCosts && (
        <section id="film-cost" className="mt-10">
          <div className="mb-4 max-w-2xl">
            <h2 className="text-xl font-semibold tracking-tight">
              {t('Typical first film')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {t(
                '{{value1}}s target (Enhance default) with product defaults ({{value2}}, {{value3}}, {{value4}}). These use the same estimators as Generate (fixed 30s showcase) — we try to be as accurate as possible; the final charge can differ once generation finishes.',
                {
                  value1: filmCosts.targetDurationSeconds,
                  value2: filmCosts.imageModelName,
                  value3: filmCosts.videoModelName,
                  value4: filmCosts.audioModelName,
                }
              )}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {filmCosts.examples.map((example) => (
              <div
                key={example.id}
                className="flex flex-col gap-3 rounded-xl border bg-card p-5"
              >
                <div className="flex flex-col gap-0.5">
                  <p className="text-sm font-medium">
                    {displayText(example.title)}
                  </p>
                  <p className="font-heading text-2xl font-bold tracking-tight tabular-nums">
                    {example.cost}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {displayText(example.subtitle)}
                  </p>
                </div>
                <ul className="flex flex-col gap-1.5 border-t pt-3 text-xs text-muted-foreground">
                  {example.breakdown.map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <span
                        aria-hidden
                        className="mt-1.5 size-1 shrink-0 rounded-full bg-muted-foreground/50"
                      />
                      <span>{displayText(line)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="mt-6">
            <Button onClick={onAddCredits}>{t('Add credits')}</Button>
          </div>
        </section>
      )}

      <section
        id="how-billing-works"
        className="mt-10 flex flex-col gap-3 text-sm text-muted-foreground"
      >
        <h2 className="text-base font-semibold tracking-tight text-foreground">
          {t('How billing works')}
        </h2>
        <ul className="flex flex-col gap-2">
          <li>
            {t(
              'Credits are drawn at fal.ai / OpenRouter rates when you use the wallet. Media is fal; script analysis is OpenRouter.'
            )}
          </li>
          <li>
            <Trans
              ns="pages"
              i18nKey="A {{value1}} fee applies only when you <0>buy</0> credits (${{value2}} charged → $100 wallet) — not on each generation."
              components={[<span key="0" className="text-foreground" />]}
              values={{ value1: feePercent, value2: chargeFor100 }}
            />
          </li>
          <li className="flex items-start gap-2">
            <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              <Trans
                ns="pages"
                i18nKey="<0>Bring your own keys</0> in Settings to pay platforms directly and skip the wallet. fal.ai covers media; OpenRouter is optional for analysis."
                components={[
                  <span key="0" className="font-medium text-foreground" />,
                ]}
              />
            </span>
          </li>
        </ul>
      </section>

      <div className="mt-12 flex flex-col gap-12">
        {sections.map((section) => (
          <section key={section.id} id={section.id}>
            <div className="mb-4 max-w-2xl">
              <h2 className="text-xl font-semibold tracking-tight">
                {displayText(section.title)}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {displayText(section.description)}
              </p>
            </div>

            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="px-4 py-3 font-medium">{t('Model')}</th>
                    <th className="px-4 py-3 font-medium">{t('Vendor')}</th>
                    <th className="px-4 py-3 font-medium">{t('Via')}</th>
                    <th className="px-4 py-3 font-medium text-right">
                      {t('Indicative rate')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row) => (
                    <tr
                      key={`${row.via}-${row.name}`}
                      className="border-b last:border-b-0 hover:bg-muted/20"
                    >
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{row.name}</span>
                          {row.license === 'open-weight' && (
                            <Badge variant="secondary" className="text-xs">
                              {t('Open weight')}
                            </Badge>
                          )}
                        </div>
                        {row.detail && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {displayText(row.detail)}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {row.vendor}
                      </td>
                      <td className="px-4 py-3">
                        <a
                          href={row.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        >
                          {row.via}
                          <ArrowUpRight className="size-3.5 shrink-0" />
                        </a>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums sm:text-sm">
                        {displayText(row.price)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      <p className="mt-10 text-center text-xs text-muted-foreground">
        {t(
          'Indicative rates from platform APIs ({{value1}}). Actual charges follow billed units. Via links open that platform’s full pricing.',
          { value1: displayText(lastUpdated) }
        )}
      </p>

      <div className="mt-12 flex flex-col items-center gap-4 rounded-2xl border bg-muted/30 px-6 py-10 text-center">
        <h2 className="text-xl font-semibold">{t('Ready when you are')}</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {t(
            'Top up the wallet, or connect provider keys in Settings to pay platforms directly. No subscriptions.'
          )}
        </p>
        <Button size="lg" onClick={onAddCredits}>
          {t('Add credits')}
        </Button>
      </div>
    </div>
  );
}
