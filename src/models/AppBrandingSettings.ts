import mongoose, { Document, Schema } from 'mongoose';

export interface AppBrandingSettingsDocument extends Document {
  key: string;
  logoUrl: string | null;
  activeIconId: string;
  launcherIcons: Array<{
    iconId: string;
    name: string;
    imageUrl: string;
    createdBy?: string;
    createdAt: Date;
  }>;
  launcherIconUrl: string | null;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AppBrandingSettingsSchema = new Schema<AppBrandingSettingsDocument>(
  {
    key: { type: String, required: true, unique: true, default: 'customer_app' },
    logoUrl: { type: String, default: null },
    activeIconId: { type: String, default: 'extrahand-default' },
    launcherIcons: {
      type: [
        new Schema(
          {
            iconId: { type: String, required: true },
            name: { type: String, required: true },
            imageUrl: { type: String, required: true },
            createdBy: { type: String },
            createdAt: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    launcherIconUrl: { type: String, default: null },
    updatedBy: { type: String },
  },
  { timestamps: true, collection: 'app_branding_settings' },
);

export const AppBrandingSettings = mongoose.model<AppBrandingSettingsDocument>(
  'AppBrandingSettings',
  AppBrandingSettingsSchema,
);
