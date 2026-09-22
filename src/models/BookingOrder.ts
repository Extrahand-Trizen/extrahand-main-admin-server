import mongoose, { Document, Schema, Model } from 'mongoose';

export interface BookingOrderDocument extends Document {
  orderId: string;
  customerUid?: string;
  status?: string;
  subtotal?: number;
  total?: number;
  couponId?: string | null;
  couponCode?: string | null;
  couponDiscount?: number | null;
  totalBeforeCoupon?: number | null;
  totalAfterCoupon?: number | null;
  paymentEscrowId?: string;
}

const BookingOrderSchema = new Schema<BookingOrderDocument>(
  {
    orderId: { type: String, required: true, unique: true, index: true },
    customerUid: { type: String },
    status: { type: String },
    subtotal: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    couponId: { type: String, default: null },
    couponCode: { type: String, default: null },
    couponDiscount: { type: Number, default: null },
    totalBeforeCoupon: { type: Number, default: null },
    totalAfterCoupon: { type: Number, default: null },
    paymentEscrowId: { type: String },
  },
  { collection: 'bookingorders', timestamps: true }
);

export const BookingOrder: Model<BookingOrderDocument> =
  mongoose.models.BookingOrder ||
  mongoose.model<BookingOrderDocument>('BookingOrder', BookingOrderSchema);
