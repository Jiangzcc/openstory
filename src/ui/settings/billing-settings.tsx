import { useLiveTranslation } from '@/ui/i18n/use-live-translation';
import { useLocaleFormatting } from '@/ui/i18n/use-formatting';
import { useTranslation } from 'react-i18next';
/**
 * Billing Settings Component
 * Credit balance, add-credits + auto-top-up dialogs, and invoices (#1099).
 * Purchasing happens in the AddCreditsDialog / AutoTopUpDialog modals, which
 * this page opens. The one exception is the post-checkout "Enable
 * auto-reload?" prompt below, which writes settings directly.
 */

import { AutoTopUpDialog } from '@/billing/ui/auto-topup-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/ui/shadcn/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/shadcn/alert-dialog';
import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { Switch } from '@/ui/shadcn/switch';
import {
  createSetupCheckoutSessionFn,
  getTransactionsFn,
  listPaymentMethodsFn,
  reportCheckoutCanceledFn,
  updateAutoTopUpFn,
} from '@/billing/billing.fn';
import { openAddCreditsDialog } from '@/billing/ui/use-add-credits-dialog';
import { clearBalanceFlash } from '@/billing/ui/use-balance-flash';
import {
  BILLING_BALANCE_KEY,
  BILLING_PAYMENT_METHODS_KEY,
  useBillingBalance,
} from '@/billing/ui/use-billing-balance';
import { BILLING_GATE_KEY } from '@/billing/ui/use-billing-gate';
import { useShowCosts } from '@/billing/ui/use-show-costs';
import { MIN_TOPUP_AMOUNT_USD } from '@/billing/constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  AlertCircle,
  CreditCard,
  ExternalLink,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

type BillingSettingsProps = {
  success?: boolean;
  canceled?: boolean;
  sessionId?: string;
  cardSaved?: boolean;
};

type SectionHeaderProps = {
  icon: LucideIcon;
  title: string;
  description: string;
};

function SectionHeader({
  icon: Icon,
  title,
  description,
  action,
}: SectionHeaderProps & { action?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div className="flex-1">
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </div>
      {action}
    </div>
  );
}

function getErrorMessage(
  error: string | null,
  balanceError: Error | null
): string {
  if (error) return error;
  if (balanceError instanceof Error) return balanceError.message;
  return 'Something went wrong';
}

const RETURN_KEY = 'openstory:billing-return';

