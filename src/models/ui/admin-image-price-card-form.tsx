import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { generateId } from '@/platform/id';
import { IMAGE_PRICE_LIMITS } from '@/models/image-channel-pricing';
import type { ImageChannelPriceCard } from '@/models/image-channel-pricing';
import { Button } from '@/ui/shadcn/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/shadcn/card';
import {
  AdminImageCheckbox,
  AdminImageInput,
  AdminImageSelect,
  AdminImageTextarea,
} from './admin-image-channels-fields';
import {
  IMAGE_FORM_MINIMUM,
  IMAGE_FORM_NUMBER_STEP,
  IMAGE_FORM_TEXT_ROWS,
  IMAGE_OPERATION_OPTIONS,
} from './admin-image-channels-state';

type PriceRow = { id: string; card?: ImageChannelPriceCard };

export function AdminImagePriceCardForm({
  priceCards,
}: {
  priceCards: ImageChannelPriceCard[];
}) {
  const { t } = useTranslation('imageChannels');
  const [rows, setRows] = useState<PriceRow[]>(() =>
    priceCards.map((card) => ({ id: card.id, card }))
  );
  return (
    <Card>
      <ImagePriceCardHeader />
      <CardContent className="flex flex-col gap-5">
        {rows.map((row, index) => (
          <ImagePriceRow
            key={row.id}
            row={row}
            index={index}
            onRemove={() =>
              setRows((current) => current.filter((item) => item.id !== row.id))
            }
          />
        ))}
        {!rows.length && (
          <p className="text-sm text-muted-foreground">
            {t(
              'No price cards configured. A verified operation needs a price before enabling the model.'
            )}
          </p>
        )}
        <div>
          <Button
            className="min-h-11 sm:min-h-8"
            type="button"
            variant="outline"
            disabled={rows.length >= IMAGE_PRICE_LIMITS.cards}
            onClick={() =>
              setRows((current) => [...current, { id: generateId() }])
            }
          >
            {t('Add price card')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ImagePriceRow(props: {
  row: PriceRow;
  index: number;
  onRemove: () => void;
}) {
  const { t } = useTranslation('imageChannels');
  return (
    <fieldset className="flex min-w-0 flex-col gap-4 rounded-lg border p-4">
      <legend className="px-2 font-medium">
        {t('Price card {{number}}', { number: props.index + 1 })}
      </legend>
      <input type="hidden" name="priceId" value={props.row.id} />
      <PriceAmountFields row={props.row} />
      <PriceMatchField row={props.row} />
      <SupplierCostFields row={props.row} />
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={props.onRemove}>
          {t('Remove price card')}
        </Button>
      </div>
    </fieldset>
  );
}

function PriceAmountFields({ row }: { row: PriceRow }) {
  const prefix = 'price.' + row.id + '.';
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <AdminImageSelect
        translateOptions
        name={prefix + 'operation'}
        label="Priced operation"
        defaultValue={row.card?.operation ?? 'generate'}
        options={IMAGE_OPERATION_OPTIONS}
      />
      <AdminImageInput
        name={prefix + 'unitPriceUsd'}
        label="USD per image"
        type="number"
        inputMode="decimal"
        step={IMAGE_FORM_NUMBER_STEP}
        min={IMAGE_FORM_MINIMUM}
        max={IMAGE_PRICE_LIMITS.maximumUsd}
        defaultValue={row.card?.unitPriceUsd}
        required
      />
    </div>
  );
}

function PriceMatchField({ row }: { row: PriceRow }) {
  return (
    <AdminImageTextarea
      name={'price.' + row.id + '.match'}
      label="Specification match (JSON)"
      rows={IMAGE_FORM_TEXT_ROWS}
      defaultValue={JSON.stringify(row.card?.match ?? {}, null, 2)}
      spellCheck={false}
      hint='Use a JSON object such as {"size":"1024x1024","quality":"high"}. Values must match configured parameters. An empty object is the fallback price; the most specific match wins, and ties are rejected.'
    />
  );
}

function SupplierCostFields({ row }: { row: PriceRow }) {
  const prefix = 'price.' + row.id + '.';
  return (
    <div className="flex flex-col gap-3">
      <AdminImageCheckbox
        name={prefix + 'supplierCost'}
        label="Record supplier cost separately"
        defaultChecked={!!row.card?.supplierCost}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminImageInput
          name={prefix + 'currency'}
          label="Supplier currency"
          defaultValue={row.card?.supplierCost?.currency ?? 'USD'}
          maxLength={IMAGE_PRICE_LIMITS.currencyLength}
          hint="Use an uppercase three-letter currency code. Supplier cost is not the user charge."
        />
        <AdminImageInput
          name={prefix + 'unitCost'}
          label="Supplier cost per image"
          type="number"
          inputMode="decimal"
          step={IMAGE_FORM_NUMBER_STEP}
          min={IMAGE_FORM_MINIMUM}
          max={IMAGE_PRICE_LIMITS.maximumUsd}
          defaultValue={row.card?.supplierCost?.unitPrice}
        />
      </div>
    </div>
  );
}

function ImagePriceCardHeader() {
  const { t } = useTranslation('imageChannels');
  return (
    <CardHeader>
      <CardTitle>{t('USD price cards')}</CardTitle>
      <CardDescription>
        {t(
          'Set the platform charge per returned image. Existing organization wallets and USD accounting are used.'
        )}
      </CardDescription>
    </CardHeader>
  );
}
