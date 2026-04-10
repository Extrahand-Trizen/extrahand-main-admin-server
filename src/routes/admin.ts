import { Router } from 'express';
import { AdminUserController } from '../controllers/AdminUserController';
import { InviteController } from '../controllers/InviteController';
import { verifyAuth, requireSuperAdmin } from '../middleware/auth';

const router = Router();

// All routes require authentication
router.use(verifyAuth);

// Admin user management (Super Admin only)
router.get('/users', requireSuperAdmin, AdminUserController.listUsers);
router.get('/users/:userId', requireSuperAdmin, AdminUserController.getUser);
router.post('/users', requireSuperAdmin, AdminUserController.createUser);
router.put('/users/:userId', requireSuperAdmin, AdminUserController.updateUser);
router.post('/users/:userId/dashboard-access', requireSuperAdmin, AdminUserController.addDashboardAccess);
router.delete('/users/:userId/dashboard-access/:dashboardType', requireSuperAdmin, AdminUserController.removeDashboardAccess);

// Invite management (Super Admin only)
router.post('/invites', requireSuperAdmin, InviteController.createInvite);
router.get('/invites', requireSuperAdmin, InviteController.listInvites);
router.post('/invites/:inviteId/resend', requireSuperAdmin, InviteController.resendInvite);
router.delete('/invites/:inviteId', requireSuperAdmin, InviteController.cancelInvite);

export default router;
