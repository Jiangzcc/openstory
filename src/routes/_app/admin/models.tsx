import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import {
  ADMIN_MODELS_TABS,
  AdminModelsPage,
} from '@/models/ui/admin-models-page';

export const Route = createFileRoute('/_app/admin/models')({
  validateSearch: z.object({
    tab: z.enum(ADMIN_MODELS_TABS).catch('defaults').default('defaults'),
  }),
  component: ModelConfigurationPage,
  staticData: {
    breadcrumb: { label: <ModelConfigurationBreadcrumb /> },
  },
});

function ModelConfigurationPage() {
  const { tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <AdminModelsPage
      tab={tab}
      onTabChange={(value) => {
        const nextTab = ADMIN_MODELS_TABS.find(
          (candidate) => candidate === value
        );
        if (nextTab) {
          void navigate({
            search: (previous) => ({ ...previous, tab: nextTab }),
            resetScroll: false,
          });
        }
      }}
    />
  );
}

function ModelConfigurationBreadcrumb() {
  const { t } = useTranslation('admin');
  return t('Model configuration');
}
