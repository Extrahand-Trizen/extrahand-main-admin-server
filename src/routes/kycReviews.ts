import { Router } from 'express';
import multer from 'multer';
import { verifyAuth } from '../middleware/auth';
import { KycReviewController } from '../controllers/KycReviewController';

const router = Router();

const aadhaarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype?.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  },
});

router.use(verifyAuth);

router.get('/', KycReviewController.list);
router.get('/my-claims', KycReviewController.myClaims);
router.get('/ops-admins', KycReviewController.listOpsAdmins);
router.get('/:userId/documents', KycReviewController.getDocuments);
router.get('/:userId/upload-status', KycReviewController.getUploadStatus);
router.post('/:userId/claim', KycReviewController.claim);
router.post('/:userId/unclaim', KycReviewController.unclaim);
router.post('/:userId/transfer', KycReviewController.transfer);
router.post('/:userId/accept', KycReviewController.accept);
router.post('/:userId/reject', KycReviewController.reject);
router.patch('/:userId/follow-up', KycReviewController.updateFollowUp);

// Aadhaar document upload by admin (for users without DigiLocker)
router.post(
  '/:userId/upload-aadhaar',
  aadhaarUpload.single('file'),
  KycReviewController.uploadAadhaarDocument,
);

export default router;
