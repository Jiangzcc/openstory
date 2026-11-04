import { useLiveTranslation } from '@/ui/i18n/use-live-translation';
import { localizeMeta } from '@/ui/i18n/head';
import { Trans, useTranslation } from 'react-i18next';
/**
 * Public content report / takedown channel (#1180).
 *
 * Reachable without an account. Linked from Terms, the sign-in legal line,
 * and the sitemap. The person whose likeness was misused does not have a
 * login here, so a report form behind auth would be a report form nobody
 * who needs it can use.
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
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Textarea } from '@/ui/shadcn/textarea';
import { submitContentReportFn } from '@/platform/content-reports.fn';
import { CONTENT_REPORT_REASONS } from '@/platform/content-reports';
import { SITE_CONFIG } from '@/ui/marketing/constants';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

const title = `Report content — ${SITE_CONFIG.name}`;

export const Route = createFileRoute('/_app/report')({
  component: ReportPage,
  head: ({ match }) => ({
    meta: localizeMeta(match.context.i18n, 'pages', [
      { title },
      { property: 'og:title', content: title },
      { property: 'og:url', content: `${SITE_CONFIG.url}/report` },
    ]),
  }),
  staticData: {
    breadcrumb: {
      translationKey: 'Report content',
      label: 'Report content',
      to: '/report',
    },
  },
});

/**
 * Reason labels. Plain language rather than the enum's wording — a complainant
 * should not have to work out which internal category their problem falls into,
 * and mislabelled reports slow triage more than a missing label would.
 */
const REASON_LABELS: Record<(typeof CONTENT_REPORT_REASONS)[number], string> = {
  csam: 'Child sexual abuse material',
  portrait_rights: 'Uses my likeness without permission',
  deepfake_impersonation: 'Impersonates a real person',
  copyright: 'Infringes my copyright or trademark',
  sexual_content: 'Non-consensual or explicit sexual content',
  violence_or_harm: 'Violent, harmful, or dangerous content',
  hate_or_harassment: 'Hate speech or harassment',
  illegal_or_regulated: 'Illegal or regulated content',
  misleading_content: 'Misleading or deceptive content',
  other: 'Something else',
};

const formSchema = z.object({
  reason: z.enum(CONTENT_REPORT_REASONS),
  targetId: z.string().trim().min(1, 'Tell us what to look at'),
  details: z.string().trim().max(5000).optional(),
  reporterEmail: z
    .union([z.string().trim().email(), z.literal('')])
    .optional()
    .transform((value) => (value ? value : undefined)),
});

