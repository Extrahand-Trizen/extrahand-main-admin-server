import { Router } from 'express';
import { PaymentController } from '../controllers/PaymentController';
import { verifyAuth, requirePermission } from '../middleware/auth';
import { Action, Resource } from '../types/permissions';

const router = Router();

router.use(verifyAuth);

router.get(
  '/overview',
  requirePermission(`${Resource.PAYMENT}.${Action.VIEW}`),
  PaymentController.getOverview
);

router.get(
  '/transactions',
  requirePermission(`${Resource.PAYMENT}.${Action.LIST}`),
  PaymentController.listTransactions
);

router.get(
  '/payouts',
  requirePermission(`${Resource.PAYMENT}.${Action.LIST}`),
  PaymentController.listPayouts
);

router.get(
  '/refunds',
  requirePermission(`${Resource.PAYMENT}.${Action.LIST}`),
  PaymentController.listRefunds
);

router.get(
  '/ledger',
  requirePermission(`${Resource.PAYMENT}.${Action.LIST}`),
  PaymentController.listLedger
);

export default router;
