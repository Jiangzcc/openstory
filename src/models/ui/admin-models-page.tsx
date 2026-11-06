import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { AdminImageChannels } from './admin-image-channels';
import { AdminModelConfiguration } from './admin-model-configuration';
import { AdminTextChannels } from './admin-text-channels';

export const ADMIN_MODELS_TABS = [
  'defaults',
  'text-channels',
  'image-channels',
] as const;

const MODEL_PANELS = [
  {
    value: 'defaults',
    label: 'Defaults and internal models',
    namespace: 'admin',
    Component: AdminModelConfiguration,
  },
  {
    value: 'text-channels',
    label: 'Text channels',
    namespace: 'admin',
    Component: AdminTextChannels,
  },
  {
    value: 'image-channels',
    label: 'Image channels',
    namespace: 'imageChannels',
    Component: AdminImageChannels,
  },
] as const;

interface AdminModelsPageProps {
  tab?: (typeof ADMIN_MODELS_TABS)[number];
  onTabChange?: (tab: string) => void;
}

export function AdminModelsPage({
  tab = 'defaults',
  onTabChange,
}: AdminModelsPageProps) {
  const { t } = useTranslation(['admin', 'imageChannels']);
  return (
    <Tabs
      value={tab}
      onValueChange={onTabChange}
      className="relative flex min-h-0 flex-1 flex-col gap-6 overflow-hidden"
    >
      <TabsList
        aria-label={t('Model administration')}
        className="h-auto w-full max-w-full shrink-0 group-data-horizontal/tabs:h-auto sm:w-fit"
      >
        {MODEL_PANELS.map(({ value, label, namespace }) => (
          <TabsTrigger
            key={value}
            value={value}
            className="min-h-11 min-w-0 px-3 whitespace-normal data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm sm:flex-none sm:whitespace-nowrap md:min-h-8"
          >
            {t(label, { ns: namespace })}
          </TabsTrigger>
        ))}
      </TabsList>
      {MODEL_PANELS.map(({ value, Component }) => (
        <TabsContent
          key={value}
          value={value}
          forceMount
          className="flex min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden"
        >
          <Component />
        </TabsContent>
      ))}
    </Tabs>
  );
}
