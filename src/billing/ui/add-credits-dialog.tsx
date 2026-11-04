import { useLiveTranslation } from '@/ui/i18n/use-live-translation';
import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import { useLocaleFormatting } from '@/ui/i18n/use-formatting';
import { useTranslation } from 'react-i18next';
import { AskAssistantButton } from '@/assistant/ui/ask-assistant-button';
import { usePageContext } from '@/assistant/ui/use-page-context';
/**
 * Add Credits Dialog (#1099)
 * OpenAI-style "Add to credit balance" modal — the in-app purchase surface.
 * (Credits also arrive via gift codes, founder grants, and
 * auto-top-up.) A saved card is charged in place; "+ Add payment method" (or
 * having no saved card) falls back to Stripe Checkout — card, Alipay or WeChat
 * Pay (#1537); a card is saved for next time. Globally mounted in AppLayout,
 * opened via openAddCreditsDialog().
 */

import { Button } from '@/ui/shadcn/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/shadcn/dialog';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { Skeleton } from '@/ui/shadcn/skeleton';
import {
  createCheckoutSessionFn,
  listPaymentMethodsFn,
  purchaseCreditsFn,
} from '@/billing/billing.fn';
import { prepareBalanceFlash, triggerBalanceFlash } from './use-balance-flash';
import {
  closeAddCreditsDialog,
  getAddCreditsSurface,
  useAddCreditsDialogOpen,
} from './use-add-credits-dialog';
import { closeBillingGate } from './use-billing-gate-dialog';
import {
  BILLING_BALANCE_KEY,
  BILLING_PAYMENT_METHODS_KEY,
} from './use-billing-balance';
import { BILLING_GATE_KEY } from './use-billing-gate';
import { useAuthSession } from '@/platform/ui/auth/session-query';
import {
  DEFAULT_TOPUP_AMOUNT_USD,
  formatPlatformFeePercent,
  MAX_TOPUP_AMOUNT_USD,
  MIN_TOPUP_AMOUNT_USD,
  splitCheckoutAmounts,
} from '@/billing/constants';
import { usePostHog } from '@posthog/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { CreditCard, ExternalLink, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ulid } from 'ulid';

/** Sentinel Select value for "pay at checkout" — new card, Alipay or WeChat Pay (#1537). */
const NEW_CARD = 'new-card';

/** Amount the dialog opens on — matches the low-balance toast's "Add $10". */
const DEFAULT_TOPUP_AMOUNT = String(DEFAULT_TOPUP_AMOUNT_USD);

function formatBrand(brand: string): string {
  return brand.charAt(0).toUpperCase() + brand.slice(1);
}

const AMOUNT_ERROR = 'Enter an amount between ${{value1}} and ${{value2}}';

