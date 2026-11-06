import mongoose from 'mongoose';
import { AdminCouponDocument, Coupon } from '../models/Coupon';

type CouponPayload = Record<string, unknown>;

const allowedFields = [
  'discountType', 'discountValue', 'minOrderAmount', 'applicableTo', 'serviceIds',
  'applicableLocations', 'cities', 'pincodes', 'applicableFlows', 'redemptionScope',
  'firstBookingOnly', 'usageLimitPerUser', 'overallUsageLimit', 'startDate', 'expiryDate', 'isActive',
] as const;

function normalizeCode(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function normalizePayload(payload: CouponPayload, code: string) {
  const discountType = String(payload.discountType || '').toUpperCase();
  if (!['FIXED', 'PERCENTAGE'].includes(discountType)) throw new Error('discountType must be FIXED or PERCENTAGE');

  const discountValue = Number(payload.discountValue);
  if (!Number.isFinite(discountValue) || discountValue <= 0) throw new Error('discountValue must be a positive number');
  if (discountType === 'PERCENTAGE' && discountValue > 100) throw new Error('Percentage discount cannot exceed 100');

  const applicableTo = String(payload.applicableTo || 'ALL_SERVICES').toUpperCase();
  if (!['ALL_SERVICES', 'SELECTED_SERVICES'].includes(applicableTo)) throw new Error('Invalid applicableTo');
  const serviceIds = Array.isArray(payload.serviceIds) ? payload.serviceIds.map(String).map((id) => id.trim()).filter(Boolean) : [];
  if (applicableTo === 'SELECTED_SERVICES' && serviceIds.length === 0) throw new Error('serviceIds required when applicableTo is SELECTED_SERVICES');

  const applicableLocations = String(payload.applicableLocations || 'ALL_LOCATIONS').toUpperCase();
  if (!['ALL_LOCATIONS', 'SELECTED_LOCATIONS'].includes(applicableLocations)) throw new Error('Invalid applicableLocations');
  const cities = Array.isArray(payload.cities) ? payload.cities.map((city) => String(city).trim().toUpperCase()).filter(Boolean) : [];
  const pincodes = Array.isArray(payload.pincodes) ? payload.pincodes.map((pincode) => String(pincode).trim()).filter(Boolean) : [];
  if (applicableLocations === 'SELECTED_LOCATIONS' && cities.length === 0 && pincodes.length === 0) {
    throw new Error('At least one city or pincode is required when applicableLocations is SELECTED_LOCATIONS');
  }

  const applicableFlows = Array.isArray(payload.applicableFlows)
    ? payload.applicableFlows.map((flow) => String(flow).toUpperCase()).filter((flow): flow is 'BOOK_NOW' | 'POST_COMPARE' => ['BOOK_NOW', 'POST_COMPARE'].includes(flow))
    : [];
  if (applicableFlows.length === 0) throw new Error('applicableFlows is required');

  const redemptionScope = String(payload.redemptionScope || 'PER_USER').toUpperCase();
  if (!['PER_USER', 'GLOBAL_SINGLE_USE'].includes(redemptionScope)) throw new Error('Invalid redemptionScope');
  const overallLimitRaw = payload.overallUsageLimit;
  const overallUsageLimit = overallLimitRaw === undefined || overallLimitRaw === null || overallLimitRaw === ''
    ? null
    : Math.max(1, Math.floor(Number(overallLimitRaw) || 1));
  const startDate = payload.startDate ? new Date(String(payload.startDate)) : new Date();
  const expiryDate = payload.expiryDate ? new Date(String(payload.expiryDate)) : null;
  if (Number.isNaN(startDate.getTime()) || (expiryDate && Number.isNaN(expiryDate.getTime()))) {
    throw new Error('startDate and expiryDate must be valid dates');
  }

  return {
    code,
    discountType,
    discountValue,
    minOrderAmount: Math.max(0, Number(payload.minOrderAmount) || 0),
    applicableTo,
    serviceIds: applicableTo === 'ALL_SERVICES' ? [] : serviceIds,
    applicableLocations,
    cities: applicableLocations === 'ALL_LOCATIONS' ? [] : cities,
    pincodes: applicableLocations === 'ALL_LOCATIONS' ? [] : pincodes,
    applicableFlows,
    redemptionScope,
    firstBookingOnly: Boolean(payload.firstBookingOnly),
    usageLimitPerUser: redemptionScope === 'GLOBAL_SINGLE_USE' ? 1 : Math.max(1, Math.floor(Number(payload.usageLimitPerUser) || 1)),
    overallUsageLimit,
    startDate,
    expiryDate,
    isActive: payload.isActive === undefined ? true : Boolean(payload.isActive),
  };
}

export class CouponManagementService {
  static async list(filters: { isActive?: boolean; search?: string } = {}) {
    const query: Record<string, unknown> = {};
    if (typeof filters.isActive === 'boolean') query.isActive = filters.isActive;
    if (filters.search) query.code = { $regex: normalizeCode(filters.search), $options: 'i' };
    return Coupon.find(query).sort({ createdAt: -1 });
  }

  static async create(payload: CouponPayload) {
    const code = normalizeCode(payload.code);
    if (!code) throw new Error('Coupon code is required');
    return Coupon.create(normalizePayload(payload, code));
  }

  static async bulkCreate(payload: CouponPayload) {
    const codes = [...new Set((Array.isArray(payload.codes) ? payload.codes : []).map(normalizeCode).filter(Boolean))];
    if (!codes.length) throw new Error('At least one coupon code is required');
    const basePayload = { ...payload, redemptionScope: 'GLOBAL_SINGLE_USE', usageLimitPerUser: 1 };
    const normalized = codes.map((code) => normalizePayload(basePayload, code));
    const existing = await Coupon.find({ code: { $in: codes } }, { code: 1 }).lean();
    const existingCodes = new Set(existing.map((coupon) => coupon.code));
    const drafts = normalized.filter((coupon) => !existingCodes.has(coupon.code));
    if (drafts.length) {
      try {
        await Coupon.insertMany(drafts, { ordered: false });
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 11000)) throw error;
      }
    }
    const after = await Coupon.find({ code: { $in: codes } }, { code: 1 }).lean();
    const createdCodes = after.map((coupon) => coupon.code).filter((code) => !existingCodes.has(code));
    const created = new Set(createdCodes);
    return {
      createdCount: createdCodes.length,
      skippedCount: codes.length - createdCodes.length,
      createdCodes,
      skippedCodes: codes.filter((code) => !created.has(code)),
    };
  }

  static async getById(id: string): Promise<AdminCouponDocument> {
    if (!mongoose.Types.ObjectId.isValid(id)) throw new Error('Coupon not found');
    const coupon = await Coupon.findById(id);
    if (!coupon) throw new Error('Coupon not found');
    return coupon;
  }

  static async update(id: string, payload: CouponPayload) {
    const coupon = await this.getById(id);
    for (const field of allowedFields) {
      if (payload[field] !== undefined) (coupon as unknown as Record<string, unknown>)[field] = payload[field];
    }
    if (payload.code !== undefined) {
      const code = normalizeCode(payload.code);
      if (code && code !== coupon.code) coupon.code = code;
    }
    if (coupon.applicableTo === 'ALL_SERVICES') coupon.serviceIds = [];
    else if (!coupon.serviceIds?.length) throw new Error('serviceIds required when applicableTo is SELECTED_SERVICES');
    if (coupon.applicableLocations === 'ALL_LOCATIONS') {
      coupon.cities = [];
      coupon.pincodes = [];
    } else if (!coupon.cities?.length && !coupon.pincodes?.length) {
      throw new Error('At least one city or pincode is required when applicableLocations is SELECTED_LOCATIONS');
    }
    if (coupon.redemptionScope === 'GLOBAL_SINGLE_USE') coupon.usageLimitPerUser = 1;
    if (coupon.overallUsageLimit !== null && coupon.overallUsageLimit < 1) coupon.overallUsageLimit = null;
    await coupon.save();
    return coupon;
  }

  static async setStatus(id: string, isActive: boolean) {
    const coupon = await this.getById(id);
    coupon.isActive = isActive;
    await coupon.save();
    return coupon;
  }

  static async remove(id: string) {
    const coupon = await this.getById(id);
    await coupon.deleteOne();
  }
}
