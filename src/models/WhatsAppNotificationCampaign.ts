import mongoose, { Document, Schema } from 'mongoose';

export type WhatsAppCampaignApp = 'customer_app' | 'helper_app' | 'seller_app';
export type WhatsAppCampaignStatus =
  | 'preparing'
  | 'sending'
  | 'sent'
  | 'sent_with_errors'
  | 'failed';
export type WhatsAppCampaignRecipientStatus =
  | 'pending'
  | 'sending'
  | 'queued'
  | 'failed'
  | 'suppressed';

export interface WhatsAppNotificationCampaignDocument extends Document {
  app: WhatsAppCampaignApp;
  templateId: string;
  templateName: string;
  templateLanguage: string;
  templateCategory: string;
  variables: Record<string, string>;
  cities: string[];
  categories: string[];
  recipientCount: number;
  status: WhatsAppCampaignStatus;
  createdBy: string;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const WhatsAppNotificationCampaignSchema =
  new Schema<WhatsAppNotificationCampaignDocument>(
    {
      app: {
        type: String,
        required: true,
        enum: ['customer_app', 'helper_app', 'seller_app'],
      },
      templateId: { type: String, required: true },
      templateName: { type: String, required: true },
      templateLanguage: { type: String, required: true },
      templateCategory: { type: String, required: true },
      variables: { type: Schema.Types.Mixed, required: true },
      cities: { type: [String], default: [] },
      categories: { type: [String], default: [] },
      recipientCount: { type: Number, required: true },
      status: {
        type: String,
        required: true,
        enum: ['preparing', 'sending', 'sent', 'sent_with_errors', 'failed'],
        default: 'preparing',
        index: true,
      },
      createdBy: { type: String, required: true },
      completedAt: { type: Date },
    },
    { timestamps: true, collection: 'whatsapp_notification_campaigns' },
  );

export interface WhatsAppCampaignRecipientDocument extends Document {
  campaignId: mongoose.Types.ObjectId;
  recipientUid: string;
  status: WhatsAppCampaignRecipientStatus;
  attemptCount: number;
  providerEventId?: string;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
}

const WhatsAppCampaignRecipientSchema =
  new Schema<WhatsAppCampaignRecipientDocument>(
    {
      campaignId: {
        type: Schema.Types.ObjectId,
        ref: 'WhatsAppNotificationCampaign',
        required: true,
      },
      recipientUid: { type: String, required: true },
      status: {
        type: String,
        required: true,
        enum: ['pending', 'sending', 'queued', 'failed', 'suppressed'],
        default: 'pending',
      },
      attemptCount: { type: Number, required: true, default: 0 },
      providerEventId: { type: String },
      lastError: { type: String },
    },
    { timestamps: true, collection: 'whatsapp_campaign_recipients' },
  );

WhatsAppCampaignRecipientSchema.index(
  { campaignId: 1, recipientUid: 1 },
  { unique: true },
);
WhatsAppCampaignRecipientSchema.index({ campaignId: 1, status: 1, createdAt: 1 });

export const WhatsAppNotificationCampaign =
  mongoose.model<WhatsAppNotificationCampaignDocument>(
    'WhatsAppNotificationCampaign',
    WhatsAppNotificationCampaignSchema,
  );

export const WhatsAppCampaignRecipient =
  mongoose.model<WhatsAppCampaignRecipientDocument>(
    'WhatsAppCampaignRecipient',
    WhatsAppCampaignRecipientSchema,
  );
