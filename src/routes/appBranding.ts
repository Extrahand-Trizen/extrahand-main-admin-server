import { Router } from 'express';
import { AppBrandingSettingsController } from '../controllers/AppBrandingSettingsController';

const router = Router();

router.get('/', AppBrandingSettingsController.get);

export default router;
