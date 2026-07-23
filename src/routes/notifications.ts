import { Router } from 'express';
import { NotificationController } from '../controllers/NotificationController';
import { verifyAuth } from '../middleware/auth';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';

const router = Router();

router.get('/', verifyAuth, NotificationController.listNotifications);
router.post('/read-all', verifyAuth, NotificationController.markAllRead);
router.post('/:notificationId/read', verifyAuth, NotificationController.markRead);

// Service-auth webhook
router.post('/events', serviceAuthMiddleware, NotificationController.receiveEvent);

export default router;
