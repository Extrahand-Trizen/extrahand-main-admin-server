import { TaskPostedEmailAttempt } from '../models/TaskPostedEmailAttempt';

export async function getTaskPostedEmailAttempt(taskId?: string) {
  if (!taskId) return null;
  return TaskPostedEmailAttempt.findOne({ taskId }).lean();
}

export async function recordTaskPostedEmailAttempt(data: {
  taskId?: string;
  status: 'sent' | 'partial' | 'failed' | 'skipped';
  recipients?: string[];
  sentRecipients?: string[];
  failedRecipients?: string[];
  error?: string;
}): Promise<void> {
  if (!data.taskId) return;
  await TaskPostedEmailAttempt.findOneAndUpdate(
    { taskId: data.taskId },
    {
      $set: {
        status: data.status,
        recipients: data.recipients || [],
        sentRecipients: data.sentRecipients || [],
        failedRecipients: data.failedRecipients || [],
        lastAttemptAt: new Date(),
        error: data.error,
      },
    },
    { upsert: true },
  );
}