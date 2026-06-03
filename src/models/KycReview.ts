import mongoose, { Document, Schema } from 'mongoose';

export type KycReviewStatus = 'pending' | 'accepted' | 'rejected';
export type KycFollowUpStatus = 'none' | 'follow_up' | 'not_interested' | 'followup_uploaded';

export interface KycReviewDocument extends Document {
  userId: string;
  sessionId?: string;
  verificationId?: string;
  reviewStatus: KycReviewStatus;
  followUpStatus: KycFollowUpStatus;
  followUpDate?: Date | null;
  rejectionReason?: string;
  reviewedBy?: {
    userId: string;
    email: string;
    name: string;
  };
  reviewedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ReviewerSchema = new Schema(
  {
    userId: { type: String, required: true },
    email: { type: String, required: true },
    name: { type: String, required: true },
  },
  { _id: false },
);

const KycReviewSchema = new Schema<KycReviewDocument>(
  {
    userId: { type: String, required: true, index: true },
    sessionId: { type: String },
    verificationId: { type: String },
    reviewStatus: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending',
      index: true,
    },
    followUpStatus: {
      type: String,
      enum: ['none', 'follow_up', 'not_interested', 'followup_uploaded'],
      default: 'none',
      index: true,
    },
    followUpDate: { type: Date, default: null },
    rejectionReason: { type: String },
    reviewedBy: { type: ReviewerSchema },
    reviewedAt: { type: Date },
  },
  { timestamps: true },
);

KycReviewSchema.index({ userId: 1, sessionId: 1 }, { unique: true, sparse: true });
KycReviewSchema.index({ reviewStatus: 1, followUpStatus: 1, updatedAt: -1 });

export const KycReview = mongoose.model<KycReviewDocument>('KycReview', KycReviewSchema);
