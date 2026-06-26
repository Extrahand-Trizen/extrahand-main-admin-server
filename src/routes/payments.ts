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

router.post(
  '/transactions/enrich',
  requirePermission(`${Resource.PAYMENT}.${Action.LIST}`),
  PaymentController.enrichTransactionsBatch
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

router.post(
  '/payouts/enrich',
  requirePermission(`${Resource.PAYMENT}.${Action.LIST}`),
  PaymentController.enrichPayoutsBatch
);

router.patch(
  '/payouts/:id/status',
  requirePermission(`${Resource.PAYMENT}.${Action.UPDATE}`),
  PaymentController.updatePayoutStatus
);

router.patch(
  '/payouts/:id/team-test',
  requirePermission(`${Resource.PAYMENT}.${Action.UPDATE}`),
  PaymentController.markPayoutTeamTest
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

router.post(
  '/refunds/enrich',
  requirePermission(`${Resource.PAYMENT}.${Action.LIST}`),
  PaymentController.enrichRefundsBatch
);

router.patch(
  '/refunds/:id/team-test',
  requirePermission(`${Resource.PAYMENT}.${Action.UPDATE}`),
  PaymentController.markRefundTeamTest
);

router.get(
  '/ledger',
  requirePermission(`${Resource.PAYMENT}.${Action.LIST}`),
  PaymentController.listLedger
);

router.post(
  '/ledger/enrich',
  requirePermission(`${Resource.PAYMENT}.${Action.LIST}`),
  PaymentController.enrichLedgerBatch
);

router.delete(
  '/transactions/:id',
  requirePermission(`${Resource.PAYMENT}.${Action.DELETE}`),
  PaymentController.deleteTransaction
);

router.delete(
  '/payouts/:id',
  requirePermission(`${Resource.PAYMENT}.${Action.DELETE}`),
  PaymentController.deletePayout
);

router.delete(
  '/refunds/:id',
  requirePermission(`${Resource.PAYMENT}.${Action.DELETE}`),
  PaymentController.deleteRefund
);

export default router;

