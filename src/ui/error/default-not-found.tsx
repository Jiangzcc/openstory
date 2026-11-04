import { useTranslation } from 'react-i18next';
import { Button } from '@/ui/shadcn/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/ui/shadcn/empty';
import { Link } from '@tanstack/react-router';
import { SearchX } from 'lucide-react';

export const DefaultNotFound: React.FC = () => {
  const { t } = useTranslation('interface');

  return (
    <Empty className="flex-1">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX />
        </EmptyMedia>
        <EmptyTitle>{t('Page not found')}</EmptyTitle>
        <EmptyDescription>
          {t(
            "The page you're looking for doesn't exist or you don't have access to it."
          )}
        </EmptyDescription>
      </EmptyHeader>
      <Button variant="outline" size="sm" asChild>
        <Link to="/">{t('Go home')}</Link>
      </Button>
    </Empty>
  );
};
