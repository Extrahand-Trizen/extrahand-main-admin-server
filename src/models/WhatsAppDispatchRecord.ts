import mongoose, { Document, Schema } from 'mongoose';

export type WhatsAppDispatchStatus =
  | 'sending'
  | 'queued'
  | 'failed'
  | 'disabled'
  | 'suppressed';

export interface WhatsAppDispatchRecordDocument extends Document {
  idempotencyKey: string;
  taskId: string;
  partnerUid: string;
  dispatchStage: 'preferred' | 'area_rule' | 'all';
  title: string;
  category: string;
  locationLabel: string;
  status: WhatsAppDispatchStatus;
  attemptCount: number;
  providerEventId?: string;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const WhatsAppDispatchRecordSchema =
  new Schema<WhatsAppDispatchRecordDocument>(
    {
      idempotencyKey: { type: String, required: true, unique: true },
      taskId: { type: String, required: true, index: true },
      partnerUid: { type: String, required: true },
      dispatchStage: {
        type: String,
        required: true,
        enum: ['preferred', 'area_rule', 'all'],
      },
      title: { type: String, required: true },
      category: { type: String, required: true },
      locationLabel: { type: String, default: '' },
      status: {
        type: String,
        required: true,
        enum: ['sending', 'queued', 'failed', 'disabled', 'suppressed'],
      },
      attemptCount: { type: Number, required: true, default: 1 },
      providerEventId: { type: String },
      lastError: { type: String },
    },
    { timestamps: true, collection: 'whatsapp_dispatch_records' },
  );

export const WhatsAppDispatchRecord =
  mongoose.model<WhatsAppDispatchRecordDocument>(
    'WhatsAppDispatchRecord',
    WhatsAppDispatchRecordSchema,
  );
