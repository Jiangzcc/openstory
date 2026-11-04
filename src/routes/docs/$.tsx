import { useMemo } from 'react';
import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import { localizeMarkdown } from '@/ui/i18n/markdown';
import { localizeMeta } from '@/ui/i18n/head';
import { useTranslation } from 'react-i18next';
import { createFileRoute, notFound } from '@tanstack/react-router';
import { allDocs } from 'content-collections';
import { MarkdownContent } from '@/ui/docs/markdown';
import { parseDocsMarkdown } from '@/ui/docs/markdown-ast';

export const Route = createFileRoute('/docs/$')({
  loader: ({ params }) => {
    const slug = params._splat;
    const doc = allDocs.find((d) => d.slug === slug);

    if (!doc) {
      throw notFound();
    }

    const { document, headings } = parseDocsMarkdown(doc.body);

    return {
      body: doc.body,
      title: doc.title,
      description: doc.description,
      section: doc.section,
      document,
      headings,
    };
  },
  head: ({ match, loaderData }) => ({
    meta: localizeMeta(
      match.context.i18n,
      'documentation',
      loaderData
        ? [
            { title: `${loaderData.title} - OpenStory Docs` },
            { name: 'description', content: loaderData.description },
          ]
        : []
    ),
  }),
  component: DocsArticle,
  notFoundComponent: function RouteComponent() {
    const { t } = useTranslation('documentation');
    return (
      <div className="flex flex-col gap-2 py-20 text-center">
        <h1 className="text-2xl font-bold">{t('Page not found')}</h1>
        <p className="text-muted-foreground">
          {t('This documentation page does not exist.')}
        </p>
      </div>
    );
  },
});

function DocsArticle() {
  const data = Route.useLoaderData();
  const { i18n } = useTranslation('documentation');
  const translateLabel = useLabelTranslation('labels');
  const locale = i18n.resolvedLanguage;
  const rendered = useMemo(
    () =>
      parseDocsMarkdown(
        localizeMarkdown(i18n, data.body, locale),
        data.headings.map(({ id }) => id)
      ),
    [i18n, locale, data.body, data.headings]
  );

  return (
    <article>
      <header className="mb-8">
        <p className="text-sm font-medium text-muted-foreground">
          {translateLabel(data.section)}
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">
          {translateLabel(data.title)}
        </h1>
        <p className="mt-2 text-lg text-muted-foreground">
          {translateLabel(data.description)}
        </p>
      </header>
      <MarkdownContent document={rendered.document} />
    </article>
  );
}
