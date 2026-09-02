import mongoose, { Document, Schema, Model, Types } from 'mongoose';

export interface IQcCategoryDocument extends Document {
  name: string;
  slug: string;
  code: string;
  description?: string;
  imageUrl?: string;
  displayOrder: number;
  status: string;
}

const CategorySchema = new Schema<IQcCategoryDocument>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    description: { type: String, trim: true },
    imageUrl: { type: String },
    displayOrder: { type: Number, default: 0 },
    status: { type: String, default: 'ACTIVE', index: true },
  },
  { timestamps: true, collection: 'categories' }
);

export const QcCategory: Model<IQcCategoryDocument> =
  mongoose.models.Category || mongoose.model<IQcCategoryDocument>('Category', CategorySchema);

export interface IQcSubcategoryDocument extends Document {
  categoryId: Types.ObjectId | string;
  name: string;
  slug: string;
  description?: string;
  imageUrl?: string;
  displayOrder: number;
  status: string;
}

const SubcategorySchema = new Schema<IQcSubcategoryDocument>(
  {
    categoryId: { type: Schema.Types.Mixed, required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String, trim: true },
    imageUrl: { type: String },
    displayOrder: { type: Number, default: 0 },
    status: { type: String, default: 'ACTIVE', index: true },
  },
  { timestamps: true, collection: 'subcategories' }
);

export const QcSubcategory: Model<IQcSubcategoryDocument> =
  mongoose.models.Subcategory || mongoose.model<IQcSubcategoryDocument>('Subcategory', SubcategorySchema);

export interface IQcSellerOnboardingDocument extends Document {
  sellerId: Types.ObjectId | string;
  fullName: string;
  mobileNumber: string;
  email?: string;
  shopName: string;
  shopType: string;
  shopMobileNumber?: string;
  shopEmail?: string;
  shopDescription?: string;
  address: string;
  area?: string;
  locality?: string;
  city: string;
  state: string;
  pincode: string;
  status: string;
}

const SellerOnboardingSchema = new Schema<IQcSellerOnboardingDocument>(
  {
    sellerId: { type: Schema.Types.Mixed, required: true, index: true },
    fullName: { type: String, required: true },
    mobileNumber: { type: String, required: true },
    email: { type: String },
    shopName: { type: String, required: true },
    shopType: { type: String, required: true },
    shopMobileNumber: { type: String },
    shopEmail: { type: String },
    shopDescription: { type: String },
    address: { type: String, required: true },
    area: { type: String },
    locality: { type: String },
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    status: { type: String, default: 'APPROVED', index: true },
  },
  { timestamps: true, collection: 'selleronboardings' }
);

export const QcSellerOnboarding: Model<IQcSellerOnboardingDocument> =
  mongoose.models.SellerOnboarding ||
  mongoose.model<IQcSellerOnboardingDocument>('SellerOnboarding', SellerOnboardingSchema);
