import mongoose, { Document, Model, Schema } from 'mongoose';

export interface CouponRedemptionDocument extends Document {
  taskId: string;
  couponCode?: string | null;
  discountAmount?: number | null;
  flowType?: string | null;
  redemptionScope?: string | null;
  bookingOrderId?: string | null;
  status?: string;
  redeemedAt?: Date;
  createdAt?: Date;
}

const CouponRedemptionSchema = new Schema<CouponRedemptionDocument>(
  {
    taskId: { type: String, required: true, index: true },
    couponCode: { type: String, default: null },
    discountAmount: { type: Number, default: null },
    flowType: { type: String, default: null },
    redemptionScope: { type: String, default: null },
    bookingOrderId: { type: String, default: null },
    status: { type: String },
    redeemedAt: { type: Date },
  },
  { collection: 'couponRedemptions', strict: false },
);

export const CouponRedemption: Model<CouponRedemptionDocument> =
  (mongoose.models.CouponRedemption as Model<CouponRedemptionDocument> | undefined) ||
  mongoose.model<CouponRedemptionDocument>(
    'CouponRedemption',
    CouponRedemptionSchema,
  );
