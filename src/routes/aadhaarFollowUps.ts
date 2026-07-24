import { Router } from 'express';
import { verifyAuth } from '../middleware/auth';
import { AadhaarFollowUpController } from '../controllers/AadhaarFollowUpController';

const router = Router();

router.use(verifyAuth);

router.get('/', AadhaarFollowUpController.list);

export default router;
