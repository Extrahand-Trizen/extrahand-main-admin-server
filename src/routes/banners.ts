import { Router } from 'express';
import multer from 'multer';
import { BannerController } from '../controllers/BannerController';
import { verifyAuth } from '../middleware/auth';
import { auditMiddleware } from '../middleware/audit';

const router = Router();

router.use(verifyAuth);

const bannerImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG or WebP images are allowed'));
    }
  },
});

router.get('/', BannerController.listBanners);
router.get('/:id', BannerController.getBannerById);
router.post('/upload-image', bannerImageUpload.single('image'), BannerController.uploadBannerImage);
router.post('/', auditMiddleware('banner.created', 'banner'), BannerController.createBanner);
router.patch('/:id', auditMiddleware('banner.updated', 'banner'), BannerController.updateBanner);
router.delete('/:id', auditMiddleware('banner.deleted', 'banner'), BannerController.deleteBanner);
router.post('/reorder', auditMiddleware('banner.reordered', 'banner'), BannerController.reorderBanners);

export default router;
