import mongoose, { Document, Schema, Model } from 'mongoose';

export interface ProfileDocument extends Document {
  uid: string;
  name: string;
}

const ProfileSchema = new Schema<ProfileDocument>(
  {
    uid: { type: String, index: true },
    name: { type: String },
  },
  { collection: 'profiles' },
);

export const Profile: Model<ProfileDocument> =
  mongoose.models.Profile || mongoose.model<ProfileDocument>('Profile', ProfileSchema);
