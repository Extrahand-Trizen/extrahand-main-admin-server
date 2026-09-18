import mongoose, { Document, Schema } from 'mongoose';

export interface PreferredAssignmentPartner {
  profileId: string;
  uid: string;
  name: string;
  phone?: string;
  categories: string[];
  areas: string[];
  priority: number;
  active: boolean;
}

export interface AreaAssignmentRule {
  area: string;
  category?: string;
  zone: string;
  workTypes: string[];
  preferredPartners: PreferredAssignmentPartner[];
  active: boolean;
}

export interface AssignmentManagementRulesDocument extends Document {
  key: string;
  preferredPartners: PreferredAssignmentPartner[];
  preferredPartnerCursor: number;
  areaRules: AreaAssignmentRule[];
  excludedPhones: string[];
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

const PreferredPartnerSchema = new Schema<PreferredAssignmentPartner>(
  {
    profileId: { type: String, required: true },
    uid: { type: String, required: true },
    name: { type: String, required: true },
    phone: { type: String },
    categories: { type: [String], default: [] },
    areas: { type: [String], default: [] },
    priority: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { _id: false },
);

const AreaAssignmentRuleSchema = new Schema<AreaAssignmentRule>(
  {
    area: { type: String, required: true },
    category: { type: String },
    zone: { type: String, default: 'Custom Zone' },
    workTypes: { type: [String], default: ['hourly'] },
    preferredPartners: { type: [PreferredPartnerSchema], default: [] },
    active: { type: Boolean, default: true },
  },
  { _id: false },
);

const AssignmentManagementRulesSchema = new Schema<AssignmentManagementRulesDocument>(
  {
    key: { type: String, unique: true, default: 'assignment_management' },
    preferredPartners: { type: [PreferredPartnerSchema], default: [] },
    preferredPartnerCursor: { type: Number, default: 0 },
    areaRules: { type: [AreaAssignmentRuleSchema], default: [] },
    excludedPhones: { type: [String], default: [] },
    updatedBy: { type: String },
  },
  { timestamps: true },
);

export const AssignmentManagementRules = mongoose.model<AssignmentManagementRulesDocument>(
  'AssignmentManagementRules',
  AssignmentManagementRulesSchema,
);
