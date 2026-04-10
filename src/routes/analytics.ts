import { Router } from 'express';
import { AnalyticsController } from '../controllers/AnalyticsController';
import { verifyAuth, requirePermission } from '../middleware/auth';
import { Resource, Action } from '../types/permissions';

const router = Router();

router.use(verifyAuth);

router.get(
  '/overview',
  requirePermission(`${Resource.ANALYTICS}.${Action.VIEW}`),
  AnalyticsController.getOverview
);

export default router;
