import { getGenerationChannel } from '@/platform/realtime';
import type { WorkflowScopedDb } from '@/platform/server/db/scoped-workflow';
import type { StoryboardOwner } from './db/storyboard-owner';

type NotificationMethods = Pick<
  WorkflowScopedDb['sequences'],
  'beginWorkflowNotificationAttempt' | 'confirmWorkflowNotificationDelivery'
>;

export async function deliverStoryboardNotification(
  methods: NotificationMethods,
  owner: StoryboardOwner
): Promise<boolean> {
  const receipt = await methods.beginWorkflowNotificationAttempt(owner);
  if (!receipt) return false;
  await getGenerationChannel(receipt.sequenceId).emit(
    receipt.notification.event,
    receipt.notification.data,
    { requireAcknowledgement: true }
  );
  await methods.confirmWorkflowNotificationDelivery(receipt);
  return true;
}
