import mongoose, { Schema, Document } from 'mongoose';
import { DashboardType } from '../types/dashboard';

export interface NotificationReadEntry {
  userId: string;
  readAt: Date;
}

export interface AdminNotificationDocument extends Document {
  type: string;
  title: string;
  message: string;
  linkUrl?: string;
  dashboardType: DashboardType;
  targetAdminUserIds?: string[];
  metadata?: Record<string, any>;
  readBy: NotificationReadEntry[];
  createdAt: Date;
  updatedAt: Date;
}

const NotificationReadSchema = new Schema<NotificationReadEntry>(
  {
    userId: { type: String, required: true },
    readAt: { type: Date, required: true, default: Date.now },
  },
  { _id: false }
);

const AdminNotificationSchema = new Schema<AdminNotificationDocument>(
  {
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    linkUrl: { type: String },
    dashboardType: {
      type: String,
      enum: Object.values(DashboardType),
      required: true,
    },
    targetAdminUserIds: { type: [String], default: [] },
    metadata: { type: Schema.Types.Mixed },
    readBy: { type: [NotificationReadSchema], default: [] },
  },
  { timestamps: true }
);

AdminNotificationSchema.index({ dashboardType: 1, createdAt: -1 });
AdminNotificationSchema.index({ dashboardType: 1, targetAdminUserIds: 1, createdAt: -1 });
AdminNotificationSchema.index({ 'readBy.userId': 1 });
AdminNotificationSchema.index({ type: 1, dashboardType: 1, 'metadata.taskId': 1 });

export const AdminNotification = mongoose.model<AdminNotificationDocument>(
  'AdminNotification',
  AdminNotificationSchema
);
