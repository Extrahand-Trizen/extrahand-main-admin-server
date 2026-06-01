import mongoose, { Document, Schema } from 'mongoose';

export interface TaskAssignmentDocument extends Document {
  taskId: string;
  assignedToUserId: string;
  assignedToEmail: string;
  assignedToName: string;
  notificationId?: string;
  taskTitle?: string;
  createdAt: Date;
  updatedAt: Date;
}

const TaskAssignmentSchema = new Schema<TaskAssignmentDocument>(
  {
    taskId: { type: String, required: true, unique: true, index: true },
    assignedToUserId: { type: String, required: true, index: true },
    assignedToEmail: { type: String, required: true },
    assignedToName: { type: String, required: true },
    notificationId: { type: String },
    taskTitle: { type: String },
  },
  { timestamps: true, collection: 'task_assignments' },
);

export const TaskAssignment = mongoose.model<TaskAssignmentDocument>(
  'TaskAssignment',
  TaskAssignmentSchema,
);
