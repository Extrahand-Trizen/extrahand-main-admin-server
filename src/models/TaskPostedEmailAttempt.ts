import mongoose, { Document, Schema } from 'mongoose';

export interface TaskPostedEmailAttemptDocument extends Document {
  taskId: string;
  status: 'sent' | 'failed' | 'skipped';
  recipients: string[];
  lastAttemptAt: Date;
  error?: string;
  updatedAt: Date;
}

const TaskPostedEmailAttemptSchema = new Schema<TaskPostedEmailAttemptDocument>(
  {
    taskId: { type: String, required: true, unique: true },
    status: { type: String, enum: ['sent', 'failed', 'skipped'], required: true },
    recipients: { type: [String], default: [] },
    lastAttemptAt: { type: Date, required: true, default: Date.now },
    error: { type: String },
  },
  { timestamps: true },
);

export const TaskPostedEmailAttempt = mongoose.model<TaskPostedEmailAttemptDocument>(
  'TaskPostedEmailAttempt',
  TaskPostedEmailAttemptSchema,
);