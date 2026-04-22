import { Router } from 'express';
import { TaskManagementController } from '../controllers/TaskManagementController';
import { verifyAuth, requirePermission } from '../middleware/auth';
import { Resource, Action } from '../types/permissions';

const router = Router();

router.use(verifyAuth);

router.get(
  '/',
  requirePermission(`${Resource.TASK_APPLICATION}.${Action.LIST}`),
  TaskManagementController.listApplications
);

export default router;
