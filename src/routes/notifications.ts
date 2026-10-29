import { Router } from 'express';
import multer from 'multer';
import { NotificationController } from '../controllers/NotificationController';
import { AppNotificationController } from '../controllers/AppNotificationController';
import { WhatsAppNotificationController } from '../controllers/WhatsAppNotificationController';
import { verifyAuth, requireOperationsAdminOrSuperAdmin, requirePermission } from '../middleware/auth';
import { Action, Resource } from '../types/permissions';
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

// App user broadcasts (Operations Portal > Notifications) — Operations Admin and Super Admin
router.get('/broadcasts', verifyAuth, requireOperationsAdminOrSuperAdmin, AppNotificationController.listBroadcasts);
router.post('/broadcasts', verifyAuth, requireOperationsAdminOrSuperAdmin, AppNotificationController.sendBroadcast);
router.post('/broadcasts/clear', verifyAuth, requireOperationsAdminOrSuperAdmin, AppNotificationController.clearBroadcasts);
router.post(
  '/broadcasts/image',
  verifyAuth,
  requireOperationsAdminOrSuperAdmin,
  broadcastImageUpload.single('image'),
  AppNotificationController.uploadImage
);
router.post('/broadcasts/:campaignId/cancel', verifyAuth, requireOperationsAdminOrSuperAdmin, AppNotificationController.cancelBroadcast);

router.get('/', verifyAuth, NotificationController.listNotifications);
router.post('/read-all', verifyAuth, NotificationController.markAllRead);
router.post('/:notificationId/read', verifyAuth, NotificationController.markRead);

// Service-auth webhook
router.post('/events', serviceAuthMiddleware, NotificationController.receiveEvent);
router.post(
  '/work-whatsapp-dispatch',
  serviceAuthMiddleware,
  WhatsAppNotificationController.dispatchWork,
);
router.post(
  '/work-whatsapp-dispatch/send',
  verifyAuth,
  requirePermission(`${Resource.TASK}.${Action.UPDATE}`),
  WhatsAppNotificationController.dispatchWork,
);
router.get(
  '/work-whatsapp-dispatch/status',
  verifyAuth,
  requirePermission(`${Resource.TASK}.${Action.VIEW}`),
  WhatsAppNotificationController.getDispatchStatuses,
);
router.post(
  '/work-whatsapp-dispatch/resend',
  verifyAuth,
  requirePermission(`${Resource.TASK}.${Action.UPDATE}`),
  WhatsAppNotificationController.resendWork,
);

export default router;
