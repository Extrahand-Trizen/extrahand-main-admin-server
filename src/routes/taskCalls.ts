import { Router } from 'express';
import { verifyAuth } from '../middleware/auth';
import { TaskCallController } from '../controllers/TaskCallController';

const router = Router();

router.use(verifyAuth);

router.get('/', TaskCallController.list);
router.get('/:taskId', TaskCallController.get);
router.patch('/:taskId/status', TaskCallController.updateStatus);
router.post('/:taskId/notes', TaskCallController.addNote);

export default router;
