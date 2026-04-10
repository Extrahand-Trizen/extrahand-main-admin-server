import { Request, Response } from 'express';
import { userServiceClient } from '../services/UserServiceClient';
import { taskServiceClient } from '../services/TaskServiceClient';
import logger from '../config/logger';

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

export class AnalyticsController {
  /**
   * GET /api/v1/analytics/overview
   * Aggregated analytics for dashboard cards.
   */
  static async getOverview(req: Request, res: Response): Promise<void> {
    try {
      const results = await Promise.allSettled([
        userServiceClient.getRoleCounts(),
        taskServiceClient.listTasks({ page: 1, limit: 1 }),
        taskServiceClient.listTasks({ page: 1, limit: 1, status: 'open' }),
        taskServiceClient.listTasks({ page: 1, limit: 1, status: 'in_progress' }),
        taskServiceClient.listTasks({ page: 1, limit: 1, status: 'completed' }),
      ]);

      const userCounts = results[0].status === 'fulfilled'
        ? (results[0].value?.data || { posters: 0, taskers: 0 })
        : { posters: 0, taskers: 0 };
      const totalTaskResult = results[1].status === 'fulfilled' ? results[1].value : {};
      const openTaskResult = results[2].status === 'fulfilled' ? results[2].value : {};
      const inProgressTaskResult = results[3].status === 'fulfilled' ? results[3].value : {};
      const completedTaskResult = results[4].status === 'fulfilled' ? results[4].value : {};

      const taskServiceHealthy = results.slice(1).every((result) => result.status === 'fulfilled');

      const data = {
        posters: {
          totalRegistered: userCounts.posters,
        },
        taskers: {
          totalRegistered: userCounts.taskers,
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

      res.json({
        success: true,
        data,
      });
    } catch (error: any) {
      logger.error('Get analytics overview error:', error);
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Failed to fetch analytics overview',
      });
    }
  }
}
