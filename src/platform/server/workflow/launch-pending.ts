const WORKFLOW_LAUNCH_PENDING_MESSAGE =
  "Couldn't verify whether a generation is still running — please try again in a moment.";

export class WorkflowLaunchPendingError extends Error {
  readonly workflowRunId: string;
  readonly reservationId: string | undefined;

  constructor({
    workflowRunId,
    reservationId,
    cause,
  }: {
    workflowRunId: string;
    reservationId?: string;
    cause: unknown;
  }) {
    super(WORKFLOW_LAUNCH_PENDING_MESSAGE, { cause });
    this.name = 'WorkflowLaunchPendingError';
    this.workflowRunId = workflowRunId;
    this.reservationId = reservationId;
  }
}
