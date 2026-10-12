import { Router } from 'express';
import multer from 'multer';
import { NotificationController } from '../controllers/NotificationController';
import { AppNotificationController } from '../controllers/AppNotificationController';
import { verifyAuth, requireSuperAdmin } from '../middleware/auth';
import { serviceAuthMiddleware } from '../middleware/serviceAuth';

const router = Router();

const broadcastImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG or WebP images are allowed'));
    }
  },
});

// App user broadcasts (Operations Portal > Notifications) — Super Admin only
router.get('/broadcasts', verifyAuth, requireSuperAdmin, AppNotificationController.listBroadcasts);
router.post('/broadcasts', verifyAuth, requireSuperAdmin, AppNotificationController.sendBroadcast);
router.post('/broadcasts/clear', verifyAuth, requireSuperAdmin, AppNotificationController.clearBroadcasts);
router.post(
  '/broadcasts/image',
  verifyAuth,
  requireSuperAdmin,
  broadcastImageUpload.single('image'),
  AppNotificationController.uploadImage
);
router.post('/broadcasts/:campaignId/cancel', verifyAuth, requireSuperAdmin, AppNotificationController.cancelBroadcast);

router.get('/', verifyAuth, NotificationController.listNotifications);
router.post('/read-all', verifyAuth, NotificationController.markAllRead);
router.post('/:notificationId/read', verifyAuth, NotificationController.markRead);

// Service-auth webhook
router.post('/events', serviceAuthMiddleware, NotificationController.receiveEvent);

export default router;
