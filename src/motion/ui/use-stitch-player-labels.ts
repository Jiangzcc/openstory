import type { StitchedPlayerProps } from '@openstory/stitch/react';
import { useTranslation } from 'react-i18next';

export function useStitchPlayerLabels(): StitchedPlayerProps['labels'] {
  const { t } = useTranslation('motion');
  return {
    playback: t('Sequence playback'),
    download: t('Download'),
    exporting: (percent) => t('Exporting… {{percent}}%', { percent }),
  };
}
