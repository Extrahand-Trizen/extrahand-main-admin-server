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

  // ─── Task Collection Alignment Fields ──────────────────────────────────────
  title?: string;
  description?: string;
  category?: string;
  categorySlug?: string;
  categoryLabel?: string;
  subcategory?: string;

  budget?: {
    amount?: number;
    min?: number;
    max?: number;
    currency: 'INR';
    type?: 'fixed' | 'hourly';
  };
  isNegotiable?: boolean;

  location?: {
    type: 'Point';
    coordinates?: [number, number];
    address?: string;
    city?: string;
    state?: string;
    pinCode?: string;
    country?: string;
    taskArea?: string;
  };

  urgency?: 'low' | 'medium' | 'high' | 'urgent';
  priority?: 'low' | 'normal' | 'high';

  bookingSource?: 'marketplace' | 'book_now' | 'quick_commerce';
  bookingOrderId?: string;
  bookingItemId?: string;

  requesterId?: Types.ObjectId | string;
  requesterUid?: string;

  assigneeId?: Types.ObjectId | string | null;
  assigneeUid?: string | null;
  assignedHelperName?: string | null;
  assignedToName?: string | null;
  assigneeName?: string | null;
  assignedAt?: Date;
  assignmentStatus?: 'pending' | 'assigned' | 'failed';

  partnerId?: Types.ObjectId | string | null;
  partnerUid?: string | null;
  partnerAcceptedAt?: Date;

  confirmed?: boolean;
  confirmedAt?: Date | null;
  confirmed_at?: Date | null;

  executionPhase?: 'assigned' | 'on_the_way' | 'arrived';
  executionPhaseUpdatedAt?: Date;
  onTheWayAt?: Date;
  arrivedAt?: Date;

  startOtp?: {
    codeHash: string;
    codePlain?: string;
    requestedAt: Date;
    verifiedAt?: Date;
    attempts: number;
    resendCount: number;
    requestedById?: Types.ObjectId | string;
  };

  startedAt?: Date;
  inProgressAt?: Date;
  reviewAt?: Date;
  completionSubmittedAt?: Date;
  completedAt?: Date;
  firstCompletedAt?: Date;
  cancelledAt?: Date;
  cancelledById?: Types.ObjectId | string;
  cancellationReason?: string;

  completionProof?: Array<{
    url: string;
    filename?: string;
    uploadedAt?: Date;
    uploadedBy?: string;
  }>;
  completionStatus?: 'pending_approval' | 'approved' | 'rejected' | 'revision_requested' | 'completed';
  completionNotes?: string;
  completionRejectedReason?: string;
  completionApprovedAt?: Date;
  completionRejectedAt?: Date;

  fulfillmentStatus?: string;

  scheduledDate?: Date;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;

  isDeletedByCustomer?: boolean;
  deletedByCustomerAt?: Date;
  deletedByCustomerId?: string;
  isDeletedBySupport?: boolean;
  deletedBySupportAt?: Date;
  deletedBySupportId?: string;
  deleteReason?: string;

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

    // ─── Task Collection Alignment Fields ──────────────────────────────────────
    title: { type: String, trim: true },
    description: { type: String, trim: true },
    category: { type: String, default: 'delivery' },
    categorySlug: { type: String, default: 'delivery_logistics' },
    categoryLabel: { type: String, default: 'Delivery & Logistics' },
    subcategory: { type: String, default: 'quick_commerce_delivery' },

    budget: {
      amount: { type: Number, min: 0 },
      min: { type: Number, min: 0 },
      max: { type: Number, min: 0 },
      currency: { type: String, default: 'INR' },
      type: { type: String, enum: ['fixed', 'hourly'], default: 'fixed' },
    },
    isNegotiable: { type: Boolean, default: false },

    location: {
      type: { type: String, enum: ['Point'], default: 'Point' },
      coordinates: { type: [Number], default: [0, 0] },
      address: String,
      city: String,
      state: String,
      pinCode: String,
      country: { type: String, default: 'India' },
      taskArea: String,
    },

    urgency: { type: String, enum: ['low', 'medium', 'high', 'urgent'], default: 'urgent' },
    priority: { type: String, enum: ['low', 'normal', 'high'], default: 'high' },

    bookingSource: {
      type: String,
      enum: ['marketplace', 'book_now', 'quick_commerce'],
      default: 'quick_commerce',
    },
    bookingOrderId: { type: String, trim: true },
    bookingItemId: { type: String, trim: true },

    requesterId: { type: Schema.Types.ObjectId, ref: 'Profile' },
    requesterUid: { type: String },

    assigneeId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    assigneeUid: { type: String, default: null },
    assignedHelperName: { type: String, default: null },
    assignedToName: { type: String, default: null },
    assigneeName: { type: String, default: null },
    assignedAt: { type: Date },
    assignmentStatus: {
      type: String,
      enum: ['pending', 'assigned', 'failed'],
      default: 'pending',
    },

    partnerId: { type: Schema.Types.ObjectId, ref: 'Profile', default: null },
    partnerUid: { type: String, default: null },
    partnerAcceptedAt: { type: Date },

    confirmed: { type: Boolean, default: false },
    confirmedAt: { type: Date, default: null },
    confirmed_at: { type: Date, default: null },

    executionPhase: { type: String, enum: ['assigned', 'on_the_way', 'arrived'] },
    executionPhaseUpdatedAt: { type: Date },
    onTheWayAt: { type: Date },
    arrivedAt: { type: Date },

    startOtp: {
      codeHash: String,
      codePlain: String,
      requestedAt: { type: Date, default: Date.now },
      verifiedAt: Date,
      attempts: { type: Number, default: 0 },
      resendCount: { type: Number, default: 0 },
      requestedById: { type: Schema.Types.ObjectId, ref: 'Profile' },
    },

    startedAt: { type: Date },
    inProgressAt: { type: Date },
    reviewAt: { type: Date },
    completionSubmittedAt: { type: Date },
    completedAt: { type: Date },
    firstCompletedAt: { type: Date },
    cancelledAt: { type: Date },
    cancelledById: { type: Schema.Types.ObjectId, ref: 'Profile' },
    cancellationReason: { type: String },

    completionProof: [
      {
        url: { type: String, required: true },
        filename: String,
        uploadedAt: { type: Date, default: Date.now },
        uploadedBy: String,
      },
    ],
    completionStatus: {
      type: String,
      enum: ['pending_approval', 'approved', 'rejected', 'revision_requested', 'completed'],
    },
    completionNotes: String,
    completionRejectedReason: String,
    completionApprovedAt: Date,
    completionRejectedAt: Date,

    fulfillmentStatus: { type: String },

    scheduledDate: { type: Date },
    scheduledTimeStart: { type: String },
    scheduledTimeEnd: { type: String },

    isDeletedByCustomer: { type: Boolean, default: false },
    deletedByCustomerAt: { type: Date },
    deletedByCustomerId: { type: String },
    isDeletedBySupport: { type: Boolean, default: false },
    deletedBySupportAt: { type: Date },
    deletedBySupportId: { type: String },
    deleteReason: { type: String },
  },
  {
    timestamps: true,
    collection: 'customerorders',
  }
);

QcOrderSchema.index({ createdAt: -1 });
QcOrderSchema.index({ deadline: 1 });
QcOrderSchema.index({ partnerId: 1, status: 1 });
QcOrderSchema.index({ assigneeId: 1, status: 1 });
QcOrderSchema.index({ partnerUid: 1, status: 1 });
QcOrderSchema.index({ assigneeUid: 1, status: 1 });

export const QcOrder: Model<IQcOrderDocument> =
  mongoose.models.CustomerOrder || mongoose.model<IQcOrderDocument>('CustomerOrder', QcOrderSchema);
