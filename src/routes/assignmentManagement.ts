import { Router } from 'express';
import { AssignmentManagementController } from '../controllers/AssignmentManagementController';
import { verifyAuth, requirePermission } from '../middleware/auth';
import { Action, Resource } from '../types/permissions';

const router = Router();
router.use(verifyAuth);

router.get('/', requirePermission(`${Resource.TASK}.${Action.LIST}`), AssignmentManagementController.getRules);
router.post('/preferred-partners', requirePermission(`${Resource.TASK}.${Action.UPDATE}`), AssignmentManagementController.addPreferredPartner);
router.delete('/preferred-partners/:profileId', requirePermission(`${Resource.TASK}.${Action.UPDATE}`), AssignmentManagementController.removePreferredPartner);
router.post('/preferred-partners/reorder', requirePermission(`${Resource.TASK}.${Action.UPDATE}`), AssignmentManagementController.reorderPreferredPartners);
router.post('/excluded-phones', requirePermission(`${Resource.TASK}.${Action.UPDATE}`), AssignmentManagementController.addExcludedPhone);
router.delete('/excluded-phones/:phone', requirePermission(`${Resource.TASK}.${Action.UPDATE}`), AssignmentManagementController.removeExcludedPhone);
router.post('/area-rules', requirePermission(`${Resource.TASK}.${Action.UPDATE}`), AssignmentManagementController.saveAreaRule);
router.delete('/area-rules/:area', requirePermission(`${Resource.TASK}.${Action.UPDATE}`), AssignmentManagementController.removeAreaRule);
router.post('/area-rules/reorder', requirePermission(`${Resource.TASK}.${Action.UPDATE}`), AssignmentManagementController.reorderAreaRulePartners);

export default router;
