import { Router } from 'express';
import { FeeManagementController } from '../controllers/FeeManagementController';
import { verifyAuth, requireOperationsAdminOrSuperAdmin } from '../middleware/auth';
import { auditMiddleware } from '../middleware/audit';

const router = Router();

router.use(verifyAuth, requireOperationsAdminOrSuperAdmin);
router.get('/categories', FeeManagementController.list);
router.put(
  '/categories/:categoryKey',
  auditMiddleware('fee.category_updated', 'fee_category', (req) => String(req.params.categoryKey)),
  FeeManagementController.upsert,
);
router.delete(
  '/categories/:categoryKey',
  auditMiddleware('fee.category_deleted', 'fee_category', (req) => String(req.params.categoryKey)),
  FeeManagementController.remove,
);

export default router;
