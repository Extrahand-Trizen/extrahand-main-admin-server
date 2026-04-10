import mongoose, { Schema, Document, Model } from 'mongoose';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { DashboardType } from '../types/dashboard';

export interface IAdminInvite extends Document {
  inviteId: string;
  email: string;
  dashboardType: DashboardType;
  role: string;
  invitedBy: string;
  invitedByName: string;
  token: string; // Hashed token
  expiresAt: Date;
  status: 'pending' | 'accepted' | 'expired' | 'cancelled';
  acceptedAt?: Date;
  acceptedBy?: string;
  customMessage?: string;
  createdAt: Date;
  
  // Methods
  verifyToken(token: string): Promise<boolean>;
  isExpired(): boolean;
  canBeAccepted(): boolean;
}

const AdminInviteSchema = new Schema<IAdminInvite>({
  inviteId: {
    type: String,
    required: true,
    unique: true,
    default: () => uuidv4(),
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  dashboardType: {
    type: String,
    enum: Object.values(DashboardType),
    required: true,
  },
  role: { type: String, required: true },
  invitedBy: { type: String, required: true },
  invitedByName: { type: String, required: true },
  token: { type: String, required: true },
  expiresAt: { type: Date, required: true },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'expired', 'cancelled'],
    default: 'pending',
  },
  acceptedAt: { type: Date },
  acceptedBy: { type: String },
  customMessage: { type: String },
  createdAt: { type: Date, default: Date.now },
}, {
  timestamps: false,
  collection: 'admin_invites',
});

// Indexes
AdminInviteSchema.index({ email: 1 });
AdminInviteSchema.index({ inviteId: 1 });
AdminInviteSchema.index({ token: 1 });
AdminInviteSchema.index({ status: 1 });
AdminInviteSchema.index({ expiresAt: 1 });
AdminInviteSchema.index({ dashboardType: 1, role: 1 });

// Methods
AdminInviteSchema.methods.verifyToken = async function(token: string): Promise<boolean> {
  return bcrypt.compare(token, this.token);
};

AdminInviteSchema.methods.isExpired = function(): boolean {
  return new Date() > this.expiresAt;
};

AdminInviteSchema.methods.canBeAccepted = function(): boolean {
  return this.status === 'pending' && !this.isExpired();
};

// Static method to create invite with hashed token
AdminInviteSchema.statics.createInvite = async function(data: {
  email: string;
  dashboardType: DashboardType;
  role: string;
  invitedBy: string;
  invitedByName: string;
  customMessage?: string;
  expiresInDays?: number;
}): Promise<{ invite: IAdminInvite; token: string }> {
  const token = uuidv4();
  const hashedToken = await bcrypt.hash(token, 10);
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (data.expiresInDays || 7));
  
  const invite = new this({
    ...data,
    token: hashedToken,
    expiresAt,
  });
  
  await invite.save();
  return { invite, token };
};

export const AdminInvite: Model<IAdminInvite> = mongoose.model<IAdminInvite>('AdminInvite', AdminInviteSchema);
