import { Router } from 'express';
import multer from 'multer';
import { ServiceCatalogController } from '../controllers/ServiceCatalogController';
import { verifyAuth, requireOperationsAdminOrSuperAdmin } from '../middleware/auth';
import { auditMiddleware } from '../middleware/audit';

const router = Router();

router.use(verifyAuth, requireOperationsAdminOrSuperAdmin);
router.get('/', ServiceCatalogController.list);
router.get('/book-now-availability', ServiceCatalogController.listBookNowLocationAvailability);
router.patch(
  '/book-now-availability/:type/:id',
  auditMiddleware('service.location_availability_updated', 'service', (req) =>
    `${req.params.type}:${req.params.id}:${req.body?.catalogId || 'all'}:${req.body?.isEnabled ? 'enabled' : 'disabled'}`,
  ),
  ServiceCatalogController.updateBookNowLocationAvailability,
);
router.delete(
  '/book-now-availability/:type/:id',
  auditMiddleware('service.location_availability_removed', 'service', (req) =>
    `${req.params.type}:${req.params.id}`,
  ),
  ServiceCatalogController.removeBookNowLocation,
);
const serviceImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      callback(null, true);
    } else {
      callback(new Error('Only JPG, PNG or WebP images are allowed'));
    }
  },
});
router.post('/upload-image', serviceImageUpload.single('image'), ServiceCatalogController.uploadImage);
router.post(
  '/',
  auditMiddleware('service.created', 'service', (req) =>
    String(req.body?.name || 'new-service'),
  ),
  ServiceCatalogController.create,
);
router.patch(
  '/:id/status',
  auditMiddleware('service.updated', 'service'),
  ServiceCatalogController.updateStatus,
);
router.patch(
  '/:id',
  auditMiddleware('service.updated', 'service'),
  ServiceCatalogController.update,
);
router.patch(
  '/:id/image',
  auditMiddleware('service.image_updated', 'service'),
  ServiceCatalogController.updateImage,
);
router.patch(
  '/:id/offer',
  auditMiddleware('service.offer_updated', 'service'),
  ServiceCatalogController.updateOffer,
);

export default router;
