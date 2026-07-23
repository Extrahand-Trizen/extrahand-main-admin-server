import mongoose, { Schema, Document, Model } from 'mongoose';

export enum AuditLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface IAuditLog extends Document {
  auditId: string;
  userId: string; // Admin user ID
  userName: string;
  action: string; // e.g., 'user.ban', 'task.delete'
  resourceType: string; // e.g., 'user', 'task'
  resourceId: string;
  dashboardType: string;
  role: string;
  level: AuditLevel;
  details: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  reason?: string; // Required for high/critical actions
  previousState?: Record<string, any>;
  newState?: Record<string, any>;
  timestamp: Date;
}

const AuditLogSchema = new Schema<IAuditLog>({
  auditId: {
    type: String,
    required: true,
    unique: true,
    default: () => `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  },
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  action: { type: String, required: true },
  resourceType: { type: String, required: true },
  resourceId: { type: String, required: true },
  dashboardType: { type: String, required: true },
  role: { type: String, required: true },
  level: {
    type: String,
    enum: Object.values(AuditLevel),
    default: AuditLevel.MEDIUM,
  },
  details: { type: Schema.Types.Mixed, default: {} },
  ipAddress: { type: String },
  userAgent: { type: String },
  reason: { type: String },
  previousState: { type: Schema.Types.Mixed },
  newState: { type: Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now },
}, {
  timestamps: false,
  collection: 'audit_logs',
});

// Indexes
AuditLogSchema.index({ userId: 1 });
AuditLogSchema.index({ action: 1 });
AuditLogSchema.index({ resourceType: 1, resourceId: 1 });
AuditLogSchema.index({ dashboardType: 1 });
AuditLogSchema.index({ level: 1 });
AuditLogSchema.index({ timestamp: -1 });
AuditLogSchema.index({ userId: 1, timestamp: -1 });

export const AuditLog: Model<IAuditLog> = mongoose.model<IAuditLog>('AuditLog', AuditLogSchema);
