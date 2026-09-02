import mongoose, { Document, Schema, Model, Types } from 'mongoose';

export interface IQcOrderItem {
  productSlug?: string;
  masterProductId?: Types.ObjectId | string;
  name: string;
  unit: string;
  quantity: number;
  unitPricePaise: number;
  lineTotalPaise: number;
  imageUrl?: string;
}

export interface IQcOrderAddress {
  label?: string;
  line1: string;
  line2?: string;
  city: string;
  state?: string;
  pinCode: string;
  coordinates?: [number, number];
  name?: string;
  phone?: string;
}

export interface IQcAssignedHelper {
  userId?: string;
  profileId?: string;
  name?: string;
  phone?: string;
  role?: string;
  assignedAt?: Date;
}

export interface IQcOpsAdmin {
  userId?: string;
  name?: string;
  email?: string;
}

export interface IQcOrderDocument extends Document {
  userId: string;
  orderNumber: string;
  shopId?: string;
  shopName: string;
  shopCategory?: string;
  shopSubcategory?: string;
  status: 'open' | 'assigned' | 'completed' | 'cancelled' | 'PENDING_PAYMENT' | 'PAID' | 'CONFIRMED' | 'FAILED';
  paymentStatus: 'PENDING' | 'PAID' | 'FAILED';
  items: IQcOrderItem[];
  address: IQcOrderAddress;
  deliveryInstructions: string[];
  partnerTipPaise: number;
  itemTotalPaise: number;
  deliveryFeePaise: number;
  handlingFeePaise: number;
  couponDiscountPaise: number;
  amountPaise: number;
  amount?: number;
  assignedTo?: IQcAssignedHelper;
  opsAdmin?: IQcOpsAdmin;
  deadline?: Date;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const QcOrderItemSchema = new Schema<IQcOrderItem>(
  {
    productSlug: { type: String },
    masterProductId: { type: Schema.Types.Mixed },
    name: { type: String, required: true },
    unit: { type: String, default: 'pcs' },
    quantity: { type: Number, required: true, min: 1 },
    unitPricePaise: { type: Number, required: true, min: 0 },
    lineTotalPaise: { type: Number, required: true, min: 0 },
    imageUrl: { type: String },
  },
  { _id: false }
);

const QcOrderAddressSchema = new Schema<IQcOrderAddress>(
  {
    label: { type: String },
    line1: { type: String, required: true },
    line2: { type: String },
    city: { type: String, required: true },
    state: { type: String },
    pinCode: { type: String, required: true },
    coordinates: { type: [Number] },
    name: { type: String },
    phone: { type: String },
  },
  { _id: false }
);

const QcAssignedHelperSchema = new Schema<IQcAssignedHelper>(
  {
    userId: { type: String },
    profileId: { type: String },
    name: { type: String },
    phone: { type: String },
    role: { type: String },
    assignedAt: { type: Date },
  },
  { _id: false }
);

const QcOpsAdminSchema = new Schema<IQcOpsAdmin>(
  {
    userId: { type: String },
    name: { type: String },
    email: { type: String },
  },
  { _id: false }
);

const QcOrderSchema = new Schema<IQcOrderDocument>(
  {
    userId: { type: String, required: true, index: true },
    orderNumber: { type: String, required: true, unique: true, index: true },
    shopId: { type: String, index: true },
    shopName: { type: String, required: true, index: true },
    shopCategory: { type: String, index: true },
    shopSubcategory: { type: String, index: true },
    status: {
      type: String,
      enum: ['open', 'assigned', 'completed', 'cancelled', 'PENDING_PAYMENT', 'PAID', 'CONFIRMED', 'FAILED'],
      default: 'open',
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: ['PENDING', 'PAID', 'FAILED'],
      default: 'PAID',
    },
    items: { type: [QcOrderItemSchema], default: [] },
    address: { type: QcOrderAddressSchema, required: true },
    deliveryInstructions: { type: [String], default: [] },
    partnerTipPaise: { type: Number, default: 0, min: 0 },
    itemTotalPaise: { type: Number, required: true, min: 0 },
    deliveryFeePaise: { type: Number, required: true, min: 0 },
    handlingFeePaise: { type: Number, required: true, min: 0 },
    couponDiscountPaise: { type: Number, default: 0, min: 0 },
    amountPaise: { type: Number, required: true, min: 0 },
    amount: { type: Number },
    assignedTo: { type: QcAssignedHelperSchema },
    opsAdmin: { type: QcOpsAdminSchema },
    deadline: { type: Date },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
  },
  {
    timestamps: true,
    collection: 'customerorders',
  }
);

QcOrderSchema.index({ createdAt: -1 });
QcOrderSchema.index({ deadline: 1 });

export const QcOrder: Model<IQcOrderDocument> =
  mongoose.models.CustomerOrder || mongoose.model<IQcOrderDocument>('CustomerOrder', QcOrderSchema);