export function AddCreditsDialog() {
  const translateEvent = useLiveTranslation('billing');
  const { formatNumber } = useLocaleFormatting();
  const translateLabel = useLabelTranslation('billing');
  const { t } = useTranslation('billing');

  const open = useAddCreditsDialogOpen();
  const { data: session } = useAuthSession();
  const queryClient = useQueryClient();
  const posthog = usePostHog();
  // Only a sequence page can ask what finishing costs (#2155).
  const inSequence = usePageContext().some((item) => item.kind === 'sequence');

  const [amount, setAmount] = useState(DEFAULT_TOPUP_AMOUNT);
  const [selectedPm, setSelectedPm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorMessage =
    error === AMOUNT_ERROR
      ? t(AMOUNT_ERROR, {
          value1: MIN_TOPUP_AMOUNT_USD,
          value2: formatNumber(MAX_TOPUP_AMOUNT_USD),
        })
      : error
        ? translateLabel(error)
        : null;
  /**
   * Idempotency key for the purchase. Stable across retries of the same
   * attempt (React Query resends the same variables), so a timed-out request
   * whose charge actually landed can never charge or credit a second time.
   */
  const [requestId, setRequestId] = useState(() => ulid());

  // Every "Add credits" button routes through openAddCreditsDialog(surface),
  // so one capture here covers them all (#1301).
  useEffect(() => {
    if (open) {
      posthog.capture('add_credits_clicked', {
        surface: getAddCreditsSurface(),
      });
      // The dialog is mounted once, so a previously typed amount would still
      // be sitting there — and the low-balance toast promises the min top-up (#1299).
      setAmount(DEFAULT_TOPUP_AMOUNT);
    }
  }, [open, posthog]);

  const {
    data: pmData,
    isLoading: pmLoading,
    error: pmError,
  } = useQuery({
    queryKey: [...BILLING_PAYMENT_METHODS_KEY],
    queryFn: () => listPaymentMethodsFn(),
    staleTime: 60_000,
    enabled: open && !!session,
  });

  // Sorted default-first by listPaymentMethodsFn, so [0] is the default card.
  const paymentMethods = pmData?.paymentMethods ?? [];
  const effectivePm = selectedPm ?? paymentMethods[0]?.id ?? NEW_CARD;

  const amountUsd = parseFloat(amount);
  const isValidAmount =
    !isNaN(amountUsd) &&
    amountUsd >= MIN_TOPUP_AMOUNT_USD &&
    amountUsd <= MAX_TOPUP_AMOUNT_USD;
  const breakdown = isValidAmount ? splitCheckoutAmounts(amountUsd) : null;

  const onOpenChange = (next: boolean) => {
    if (!next) {
      setError(null);
      closeAddCreditsDialog();
    }
  };

  const invalidateBilling = () => {
    void queryClient.invalidateQueries({ queryKey: [...BILLING_BALANCE_KEY] });
    void queryClient.invalidateQueries({ queryKey: [...BILLING_GATE_KEY] });
    void queryClient.invalidateQueries({ queryKey: ['billing-invoices'] });
  };

  const purchaseMutation = useMutation({
    mutationFn: (input: {
      amountUsd: number;
      paymentMethodId: string;
      requestId: string;
    }) =>
      purchaseCreditsFn({
        data: { ...input, surface: getAddCreditsSurface() || undefined },
      }),
    onSuccess: (_data, input) => {
      invalidateBilling();
      triggerBalanceFlash();
      toast.success(
        translateEvent('Added ${{value1}} to your credit balance', {
          value1: input.amountUsd.toFixed(2),
        })
      );
      onOpenChange(false);
      // This dialog often opens on top of the gate; with credits now bought,
      // leaving the gate up (it blocks Escape and outside-click) would strand
      // the user on a "you're out of credits" modal they just resolved.
      closeBillingGate();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Payment failed');
      // A new key on retry: the failed attempt's key is spent, and Stripe
      // replays the original outcome for a reused one.
      setRequestId(ulid());
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: (checkoutAmountUsd: number) =>
      createCheckoutSessionFn({
        data: {
          amountUsd: checkoutAmountUsd,
          surface: getAddCreditsSurface() || undefined,
        },
      }),
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Checkout failed');
    },
  });

  const isPending = purchaseMutation.isPending || checkoutMutation.isPending;

  const handleContinue = () => {
    if (!isValidAmount) {
      setError(AMOUNT_ERROR);
      return;
    }
    setError(null);
    const method = effectivePm === NEW_CARD ? 'checkout' : 'saved_card';
    posthog.capture('credits_topup_started', {
      amount_usd: amountUsd,
      method,
    });
    if (method === 'checkout') {
      try {
        // Suggest this amount for auto-top-up on return from Stripe
        localStorage.setItem('openstory:last-topup-amount', String(amountUsd));
      } catch {
        // Private mode / quota. This only seeds a follow-up prompt — it must
        // never stop the checkout the user actually asked for.
      }
      prepareBalanceFlash();
      checkoutMutation.mutate(amountUsd);
      return;
    }
    purchaseMutation.mutate({
      amountUsd,
      paymentMethodId: effectivePm,
      requestId,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('Add to credit balance')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('Buy credits with a saved card or at checkout.')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="add-credits-amount">{t('Amount to add')}</Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              $
            </span>
            <Input
              id="add-credits-amount"
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => {
                setAmount(e.target.value.replace(/[^0-9.]/g, ''));
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleContinue();
              }}
              className="pl-7 tabular-nums"
              autoComplete="off"
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {t('Enter an amount between ${{value1}} and ${{value2}}', {
                value1: MIN_TOPUP_AMOUNT_USD,
                value2: formatNumber(MAX_TOPUP_AMOUNT_USD),
              })}
            </span>
            <Link
              to="/pricing"
              onClick={() => onOpenChange(false)}
              className="inline-flex shrink-0 items-center gap-1 underline-offset-2 hover:text-foreground hover:underline"
            >
              {t('Pricing')}
              <ExternalLink className="size-3" />
            </Link>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="add-credits-payment-method">
            {t('Payment method')}
          </Label>
          {pmError ? (
            // Never render a failed fetch as "you have no saved cards" — that
            // silently pushes a returning customer back through Checkout.
            <p role="alert" className="text-xs text-destructive">
              {
                <>
                  {t("Couldn't load your saved cards")}
                  {pmError instanceof Error && <span>: {pmError.message}</span>}
                </>
              }
            </p>
          ) : pmLoading ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <Select
              value={effectivePm}
              items={[
                ...paymentMethods.map((pm) => ({
                  value: pm.id,
                  label: `${formatBrand(pm.brand)} •••• ${pm.last4}`,
                })),
                {
                  value: NEW_CARD,
                  label: t('Pay at checkout'),
                },
              ]}
              onValueChange={(value) => {
                if (value == null) return;
                setSelectedPm(value);
                setError(null);
              }}
            >
              <SelectTrigger id="add-credits-payment-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {paymentMethods.map((pm) => (
                  <SelectItem key={pm.id} value={pm.id}>
                    <CreditCard className="size-4 text-muted-foreground" />
                    {formatBrand(pm.brand)} •••• {pm.last4}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_CARD}>
                  <Plus className="size-4 text-muted-foreground" />
                  {t('Pay at checkout')}
                </SelectItem>
              </SelectContent>
            </Select>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setSelectedPm(NEW_CARD);
                setError(null);
              }}
              className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Plus className="size-3" />
              {t('Add payment method')}
            </button>
          </div>
        </div>

        {breakdown && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {t(
              "You'll be charged ${{value1}} — includes the {{value2}} platform fee.",
              {
                value1: breakdown.totalUsd.toFixed(2),
                value2: formatPlatformFeePercent(),
              }
            )}
          </p>
        )}

        {error && (
          <p role="alert" className="text-xs text-destructive">
            {errorMessage}
          </p>
        )}

        <DialogFooter>
          {inSequence && (
            <AskAssistantButton
              context={[]}
              variant="ghost"
              size="default"
              onOpen={() => onOpenChange(false)}
            />
          )}
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t('Cancel')}
          </Button>
          {/* pmLoading gates submit: until the cards land, effectivePm is
              NEW_CARD, so an early click would bounce a saved-card customer
              out to Checkout. */}
          <Button
            onClick={handleContinue}
            disabled={!isValidAmount || isPending || pmLoading}
          >
            {isPending ? t('Processing…') : t('Continue')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
