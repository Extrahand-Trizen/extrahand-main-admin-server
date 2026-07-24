import { Router } from 'express';
import { TaskServiceClient } from '../services/TaskServiceClient';
import { UserServiceClient } from '../services/UserServiceClient';
import { verifyAuth } from '../middleware/auth';

const router = Router();
const taskClient = new TaskServiceClient();
const userClient = new UserServiceClient();

router.use(verifyAuth);

router.get('/assignments/pending', async (req, res, next) => {
  try {
    const data = await taskClient.listPendingBookNowAssignments(req.query);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post('/assignments/assign', async (req, res, next) => {
  try {
    const adminUid = (req as { adminUser?: { uid?: string } }).adminUser?.uid ?? 'admin';
    const data = await taskClient.assignBookNowHelper({ ...req.body, assignedByUid: adminUid });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.get('/supply/applications/pending', async (req, res, next) => {
  try {
    const data = await userClient.listPendingSupplyApplications(req.query);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post('/supply/applications/:id/approve', async (req, res, next) => {
  try {
    const adminUid = (req as { adminUser?: { uid?: string } }).adminUser?.uid ?? 'admin';
    const data = await userClient.reviewSupplyApplication(req.params.id, 'approve', adminUid, req.body);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

router.post('/supply/applications/:id/reject', async (req, res, next) => {
  try {
    const adminUid = (req as { adminUser?: { uid?: string } }).adminUser?.uid ?? 'admin';
    const data = await userClient.reviewSupplyApplication(req.params.id, 'reject', adminUid, req.body);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

export default router;
