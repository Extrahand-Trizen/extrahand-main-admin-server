import mongoose, { Document, Schema } from 'mongoose';
import { TASK_POSTED_EMAIL_RECIPIENTS } from '../constants/taskAssignment';

export interface TaskPostedEmailSettingsDocument extends Document {
  key: string;
  recipients: string[];
  excludedPhones: string[];
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TaskPostedEmailSettingsSchema = new Schema<TaskPostedEmailSettingsDocument>(
  {
    key: { type: String, required: true, unique: true, default: 'task_posted_email' },
    recipients: {
      type: [String],
      default: () => [...TASK_POSTED_EMAIL_RECIPIENTS],
    },
    excludedPhones: { type: [String], default: [] },
    updatedBy: { type: String },
  },
  { timestamps: true },
);

export const TaskPostedEmailSettings = mongoose.model<TaskPostedEmailSettingsDocument>(
  'TaskPostedEmailSettings',
  TaskPostedEmailSettingsSchema,
);