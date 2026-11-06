import { useTranslation } from 'react-i18next';
import type {
  GeneratedAsset,
  GeneratedAssetOutput,
} from '@/platform/server/db/schema';
import { AppImage } from '@/ui/shadcn/app-image';
import { buttonVariants } from '@/ui/shadcn/button';
import { studioDownloadFilename, studioDownloadHref } from './outputs';
import { studioPartialImageOutput } from './configured-image-output';
import type { StudioImageOutputAsset } from './configured-image-output';

export function StudioImageOutputStatus({
  asset,
}: {
  asset: StudioImageOutputAsset;
}) {
  const { t } = useTranslation('imageChannels');
  const partial = studioPartialImageOutput(asset);
  if (!partial) return null;
  return (
    <output
      className="flex shrink-0 flex-col gap-1 border-t bg-card p-3 text-sm"
      aria-live="polite"
    >
      <span className="font-medium">
        {t(
          'Partially completed: requested {{requested}} images, generated {{actual}}.',
          partial
        )}
      </span>
      <span className="text-xs text-muted-foreground">
        {t('Billing follows the actual number of output images.')}
      </span>
    </output>
  );
}

export function StudioImageOutputList({ asset }: { asset: GeneratedAsset }) {
  const { t } = useTranslation('imageChannels');
  if (asset.activity !== 'image' || asset.status !== 'completed') return null;
  const images = (asset.outputs ?? []).filter((image) =>
    image.contentType.startsWith('image/')
  );
  if (images.length < 2) return null;
  return (
    <section className="flex shrink-0 flex-col gap-3">
      <h3 className="text-sm font-medium">
        {t('Output images ({{count}})', { count: images.length })}
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {images.map((image, index) => (
          <StudioImageOutputTile
            key={image.url}
            image={image}
            index={index}
            assetId={asset.id}
          />
        ))}
      </div>
    </section>
  );
}

function StudioImageOutputTile({
  image,
  index,
  assetId,
}: {
  image: GeneratedAssetOutput;
  index: number;
  assetId: string;
}) {
  const { t } = useTranslation('imageChannels');
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <a
        href={image.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={t('Open image {{number}}', { number: index + 1 })}
        className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <AppImage
          src={image.url}
          alt={t('Output image {{number}}', { number: index + 1 })}
          width={160}
          height={160}
          className="aspect-square w-full rounded-lg object-cover"
        />
      </a>
      <a
        href={studioDownloadHref(image.url)}
        download={studioDownloadFilename(
          assetId + '-' + (index + 1),
          image.contentType
        )}
        className={buttonVariants({ variant: 'outline', size: 'sm' })}
      >
        {t('Download image {{number}}', { number: index + 1 })}
      </a>
    </div>
  );
}
