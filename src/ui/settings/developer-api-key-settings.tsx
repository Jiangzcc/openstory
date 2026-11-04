import { useLiveTranslation } from '@/ui/i18n/use-live-translation';
import { useLocaleFormatting } from '@/ui/i18n/use-formatting';
import { Trans, useTranslation } from 'react-i18next';
/**
 * Developer API Key Settings
 * Mint, view, and revoke keys that authenticate calls to the public OpenStory
 * API (`/api/v1/*`). Distinct from the "API Keys" tab, which manages a team's
 * provider keys (OpenRouter/Fal). The secret is shown exactly once, on creation.
 */

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/ui/shadcn/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
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
import { copyTextToClipboard } from '@/ui/clipboard';
import {
  createPublicApiKeyFn,
  listPublicApiKeysFn,
  revokePublicApiKeyFn,
} from '@/platform/public-api-keys.fn';
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { Check, Copy, KeyRound, Trash2 } from 'lucide-react';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';

const PUBLIC_API_KEYS_QUERY_KEY = ['publicApiKeys'] as const;

const createFormSchema = z.object({
  name: z.string().min(1).max(32),
});

export function DeveloperApiKeySettings() {
  const { t } = useTranslation('interface');

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle>{t('API access')}</CardTitle>
            <CardDescription>
              <Trans
                ns="interface"
                i18nKey="Create keys to call the OpenStory API. Authenticate with <0/>."
                components={[
                  <code
                    key="0"
                    className="rounded bg-muted px-1 py-0.5 text-xs"
                  >
                    Authorization: Bearer &lt;key&gt;
                  </code>,
                ]}
              />
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <CreateKeyForm />
        <div className="border-t" />
        <Suspense fallback={<KeyListSkeleton />}>
          <KeyList />
        </Suspense>
      </CardContent>
    </Card>
  );
}

function CreateKeyForm() {
  const translateEvent = useLiveTranslation('interface');
  const { t } = useTranslation('interface');

  const queryClient = useQueryClient();
  const [createdKey, setCreatedKey] = useState<{
    name: string;
    key: string;
  } | null>(null);

  const createMutation = useMutation({
    mutationFn: (input: { name: string }) =>
      createPublicApiKeyFn({ data: input }),
    onSuccess: (result) => {
      setCreatedKey({ name: result.name, key: result.key });
      void queryClient.invalidateQueries({
        queryKey: PUBLIC_API_KEYS_QUERY_KEY,
      });
    },
    onError: (err) => {
      toast.error(
        err instanceof Error
          ? err.message
          : translateEvent('Failed to create key')
      );
    },
  });

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = createFormSchema.safeParse(
      Object.fromEntries(new FormData(e.currentTarget))
    );
    if (!parsed.success) {
      toast.error(translateEvent('Enter a name (1–32 characters).'));
      return;
    }
    createMutation.mutate({ name: parsed.data.name });
    e.currentTarget.reset();
  };

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={onSubmit} className="flex gap-2">
        <Input
          name="name"
          placeholder={t('Key name (e.g. Production server)')}
          maxLength={32}
          autoComplete="off"
          required
        />
        <Button type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? t('Creating…') : t('Create key')}
        </Button>
      </form>

      {createdKey && (
        <NewKeyReveal
          name={createdKey.name}
          apiKey={createdKey.key}
          onDismiss={() => setCreatedKey(null)}
        />
      )}
    </div>
  );
}

function NewKeyReveal({
  name,
  apiKey,
  onDismiss,
}: {
  name: string;
  apiKey: string;
  onDismiss: () => void;
}) {
  const translateEvent = useLiveTranslation('interface');
  const { t } = useTranslation('interface');

  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!(await copyTextToClipboard(apiKey))) {
      // The key is shown exactly once, so a silent failure would lose it.
      toast.error(translateEvent('Could not copy the key'), {
        description: translateEvent(
          'Your browser blocked clipboard access. Select the key above and copy it manually before dismissing this.'
        ),
      });
      return;
    }
    setCopied(true);
    toast.success(translateEvent('Copied to clipboard'));
  };

  return (
    <Alert>
      <KeyRound className="h-4 w-4" />
      <AlertTitle>{t('Key “{{value1}}” created', { value1: name })}</AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>
          {t('Copy it now — for your security it won’t be shown again.')}
        </span>
        <div className="flex items-center gap-2">
          <code className="flex-1 overflow-x-auto rounded bg-muted px-2 py-1.5 font-mono text-xs">
            {apiKey}
          </code>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void copy()}
            aria-label={t('Copy API key')}
          >
            {copied ? (
              <Check className="h-4 w-4" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
            {t('Done')}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function KeyList() {
  const translateEvent = useLiveTranslation('interface');
  const { formatDate } = useLocaleFormatting();
  const { t } = useTranslation('interface');

  const queryClient = useQueryClient();
  const { data: keys } = useSuspenseQuery({
    queryKey: PUBLIC_API_KEYS_QUERY_KEY,
    queryFn: () => listPublicApiKeysFn(),
  });

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) => revokePublicApiKeyFn({ data: { keyId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: PUBLIC_API_KEYS_QUERY_KEY,
      });
      toast.success(translateEvent('Key revoked'));
    },
    onError: (err) => {
      toast.error(
        err instanceof Error
          ? err.message
          : translateEvent('Failed to revoke key')
      );
    },
  });

  if (keys.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('No API keys yet. Create one above to start using the API.')}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {keys.map((key) => (
        <li
          key={key.id}
          className="flex items-center justify-between rounded-lg border p-3"
        >
          <div className="flex items-center gap-3">
            <KeyRound className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">
                {key.name ?? t('Untitled key')}
              </p>
              <p className="text-xs text-muted-foreground">
                {key.start ? `${key.start}…` : t('osk_…')}
                {key.expiresAt
                  ? t(' · expires {{value1}}', {
                      value1: formatDate(new Date(key.expiresAt)),
                    })
                  : t(' · no expiry')}
                {key.lastRequest
                  ? t(' · last used {{value1}}', {
                      value1: formatDate(new Date(key.lastRequest)),
                    })
                  : t(' · never used')}
              </p>
            </div>
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('Revoke {{value1}}', {
                  value1: key.name ?? 'key',
                })}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('Revoke this API key?')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t(
                    'Any integration using “{{value1}}” will stop working immediately. This cannot be undone.',
                    { value1: key.name ?? t('this key') }
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('Cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => revokeMutation.mutate(key.id)}
                >
                  {t('Revoke')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </li>
      ))}
    </ul>
  );
}

function KeyListSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-14 w-full" />
    </div>
  );
}
