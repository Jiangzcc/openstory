import { Badge } from '@/ui/shadcn/badge';
import { Skeleton } from '@/ui/shadcn/skeleton';
import { getAnalysisModelById } from '@/models/models.config';
import { useTextModelCatalog } from '../use-text-model-catalog';

const PRIMARY_MODEL_MAX_RANK = 4;

export const ModelBadge = ({ model }: { model?: string }) => {
  const { models } = useTextModelCatalog();
  if (!model) {
    return <Skeleton className="w-[100px] h-[20px]" />;
  }

  const definition = getAnalysisModelById(model, models);
  return (
    <Badge
      variant={
        (definition?.qualityRank ?? Number.POSITIVE_INFINITY) <=
        PRIMARY_MODEL_MAX_RANK
          ? 'default'
          : 'secondary'
      }
      className="text-xs"
    >
      {definition?.name || model}
    </Badge>
  );
};
