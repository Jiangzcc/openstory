import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AdminModelsPage } from '@/models/ui/admin-models-page';

export const Route = createFileRoute('/_app/admin/models')({
  component: AdminModelsPage,
  staticData: {
    breadcrumb: { label: <ModelConfigurationBreadcrumb /> },
  },
});

function ModelConfigurationBreadcrumb() {
  const { t } = useTranslation('admin');
  return t('Model configuration');
}
