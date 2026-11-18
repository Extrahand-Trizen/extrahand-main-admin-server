import mongoose, { Document, Schema } from 'mongoose';

export interface TaskPostedEmailAttemptDocument extends Document {
  taskId: string;
  status: 'sent' | 'partial' | 'failed' | 'skipped';
  recipients: string[];
  sentRecipients: string[];
  failedRecipients: string[];
  lastAttemptAt: Date;
  error?: string;
  updatedAt: Date;
}

const TaskPostedEmailAttemptSchema = new Schema<TaskPostedEmailAttemptDocument>(
  {
    taskId: { type: String, required: true, unique: true },
    status: { type: String, enum: ['sent', 'partial', 'failed', 'skipped'], required: true },
    recipients: { type: [String], default: [] },
    sentRecipients: { type: [String], default: [] },
    failedRecipients: { type: [String], default: [] },
    lastAttemptAt: { type: Date, required: true, default: Date.now },
    error: { type: String },
  },
  { timestamps: true },
);

export const TaskPostedEmailAttempt = mongoose.model<TaskPostedEmailAttemptDocument>(
  'TaskPostedEmailAttempt',
  TaskPostedEmailAttemptSchema,
);