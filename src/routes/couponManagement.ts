import { Router } from 'express';
import { CouponManagementController } from '../controllers/CouponManagementController';
import { verifyAuth, requireOperationsAdminOrSuperAdmin } from '../middleware/auth';

const router = Router();

router.use(verifyAuth, requireOperationsAdminOrSuperAdmin);
router.all('*', CouponManagementController.proxy);

export default router;
