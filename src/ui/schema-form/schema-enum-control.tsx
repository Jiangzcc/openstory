import type { JsonValue } from '@/models/catalog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/shadcn/select';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';
import type { FC } from 'react';
import { useTranslation } from 'react-i18next';

type EnumControlProps = {
  options: JsonValue[];
  value: JsonValue | undefined;
  onChange: (value: JsonValue | undefined) => void;
  required: boolean;
  disabled: boolean;
  id: string;
  labelId: string;
};

export function optionLabel(option: JsonValue): string {
  return typeof option === 'string' ? option : JSON.stringify(option);
}

export const EnumChips: FC<EnumControlProps> = ({
  options,
  value,
  onChange,
  disabled,
  labelId,
}) => {
  const selected = options.findIndex((option) => option === value);
  return (
    <ToggleGroup
      type="single"
      aria-labelledby={labelId}
      value={selected === -1 ? '' : String(selected)}
      onValueChange={(next) => {
        if (next === '') {
          onChange(undefined);
          return;
        }
        const option = options[Number(next)];
        if (option !== undefined) onChange(option);
      }}
      disabled={disabled}
      className="flex flex-wrap justify-start"
    >
      {options.map((option, index) => (
        <ToggleGroupItem
          key={optionLabel(option)}
          value={String(index)}
          className="rounded-full"
        >
          {optionLabel(option)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
};

export const EnumSelect: FC<EnumControlProps> = ({
  options,
  value,
  onChange,
  required,
  disabled,
  id,
}) => {
  const { t } = useTranslation('interface');

  const selected = options.findIndex((option) => option === value);
  const enumItems = [
    ...(!required ? [{ value: 'omit', label: t('Model default') }] : []),
    ...options.map((option, index) => ({
      value: String(index),
      label: optionLabel(option),
    })),
  ];
  return (
    <Select
      value={
        selected === -1 ? (required ? undefined : 'omit') : String(selected)
      }
      items={enumItems}
      onValueChange={(next) => {
        if (next === 'omit') {
          onChange(undefined);
          return;
        }
        const option = options[Number(next)];
        if (option !== undefined) onChange(option);
      }}
      disabled={disabled}
    >
      <SelectTrigger id={id} className="w-full sm:max-w-xs">
        <SelectValue
          placeholder={required ? t('Choose…') : t('Model default')}
        />
      </SelectTrigger>
      <SelectContent>
        {enumItems.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
