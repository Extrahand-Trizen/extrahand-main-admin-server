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
router.get('/skus', LocationPricingController.listPricingSkus);
router.get('/hourly-prices', LocationPricingController.listHourlyPrices);
router.post('/hourly-prices', auditMiddleware('hourly_pricing.created', 'hourly_pricing'), LocationPricingController.createHourlyPrice);
router.patch('/hourly-prices/:id', auditMiddleware('hourly_pricing.updated', 'hourly_pricing'), LocationPricingController.updateHourlyPrice);
router.post('/hourly-prices/resolve', LocationPricingController.resolveHourlyPrice);
router.post('/resolve-address', LocationPricingController.resolveAddress);

export default router;
