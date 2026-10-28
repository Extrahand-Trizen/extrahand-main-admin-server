import { Request, Response } from 'express';
import logger from '../config/logger';
import { getClientSafeStatus } from '../utils/upstreamHttp';
import { userServiceClient } from '../services/UserServiceClient';
import {
  getPartnerById,
  getTeamWork,
  listPartners,
  listTeamWork,
  partnerMatchesWork,
  projectCustomer,
  projectPartner,
  projectStatusHistory,
  projectWork,
} from '../services/TeamWorkReadService';

function parsePositiveInteger(value: unknown, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw Object.assign(new Error(`Value must be an integer between 1 and ${maximum}`), { statusCode: 400 });
  }
  return parsed;
}

function getWorkFilters(query: Request['query']): Record<string, unknown> {
  const filters: Record<string, unknown> = { bookingSource: 'all' };
  for (const key of [
    'status',
    'search',
    'category',
    'bookingSource',
    'scheduledDateFrom',
    'scheduledDateTo',
    'sortBy',
    'sortOrder',
  ]) {
    const value = query[key];
    if (typeof value === 'string' && value.trim()) {
      const normalizedValue = value.trim();
      if ((key === 'status' || key === 'category') && normalizedValue.toLowerCase() === 'all') {
        continue;
      }
      filters[key] = normalizedValue;
    }
  }
  return filters;
}

async function loadWorkAndPartnerProfiles(task: Record<string, any>, requester: Record<string, any>) {
  const workerProfileId = task.assigneeId ?? task.partnerId;
  const workerUid = task.assigneeUid ?? task.partnerUid;
  if (!workerProfileId && !workerUid) return { requester, worker: undefined };
  const response = workerProfileId
    ? await userServiceClient.getProfilesBatch([String(workerProfileId)])
    : await userServiceClient.getProfilesBatchByUids([String(workerUid)]);
  const profiles = Array.isArray(response?.profiles) ? response.profiles : [];
  return { requester, worker: profiles[0] };
}

export class TeamWorkController {
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const page = parsePositiveInteger(req.query.page, 1, 100000);
      const limit = parsePositiveInteger(req.query.limit, 20, 100);
      const { rows, truncated } = await listTeamWork(getWorkFilters(req.query));
      const offset = (page - 1) * limit;
      res.json({
        success: true,
        data: rows.slice(offset, offset + limit).map(({ task, requester }) =>
          projectWork(task, requester),
        ),
        pagination: {
          page,
          limit,
          total: rows.length,
          pages: Math.ceil(rows.length / limit),
          truncated,
        },
      });
    } catch (error: any) {
      logger.error('List Team Work error:', error);
      res.status(error.statusCode || getClientSafeStatus(error)).json({
        success: false,
        error: error.message || error.response?.data?.error || 'Failed to list Team Work',
      });
    }
  }

  static async get(req: Request, res: Response): Promise<void> {
    try {
      const entry = await getTeamWork(req.params.workId);
      if (!entry) {
        res.status(404).json({ success: false, error: 'Team Work not found' });
        return;
      }
      const profiles = await loadWorkAndPartnerProfiles(entry.task, entry.requester);
      res.json({
        success: true,
        data: projectWork(entry.task, profiles.requester, profiles.worker),
      });
    } catch (error: any) {
      logger.error('Get Team Work error:', { workId: req.params.workId, error });
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to get Team Work',
      });
    }
  }

  static async helpers(req: Request, res: Response): Promise<void> {
    try {
      const entry = await getTeamWork(req.params.workId);
      if (!entry) {
        res.status(404).json({ success: false, error: 'Team Work not found' });
        return;
      }
      const { profiles, truncated } = await listPartners();
      const eligible = profiles.filter((profile) => partnerMatchesWork(profile, entry.task));
      res.json({
        success: true,
        data: eligible.map(projectPartner),
        matching: {
          category: entry.task.categorySlug ?? entry.task.categoryLabel ?? entry.task.category ?? null,
          workAreas: [
            entry.task.location?.taskArea,
            entry.task.location?.addressDetails?.area,
            entry.task.location?.city,
            entry.task.location?.addressDetails?.city,
          ].filter(Boolean),
          availabilityVerified: false,
          note: 'Partner profile data has no verified real-time availability field; results are category/area candidates only.',
          truncated,
        },
      });
    } catch (error: any) {
      logger.error('List Team Work partner recommendations error:', { workId: req.params.workId, error });
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to retrieve partner candidates',
      });
    }
  }

  static async statusHistory(req: Request, res: Response): Promise<void> {
    try {
      const entry = await getTeamWork(req.params.workId);
      if (!entry) {
        res.status(404).json({ success: false, error: 'Team Work not found' });
        return;
      }
      res.json({ success: true, data: projectStatusHistory(entry.task) });
    } catch (error: any) {
      logger.error('Get Team Work status history error:', { workId: req.params.workId, error });
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to get Team Work status history',
      });
    }
  }

  static async customer(req: Request, res: Response): Promise<void> {
    try {
      const customerId = String(req.params.customerId || '').trim();
      const { rows } = await listTeamWork();
      const relatedWorks = rows.filter(({ requester }) =>
        [requester._id, requester.id, requester.profileId, requester.userId, requester.uid]
          .some((id) => {
            const candidate = String(id ?? '').trim();
            const isObjectId = /^[a-f0-9]{24}$/i.test(candidate) &&
              /^[a-f0-9]{24}$/i.test(customerId);
            return isObjectId
              ? candidate.toLowerCase() === customerId.toLowerCase()
              : candidate === customerId;
          }),
      );
      if (relatedWorks.length === 0) {
        res.status(404).json({ success: false, error: 'Team Work customer not found' });
        return;
      }
      const profile = relatedWorks[0].requester;
      res.json({
        success: true,
        data: {
          ...projectCustomer(profile),
          teamWorkIds: relatedWorks.map(({ task }) => String(task.taskId ?? task._id ?? task.id)),
        },
      });
    } catch (error: any) {
      logger.error('Get Team Work customer error:', { customerId: req.params.customerId, error });
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to get Team Work customer',
      });
    }
  }

  static async worker(req: Request, res: Response): Promise<void> {
    try {
      const profile = await getPartnerById(req.params.workerId);
      if (!profile) {
        res.status(404).json({ success: false, error: 'Partner not found' });
        return;
      }
      res.json({ success: true, data: projectPartner(profile) });
    } catch (error: any) {
      logger.error('Get partner profile error:', { workerId: req.params.workerId, error });
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to get partner profile',
      });
    }
  }
}
