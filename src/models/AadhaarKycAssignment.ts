import mongoose, { Document, Schema } from 'mongoose';

export interface AadhaarKycAssignmentDocument extends Document {
  userId: string;
  assignedToUserId: string;
  assignedToEmail: string;
  assignedToName: string;
  lastNotificationId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AadhaarKycAssignmentSchema = new Schema<AadhaarKycAssignmentDocument>(
  {
    userId: { type: String, required: true, unique: true, index: true },
    assignedToUserId: { type: String, required: true, index: true },
    assignedToEmail: { type: String, required: true },
    assignedToName: { type: String, required: true },
    lastNotificationId: { type: String },
  },
  { timestamps: true },
);

export const AadhaarKycAssignment = mongoose.model<AadhaarKycAssignmentDocument>(
  'AadhaarKycAssignment',
  AadhaarKycAssignmentSchema,
);
