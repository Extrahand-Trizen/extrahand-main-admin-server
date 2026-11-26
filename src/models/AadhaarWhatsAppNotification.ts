import mongoose, { Document, Schema } from 'mongoose';

export type AadhaarWhatsAppSendStatus = 'sending' | 'accepted' | 'failed';
export type AadhaarWhatsAppDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface AadhaarWhatsAppNotificationDocument extends Document {
  idempotencyKey: string;
  userId: string;
  userName: string;
  phoneNumber: string;
  templateId: string;
  templateName: string;
  templateLanguage: string;
  variables: Record<string, string>;
  sentBy: {
    userId: string;
    email: string;
    name: string;
  };
  sentAt: Date;
  dialogMessageId?: string;
  sendStatus: AadhaarWhatsAppSendStatus;
  deliveryStatus?: AadhaarWhatsAppDeliveryStatus;
  failureReason?: string;
  deliveryUpdatedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const AadhaarWhatsAppNotificationSchema =
  new Schema<AadhaarWhatsAppNotificationDocument>(
    {
      idempotencyKey: { type: String, required: true, unique: true },
      userId: { type: String, required: true, index: true },
      userName: { type: String, required: true },
      phoneNumber: { type: String, required: true },
      templateId: { type: String, required: true },
      templateName: { type: String, required: true },
      templateLanguage: { type: String, required: true },
      variables: { type: Schema.Types.Mixed, required: true },
      sentBy: {
        userId: { type: String, required: true },
        email: { type: String, required: true },
        name: { type: String, required: true },
      },
      sentAt: { type: Date, required: true },
      dialogMessageId: { type: String },
      sendStatus: {
        type: String,
        required: true,
        enum: ['sending', 'accepted', 'failed'],
        default: 'sending',
      },
      deliveryStatus: {
        type: String,
        enum: ['sent', 'delivered', 'read', 'failed'],
      },
      failureReason: { type: String },
      deliveryUpdatedAt: { type: Date },
    },
    { timestamps: true, collection: 'aadhaar_whatsapp_notifications' },
  );

AadhaarWhatsAppNotificationSchema.index({ userId: 1, sentAt: -1 });

export const AadhaarWhatsAppNotification =
  mongoose.models.AadhaarWhatsAppNotification ||
  mongoose.model<AadhaarWhatsAppNotificationDocument>(
    'AadhaarWhatsAppNotification',
    AadhaarWhatsAppNotificationSchema,
  );
