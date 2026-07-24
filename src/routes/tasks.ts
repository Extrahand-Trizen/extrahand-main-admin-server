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

router.get(
  '/assignments/status',
  requireSuperAdmin,
  TaskManagementController.getAssignmentStatus
);

router.post(
  '/assignments/backfill',
  requireSuperAdmin,
  TaskManagementController.backfillTaskAssignments
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

router.post(
  '/:taskId/unassign',
  requirePermission(`${Resource.TASK}.${Action.UPDATE}`),
  TaskManagementController.unassignHelper
);

router.post(
  '/:taskId/assign',
  requirePermission(`${Resource.TASK}.${Action.UPDATE}`),
  TaskManagementController.assignHelper
);

router.post(
  '/:taskId/assign-partner',
  requirePermission(`${Resource.TASK}.${Action.UPDATE}`),
  TaskManagementController.assignPartner
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
