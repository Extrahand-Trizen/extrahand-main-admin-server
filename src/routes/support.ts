import { Router } from 'express';
import { SupportController } from '../controllers/SupportController';
import { verifyAuth, requirePermission } from '../middleware/auth';
import { Resource, Action } from '../types/permissions';

const router = Router();

// All routes require authentication
router.use(verifyAuth);

// Support ticket routes
router.get(
  '/tickets',
  requirePermission(`${Resource.SUPPORT_TICKET}.${Action.LIST}`),
  SupportController.listTickets
);

router.get(
  '/tickets/:ticketId',
  requirePermission(`${Resource.SUPPORT_TICKET}.${Action.VIEW}`),
  SupportController.getTicket
);

router.patch(
  '/tickets/:ticketId/status',
  requirePermission(`${Resource.SUPPORT_TICKET}.${Action.UPDATE}`),
  SupportController.updateTicketStatus
);

// Support article routes
router.get(
  '/articles',
  requirePermission(`${Resource.CONTENT}.${Action.LIST}`),
  SupportController.listArticles
);

router.get(
  '/articles/:articleId',
  requirePermission(`${Resource.CONTENT}.${Action.VIEW}`),
  SupportController.getArticle
);

router.post(
  '/articles',
  requirePermission(`${Resource.CONTENT}.${Action.CREATE}`),
  SupportController.createArticle
);

router.patch(
  '/articles/:articleId',
  requirePermission(`${Resource.CONTENT}.${Action.UPDATE}`),
  SupportController.updateArticle
);

router.delete(
  '/articles/:articleId',
  requirePermission(`${Resource.CONTENT}.${Action.DELETE}`),
  SupportController.deleteArticle
);

export default router;