function ReportPage() {
  const translateEvent = useLiveTranslation('pages');
  const { t } = useTranslation('pages');

  const [reason, setReason] = useState<
    (typeof CONTENT_REPORT_REASONS)[number] | ''
  >('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reference, setReference] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (data: z.infer<typeof formSchema>) =>
      submitContentReportFn({
        data: {
          // Everything arrives as a URL, a trace id, or prose. The server
          // decides what it is; the form does not make the reporter classify it.
          targetType: 'external_url',
          targetId: data.targetId,
          reason: data.reason,
          details: data.details,
          reporterEmail: data.reporterEmail,
          traceId: data.targetId,
        },
      }),
    onSuccess: (result) => {
      setReference(result.reference);
      toast.success(translateEvent('Report received'), {
        description: translateEvent('Reference {{value1}}', {
          value1: result.reference,
        }),
      });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : translateEvent(
              'Could not submit the report. Please email us instead.'
            )
      );
    },
  });

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(event.currentTarget));
    const parsed = formSchema.safeParse({ ...raw, reason });

    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (typeof key === 'string' && !fieldErrors[key]) {
          fieldErrors[key] = issue.message;
        }
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    mutation.mutate(parsed.data);
  };

  if (reference) {
    return (
      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-10">
        <h1 className="font-heading text-3xl font-bold tracking-tight">
          {t('Report received')}
        </h1>
        <Card>
          <CardHeader>
            <CardTitle>
              {t('Reference {{value1}}', { value1: reference })}
            </CardTitle>
            <CardDescription>
              {t('Keep this reference if you need to follow up.')}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 leading-relaxed">
            <p>
              {t(
                'We review reports of child sexual abuse material and non-consensual likeness immediately, and all other reports in the order received. Content found to breach our terms is removed and the account responsible is restricted.'
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              <Trans
                ns="pages"
                i18nKey="If your report is urgent and you have not heard from us, email <0>{{value1}}</0> quoting this reference."
                components={[
                  <a
                    key="0"
                    className="underline"
                    href={`mailto:${SITE_CONFIG.contactEmail}`}
                  >
                    {t('Open link', { ns: 'labels' })}
                  </a>,
                ]}
                values={{ value1: SITE_CONFIG.contactEmail }}
              />
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-bold tracking-tight">
          {t('Report content')}
        </h1>
        <p className="leading-relaxed text-muted-foreground">
          <Trans
            ns="pages"
            i18nKey="Use this form to report content generated on {{value1}} that uses someone’s likeness without permission, infringes your rights, or breaks our <0>terms</0>. You do not need an account."
            components={[
              <a key="0" className="underline" href="/terms">
                {t('Open link', { ns: 'labels' })}
              </a>,
            ]}
            values={{ value1: SITE_CONFIG.name }}
          />
        </p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="reason">{t('What is the problem?')}</Label>
          <Select
            value={reason}
            items={CONTENT_REPORT_REASONS.map((value) => ({
              value,
              label: REASON_LABELS[value],
            }))}
            onValueChange={(value) => {
              // Narrow by lookup rather than asserting: the Select hands back a
              // plain string, and a value that is not one of our reasons should
              // be ignored, not coerced into one.
              const match = CONTENT_REPORT_REASONS.find(
                (candidate) => candidate === value
              );
              if (match) setReason(match);
            }}
          >
            <SelectTrigger id="reason">
              <SelectValue placeholder={t('Choose a reason…')} />
            </SelectTrigger>
            <SelectContent>
              {CONTENT_REPORT_REASONS.map((value) => (
                <SelectItem key={value} value={value}>
                  {REASON_LABELS[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.reason ? (
            <p className="text-sm text-destructive">{t('Choose a reason')}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="targetId">{t('Link or reference')}</Label>
          <Input
            id="targetId"
            name="targetId"
            placeholder={t('https://… or OS-01J…')}
            autoComplete="off"
            required
          />
          <p className="text-sm text-muted-foreground">
            <Trans
              ns="pages"
              i18nKey="Paste the video or image URL, or the <0/> reference if we gave you one. This is how we trace the content back to the account that generated it."
              components={[<code key="0">OS-…</code>]}
            />
          </p>
          {errors.targetId ? (
            <p className="text-sm text-destructive">{errors.targetId}</p>
          ) : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="details">{t('Details')}</Label>
          <Textarea
            id="details"
            name="details"
            rows={5}
            placeholder={t(
              'Tell us what is wrong, and if this is about your likeness or your work, how we can tell it is yours.'
            )}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="reporterEmail">{t('Your email (optional)')}</Label>
          <Input
            id="reporterEmail"
            name="reporterEmail"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder={t('you@example.com')}
          />
          <p className="text-sm text-muted-foreground">
            {t(
              'Only used to follow up on this report. Leave blank to report anonymously.'
            )}
          </p>
          {errors.reporterEmail ? (
            <p className="text-sm text-destructive">
              {t('Enter a valid email, or leave it blank')}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? t('Submitting…') : t('Submit report')}
          </Button>
          <p aria-live="polite" className="text-sm text-muted-foreground">
            {mutation.isPending && <span>{t('Sending your report…')}</span>}
          </p>
        </div>
      </form>
    </main>
  );
}
