import { Router } from 'express';
import { TaskManagementController } from '../controllers/TaskManagementController';
import { verifyAuth, requirePermission, requireSuperAdmin } from '../middleware/auth';
import { Resource, Action } from '../types/permissions';

const router = Router();

// All routes require authentication
router.use(verifyAuth);

// Task management routes
router.get(
  '/',
  requirePermission(`${Resource.TASK}.${Action.LIST}`),
  TaskManagementController.listTasks
);

// Delete-request workflows (must come before "/:taskId" routes)
router.get(
  '/delete-requests',
  requireSuperAdmin,
  TaskManagementController.listDeleteRequests
);

router.post(
  '/delete-requests/:requestId/approve',
  requireSuperAdmin,
  TaskManagementController.approveDeleteRequest
);

router.post(
  '/delete-requests/:requestId/reject',
  requireSuperAdmin,
  TaskManagementController.rejectDeleteRequest
);

// Recycle bin
router.get(
  '/recycle-bin',
  requireSuperAdmin,
  TaskManagementController.listDeletedTasks
);

router.delete(
  '/:taskId/permanent',
  requireSuperAdmin,
  TaskManagementController.permanentlyDeleteTask
);

router.get(
  '/:taskId',
  requirePermission(`${Resource.TASK}.${Action.VIEW}`),
  TaskManagementController.getTask
);

router.patch(
  '/:taskId',
  requirePermission(`${Resource.TASK}.${Action.UPDATE}`),
  TaskManagementController.updateTask
);

router.delete(
  '/:taskId',
  requirePermission(`${Resource.TASK}.${Action.DELETE}`),
  TaskManagementController.deleteTask
);

router.post(
  '/:taskId/delete-requests',
  requirePermission(`${Resource.TASK}.${Action.DELETE}`),
  TaskManagementController.createDeleteRequest
);

router.post(
  '/:taskId/restore',
  requireSuperAdmin,
  TaskManagementController.restoreTask
);

router.get(
  '/:taskId/applications',
  requirePermission(`${Resource.TASK_APPLICATION}.${Action.LIST}`),
  TaskManagementController.getTaskApplications
);

router.patch(
  '/:taskId/applications/:applicationId',
  requirePermission(`${Resource.TASK_APPLICATION}.${Action.UPDATE}`),
  TaskManagementController.updateApplicationStatus
);

export default router;
