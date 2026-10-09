import { Router } from 'express';
import { LocationController } from '../controllers/LocationController';
import { requirePermission, verifyAuth } from '../middleware/auth';
import { Action, Resource } from '../types/permissions';

const router = Router();

router.get('/active', LocationController.getActive);
router.use(verifyAuth);
router.get('/', requirePermission(`${Resource.USER}.${Action.LIST}`), LocationController.getAll);
router.use(requirePermission(`${Resource.USER}.${Action.UPDATE}`));
router.post('/cities', LocationController.createCity);
router.patch('/cities/:cityId', LocationController.updateCity);
router.delete('/cities/:cityId', LocationController.deleteCity);
router.post('/cities/:cityId/zones', LocationController.createZone);
router.patch('/cities/:cityId/zones/:zoneId', LocationController.updateZone);
router.delete('/cities/:cityId/zones/:zoneId', LocationController.deleteZone);
router.post('/cities/:cityId/areas', LocationController.createCityArea);
router.patch('/cities/:cityId/areas/:areaId', LocationController.updateCityArea);
router.delete('/cities/:cityId/areas/:areaId', LocationController.deleteCityArea);
router.post('/cities/:cityId/zones/:zoneId/areas', LocationController.createArea);
router.patch('/cities/:cityId/zones/:zoneId/areas/:areaId', LocationController.updateArea);
router.delete('/cities/:cityId/zones/:zoneId/areas/:areaId', LocationController.deleteArea);

export default router;