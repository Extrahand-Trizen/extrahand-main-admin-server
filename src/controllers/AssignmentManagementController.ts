import { Request, Response } from 'express';
import { AssignmentManagementRules } from '../models/AssignmentManagementRules';
import { getClientSafeStatus } from '../utils/upstreamHttp';
import logger from '../config/logger';

function normalizePhone(phone: string): string {
  return String(phone || '').replace(/\D/g, '');
}

function normalizeRules(document: any) {
  return {
    preferredPartners: [...(document?.preferredPartners || [])].sort(
      (left, right) => Number(left.priority || 0) - Number(right.priority || 0),
    ),
    areaRules: (document?.areaRules || []).map((rule: any) => ({
      area: String(rule.area || rule._doc?.area || ''),
      category: rule.category || rule._doc?.category || undefined,
      zone: String(rule.zone || rule._doc?.zone || 'Custom Zone'),
      workTypes: Array.isArray(rule.workTypes || rule._doc?.workTypes)
        ? (rule.workTypes || rule._doc?.workTypes).map(String)
        : ['hourly'],
      active: rule.active !== false && rule._doc?.active !== false,
      preferredPartners: [...(rule.preferredPartners || rule._doc?.preferredPartners || [])].sort(
        (left, right) => Number(left.priority || 0) - Number(right.priority || 0),
      ),
    })),
    excludedPhones: (document?.excludedPhones || []).map(normalizePhone).filter(Boolean),
  };
}

