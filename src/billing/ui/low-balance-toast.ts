/**
 * Low-balance toast (#1299).
 *
 * The toast carries the offer — "Add $N" (min top-up) as the primary action, with the
 * gate's other paths (BYOK, gift codes, founder credits) on Sonner's `cancel`
 * slot. Separated from `useLowBalanceWarning` so the copy and both buttons
 * are viewable in Storybook without a real balance drop; the hook owns when
 * it fires, the analytics, and what the buttons open.
 */

import { DEFAULT_TOPUP_AMOUNT_USD } from '@/billing/constants';
import type { CSSProperties } from 'react';
import { toast } from 'sonner';
import type { i18n as I18n } from 'i18next';

export type LowBalanceToastProps = {
  balanceUsd: number;
  isZeroBalance: boolean;
  /** Live estimate for another default short — see `typicalShortCostUsd`. */
  runCostUsd: number;
  onAddCredits: () => void;
  onOtherOptions: () => void;
};

export function showLowBalanceToast(
  {
    balanceUsd,
    isZeroBalance,
    runCostUsd,
    onAddCredits,
    onOtherOptions,
  }: LowBalanceToastProps,
  i18n: I18n
) {
  const t = i18n.getFixedT(null, 'billing');
  const action = {
    label: t('Add ${{amount}}', { amount: DEFAULT_TOPUP_AMOUNT_USD }),
    onClick: onAddCredits,
  };
  const cancel = { label: t('Other options'), onClick: onOtherOptions };
  // Two buttons on one toast squeeze the text column to ~4 wrapped lines at
  // Sonner's default 356px. Widened here rather than on the Toaster — every
  // other toast in the app has at most one action. Sonner reads `--width`;
  // setting `width` directly would beat its <600px "fill the screen" rule.
  const style: CSSProperties & { '--width': string } = { '--width': '440px' };

  if (isZeroBalance) {
    toast.error(t('Your credit balance is $0'), {
      id: 'low-balance',
      description: t('Generation is off until you add credits.'),
      action,
      cancel,
      style,
      duration: 10_000,
    });
    return;
  }

  toast.warning(
    t('Balance is ${{amount}}', { amount: balanceUsd.toFixed(2) }),
    {
      id: 'low-balance',
      description: t('Another short is about ${{amount}}.', {
        amount: Math.round(runCostUsd),
      }),
      action,
      cancel,
      style,
      duration: 8_000,
    }
  );
}
