import { useTranslation } from 'react-i18next';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { AdminModelConfiguration } from './admin-model-configuration';
import { AdminTextChannels } from './admin-text-channels';

export function AdminModelsPage() {
  const { t } = useTranslation('admin');
  return (
    <Tabs
      defaultValue="defaults"
      className="relative flex min-h-0 flex-1 flex-col gap-6 overflow-hidden"
    >
      <TabsList
        aria-label={t('Model administration')}
        className="h-auto w-full max-w-full shrink-0 group-data-horizontal/tabs:h-auto sm:w-fit"
      >
        <TabsTrigger
          value="defaults"
          className="min-h-11 min-w-0 px-3 whitespace-normal data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm md:min-h-8"
        >
          {t('Defaults and internal models')}
        </TabsTrigger>
        <TabsTrigger
          value="text-channels"
          className="min-h-11 min-w-0 px-3 whitespace-normal data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm md:min-h-8"
        >
          {t('Text channels')}
        </TabsTrigger>
      </TabsList>
      <TabsContent
        value="defaults"
        forceMount
        className="flex min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden"
      >
        <AdminModelConfiguration />
      </TabsContent>
      <TabsContent
        value="text-channels"
        forceMount
        className="flex min-h-0 flex-col overflow-hidden data-[state=inactive]:hidden"
      >
        <AdminTextChannels />
      </TabsContent>
    </Tabs>
  );
}
