import mongoose, { Document, Schema, Model } from 'mongoose';

export interface ProfileDocument extends Document {
  uid: string;
  name: string;
  email?: string;
  phone?: string;
  roles?: string[];
  isAadhaarVerified?: boolean;
  createdAt?: Date;
  aadhaarKyc?: {
    visibleStatus?: string;
    internalStatus?: string;
    status?: string;
    failureReason?: string;
    updatedAt?: Date;
    verificationId?: string;
    id?: string;
  };
}

const ProfileSchema = new Schema<ProfileDocument>(
  {
    uid: { type: String, index: true },
    name: { type: String },
    email: { type: String },
    phone: { type: String },
    roles: [{ type: String }],
    isAadhaarVerified: { type: Boolean },
    createdAt: { type: Date },
    aadhaarKyc: { type: Schema.Types.Mixed },
  },
  { collection: 'profiles', strict: false },
);

export const Profile: Model<ProfileDocument> =
  mongoose.models.Profile || mongoose.model<ProfileDocument>('Profile', ProfileSchema);

