import { useTranslation } from 'react-i18next';
import { IMAGE_PARAMETER_LIMITS } from '@/models/image-channel-parameters';
import type { ImageOperation } from '@/models/image-channel-parameters';
import type { ImageOperationBinding } from '@/models/image-channels';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/shadcn/card';
import {
  AdminImageInput,
  AdminImageCheckbox,
  AdminImageSelect,
} from './admin-image-channels-fields';
import {
  IMAGE_FORM_INTEGER_STEP,
  IMAGE_FORM_MINIMUM,
  IMAGE_VERIFICATION_OPTIONS,
} from './admin-image-channels-state';

type OperationProps = {
  operation: ImageOperation;
  binding?: ImageOperationBinding;
  locked?: boolean;
};

export function AdminImageOperationFields(props: OperationProps) {
  const { t } = useTranslation('imageChannels');
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {props.operation === 'generate'
            ? t('Generation binding')
            : t('Editing binding')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <AdminImageCheckbox
          name={props.operation + '.configured'}
          label="Configure this operation"
          defaultChecked={!!props.binding}
          disabled={props.locked}
        />
        {props.locked && (
          <input
            type="hidden"
            name={props.operation + '.configured'}
            value="on"
          />
        )}
        <OperationBindingFields {...props} />
        {props.operation === 'edit' && <ReferenceCapabilityFields {...props} />}
        <p className="text-sm text-muted-foreground">
          {t(
            'Only verified operations are available to users. Accepting a field does not prove the provider applies it.'
          )}
        </p>
      </CardContent>
    </Card>
  );
}

function OperationBindingFields({
  operation,
  binding,
  locked,
}: OperationProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <AdminImageInput
        name={operation + '.upstreamModel'}
        label="Exact upstream model ID"
        defaultValue={binding?.upstreamModel ?? ''}
        readOnly={locked}
      />
      <AdminImageSelect
        translateOptions
        name={operation + '.status'}
        label="Operation verification"
        defaultValue={binding?.status ?? 'unverified'}
        options={IMAGE_VERIFICATION_OPTIONS}
      />
    </div>
  );
}

function ReferenceCapabilityFields({ operation, binding }: OperationProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <AdminImageInput
        name={operation + '.minimum'}
        label="Minimum reference images"
        type="number"
        step={IMAGE_FORM_INTEGER_STEP}
        min={IMAGE_FORM_INTEGER_STEP}
        max={IMAGE_PARAMETER_LIMITS.maximumImages}
        defaultValue={binding?.minReferenceImages ?? IMAGE_FORM_INTEGER_STEP}
      />
      <AdminImageInput
        name={operation + '.maximum'}
        label="Maximum reference images"
        type="number"
        step={IMAGE_FORM_INTEGER_STEP}
        min={IMAGE_FORM_MINIMUM}
        max={IMAGE_PARAMETER_LIMITS.maximumImages}
        defaultValue={binding?.maxReferenceImages ?? IMAGE_FORM_INTEGER_STEP}
      />
      <AdminImageSelect
        translateOptions
        name={operation + '.mask'}
        label="Mask verification"
        defaultValue={binding?.mask ?? 'unverified'}
        options={IMAGE_VERIFICATION_OPTIONS}
      />
    </div>
  );
}
