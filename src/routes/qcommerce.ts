import { Router } from 'express';
import { QcommerceOrderController } from '../controllers/QcommerceOrderController';
import { verifyAuth, requirePermission } from '../middleware/auth';
import { Resource, Action } from '../types/permissions';

const router = Router();

// All routes require authentication
router.use(verifyAuth);

// Order routes
router.get(
  '/orders',
  requirePermission(`${Resource.QCOMMERCE}.${Action.LIST}`),
  QcommerceOrderController.listOrders
);

router.get(
  '/orders/:id',
  requirePermission(`${Resource.QCOMMERCE}.${Action.VIEW}`),
  QcommerceOrderController.getOrder
);

router.post(
  '/orders/:id/assign',
  requirePermission(`${Resource.QCOMMERCE}.${Action.ASSIGN}`),
  QcommerceOrderController.assignHelper
);

router.patch(
  '/orders/:id/status',
  requirePermission(`${Resource.QCOMMERCE}.${Action.UPDATE}`),
  QcommerceOrderController.updateOrderStatus
);

// Filter options routes
router.get(
  '/categories',
  requirePermission(`${Resource.QCOMMERCE}.${Action.LIST}`),
  QcommerceOrderController.getCategories
);

router.get(
  '/subcategories',
  requirePermission(`${Resource.QCOMMERCE}.${Action.LIST}`),
  QcommerceOrderController.getSubcategories
);

router.get(
  '/shops',
  requirePermission(`${Resource.QCOMMERCE}.${Action.LIST}`),
  QcommerceOrderController.getShops
);

export default router;
