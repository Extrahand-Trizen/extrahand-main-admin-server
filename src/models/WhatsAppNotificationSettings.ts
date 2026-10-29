import mongoose, { Document, Schema } from 'mongoose';

export interface WhatsAppNotificationSettingsDocument extends Document {
  key: string;
  enabled: boolean;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const WhatsAppNotificationSettingsSchema =
  new Schema<WhatsAppNotificationSettingsDocument>(
    {
      key: {
        type: String,
        required: true,
        unique: true,
        default: 'automatic_work_dispatch',
      },
      enabled: { type: Boolean, default: false },
      updatedBy: { type: String },
    },
    { timestamps: true, collection: 'whatsapp_notification_settings' },
  );

export const WhatsAppNotificationSettings =
  mongoose.model<WhatsAppNotificationSettingsDocument>(
    'WhatsAppNotificationSettings',
    WhatsAppNotificationSettingsSchema,
  );
