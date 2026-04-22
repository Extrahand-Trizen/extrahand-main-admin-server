import { Request, Response } from 'express';
import { userServiceClient } from '../services/UserServiceClient';
import { taskServiceClient } from '../services/TaskServiceClient';
import logger from '../config/logger';
import {
  AnalyticsRange,
  PosterAnalyticsDto,
  PosterVerificationComparisonDto,
  TaskCancellationAnalyticsDto,
  TaskCategoryBreakdownDto,
  TaskCategoryPerformanceDto,
  UserAnalyticsDto,
} from '../contracts/analytics';

type AnyObject = Record<string, any>;

function extractTotal(result: AnyObject): number {
  const candidates = [
    result?.pagination?.total,
    result?.data?.pagination?.total,
    result?.meta?.pagination?.total,
    result?.data?.meta?.pagination?.total,
  ];

  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
  }

  return 0;
}

function getRange(rangeParam: string | undefined): AnalyticsRange {
  if (rangeParam === '7d' || rangeParam === '90d') return rangeParam;
  return '30d';
}

function normalizeRoles(roles: unknown): Array<'tasker' | 'poster'> {
  if (!Array.isArray(roles)) return [];
  const normalized = new Set<'tasker' | 'poster'>();
  for (const rawRole of roles) {
    const role = String(rawRole || '').trim().toLowerCase();
    if (role === 'tasker') normalized.add('tasker');
    if (role === 'poster' || role === 'requester') normalized.add('poster');
    if (role === 'both') {
      normalized.add('tasker');
      normalized.add('poster');
    }
  }
  return Array.from(normalized);
}

function derivePrimaryRole(roles: Array<'tasker' | 'poster'>): 'tasker' | 'poster' | 'unknown' {
  if (roles.includes('tasker')) return 'tasker';
  if (roles.includes('poster')) return 'poster';
  return 'unknown';
}

function getClientSafeStatus(error: any): number {
  const upstreamStatus = Number(error?.response?.status || 0);
  // Downstream service-auth failures should not be interpreted by browser as admin auth expiry.
  if (upstreamStatus === 401) {
    return 502;
  }
  return upstreamStatus || 500;
}

