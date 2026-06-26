import mongoose, { Document, Schema, Model } from 'mongoose';

export interface TaskDocument extends Document {
  title: string;
  assigneeUid?: string | null;
  assigneeId?: mongoose.Types.ObjectId | null;
}

const TaskSchema = new Schema<TaskDocument>(
  {
    title: { type: String },
    assigneeUid: { type: String },
    assigneeId: { type: Schema.Types.ObjectId },
  },
  { collection: 'tasks' },
);

export const Task: Model<TaskDocument> =
  mongoose.models.Task || mongoose.model<TaskDocument>('Task', TaskSchema);
