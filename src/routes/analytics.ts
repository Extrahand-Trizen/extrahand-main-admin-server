import { Router } from 'express';
import { AnalyticsController } from '../controllers/AnalyticsController';
import { verifyAuth, requirePermission } from '../middleware/auth';
import { Resource, Action } from '../types/permissions';
import { analyticsRateLimit } from '../middleware/analyticsRateLimit';

const router = Router();

router.use(verifyAuth);
router.use(analyticsRateLimit({ windowMs: 60_000, max: 60 }));

router.get(
  '/tasks/categories',
  requirePermission(`${Resource.ANALYTICS}.${Action.VIEW}`),
  AnalyticsController.getTaskCategoryBreakdown
);

router.get(
  '/tasks/categories/performance',
  requirePermission(`${Resource.ANALYTICS}.${Action.VIEW}`),
  AnalyticsController.getTaskCategoryPerformance
);

router.get(
  '/tasks/cancellations',
  requirePermission(`${Resource.ANALYTICS}.${Action.VIEW}`),
  AnalyticsController.getTaskCancellationAnalytics
);

router.get(
  '/Customers/verification-comparison',
  requirePermission(`${Resource.ANALYTICS}.${Action.VIEW}`),
  AnalyticsController.getCustomerVerificationComparison
);

router.get(
  '/Customers/:requesterId',
  requirePermission(`${Resource.ANALYTICS}.${Action.VIEW}`),
  AnalyticsController.getCustomerAnalytics
);

router.get(
  '/users/:userId',
  requirePermission(`${Resource.ANALYTICS}.${Action.VIEW}`),
  AnalyticsController.getUserAnalytics
);

router.get(
  '/overview',
  requirePermission(`${Resource.ANALYTICS}.${Action.VIEW}`),
  AnalyticsController.getOverview
);

export default router;