async function getRulesDocument() {
  return AssignmentManagementRules.findOneAndUpdate(
    { key: 'assignment_management' },
    { $setOnInsert: { key: 'assignment_management' } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
}

export class AssignmentManagementController {
  static async getRules(_req: Request, res: Response): Promise<void> {
    try {
      const rules = await getRulesDocument();
      res.json({ success: true, data: normalizeRules(rules) });
    } catch (error: any) {
      logger.error('Get assignment management rules error:', error);
      res.status(getClientSafeStatus(error)).json({ success: false, error: 'Failed to load assignment rules' });
    }
  }

  static async addPreferredPartner(req: Request, res: Response): Promise<void> {
    try {
      const { profileId, uid, name, phone, categories = [], areas = [] } = req.body;
      if (!profileId || !uid || !name) {
        res.status(400).json({ success: false, error: 'profileId, uid and name are required' });
        return;
      }
      const rules = await getRulesDocument();
      const existing = rules.preferredPartners.find((partner) => partner.profileId === String(profileId));
      if (existing) {
        res.status(409).json({ success: false, error: 'Partner is already preferred' });
        return;
      }
      const priority = rules.preferredPartners.length;
      rules.preferredPartners.push({
        profileId: String(profileId),
        uid: String(uid),
        name: String(name),
        phone: phone ? normalizePhone(phone) : undefined,
        categories: Array.isArray(categories) ? categories.map(String) : [],
        areas: Array.isArray(areas) ? areas.map(String) : [],
        priority,
        active: true,
      });
      rules.updatedBy = (req as any).admin?.userId;
      await rules.save();
      res.json({ success: true, data: normalizeRules(rules) });
    } catch (error: any) {
      logger.error('Add preferred partner error:', error);
      res.status(getClientSafeStatus(error)).json({ success: false, error: 'Failed to add preferred partner' });
    }
  }

  static async removePreferredPartner(req: Request, res: Response): Promise<void> {
    try {
      const rules = await getRulesDocument();
      rules.preferredPartners = rules.preferredPartners
        .filter((partner) => partner.profileId !== String(req.params.profileId))
        .map((partner, index) => ({ ...partner, priority: index })) as any;
      await rules.save();
      res.json({ success: true, data: normalizeRules(rules) });
    } catch (error: any) {
      logger.error('Remove preferred partner error:', error);
      res.status(getClientSafeStatus(error)).json({ success: false, error: 'Failed to remove preferred partner' });
    }
  }

  static async reorderPreferredPartners(req: Request, res: Response): Promise<void> {
    try {
      const { profileId, direction } = req.body;
      const rules = await getRulesDocument();
      const currentIndex = rules.preferredPartners.findIndex((partner) => partner.profileId === String(profileId));
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (currentIndex < 0 || targetIndex < 0 || targetIndex >= rules.preferredPartners.length) {
        res.json({ success: true, data: normalizeRules(rules) });
        return;
      }
      const [partner] = rules.preferredPartners.splice(currentIndex, 1);
      rules.preferredPartners.splice(targetIndex, 0, partner);
      rules.preferredPartners.forEach((item, index) => { item.priority = index; });
      await rules.save();
      res.json({ success: true, data: normalizeRules(rules) });
    } catch (error: any) {
      logger.error('Reorder preferred partners error:', error);
      res.status(getClientSafeStatus(error)).json({ success: false, error: 'Failed to reorder preferred partners' });
    }
  }

  static async addExcludedPhone(req: Request, res: Response): Promise<void> {
    try {
      const phone = normalizePhone(req.body.phone);
      if (!phone) {
        res.status(400).json({ success: false, error: 'A valid phone number is required' });
        return;
      }
      const rules = await getRulesDocument();
      if (!rules.excludedPhones.some((item) => normalizePhone(item) === phone)) {
        rules.excludedPhones.push(phone);
        await rules.save();
      }
      res.json({ success: true, data: normalizeRules(rules) });
    } catch (error: any) {
      logger.error('Add excluded phone error:', error);
      res.status(getClientSafeStatus(error)).json({ success: false, error: 'Failed to add excluded phone' });
    }
  }

  static async saveAreaRule(req: Request, res: Response): Promise<void> {
    try {
      const { area, category, zone = 'Custom Zone', workTypes = ['hourly'], preferredPartners = [] } = req.body;
      if (!String(area || '').trim()) {
        res.status(400).json({ success: false, error: 'Area is required' });
        return;
      }
      const rules = await getRulesDocument();
      const normalizedArea = String(area).trim();
      const partners = (Array.isArray(preferredPartners) ? preferredPartners : []).map((partner: any, index: number) => ({
        profileId: String(partner.profileId), uid: String(partner.uid), name: String(partner.name),
        phone: partner.phone ? normalizePhone(partner.phone) : undefined,
        categories: Array.isArray(partner.categories) ? partner.categories.map(String) : [],
        areas: Array.isArray(partner.areas) ? partner.areas.map(String) : [],
        priority: index, active: partner.active !== false,
      }));
      const existingIndex = rules.areaRules.findIndex((rule) => rule.area.toLowerCase() === normalizedArea.toLowerCase());
      const nextRule = { area: normalizedArea, category: category ? String(category) : undefined, zone: String(zone), workTypes: Array.isArray(workTypes) ? workTypes.map(String) : ['hourly'], preferredPartners: partners, active: true };
      if (existingIndex >= 0) rules.areaRules[existingIndex] = nextRule as any;
      else rules.areaRules.push(nextRule as any);
      await rules.save();
      res.json({ success: true, data: normalizeRules(rules) });
    } catch (error: any) {
      logger.error('Save area rule error:', error);
      res.status(getClientSafeStatus(error)).json({ success: false, error: 'Failed to save area rule' });
    }
  }

  static async removeAreaRule(req: Request, res: Response): Promise<void> {
    try {
      const rules = await getRulesDocument();
      rules.areaRules = rules.areaRules.filter((rule) => rule.area !== decodeURIComponent(req.params.area));
      await rules.save();
      res.json({ success: true, data: normalizeRules(rules) });
    } catch (error: any) {
      logger.error('Remove area rule error:', error);
      res.status(getClientSafeStatus(error)).json({ success: false, error: 'Failed to remove area rule' });
    }
  }

  static async reorderAreaRulePartners(req: Request, res: Response): Promise<void> {
    try {
      const { area, profileId, direction } = req.body;
      const rules = await getRulesDocument();
      const rule = rules.areaRules.find((item) => item.area === String(area));
      if (!rule) {
        res.status(404).json({ success: false, error: 'Area rule not found' });
        return;
      }
      const currentIndex = rule.preferredPartners.findIndex((partner) => partner.profileId === String(profileId));
      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (currentIndex >= 0 && targetIndex >= 0 && targetIndex < rule.preferredPartners.length) {
        const [partner] = rule.preferredPartners.splice(currentIndex, 1);
        rule.preferredPartners.splice(targetIndex, 0, partner);
        rule.preferredPartners.forEach((item, index) => { item.priority = index; });
        await rules.save();
      }
      res.json({ success: true, data: normalizeRules(rules) });
    } catch (error: any) {
      logger.error('Reorder area rule partners error:', error);
      res.status(getClientSafeStatus(error)).json({ success: false, error: 'Failed to reorder area partners' });
    }
  }

  static async removeExcludedPhone(req: Request, res: Response): Promise<void> {
    try {
      const phone = normalizePhone(req.params.phone);
      const rules = await getRulesDocument();
      rules.excludedPhones = rules.excludedPhones.filter((item) => normalizePhone(item) !== phone);
      await rules.save();
      res.json({ success: true, data: normalizeRules(rules) });
    } catch (error: any) {
      logger.error('Remove excluded phone error:', error);
      res.status(getClientSafeStatus(error)).json({ success: false, error: 'Failed to remove excluded phone' });
    }
  }
}
