import { useTranslation } from 'react-i18next';
import { microsToUsd } from '@/billing/money';
import { useShowCosts } from '@/billing/ui/use-show-costs';
import { Button } from '@/ui/shadcn/button';
import { Input } from '@/ui/shadcn/input';
import { Label } from '@/ui/shadcn/label';
import { Separator } from '@/ui/shadcn/separator';
import type { ConfiguredImageControls as ImageControls } from './use-configured-image-controls';

type ControlsProps = { controls: ImageControls; formId: string };

export function ConfiguredImageControls({ controls, formId }: ControlsProps) {
  if (!controls.maskSupported && !controls.maskInput) return null;
  return (
    <>
      <Separator />
      <section className="flex flex-col gap-4" data-studio-image-controls>
        <ImageMaskControl controls={controls} formId={formId} />
      </section>
    </>
  );
}

function ImageMaskControl({ controls, formId }: ControlsProps) {
  const { t } = useTranslation('imageChannels');
  const inputId = formId + '-mask';
  return (
    <div className="flex flex-col gap-3">
      <Label htmlFor={inputId}>{t('Mask image URL')}</Label>
      <Input
        id={inputId}
        name="maskImageUrl"
        form={formId}
        autoComplete="off"
        inputMode="url"
        className="min-h-11 text-base md:text-base"
        value={controls.maskInput}
        onChange={(event) =>
          controls.setMaskImageUrl(event.currentTarget.value)
        }
      />
      <p className="text-xs text-muted-foreground">
        {t(
          'Use a PNG mask with the same dimensions as the first reference image.'
        )}
      </p>
      {controls.maskSupported && (
        <ImageMaskUpload controls={controls} formId={formId} />
      )}
      {(controls.maskInput || controls.issue) && (
        <Button
          type="button"
          variant="outline"
          onClick={() => controls.setMaskImageUrl('')}
        >
          {t('Remove mask')}
        </Button>
      )}
    </div>
  );
}

function ImageMaskUpload({ controls, formId }: ControlsProps) {
  const { t } = useTranslation('imageChannels');
  const id = formId + '-mask-file';
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{t('Upload PNG mask')}</Label>
      <Input
        id={id}
        type="file"
        accept="image/png,.png"
        className="min-h-11 text-base md:text-base"
        disabled={controls.uploadingMask}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) controls.chooseMaskFile(file);
          event.currentTarget.value = '';
        }}
      />
      {controls.uploadingMask && (
        <output className="text-xs text-muted-foreground">
          {t('Uploading mask…')}
        </output>
      )}
    </div>
  );
}

export function ConfiguredImageStatus({
  controls,
}: {
  controls: ImageControls;
}) {
  const { t } = useTranslation('imageChannels');
  if (!controls.issue) return null;
  return (
    <output aria-live="polite" className="text-sm text-destructive">
      {t(controls.issue.key, {
        defaultValue: controls.issue.key,
        ...controls.issue.values,
      })}
    </output>
  );
}

function imageCostFormatter(locale?: string) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}

export function ConfiguredImageEstimate({
  controls,
}: {
  controls: ImageControls;
}) {
  const { t, i18n } = useTranslation('billing');
  const { showCosts } = useShowCosts();
  if (
    !showCosts ||
    !controls.isConfigured ||
    controls.issue ||
    !controls.quote ||
    controls.estimate === null
  )
    return null;
  const format = imageCostFormatter(i18n.resolvedLanguage);
  const totalPrice = format.format(microsToUsd(controls.estimate));
  return (
    <output
      aria-label={t('Estimated cost about {{value1}}', { value1: totalPrice })}
      aria-live="polite"
      className="text-xs text-muted-foreground tabular-nums"
    >
      ~{totalPrice}
    </output>
  );
}
