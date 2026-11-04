import { HistoryPage, HistorySkeleton } from '@/sequences/ui/history-page';
import { createFileRoute } from '@tanstack/react-router';
import { Suspense } from 'react';

export const Route = createFileRoute('/_app/sequences/$id/history')({
  component: HistoryRoute,
  staticData: { breadcrumb: { label: 'History', translationKey: 'History' } },
});

function HistoryRoute() {
  const { id } = Route.useParams();
  return (
    <Suspense fallback={<HistorySkeleton />}>
      <HistoryPage sequenceId={id} />
    </Suspense>
  );
}
