import { translateStaticLabel } from '@/platform/i18n/labels';
import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import { localizeMeta } from '@/ui/i18n/head';
import { useTranslation } from 'react-i18next';
import { createFileRoute } from '@tanstack/react-router';
import { FAQ_ITEMS, SITE_CONFIG } from '@/ui/marketing/constants';

const title = 'Frequently Asked Questions';
const description =
  'Common questions about OpenStory: what it is, pricing, AI model support, API keys, open source licensing, and getting started.';

// The FAQ lived on the old marketing homepage; `/` is now the product composer
// in the app shell, so this docs page is the crawlable home for the answers
// (#814). FAQ_ITEMS stays the single source of truth — llms.txt renders the
// same items, so the two surfaces can't drift.
export const Route = createFileRoute('/docs/faq')({
  head: ({ match }) => ({
    meta: localizeMeta(match.context.i18n, 'documentation', [
      { title: `${title} - OpenStory Docs` },
      { name: 'description', content: description },
    ]),
    scripts: [
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: FAQ_ITEMS.map((item) => ({
            '@type': 'Question',
            name: translateStaticLabel(
              match.context.i18n,
              'labels',
              item.question
            ),
            acceptedAnswer: {
              '@type': 'Answer',
              text: translateStaticLabel(
                match.context.i18n,
                'labels',
                item.answer
              ),
            },
          })),
        }),
      },
      {
        type: 'application/ld+json',
        children: JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: SITE_CONFIG.name,
          description: translateStaticLabel(
            match.context.i18n,
            'labels',
            SITE_CONFIG.description
          ),
          url: SITE_CONFIG.url,
          applicationCategory: 'MultimediaApplication',
          operatingSystem: 'Web',
          offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
          },
          isAccessibleForFree: true,
          license: `${SITE_CONFIG.githubHref}/blob/main/LICENSE`,
        }),
      },
    ],
  }),
  component: FaqArticle,
});

function FaqArticle() {
  const translateLabel = useLabelTranslation('labels');
  const { t } = useTranslation('documentation');

  return (
    <article>
      <header className="mb-8">
        <p className="text-sm font-medium text-muted-foreground">
          {t('Support')}
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          {translateLabel(title)}
        </h1>
        <p className="mt-2 text-lg text-muted-foreground">
          {translateLabel(description)}
        </p>
      </header>
      <div className="prose dark:prose-invert max-w-none">
        {FAQ_ITEMS.map((item) => (
          <section key={item.question}>
            <h2>{translateLabel(item.question)}</h2>
            <p>{translateLabel(item.answer)}</p>
          </section>
        ))}
      </div>
    </article>
  );
}
