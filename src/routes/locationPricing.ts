import { Router } from 'express';
import { LocationPricingController } from '../controllers/LocationPricingController';
import { requireSuperAdmin, verifyAuth } from '../middleware/auth';
import { auditMiddleware } from '../middleware/audit';

const router = Router();

// Google search is read-only and does not expose pricing or canonical mutations.
router.get('/location-search', LocationPricingController.searchLocations);

// Canonical location and pricing operations remain Super Admin-only.
router.use(verifyAuth, requireSuperAdmin);
router.post('/ensure-google-location', LocationPricingController.ensureGoogleLocation);
router.get('/locations', LocationPricingController.listLocations);
router.post('/locations/:type', auditMiddleware('location.created', 'location'), LocationPricingController.createLocation);
router.patch('/locations/:type/:id', auditMiddleware('location.updated', 'location'), LocationPricingController.updateLocation);
router.post('/locations/:type/:id/activate', auditMiddleware('location.activated', 'location'), LocationPricingController.setLocationActive);
router.post('/locations/:type/:id/deactivate', auditMiddleware('location.deactivated', 'location'), LocationPricingController.setLocationActive);
router.get('/hourly-skus', LocationPricingController.listHourlySkus);
router.get('/categories', LocationPricingController.listPricingCategories);
router.patch('/categories/:id/min-order-value', auditMiddleware('category.min_order_value.updated', 'category', (req) => req.params.id), LocationPricingController.updateCategoryMinOrderValue);
router.get('/skus', LocationPricingController.listPricingSkus);
router.patch(
  '/skus/:id/global-price',
  auditMiddleware('sku.global_price.updated', 'sku', (req) => req.params.id),
  LocationPricingController.updateSkuGlobalPrice,
);
router.get('/hourly-prices', LocationPricingController.listHourlyPrices);
router.post('/hourly-prices', auditMiddleware('hourly_pricing.created', 'hourly_pricing'), LocationPricingController.createHourlyPrice);
router.patch('/hourly-prices/:id', auditMiddleware('hourly_pricing.updated', 'hourly_pricing'), LocationPricingController.updateHourlyPrice);
router.post('/hourly-prices/resolve', LocationPricingController.resolveHourlyPrice);
router.post('/resolve-address', LocationPricingController.resolveAddress);
router.get('/hourly-availability', LocationPricingController.listHourlyHelperAvailabilities);
router.post('/hourly-availability/:type/:id/toggle', auditMiddleware('hourly_availability.toggled', 'location'), LocationPricingController.toggleHourlyHelperAvailability);
router.delete('/hourly-availability/:type/:id', auditMiddleware('hourly_availability.removed', 'location'), LocationPricingController.removeHourlyHelperAvailability);
router.get('/post-compare-availability/areas', LocationPricingController.listPostCompareAreaAvailabilities);
router.post(
  '/post-compare-availability/areas/:areaId/toggle',
  auditMiddleware('post_compare_availability.toggled', 'location', (req) => req.params.areaId),
  LocationPricingController.togglePostCompareAreaAvailability,
);

export default router;
