import { Router } from 'express';
import { AdminUserController } from '../controllers/AdminUserController';
import { InviteController } from '../controllers/InviteController';
import { verifyAuth, requireSuperAdmin } from '../middleware/auth';
import { TaskPostedEmailSettingsController } from '../controllers/TaskPostedEmailSettingsController';
import { RoundRobinTeamSettingsController } from '../controllers/RoundRobinTeamSettingsController';
import { WhatsAppNotificationController } from '../controllers/WhatsAppNotificationController';
import multer from 'multer';
import { AppBrandingSettingsController } from '../controllers/AppBrandingSettingsController';

const router = Router();

// All routes require authentication
router.use(verifyAuth);

// Admin user management (Super Admin only)
router.get('/users', requireSuperAdmin, AdminUserController.listUsers);
router.get('/users/:userId', requireSuperAdmin, AdminUserController.getUser);
router.get('/users/:userId/assignments-summary', requireSuperAdmin, AdminUserController.getAssignmentsSummary);
router.post('/users', requireSuperAdmin, AdminUserController.createUser);
router.put('/users/:userId', requireSuperAdmin, AdminUserController.updateUser);
router.delete('/users/:userId', requireSuperAdmin, AdminUserController.deleteAdminUser);
router.post('/users/:userId/transfer-and-delete', requireSuperAdmin, AdminUserController.transferAndDeleteAdminUser);
router.post('/users/:userId/dashboard-access', requireSuperAdmin, AdminUserController.addDashboardAccess);
router.delete('/users/:userId/dashboard-access/:dashboardType', requireSuperAdmin, AdminUserController.removeDashboardAccess);
router.get('/settings/task-posted-email', requireSuperAdmin, TaskPostedEmailSettingsController.get);
router.put('/settings/task-posted-email', requireSuperAdmin, TaskPostedEmailSettingsController.update);
router.get('/settings/whatsapp-notifications', requireSuperAdmin, WhatsAppNotificationController.getSettings);
router.put('/settings/whatsapp-notifications', requireSuperAdmin, WhatsAppNotificationController.updateSettings);
router.get('/settings/round-robin-team', requireSuperAdmin, RoundRobinTeamSettingsController.get);
router.put('/settings/round-robin-team', requireSuperAdmin, RoundRobinTeamSettingsController.update);
router.get('/settings/aadhaar-round-robin-team', requireSuperAdmin, RoundRobinTeamSettingsController.getAadhaar);
router.put('/settings/aadhaar-round-robin-team', requireSuperAdmin, RoundRobinTeamSettingsController.updateAadhaar);

const appLogoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG or WebP images are allowed'));
    }
  },
});
router.get('/settings/app-branding', requireSuperAdmin, AppBrandingSettingsController.get);
router.post(
  '/settings/app-branding/logo',
  requireSuperAdmin,
  appLogoUpload.single('image'),
  AppBrandingSettingsController.uploadLogo,
);
router.delete('/settings/app-branding/logo', requireSuperAdmin, AppBrandingSettingsController.resetLogo);
router.post(
  '/settings/app-branding/launcher-icon',
  requireSuperAdmin,
  appLogoUpload.single('image'),
  AppBrandingSettingsController.uploadLauncherIcon,
);
router.delete(
  '/settings/app-branding/launcher-icon',
  requireSuperAdmin,
  AppBrandingSettingsController.resetLauncherIcon,
);
router.post(
  '/settings/app-branding/launcher-icons',
  requireSuperAdmin,
  appLogoUpload.single('image'),
  AppBrandingSettingsController.addLauncherIcon,
);
router.delete(
  '/settings/app-branding/launcher-icons/:iconId',
  requireSuperAdmin,
  AppBrandingSettingsController.deleteLauncherIcon,
);
router.put(
  '/settings/app-branding/active-icon',
  requireSuperAdmin,
  AppBrandingSettingsController.activateLauncherIcon,
);

// Invite management (Super Admin only)
router.post('/invites', requireSuperAdmin, InviteController.createInvite);
router.get('/invites', requireSuperAdmin, InviteController.listInvites);
router.post('/invites/:inviteId/resend', requireSuperAdmin, InviteController.resendInvite);
router.delete('/invites/:inviteId', requireSuperAdmin, InviteController.cancelInvite);

export default router;
