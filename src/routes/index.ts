import { Router } from 'express';
import authRoutes from './auth';
import adminRoutes from './admin';
import userRoutes from './users';
import taskRoutes from './tasks';
import inviteRoutes from './invites';
import supportRoutes from './support';
import analyticsRoutes from './analytics';
import applicationRoutes from './applications';
import paymentRoutes from './payments';

const router = Router();

// API version prefix
const API_PREFIX = '/api/v1';

// Routes
router.use(`${API_PREFIX}/auth`, authRoutes);
router.use(`${API_PREFIX}/admin`, adminRoutes);
router.use(`${API_PREFIX}/users`, userRoutes);
router.use(`${API_PREFIX}/tasks`, taskRoutes);
router.use(`${API_PREFIX}/applications`, applicationRoutes);
router.use(`${API_PREFIX}/invites`, inviteRoutes);
router.use(`${API_PREFIX}/support`, supportRoutes);
router.use(`${API_PREFIX}/analytics`, analyticsRoutes);
router.use(`${API_PREFIX}/payments`, paymentRoutes);

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Main Admin Service is running',
    timestamp: new Date().toISOString(),
  });
});

export default router;
