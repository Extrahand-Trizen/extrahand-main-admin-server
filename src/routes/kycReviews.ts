import { Router } from 'express';
import { verifyAuth } from '../middleware/auth';
import { KycReviewController } from '../controllers/KycReviewController';

const router = Router();

router.use(verifyAuth);

router.get('/', KycReviewController.list);
router.post('/:userId/accept', KycReviewController.accept);
router.post('/:userId/reject', KycReviewController.reject);
router.patch('/:userId/follow-up', KycReviewController.updateFollowUp);

export default router;