export class AnalyticsController {
  static async getTaskCategoryPerformance(req: Request, res: Response): Promise<void> {
    try {
      const range = getRange(req.query.range as string | undefined);
      const response = await taskServiceClient.getTaskCategoryPerformance(range);
      const payload = response?.data || {};
      const data: TaskCategoryPerformanceDto = {
        range,
        totals: {
          posted: Number(payload?.totals?.posted || 0),
          open: Number(payload?.totals?.open || 0),
          active: Number(payload?.totals?.active || 0),
          completed: Number(payload?.totals?.completed || 0),
          cancelled: Number(payload?.totals?.cancelled || 0),
          completionRate: Number(payload?.totals?.completionRate || 0),
          cancellationRate: Number(payload?.totals?.cancellationRate || 0),
        },
        categories: Array.isArray(payload?.categories) ? payload.categories : [],
        generatedAt: payload?.generatedAt || new Date().toISOString(),
      };
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Get task category performance error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to fetch task category performance',
      });
    }
  }

  static async getTaskCancellationAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const range = getRange(req.query.range as string | undefined);
      const response = await taskServiceClient.getTaskCancellationAnalytics(range);
      const payload = response?.data || {};
      const data: TaskCancellationAnalyticsDto = {
        range,
        totals: {
          totalTasks: Number(payload?.totals?.totalTasks || 0),
          cancelledTasks: Number(payload?.totals?.cancelledTasks || 0),
          cancellationRate: Number(payload?.totals?.cancellationRate || 0),
          cancelledBeforeAssignment: Number(payload?.totals?.cancelledBeforeAssignment || 0),
          cancelledAfterAssignment: Number(payload?.totals?.cancelledAfterAssignment || 0),
        },
        trend: Array.isArray(payload?.trend) ? payload.trend : [],
        categories: Array.isArray(payload?.categories) ? payload.categories : [],
        generatedAt: payload?.generatedAt || new Date().toISOString(),
      };
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Get task cancellation analytics error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to fetch task cancellation analytics',
      });
    }
  }

  static async getTaskCategoryBreakdown(req: Request, res: Response): Promise<void> {
    try {
      const range = getRange(req.query.range as string | undefined);
      const response = await taskServiceClient.getTaskCategoryBreakdown(range);
      const data: TaskCategoryBreakdownDto = {
        range,
        categories: Array.isArray(response?.data?.categories) ? response.data.categories : [],
        generatedAt: response?.data?.generatedAt || new Date().toISOString(),
      };
      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Get task category breakdown error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to fetch task category breakdown',
      });
    }
  }

  /**
   * GET /api/v1/analytics/overview
   * Aggregated analytics for dashboard cards.
   */
  static async getOverview(req: Request, res: Response): Promise<void> {
    try {
      const results = await Promise.allSettled([
        userServiceClient.getRoleCounts(),
        userServiceClient.getTaskerAadhaarVerifiedCount(),
        taskServiceClient.listTasks({ page: 1, limit: 1 }),
        taskServiceClient.listTasks({ page: 1, limit: 1, status: 'open' }),
        taskServiceClient.listTasks({ page: 1, limit: 1, status: 'in_progress' }),
        taskServiceClient.listTasks({ page: 1, limit: 1, status: 'completed' }),
      ]);

      const userCounts = results[0].status === 'fulfilled' ? (results[0].value?.data || { posters: 0, taskers: 0 }) : { posters: 0, taskers: 0 };
      const taskerAadhaarVerified = results[1].status === 'fulfilled'
        ? Number(results[1].value?.data?.taskersAadhaarVerified || 0)
        : 0;
      const totalTaskResult = results[2].status === 'fulfilled' ? results[2].value : {};
      const openTaskResult = results[3].status === 'fulfilled' ? results[3].value : {};
      const inProgressTaskResult = results[4].status === 'fulfilled' ? results[4].value : {};
      const completedTaskResult = results[5].status === 'fulfilled' ? results[5].value : {};

      const taskServiceHealthy = results.slice(2).every((result) => result.status === 'fulfilled');

      const data = {
        posters: {
          totalRegistered: userCounts.posters,
        },
        taskers: {
          totalRegistered: userCounts.taskers,
          aadhaarVerified: taskerAadhaarVerified,
        },
        tasks: {
          total: extractTotal(totalTaskResult),
          open: extractTotal(openTaskResult),
          inProgress: extractTotal(inProgressTaskResult),
          completed: extractTotal(completedTaskResult),
        },
        generatedAt: new Date().toISOString(),
        partial: {
          taskServiceUnavailable: !taskServiceHealthy,
        },
      };

      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Get analytics overview error:', error);
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Failed to fetch analytics overview',
      });
    }
  }

  /**
   * GET /api/v1/analytics/posters/:requesterId
   * Per-poster analytics including posted tasks and bid volume.
   */
  static async getPosterAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const requesterId = req.params.requesterId;
      if (!requesterId) {
        res.status(400).json({ success: false, error: 'requesterId is required' });
        return;
      }

      const range = getRange(req.query.range as string | undefined);
      const [taskData, profileBatch] = await Promise.all([
        taskServiceClient.getPosterAnalytics(requesterId, range),
        userServiceClient.getProfilesBatch([requesterId]),
      ]);
      const profile = Array.isArray(profileBatch?.profiles) ? profileBatch.profiles[0] : null;
      const taskMetrics = taskData?.data?.metrics || { postedTasks: 0, totalBids: 0, genuineTaskCount: 0, categories: [] };
      const data: PosterAnalyticsDto = {
        requesterId,
        range,
        profile: {
          name: profile?.name || 'Unknown',
          isVerified: Boolean(profile?.isVerified),
          isAadhaarVerified: Boolean(profile?.isAadhaarVerified),
          isPANVerified: Boolean(profile?.isPANVerified),
          isBankVerified: Boolean(profile?.isBankVerified),
        },
        metrics: {
          postedTasks: Number(taskMetrics.postedTasks || 0),
          totalBids: Number(taskMetrics.totalBids || 0),
          genuineTaskCount: Number(taskMetrics.genuineTaskCount || 0),
          categories: Array.isArray(taskMetrics.categories) ? taskMetrics.categories : [],
        },
        generatedAt: new Date().toISOString(),
      };

      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Get poster analytics error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to fetch poster analytics',
      });
    }
  }

  /**
   * GET /api/v1/analytics/posters/verification-comparison
   * Compares verified vs unverified posters behavior.
   */
  static async getPosterVerificationComparison(req: Request, res: Response): Promise<void> {
    try {
      const range = getRange(req.query.range as string | undefined);
      const summaryResponse = await taskServiceClient.getPosterSummary(range);
      const summaryRows = Array.isArray(summaryResponse?.data?.posters) ? summaryResponse.data.posters : [];
      const posterIds = summaryRows.map((row: any) => row.requesterId).filter(Boolean);
      const profileMap = new Map<string, any>();
      for (let i = 0; i < posterIds.length; i += 100) {
        const batch = posterIds.slice(i, i + 100);
        const response = await userServiceClient.getProfilesBatch(batch);
        const profiles = Array.isArray(response?.profiles) ? response.profiles : [];
        for (const profile of profiles) {
          const key = typeof profile?._id?.toString === 'function' ? profile._id.toString() : null;
          if (key) profileMap.set(key, profile);
        }
      }
      const buckets = {
        verified: { posterCount: 0, taskCount: 0, bidCount: 0 },
        unverified: { posterCount: 0, taskCount: 0, bidCount: 0 },
      };
      for (const row of summaryRows) {
        const posterId = row?.requesterId;
        if (!posterId) continue;
        const profile = profileMap.get(posterId);
        const key = profile?.isVerified ? 'verified' : 'unverified';
        buckets[key].posterCount += 1;
        buckets[key].taskCount += Number(row?.taskCount || 0);
        buckets[key].bidCount += Number(row?.bidCount || 0);
      }
      const toAvg = (value: number, count: number) => (count > 0 ? Number((value / count).toFixed(2)) : 0);
      const data: PosterVerificationComparisonDto = {
        range,
        verified: {
          ...buckets.verified,
          avgTasksPerPoster: toAvg(buckets.verified.taskCount, buckets.verified.posterCount),
          avgBidsPerTask: toAvg(buckets.verified.bidCount, buckets.verified.taskCount),
        },
        unverified: {
          ...buckets.unverified,
          avgTasksPerPoster: toAvg(buckets.unverified.taskCount, buckets.unverified.posterCount),
          avgBidsPerTask: toAvg(buckets.unverified.bidCount, buckets.unverified.taskCount),
        },
        generatedAt: new Date().toISOString(),
      };

      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Get poster verification comparison error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to fetch verification comparison',
      });
    }
  }

  /**
   * GET /api/v1/analytics/users/:userId
   * Unified per-user analytics (poster + tasker + trust signals).
   */
  static async getUserAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.params.userId;
      if (!userId) {
        res.status(400).json({ success: false, error: 'userId is required' });
        return;
      }

      const range = getRange(req.query.range as string | undefined);
      const userResponse = await userServiceClient.getUser(userId);
      const profile = userResponse?.data;

      if (!profile?._id || !profile?.uid) {
        res.status(404).json({ success: false, error: 'User profile not found for analytics' });
        return;
      }

      const taskAnalyticsResponse = await taskServiceClient.getUserAnalytics(
        String(profile._id),
        String(profile.uid),
        range
      );
      const taskAnalytics = taskAnalyticsResponse?.data || {};
      const roles = normalizeRoles(profile.roles);

      const data: UserAnalyticsDto = {
        userId,
        range,
        profile: {
          profileId: String(profile._id),
          uid: String(profile.uid),
          name: profile.name || 'Unknown',
          email: profile.email,
          role: derivePrimaryRole(roles),
          roles,
          isVerified: Boolean(profile.isVerified),
          isAadhaarVerified: Boolean(profile.isAadhaarVerified),
          isPANVerified: Boolean(profile.isPANVerified),
          isBankVerified: Boolean(profile.isBankVerified),
        },
        poster: {
          postedTasks: Number(taskAnalytics?.poster?.postedTasks || 0),
          totalBidsReceived: Number(taskAnalytics?.poster?.totalBidsReceived || 0),
          tasksWithAtLeastOneBid: Number(taskAnalytics?.poster?.tasksWithAtLeastOneBid || 0),
          openTasks: Number(taskAnalytics?.poster?.openTasks || 0),
          activeTasks: Number(taskAnalytics?.poster?.activeTasks || 0),
          completedTasks: Number(taskAnalytics?.poster?.completedTasks || 0),
          questionsAskedOnMyTasks: Number(taskAnalytics?.poster?.questionsAskedOnMyTasks || 0),
        },
        tasker: {
          applicationsPlaced: Number(taskAnalytics?.tasker?.applicationsPlaced || 0),
          acceptedApplications: Number(taskAnalytics?.tasker?.acceptedApplications || 0),
          pendingApplications: Number(taskAnalytics?.tasker?.pendingApplications || 0),
          activeAssignedTasks: Number(taskAnalytics?.tasker?.activeAssignedTasks || 0),
          completedAssignedTasks: Number(taskAnalytics?.tasker?.completedAssignedTasks || 0),
          questionsAsked: Number(taskAnalytics?.tasker?.questionsAsked || 0),
          answersGiven: Number(taskAnalytics?.tasker?.answersGiven || 0),
        },
        generatedAt: new Date().toISOString(),
      };

      res.json({ success: true, data });
    } catch (error: any) {
      logger.error('Get user analytics error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to fetch user analytics',
      });
    }
  }
}
