import { Request, Response } from 'express';
import logger from '../config/logger';
import { Profile } from '../models/Profile';
import { Task } from '../models/Task';
import {
  getTaskPostedEmailSettings,
  isPhoneInExclusionList,
} from '../services/TaskPostedEmailSettingsService';

type ActivityPeriod = '7d' | '30d' | 'all';
type ActivitySort = 'most_works' | 'fewest_works' | 'recently_posted';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getActivityPeriod(value: unknown): ActivityPeriod {
  if (value === undefined || value === '7d') return '7d';
  if (value === '30d' || value === 'all') return value;
  throw new Error('Time period must be 7d, 30d, or all.');
}

function getActivitySort(value: unknown): ActivitySort {
  if (value === undefined || value === 'most_works') return 'most_works';
  if (value === 'fewest_works' || value === 'recently_posted') return value;
  throw new Error('Sort must be most_works, fewest_works, or recently_posted.');
}

export class CustomerActivityController {
  static async list(req: Request, res: Response): Promise<void> {
    let period: ActivityPeriod;
    let sort: ActivitySort;
    try {
      period = getActivityPeriod(req.query.period);
      sort = getActivitySort(req.query.sort);
    } catch (error) {
      res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Invalid customer activity filters',
      });
      return;
    }

    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 10));
      const search = String(req.query.search || '').trim();
      const query: Record<string, unknown> = {
        roles: {
          $in: [
            'poster',
            'requester',
            'both',
            'customer',
            'Poster',
            'Requester',
            'Customer',
          ],
        },
        'dataPrivacy.accountDeleted': { $ne: true },
      };

      if (search) {
        const searchRegex = new RegExp(escapeRegex(search), 'i');
        query.$or = [
          { name: searchRegex },
          { phone: searchRegex },
          { email: searchRegex },
        ];
      }

      const periodStart =
        period === 'all'
          ? null
          : new Date(Date.now() - (period === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000);
      const periodEnd = new Date();
      const taskMatch: Record<string, unknown> = {
        createdAt: periodStart
          ? { $gte: periodStart, $lte: periodEnd }
          : { $exists: true, $ne: null, $lte: periodEnd },
      };
      const [profiles, summaries, emailSettings] = await Promise.all([
        Profile.find(query).select('_id uid name phone email').lean(),
        Task.aggregate([
          { $match: taskMatch },
          {
            $project: {
              customerId: {
                $toString: {
                  $ifNull: ['$requesterId', { $ifNull: ['$CustomerId', '$customerId'] }],
                },
              },
              createdAt: 1,
            },
          },
          { $match: { customerId: { $ne: '' } } },
          {
            $group: {
              _id: '$customerId',
              workCount: { $sum: 1 },
              lastWorkPostedAt: { $max: '$createdAt' },
            },
          },
        ]),
        getTaskPostedEmailSettings(),
      ]);
      const summaryByProfileId = new Map(
        summaries.map((summary) => [
          String(summary._id),
          {
            workCount: Number(summary.workCount) || 0,
            lastWorkPostedAt: summary.lastWorkPostedAt
              ? new Date(summary.lastWorkPostedAt).toISOString()
              : null,
          },
        ]),
      );

      const customers = profiles.map((profile) => {
        const profileId = String(profile._id);
        const summary =
          summaryByProfileId.get(profileId) ||
          (profile.uid ? summaryByProfileId.get(profile.uid) : undefined);
        return {
          profileId,
          userId: profile.uid || profileId,
          name: profile.name || 'Unknown customer',
          phone: profile.phone || '',
          email: profile.email || '',
          workCount: summary?.workCount || 0,
          lastWorkPostedAt: summary?.lastWorkPostedAt || null,
        };
      }).filter(
        (customer) =>
          customer.workCount > 0 &&
          !isPhoneInExclusionList(customer.phone, emailSettings.excludedPhones),
      );

      customers.sort((left, right) => {
        if (sort === 'fewest_works' && left.workCount !== right.workCount) {
          return left.workCount - right.workCount;
        }
        if (sort === 'most_works' && left.workCount !== right.workCount) {
          return right.workCount - left.workCount;
        }
        const leftLastWork = left.lastWorkPostedAt
          ? new Date(left.lastWorkPostedAt).getTime()
          : 0;
        const rightLastWork = right.lastWorkPostedAt
          ? new Date(right.lastWorkPostedAt).getTime()
          : 0;
        if (sort === 'recently_posted' && leftLastWork !== rightLastWork) {
          return rightLastWork - leftLastWork;
        }
        if (leftLastWork !== rightLastWork) return rightLastWork - leftLastWork;
        return left.name.localeCompare(right.name);
      });

      const total = customers.length;
      const totalWorksPosted = customers.reduce(
        (sum, customer) => sum + customer.workCount,
        0,
      );
      const start = (page - 1) * limit;

      res.json({
        success: true,
        data: customers.slice(start, start + limit),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
        summary: {
          totalCustomers: total,
          totalWorksPosted,
          averageWorksPerCustomer:
            total > 0 ? totalWorksPosted / total : 0,
        },
      });
    } catch (error) {
      logger.error('List customer activity error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to load customer activity',
      });
    }
  }
}
