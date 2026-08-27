import mongoose, { Document, Schema } from 'mongoose';

export type TaskCallStatus =
  | 'not_updated'
  | 'genuine'
  | 'not_genuine'
  | 'call_not_lifted'
  | 'follow_up'
  | 'completed';

export interface TaskCallNote {
  note: string;
  createdBy: {
    userId: string;
    email: string;
    name: string;
  };
  createdAt: Date;
}

export interface TaskCallAttempt {
  attemptedAt: Date;
  outcome: TaskCallStatus;
  nextRetryAt?: Date | null;
}

export interface TaskCallRecordDocument extends Document {
  taskId: string;
  notificationId?: string;
  status: TaskCallStatus;
  followUpDate?: Date | null;
  callAttempts: TaskCallAttempt[];
  notes: TaskCallNote[];
  lastUpdatedBy?: {
    userId: string;
    email: string;
    name: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const AdminActorSchema = new Schema(
  {
    userId: { type: String, required: true },
    email: { type: String, required: true },
    name: { type: String, required: true },
  },
  { _id: false },
);

const TaskCallNoteSchema = new Schema<TaskCallNote>(
  {
    note: { type: String, required: true, trim: true },
    createdBy: { type: AdminActorSchema, required: true },
    createdAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false },
);

const TaskCallAttemptSchema = new Schema<TaskCallAttempt>(
  {
    attemptedAt: { type: Date, required: true, default: Date.now },
    outcome: {
      type: String,
      enum: ['not_updated', 'genuine', 'not_genuine', 'call_not_lifted', 'follow_up', 'completed'],
      required: true,
    },
    nextRetryAt: { type: Date, default: null },
  },
  { _id: false },
);

const TaskCallRecordSchema = new Schema<TaskCallRecordDocument>(
  {
    taskId: { type: String, required: true, unique: true, index: true },
    notificationId: { type: String },
    status: {
      type: String,
      enum: ['not_updated', 'genuine', 'not_genuine', 'call_not_lifted', 'follow_up', 'completed'],
      default: 'not_updated',
      required: true,
    },
    followUpDate: { type: Date, default: null },
    callAttempts: { type: [TaskCallAttemptSchema], default: [] },
    notes: { type: [TaskCallNoteSchema], default: [] },
    lastUpdatedBy: { type: AdminActorSchema },
  },
  { timestamps: true },
);

TaskCallRecordSchema.index({ status: 1, followUpDate: 1 });

export const TaskCallRecord = mongoose.model<TaskCallRecordDocument>(
  'TaskCallRecord',
  TaskCallRecordSchema,
);
