import type { Database } from '@/platform/server/db/client';
import { deliverStoryboardNotification } from './storyboard-notifications';
import {
  createStoryboardNotificationMethods,
  deleteObsoleteStoryboardNotifications,
  listPendingStoryboardNotifications,
} from './db/storyboard-notifications';

const MAX_NOTIFICATIONS_PER_PASS = 100;

export async function reconcileStoryboardNotifications(
  db: Database,
  limit = MAX_NOTIFICATIONS_PER_PASS
): Promise<number> {
  await deleteObsoleteStoryboardNotifications(db, MAX_NOTIFICATIONS_PER_PASS);
  const receipts = await listPendingStoryboardNotifications(db, limit);
  const failures: unknown[] = [];
  let delivered = 0;
  for (const receipt of receipts) {
    try {
      const methods = createStoryboardNotificationMethods(
        db,
        receipt.organizationId
      );
      const confirmed = await deliverStoryboardNotification(methods, {
        id: receipt.sequenceId,
        workflowRunId: receipt.workflowRunId,
      });
      if (confirmed) delivered++;
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new AggregateError(
      failures,
      'Pending storyboard notification delivery failed'
    );
  return delivered;
}
