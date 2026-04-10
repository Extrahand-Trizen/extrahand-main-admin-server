import { Router } from 'express';
import { TaskManagementController } from '../controllers/TaskManagementController';
import { verifyAuth, requirePermission } from '../middleware/auth';
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
