import { useTranslation } from 'react-i18next';
import { useImageModelCatalog } from '@/models/ui/use-image-model-catalog';
import { imageCostHint } from '../image-cost-hint';
import type { ImageCostHintInput } from '../image-cost-hint';
import { useFalPricing } from './use-fal-pricing';

export function useImageCostHint(input: ImageCostHintInput) {
  const { models } = useImageModelCatalog();
  const { pricing, isPending } = useFalPricing();
  const { t } = useTranslation('imageChannels');
  const hint = imageCostHint(input, models, pricing, isPending);
  return { estimate: hint.estimate, issue: hint.issue ? t(hint.issue) : null };
}
