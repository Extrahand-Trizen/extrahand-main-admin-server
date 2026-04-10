import { Router } from 'express';
import { AuthController } from '../controllers/AuthController';

const router = Router();

// Public routes
router.post('/login', AuthController.login);
router.get('/verify', AuthController.verify);
router.post('/verify', AuthController.verify);
router.post('/refresh', AuthController.refresh);
router.post('/logout', AuthController.logout);

export default router;
