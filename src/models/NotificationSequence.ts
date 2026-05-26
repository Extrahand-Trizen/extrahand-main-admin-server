import mongoose, { Document, Schema } from 'mongoose';

export interface NotificationSequenceDocument extends Document {
  key: string;
  value: number;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationSequenceSchema = new Schema<NotificationSequenceDocument>(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Number, required: true, default: 0 },
  },
  { timestamps: true },
);

export const NotificationSequence = mongoose.model<NotificationSequenceDocument>(
  'NotificationSequence',
  NotificationSequenceSchema,
);
