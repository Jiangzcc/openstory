import { useTranslation } from 'react-i18next';
import { AspectRatioIcon } from '@/ui/icons/aspect-ratio-icon';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';
import {
  ASPECT_RATIOS,
  aspectRatioSchema,
  type AspectRatio,
} from '@/models/aspect-ratios';
import type { FC } from 'react';

function isValidAspectRatio(value: string): value is AspectRatio {
  return aspectRatioSchema.safeParse(value).success;
}

type AspectRatioPillsProps = {
  value: AspectRatio;
  onChange: (value: AspectRatio) => void;
  available?: readonly AspectRatio[];
};

export const AspectRatioPills: FC<AspectRatioPillsProps> = ({
  value,
  onChange,
  available,
}) => {
  const { t } = useTranslation('interface');
  const options = ASPECT_RATIOS.filter(
    (ratio) => !available || available.includes(ratio.value)
  );
  if (available && options.length === 1)
    return (
      <p className="text-[10px] text-muted-foreground">{options[0]?.label}</p>
    );

  return (
    <ToggleGroup
      type="single"
      value={value}
      onValueChange={(val) => {
        if (
          val &&
          isValidAspectRatio(val) &&
          (!available || available.includes(val))
        ) {
          onChange(val);
        }
      }}
      variant="outline"
      spacing={0}
      className="w-full min-w-0 flex-nowrap justify-start"
    >
      {options.map((ratio) => (
        <ToggleGroupItem
          key={ratio.value}
          value={ratio.value}
          className="flex h-9 min-w-0 flex-1 shrink items-center justify-center gap-2 px-2 sm:px-3"
          aria-label={t('{{value1}} aspect ratio', { value1: ratio.label })}
        >
          <AspectRatioIcon
            width={ratio.width}
            height={ratio.height}
            size="sm"
          />
          <span className="font-mono text-xs">{ratio.label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
};
