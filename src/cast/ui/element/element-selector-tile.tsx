import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';
import type { SequenceElementKind } from '@/cast/element-kind';
import { Button } from '@/ui/shadcn/button';
import { ElementThumbnail } from './element-thumbnail';
import { ElementTokenButton } from './element-token-button';

export type ElementSelectorItem = {
  key: string;
  mediaKind: SequenceElementKind;
  imageUrl: string | null;
  token?: string;
  status: 'uploading' | 'analyzing' | 'done' | 'error';
  errorMessage?: string;
};

type ElementSelectorTileProps = {
  item: ElementSelectorItem;
  affectedShotCount: number;
  onRename?: (next: string) => Promise<void>;
  onRemove: () => void;
};

function ElementSelectorStatus({ item }: { item: ElementSelectorItem }) {
  const { t } = useTranslation('cast');
  if (item.status === 'error') {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-destructive/70 px-1 text-center text-[10px] font-medium text-white">
        {item.errorMessage ?? t('Failed')}
      </div>
    );
  }
  if (item.status !== 'uploading' && item.status !== 'analyzing') return null;
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/50">
      <Loader2 className="size-5 animate-spin text-white" />
      {item.status === 'analyzing' && (
        <span className="text-[10px] font-medium text-white">
          {t('Analyzing…')}
        </span>
      )}
    </div>
  );
}

export function ElementSelectorTile({
  item,
  affectedShotCount,
  onRename,
  onRemove,
}: ElementSelectorTileProps) {
  const { t } = useTranslation('cast');
  return (
    <div className="relative aspect-square overflow-hidden rounded-md group">
      <ElementThumbnail
        kind={item.mediaKind}
        url={item.imageUrl}
        label={item.token ?? t('Element')}
        fit="cover"
      />
      <ElementSelectorStatus item={item} />
      {item.status === 'done' && item.token && onRename && (
        <ElementTokenButton
          token={item.token}
          onRename={onRename}
          affectedShotCount={affectedShotCount}
        />
      )}
      <Button
        type="button"
        variant="destructive"
        size="icon"
        onClick={onRemove}
        className="absolute top-1 right-1 size-5 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}
