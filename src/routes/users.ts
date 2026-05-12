import { Router } from 'express';
import { UserManagementController } from '../controllers/UserManagementController';
import { verifyAuth, requirePermission } from '../middleware/auth';
import { Resource, Action } from '../types/permissions';

const router = Router();

// All routes require authentication
router.use(verifyAuth);

// User management routes
router.get(
  '/',
  requirePermission(`${Resource.USER}.${Action.LIST}`),
  UserManagementController.listUsers
);

// GET  /cleanup/no-role?dry_run=true  — preview users with no role (safe, no deletion)
// POST /cleanup/no-role               — delete users with no role (body: { dry_run: false })
router.get(
  '/cleanup/no-role',
  requirePermission(`${Resource.USER}.${Action.LIST}`),
  UserManagementController.cleanupUsersWithoutRoles
);
router.post(
  '/cleanup/no-role',
  requirePermission(`${Resource.USER}.${Action.UPDATE}`),
  UserManagementController.cleanupUsersWithoutRoles
);

router.get(
  '/:userId',
  requirePermission(`${Resource.USER}.${Action.VIEW}`),
  UserManagementController.getUser
);

router.patch(
  '/:userId',
  requirePermission(`${Resource.USER}.${Action.UPDATE}`),
  UserManagementController.updateUser
);

router.post(
  '/:userId/ban',
  requirePermission(`${Resource.USER}.${Action.BAN}`),
  UserManagementController.banUser
);

router.post(
  '/:userId/unban',
  requirePermission(`${Resource.USER}.${Action.UNBAN}`),
  UserManagementController.unbanUser
);

router.post(
  '/:userId/suspend',
  requirePermission(`${Resource.USER}.${Action.SUSPEND}`),
  UserManagementController.suspendUser
);

router.post(
  '/:userId/unsuspend',
  requirePermission(`${Resource.USER}.${Action.UNSUSPEND}`),
  UserManagementController.unsuspendUser
);

export default router;
