import mongoose, { Schema, Document, Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';

export type TaskDeleteRequestStatus = 'pending' | 'approved' | 'rejected';

export interface ITaskDeleteRequest extends Document {
  requestId: string;
  taskId: string;
  reason: string;
  status: TaskDeleteRequestStatus;
  requestedBy: {
    userId: string;
    email: string;
    name: string;
  };
  requestedAt: Date;
  decidedBy?: {
    userId: string;
    email: string;
    name: string;
  };
  decidedAt?: Date;
  decisionNote?: string;
}

const ActorSchema = new Schema(
  {
    userId: { type: String, required: true },
    email: { type: String, required: true },
    name: { type: String, required: true },
  },
  { _id: false },
);

const TaskDeleteRequestSchema = new Schema<ITaskDeleteRequest>(
  {
    requestId: { type: String, required: true, unique: true, default: () => uuidv4() },
    taskId: { type: String, required: true, index: true },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
      index: true,
    },
    requestedBy: { type: ActorSchema, required: true },
    requestedAt: { type: Date, default: Date.now, index: true },
    decidedBy: { type: ActorSchema, required: false },
    decidedAt: { type: Date, required: false },
    decisionNote: { type: String, required: false, trim: true, maxlength: 500 },
  },
  { timestamps: true, collection: 'task_delete_requests' },
);

TaskDeleteRequestSchema.index({ taskId: 1, status: 1 });
TaskDeleteRequestSchema.index({ status: 1, requestedAt: -1 });

export const TaskDeleteRequest: Model<ITaskDeleteRequest> =
  mongoose.models.TaskDeleteRequest ||
  mongoose.model<ITaskDeleteRequest>('TaskDeleteRequest', TaskDeleteRequestSchema);

