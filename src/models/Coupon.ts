import mongoose, { Document, Schema } from 'mongoose';

export type AdminCouponDocument = Document & {
  code: string;
  discountType: 'FIXED' | 'PERCENTAGE';
  discountValue: number;
  minOrderAmount: number;
  applicableTo: 'ALL_SERVICES' | 'SELECTED_SERVICES';
  serviceIds: string[];
  applicableLocations: 'ALL_LOCATIONS' | 'SELECTED_LOCATIONS';
  cities: string[];
  pincodes: string[];
  applicableFlows: Array<'BOOK_NOW' | 'POST_COMPARE'>;
  redemptionScope: 'PER_USER' | 'GLOBAL_SINGLE_USE';
  firstBookingOnly: boolean;
  usageLimitPerUser: number;
  overallUsageLimit: number | null;
  startDate: Date;
  expiryDate: Date | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const couponSchema = new Schema<AdminCouponDocument>(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true, index: true },
    discountType: { type: String, enum: ['FIXED', 'PERCENTAGE'], required: true },
    discountValue: { type: Number, required: true, min: 0 },
    minOrderAmount: { type: Number, required: true, min: 0, default: 0 },
    applicableTo: { type: String, enum: ['ALL_SERVICES', 'SELECTED_SERVICES'], required: true, default: 'ALL_SERVICES' },
    serviceIds: { type: [String], default: [] },
    applicableLocations: { type: String, enum: ['ALL_LOCATIONS', 'SELECTED_LOCATIONS'], required: true, default: 'ALL_LOCATIONS' },
    cities: { type: [String], default: [] },
    pincodes: { type: [String], default: [] },
    applicableFlows: {
      type: [{ type: String, enum: ['BOOK_NOW', 'POST_COMPARE'] }],
      required: true,
      validate: { validator: (flows: string[]) => Array.isArray(flows) && flows.length > 0, message: 'At least one applicable flow is required' },
    },
    redemptionScope: { type: String, enum: ['PER_USER', 'GLOBAL_SINGLE_USE'], required: true, default: 'PER_USER' },
    firstBookingOnly: { type: Boolean, default: false },
    usageLimitPerUser: { type: Number, required: true, min: 1, default: 1 },
    overallUsageLimit: { type: Number, min: 1, default: null },
    startDate: { type: Date, required: true, default: Date.now },
    expiryDate: { type: Date, default: null },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true, collection: 'coupons' },
);

couponSchema.index({ isActive: 1, expiryDate: 1 });

couponSchema.pre('validate', function normalizeFields() {
  this.code = String(this.code || '').trim().toUpperCase();
  if (this.applicableTo === 'ALL_SERVICES') this.serviceIds = [];
  if (this.applicableLocations === 'ALL_LOCATIONS') {
    this.cities = [];
    this.pincodes = [];
  } else {
    this.cities = (this.cities || []).map((city) => String(city).trim().toUpperCase()).filter(Boolean);
    this.pincodes = (this.pincodes || []).map((pincode) => String(pincode).trim()).filter(Boolean);
  }
});

export const Coupon =
  (mongoose.models.Coupon as mongoose.Model<AdminCouponDocument> | undefined) ||
  mongoose.model<AdminCouponDocument>('Coupon', couponSchema, 'coupons');
