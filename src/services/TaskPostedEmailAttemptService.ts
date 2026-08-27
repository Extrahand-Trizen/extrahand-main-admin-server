import { TaskPostedEmailAttempt } from '../models/TaskPostedEmailAttempt';

export async function recordTaskPostedEmailAttempt(data: {
  taskId?: string;
  status: 'sent' | 'failed' | 'skipped';
  recipients?: string[];
  error?: string;
}): Promise<void> {
  if (!data.taskId) return;
  await TaskPostedEmailAttempt.findOneAndUpdate(
    { taskId: data.taskId },
    {
      $set: {
        status: data.status,
        recipients: data.recipients || [],
        lastAttemptAt: new Date(),
        error: data.error,
      },
    },
    { upsert: true },
  );
}