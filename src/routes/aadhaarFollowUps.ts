import { Router } from 'express';
import { verifyAuth } from '../middleware/auth';
import { AadhaarFollowUpController } from '../controllers/AadhaarFollowUpController';
import { AadhaarWhatsAppController } from '../controllers/AadhaarWhatsAppController';

const router = Router();

router.post('/whatsapp/delivery-status', AadhaarWhatsAppController.deliveryStatus);
router.use(verifyAuth);

router.get('/', AadhaarFollowUpController.list);
router.get('/whatsapp/templates', AadhaarWhatsAppController.templates);
router.get('/:userId/whatsapp-notifications', AadhaarWhatsAppController.history);
router.post('/:userId/whatsapp-notifications', AadhaarWhatsAppController.send);

export default router;