export function BillingSettings({
  success,
  canceled,
  sessionId,
  cardSaved,
}: BillingSettingsProps) {
  const translateEvent = useLiveTranslation('interface');

  const { formatDateTime } = useLocaleFormatting();
  const { t } = useTranslation('interface');

  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [autoTopUpPrompt, setAutoTopUpPrompt] = useState<number | null>(null);
  const [autoTopUpDialogOpen, setAutoTopUpDialogOpen] = useState(false);
  const navigate = useNavigate();

  // Handle checkout return — runs once when returning from Stripe with success or canceled params
  const checkoutHandledRef = useRef(false);
  useEffect(() => {
    if (checkoutHandledRef.current || (!success && !canceled && !cardSaved))
      return;
    checkoutHandledRef.current = true;

    if (cardSaved) toast.success(translateEvent('Card saved'));

    // Clear pending flash marker on cancel
    if (canceled) {
      clearBalanceFlash();
      if (sessionId) {
        void reportCheckoutCanceledFn({ data: { sessionId } });
      }
    }

    // Refetch balance + show return toast on success
    if (success) {
      void queryClient.invalidateQueries({
        queryKey: [...BILLING_BALANCE_KEY],
      });
      void queryClient.invalidateQueries({
        queryKey: ['billing-invoices'],
      });
      void queryClient.invalidateQueries({
        queryKey: [...BILLING_GATE_KEY],
      });

      const returnTo = localStorage.getItem(RETURN_KEY);
      if (returnTo) {
        localStorage.removeItem(RETURN_KEY);
        toast.success(translateEvent('Credits added successfully'), {
          description: translateEvent('Your balance has been updated.'),
          action: {
            label: translateEvent('Continue creating'),
            onClick: () => void navigate({ to: returnTo }),
          },
          duration: 15_000,
        });
      }
    }

    // Clear success/canceled from URL after showing
    const timer = setTimeout(() => {
      window.history.replaceState({}, '', '/credits');
    }, 5000);
    return () => clearTimeout(timer);
  }, [
    translateEvent,
    success,
    canceled,
    sessionId,
    cardSaved,
    queryClient,
    navigate,
  ]);

  const {
    data: balanceData,
    isLoading: balanceLoading,
    error: balanceError,
  } = useBillingBalance();

  // After successful top-up, prompt to enable auto-topup if not already on
  useEffect(() => {
    if (!success || balanceLoading || !balanceData) return;
    if (balanceData.autoTopUp.enabled) return;

    const lastAmount = localStorage.getItem('openstory:last-topup-amount');
    localStorage.removeItem('openstory:last-topup-amount');
    const amount = lastAmount ? parseFloat(lastAmount) : null;
    if (amount && !isNaN(amount) && amount >= MIN_TOPUP_AMOUNT_USD) {
      setAutoTopUpPrompt(amount);
    }
  }, [success, balanceLoading, balanceData]);

  const stripeEnabled = balanceData?.stripeEnabled ?? false;

  // Asks Stripe for saved cards. A Stripe customer alone is not a card: one
  // is created before the Add card checkout opens, even if it is canceled.
  const {
    data: pmData,
    isLoading: pmLoading,
    error: pmError,
  } = useQuery({
    queryKey: [...BILLING_PAYMENT_METHODS_KEY],
    queryFn: () => listPaymentMethodsFn(),
    staleTime: 60_000,
    enabled: stripeEnabled,
  });
  const hasCard = (pmData?.paymentMethods.length ?? 0) > 0;

  const {
    data: invoiceData,
    isLoading: invoicesLoading,
    error: invoicesError,
  } = useQuery({
    queryKey: ['billing-invoices'],
    queryFn: () =>
      getTransactionsFn({
        data: { type: 'credit_purchase', limit: 10, offset: 0 },
      }),
    staleTime: 5 * 60 * 1000,
  });

  const autoTopUpMutation = useMutation({
    mutationFn: (body: {
      enabled: boolean;
      thresholdUsd?: number;
      amountUsd?: number;
    }) => updateAutoTopUpFn({ data: body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: [...BILLING_BALANCE_KEY],
      });
      setError(null);
    },
    onError: (err) => {
      setError(
        err instanceof Error ? err.message : t('Failed to update auto top-up')
      );
    },
  });

  const addCardMutation = useMutation({
    mutationFn: () => createSetupCheckoutSessionFn(),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : t('Could not add card'));
    },
  });

  const autoTopUpThreshold =
    autoTopUpPrompt !== null ? Math.ceil((autoTopUpPrompt * 0.1) / 5) * 5 : 5;

  return (
    <div className="space-y-6">
      {success && (
        <Alert className="mb-4">
          <AlertDescription>
            {t('Credits added successfully. Your balance has been updated.')}
          </AlertDescription>
        </Alert>
      )}

      {canceled && (
        <Alert className="mb-4">
          <AlertDescription>
            {t('Top-up canceled. No charges were made.')}
          </AlertDescription>
        </Alert>
      )}

      <AlertDialog open={autoTopUpPrompt !== null}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('Enable auto-reload?')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                'Automatically top your balance back up to ${{value1}} when it drops below ${{value2}}.',
                { value1: autoTopUpPrompt, value2: autoTopUpThreshold }
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setAutoTopUpPrompt(null)}>
              {t('No thanks')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                autoTopUpMutation.mutate({
                  enabled: true,
                  thresholdUsd: autoTopUpThreshold,
                  amountUsd: autoTopUpPrompt ?? 0,
                });
                setAutoTopUpPrompt(null);
              }}
              disabled={autoTopUpMutation.isPending}
            >
              {autoTopUpMutation.isPending
                ? t('Enabling…')
                : t('Enable auto-reload')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {(error || balanceError || invoicesError) && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            {getErrorMessage(error, balanceError)}
          </AlertDescription>
        </Alert>
      )}

      {/* Balance Card */}
      <Card>
        <CardHeader>
          <SectionHeader
            icon={Wallet}
            title={t('Credit Balance')}
            description={t(
              'Pay-as-you-go wallet for AI generation at provider cost'
            )}
            action={
              stripeEnabled ? (
                <Button
                  onClick={() => openAddCreditsDialog('billing_settings')}
                >
                  {t('Add credits')}
                </Button>
              ) : undefined
            }
          />
        </CardHeader>
        <CardContent className="space-y-4">
          {balanceLoading ? (
            <Skeleton className="h-12 w-32" />
          ) : (
            <p className="text-4xl font-bold tabular-nums">
              $
              {(balanceData?.availableUsd ?? balanceData?.balance)?.toFixed(
                2
              ) ?? '0.00'}
            </p>
          )}
          <ShowCostsToggle />
        </CardContent>
      </Card>

      {!stripeEnabled && !balanceLoading && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">
              {t('Credits can be added via gift codes.')}
            </p>
            <div className="pt-2">
              <Link
                to="/credits"
                search={{ tab: 'transactions' }}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {t('View all transactions')}
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {stripeEnabled && (
        <>
          {/* Auto-reload */}
          <Card>
            <CardHeader>
              <SectionHeader
                icon={RefreshCw}
                title={t('Auto-reload')}
                description={t(
                  'Automatically add credits when your balance runs low'
                )}
                action={
                  !pmData?.canManage ? null : hasCard ? (
                    <Button
                      variant="outline"
                      onClick={() => setAutoTopUpDialogOpen(true)}
                    >
                      {t('Modify')}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      disabled={addCardMutation.isPending}
                      onClick={() => addCardMutation.mutate()}
                    >
                      {addCardMutation.isPending
                        ? t('Opening…')
                        : t('Add card')}
                    </Button>
                  )
                }
              />
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {balanceLoading || pmLoading ? (
                <Skeleton className="h-5 w-64" />
              ) : pmError ? (
                <p className="text-sm text-destructive">
                  {t('Could not load your cards: {{value1}}', {
                    value1: pmError.message,
                  })}
                </p>
              ) : !pmData?.canManage ? (
                <p className="text-sm text-muted-foreground">
                  {t('Only an organization admin can manage cards.')}
                </p>
              ) : !hasCard || !balanceData ? (
                <p className="text-sm text-muted-foreground">
                  {t('Add a card to enable auto-reload.')}
                </p>
              ) : balanceData.autoTopUp.enabled ? (
                <p className="text-sm text-muted-foreground tabular-nums">
                  {t(
                    'Adds ${{value1}} when your balance falls below ${{value2}}.',
                    {
                      value1: balanceData.autoTopUp.amountUsd?.toFixed(2),
                      value2: balanceData.autoTopUp.thresholdUsd?.toFixed(2),
                    }
                  )}
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{t('Off')}</p>
              )}
              {balanceData?.autoTopUp.lastFailure && (
                <Alert variant="destructive">
                  <AlertCircle />
                  <AlertTitle>
                    {t('Auto top-up failed — update your card')}
                  </AlertTitle>
                  <AlertDescription>
                    {t(
                      'We paused auto-reload after your card was declined. Add a working payment method to resume.'
                    )}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <AutoTopUpDialog
            open={autoTopUpDialogOpen}
            onOpenChange={setAutoTopUpDialogOpen}
          />

          {/* Invoices */}
          <Card>
            <CardHeader>
              <SectionHeader
                icon={CreditCard}
                title={t('Invoices')}
                description={t('Recent purchases')}
              />
            </CardHeader>
            <CardContent>
              {invoicesLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : invoiceData?.transactions.length === 0 ? (
                <p className="text-center text-muted-foreground py-4">
                  {t('No purchases yet')}
                </p>
              ) : (
                <div className="space-y-2">
                  {invoiceData?.transactions.map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">
                          {tx.description ?? t('Credit purchase')}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(new Date(tx.createdAt))}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <span className="text-sm font-semibold tabular-nums text-green-600 dark:text-green-400">
                          +${tx.amount.toFixed(2)}
                        </span>
                        {tx.metadata?.receiptUrl && (
                          <a
                            href={tx.metadata.receiptUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-foreground"
                            aria-label={t('View receipt')}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}

                  <div className="pt-2 text-center">
                    <Link
                      to="/credits"
                      search={{ tab: 'transactions' }}
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      {t('View all transactions')}
                    </Link>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ShowCostsToggle() {
  const { t } = useTranslation('interface');

  const { showCosts, setShowCosts } = useShowCosts();

  return (
    <div className="flex items-center justify-between border-t pt-4">
      <div>
        <p className="text-sm font-medium">{t('Show costs')}</p>
        <p className="text-xs text-muted-foreground">
          {t('Balance in the sidebar and estimates under generation actions')}
        </p>
      </div>
      <Switch
        checked={showCosts}
        onCheckedChange={setShowCosts}
        aria-label={t('Show costs')}
      />
    </div>
  );
}
