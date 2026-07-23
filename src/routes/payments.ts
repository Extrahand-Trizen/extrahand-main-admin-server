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

router.patch(
  '/transactions/:id/team-test',
  requirePermission(`${Resource.PAYMENT}.${Action.UPDATE}`),
  PaymentController.markTransactionTeamTest
);

router.get(
  '/payouts',
  requirePermission(`${Resource.PAYMENT}.${Action.LIST}`),
  PaymentController.listPayouts
);

router.patch(
  '/payouts/:id/status',
  requirePermission(`${Resource.PAYMENT}.${Action.UPDATE}`),
  PaymentController.updatePayoutStatus
);

router.get(
  '/users/:id/bank-accounts',
  requirePermission(`${Resource.PAYMENT}.${Action.VIEW}`),
  PaymentController.getUserBankAccounts
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
