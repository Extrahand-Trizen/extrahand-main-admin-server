import mongoose, { Schema, Document, Model } from 'mongoose';
import bcrypt from 'bcrypt';
import { IDashboardAccess, DashboardType } from '../types/dashboard';

export interface IAdminUser extends Document {
  userId: string;
  email: string;
  passwordHash?: string;
  microsoftId?: string;
  googleId?: string;
  name: string;
  dashboardAccess: IDashboardAccess[];
  isSuperAdmin: boolean;
  status: 'active' | 'suspended' | 'inactive';
  mfaEnabled: boolean;
  mfaSecret?: string;
  joinedVia: 'email' | 'microsoft' | 'google' | 'invite';
  lastLoginAt?: Date;
  loginCount: number;
  createdBy?: string;
  lastModifiedBy?: string;
  lastModifiedAt?: Date;
  refreshTokens: Array<{
    token: string;
    expiresAt: Date;
    createdAt: Date;
  }>;
  
  // Methods
  verifyPassword(password: string): Promise<boolean>;
  addRefreshToken(token: string, expiresAt: Date): void;
  cleanupExpiredTokens(): void;
  hasDashboardAccess(dashboardType: DashboardType): boolean;
  getDashboardRole(dashboardType: DashboardType): string | null;
  canAccessDashboard(dashboardType: DashboardType): boolean;
}

const DashboardAccessSchema = new Schema<IDashboardAccess>({
  dashboardType: {
    type: String,
    enum: Object.values(DashboardType),
    required: true,
  },
  role: { type: String, required: true },
  status: {
    type: String,
    enum: ['active', 'suspended', 'inactive'],
    default: 'active',
  },
  permissions: [{ type: String }],
  grantedBy: { type: String, required: true },
  grantedAt: { type: Date, default: Date.now },
  lastAccessAt: { type: Date },
  notes: { type: String },
}, { _id: false });

const RefreshTokenSchema = new Schema({
  token: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
}, { _id: false });

const AdminUserSchema = new Schema<IAdminUser>({
  userId: {
    type: String,
    required: true,
    unique: true,
    default: () => `admin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: { type: String },
  microsoftId: { type: String, sparse: true },
  googleId: { type: String, sparse: true },
  name: { type: String, required: true },
  dashboardAccess: [DashboardAccessSchema],
  isSuperAdmin: { type: Boolean, default: false },
  status: {
    type: String,
    enum: ['active', 'suspended', 'inactive'],
    default: 'active',
  },
  mfaEnabled: { type: Boolean, default: false },
  mfaSecret: { type: String },
  joinedVia: {
    type: String,
    enum: ['email', 'microsoft', 'google', 'invite'],
    default: 'email',
  },
  lastLoginAt: { type: Date },
  loginCount: { type: Number, default: 0 },
  createdBy: { type: String },
  lastModifiedBy: { type: String },
  lastModifiedAt: { type: Date },
  refreshTokens: [RefreshTokenSchema],
}, {
  timestamps: true,
  collection: 'admin_users',
});

// Indexes
AdminUserSchema.index({ email: 1 });
AdminUserSchema.index({ userId: 1 });
AdminUserSchema.index({ 'dashboardAccess.dashboardType': 1 });
AdminUserSchema.index({ isSuperAdmin: 1 });
AdminUserSchema.index({ status: 1 });

// Methods
AdminUserSchema.methods.verifyPassword = async function(password: string): Promise<boolean> {
  if (!this.passwordHash) return false;
  return bcrypt.compare(password, this.passwordHash);
};

AdminUserSchema.methods.addRefreshToken = function(token: string, expiresAt: Date): void {
  this.refreshTokens.push({ token, expiresAt, createdAt: new Date() });
  // Keep only last 5 refresh tokens
  if (this.refreshTokens.length > 5) {
    this.refreshTokens = this.refreshTokens.slice(-5);
  }
};

AdminUserSchema.methods.cleanupExpiredTokens = function(): void {
  const now = new Date();
  this.refreshTokens = this.refreshTokens.filter(
    (token: { token: string; expiresAt: Date; createdAt: Date }) => token.expiresAt > now
  );
};

AdminUserSchema.methods.hasDashboardAccess = function(dashboardType: DashboardType): boolean {
  if (this.isSuperAdmin) return true;
  return this.dashboardAccess.some(
    (access: IDashboardAccess) => access.dashboardType === dashboardType && access.status === 'active'
  );
};

AdminUserSchema.methods.getDashboardRole = function(dashboardType: DashboardType): string | null {
  if (this.isSuperAdmin) return 'super_admin';
  const access = this.dashboardAccess.find(
    (a: IDashboardAccess) => a.dashboardType === dashboardType && a.status === 'active'
  );
  return access ? access.role : null;
};

AdminUserSchema.methods.canAccessDashboard = function(dashboardType: DashboardType): boolean {
  if (this.status !== 'active') return false;
  if (this.isSuperAdmin) return true;
  return this.hasDashboardAccess(dashboardType);
};

// Pre-save hook to update lastModifiedAt
AdminUserSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    this.lastModifiedAt = new Date();
  }
  next();
});

export const AdminUser: Model<IAdminUser> = mongoose.model<IAdminUser>('AdminUser', AdminUserSchema);
