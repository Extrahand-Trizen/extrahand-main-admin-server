import { Router } from 'express';
import { InviteController } from '../controllers/InviteController';

const router = Router();

// Public route - no auth required for accepting invites
router.post('/:inviteId/accept', InviteController.acceptInvite);

export default router;
