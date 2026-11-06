import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLabelTranslation } from '@/ui/i18n/use-label-translation';
import { IMAGE_PARAMETER_LIMITS } from '@/models/image-channel-parameters';
import type {
  ImageChannelParameter,
  ImageOperation,
} from '@/models/image-channel-parameters';
import { generateId } from '@/platform/id';
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
  createImageParameterRow,
  IMAGE_FORM_TEXT_ROWS,
  IMAGE_FORM_NUMBER_STEP,
  IMAGE_PARAMETER_PRESETS,
  IMAGE_PARAMETER_TYPE_OPTIONS,
  IMAGE_VERIFICATION_OPTIONS,
} from './admin-image-channels-state';
import type { ImageParameterRow } from './admin-image-channels-state';

type RowProps = { row: ImageParameterRow; index: number; onRemove: () => void };
const PARAMETER_PRESET_NAME = 'parameter-preset';

export function AdminImageParameterForm(props: {
  parameters: ImageChannelParameter[];
  operations: ImageOperation[];
}) {
  const { t } = useTranslation('imageChannels');
  const translate = useLabelTranslation('imageChannels');
  const [rows, setRows] = useState<ImageParameterRow[]>(() =>
    props.parameters.map((parameter) => ({ rowId: generateId(), parameter }))
  );
  const add = (preset: string) => {
    const row = createImageParameterRow(preset);
    row.parameter.label = translate(row.parameter.label);
    row.parameter.operations = props.operations.length
      ? props.operations
      : ['generate'];
    setRows((current) => [...current, row]);
  };
  return (
    <Card>
      <ImageParameterHeader />
      <CardContent className="flex flex-col gap-5">
        {rows.map((row, index) => (
          <ImageParameterRowFields
            key={row.rowId}
            row={row}
            index={index}
            onRemove={() =>
              setRows((current) =>
                current.filter((item) => item.rowId !== row.rowId)
              )
            }
          />
        ))}
        {!rows.length && (
          <p className="text-sm text-muted-foreground">
            {t('No parameters configured.')}
          </p>
        )}
        <ParameterAddControl
          onAdd={add}
          disabled={rows.length >= IMAGE_PARAMETER_LIMITS.definitions}
        />
      </CardContent>
    </Card>
  );
}

function ParameterAddControl(props: {
  onAdd: (preset: string) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation('imageChannels');
  return (
    <div className="flex flex-wrap items-end gap-3">
      <AdminImageSelect
        translateOptions
        name={PARAMETER_PRESET_NAME}
        label="Parameter template"
        defaultValue="size"
        options={IMAGE_PARAMETER_PRESETS.map((item) => ({
          value: item.key || 'custom',
          label: item.label,
        }))}
      />
      <Button
        className="min-h-11 sm:min-h-8"
        type="button"
        variant="outline"
        disabled={props.disabled}
        onClick={(event) => {
          const form = event.currentTarget.form;
          if (!form) return;
          const preset = new FormData(form).get(PARAMETER_PRESET_NAME);
          props.onAdd(
            typeof preset === 'string' && preset !== 'custom' ? preset : ''
          );
        }}
      >
        {t('Add parameter')}
      </Button>
    </div>
  );
}

function ImageParameterRowFields({ row, index, onRemove }: RowProps) {
  const { t } = useTranslation('imageChannels');
  return (
    <fieldset className="flex min-w-0 flex-col gap-4 rounded-lg border p-4">
      <legend className="px-2 font-medium">
        {t('Parameter {{number}}', { number: index + 1 })}
      </legend>
      <input type="hidden" name="parameterId" value={row.rowId} />
      <ParameterIdentity row={row} />
      <ParameterOperationFields row={row} />
      <ParameterValueFields row={row} />
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={onRemove}>
          {t('Remove parameter')}
        </Button>
      </div>
    </fieldset>
  );
}

function ParameterIdentity({ row }: { row: ImageParameterRow }) {
  const prefix = 'parameter.' + row.rowId + '.';
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <AdminImageInput
        name={prefix + 'key'}
        label="Wire parameter name"
        defaultValue={row.parameter.key}
        required
        maxLength={IMAGE_PARAMETER_LIMITS.key}
        hint="Use the exact provider field name. Model, prompt, reference images and mask are managed by the adapter."
      />
      <AdminImageInput
        name={prefix + 'label'}
        label="Display label"
        defaultValue={row.parameter.label}
        required
        maxLength={IMAGE_PARAMETER_LIMITS.label}
      />
      <AdminImageSelect
        translateOptions
        name={prefix + 'type'}
        label="Value type"
        defaultValue={row.parameter.type}
        options={IMAGE_PARAMETER_TYPE_OPTIONS}
      />
      <AdminImageSelect
        translateOptions
        name={prefix + 'status'}
        label="Parameter verification"
        defaultValue={row.parameter.status}
        options={IMAGE_VERIFICATION_OPTIONS}
      />
    </div>
  );
}

function ParameterOperationFields({ row }: { row: ImageParameterRow }) {
  const prefix = 'parameter.' + row.rowId + '.';
  return (
    <div className="flex flex-wrap gap-4">
      <AdminImageCheckbox
        name={prefix + 'generate'}
        label="Applies to generation"
        defaultChecked={row.parameter.operations.includes('generate')}
      />
      <AdminImageCheckbox
        name={prefix + 'edit'}
        label="Applies to editing"
        defaultChecked={row.parameter.operations.includes('edit')}
      />
      <AdminImageCheckbox
        name={prefix + 'required'}
        label="Required parameter"
        defaultChecked={row.parameter.required}
      />
    </div>
  );
}

function ParameterValueFields({ row }: { row: ImageParameterRow }) {
  const prefix = 'parameter.' + row.rowId + '.';
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <AdminImageCheckbox
          name={prefix + 'useDefault'}
          label="Send a default value"
          defaultChecked={row.parameter.defaultValue !== undefined}
        />
        <AdminImageInput
          name={prefix + 'default'}
          label="Default value"
          defaultValue={String(row.parameter.defaultValue ?? '')}
          hint="Numbers use decimal notation. Boolean values must be true or false."
        />
        <AdminImageInput
          name={prefix + 'minimum'}
          label="Minimum value (numbers only)"
          type="number"
          step={IMAGE_FORM_NUMBER_STEP}
          defaultValue={row.parameter.minimum}
        />
        <AdminImageInput
          name={prefix + 'maximum'}
          label="Maximum value (numbers only)"
          type="number"
          step={IMAGE_FORM_NUMBER_STEP}
          defaultValue={row.parameter.maximum}
        />
      </div>
      <AdminImageTextarea
        name={prefix + 'values'}
        label="Allowed values (optional)"
        defaultValue={row.parameter.values?.map(String).join('\n') ?? ''}
        rows={IMAGE_FORM_TEXT_ROWS}
        hint="One value per line, converted using the selected type. Leave blank for an unrestricted value or numeric range. Image count and compression need an enum or a bounded range."
      />
    </>
  );
}

function ImageParameterHeader() {
  const { t } = useTranslation('imageChannels');
  return (
    <CardHeader>
      <CardTitle>{t('Dynamic parameters')}</CardTitle>
      <CardDescription>
        {t(
          'Add standard or custom scalar parameters. Only verified definitions enter the user model catalog.'
        )}
      </CardDescription>
    </CardHeader>
  );
}
