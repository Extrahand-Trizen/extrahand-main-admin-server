import { Router } from 'express';
import { PayoutOpsController } from '../controllers/PayoutOpsController';
import { verifyAuth, requirePermission } from '../middleware/auth';
import { Resource, Action } from '../types/permissions';

const router = Router();

router.use(verifyAuth);

router.get(
  '/ops/manual-queue',
  requirePermission(`${Resource.PAYOUT}.${Action.LIST}`),
  PayoutOpsController.listManualOpsQueue,
);

export default router;
