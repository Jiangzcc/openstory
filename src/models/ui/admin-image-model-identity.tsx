import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IMAGE_CHANNEL_LIMITS } from '@/models/image-channels';
import type { ChannelImageModel } from '@/models/image-channels';
import { isBuiltinTextToImageModel } from '@/models/models';
import {
  AdminImageInput,
  AdminImageSelect,
} from './admin-image-channels-fields';
import {
  CUSTOM_IMAGE_MODEL_OPTION,
  imageModelBindingIdentity,
  imageModelBindingOptions,
} from './admin-image-channels-state';

type IdentityProps = {
  model: ChannelImageModel;
  models: readonly ChannelImageModel[];
  isNew: boolean;
};

export function AdminImageModelIdentity({
  model,
  models,
  isNew,
}: IdentityProps) {
  const { t } = useTranslation('imageChannels');
  const [choice, setChoice] = useState(
    isBuiltinTextToImageModel(model.id) ? model.id : CUSTOM_IMAGE_MODEL_OPTION
  );
  const identity = imageModelBindingIdentity(model, choice);
  const options = [
    ...imageModelBindingOptions(models, model.id),
    { value: CUSTOM_IMAGE_MODEL_OPTION, label: t('New custom image model') },
  ];
  return (
    <>
      <AdminImageSelect
        name="modelChoice"
        label="Local image model"
        value={choice}
        options={options}
        disabled={!isNew}
        onValueChange={(value) => value && setChoice(value)}
      />
      <AdminImageIdentityInputs identity={identity} isNew={isNew} />
    </>
  );
}

function AdminImageIdentityInputs({
  identity,
  isNew,
}: {
  identity: ReturnType<typeof imageModelBindingIdentity>;
  isNew: boolean;
}) {
  return (
    <>
      <AdminImageInput
        key={identity.builtin ? identity.id : 'custom-id'}
        name="id"
        label="Stable model identifier"
        defaultValue={identity.id}
        readOnly={!isNew || identity.builtin}
        pattern={identity.builtin ? undefined : 'custom-image:.+'}
        required
        maxLength={IMAGE_CHANNEL_LIMITS.id}
      />
      <AdminImageInput
        key={identity.builtin ? identity.id + '-name' : 'custom-name'}
        name="name"
        label="Model name"
        defaultValue={identity.name}
        readOnly={identity.builtin}
        required
        maxLength={IMAGE_CHANNEL_LIMITS.name}
      />
    </>
  );
}
