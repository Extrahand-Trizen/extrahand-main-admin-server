import { Router } from 'express';
import { TeamWorkController } from '../controllers/TeamWorkController';
import { requireSuperAdmin, verifyAuth } from '../middleware/auth';

const router = Router();

router.use(verifyAuth, requireSuperAdmin);

router.get('/', TeamWorkController.list);
router.get('/customers/:customerId', TeamWorkController.customer);
router.get('/workers/:workerId', TeamWorkController.worker);
router.get('/:workId/helpers', TeamWorkController.helpers);
router.get('/:workId/status-history', TeamWorkController.statusHistory);
router.get('/:workId', TeamWorkController.get);

export default router;
