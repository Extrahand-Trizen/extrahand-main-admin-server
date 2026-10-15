import { Request, Response } from 'express';
import { locationPricingClient } from '../services/LocationPricingClient';
import { getClientSafeStatus } from '../utils/upstreamHttp';
import logger from '../config/logger';

function normalizeLocationText(value?: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function pickAddressComponent(components: Array<{ long_name?: string; types?: string[] }>, ...types: string[]): string {
  for (const type of types) {
    const match = components.find((component) => component.types?.includes(type));
    if (match?.long_name) return match.long_name.trim();
  }
  return '';
}

async function forward(operation: () => Promise<unknown>, res: Response, label: string): Promise<void> {
  try {
    res.json(await operation());
  } catch (error: any) {
    logger.error(`${label} failed`, error?.response?.data || error);
    const status = getClientSafeStatus(error);
    res.status(status).json({ success: false, error: error?.response?.data?.error || error?.message || `Failed to ${label.toLowerCase()}` });
  }
}

export class LocationPricingController {
  static listLocations(req: Request, res: Response) {
    return forward(() => locationPricingClient.listLocations({
      search: req.query.search ? String(req.query.search) : undefined,
      type: req.query.type ? String(req.query.type) : undefined,
      stateId: req.query.stateId ? String(req.query.stateId) : undefined,
      cityId: req.query.cityId ? String(req.query.cityId) : undefined,
      isActive: req.query.isActive ? String(req.query.isActive) : undefined,
    }), res, 'List locations');
  }

  static createLocation(req: Request, res: Response) {
    return forward(() => locationPricingClient.createLocation(String(req.params.type), req.body), res, 'Create location');
  }

  static updateLocation(req: Request, res: Response) {
    return forward(() => locationPricingClient.updateLocation(String(req.params.type), String(req.params.id), req.body), res, 'Update location');
  }

  static setLocationActive(req: Request, res: Response) {
    const active = req.path.endsWith('/activate');
    return forward(() => locationPricingClient.setLocationActive(String(req.params.type), String(req.params.id), active), res, `${active ? 'Activate' : 'Deactivate'} location`);
  }

  static listHourlySkus(req: Request, res: Response) {
    return forward(() => locationPricingClient.listHourlySkus(), res, 'List hourly SKUs');
  }

  static listPricingCategories(req: Request, res: Response) {
    return forward(() => locationPricingClient.listPricingCategories(), res, 'List pricing categories');
  }

  static listPricingSkus(req: Request, res: Response) {
    return forward(
      () => locationPricingClient.listPricingSkus(
        req.query.categoryId ? String(req.query.categoryId) : undefined,
        req.query.sectionId ? String(req.query.sectionId) : undefined,
      ),
      res,
      'List pricing SKUs',
    );
  }

  static updateSkuGlobalPrice(req: Request, res: Response) {
    return forward(
      () => locationPricingClient.updateSkuGlobalPrice(String(req.params.id), req.body),
      res,
      'Update SKU global price',
    );
  }

  static listHourlyPrices(req: Request, res: Response) {
    return forward(() => locationPricingClient.listHourlyPrices(req.query.skuId ? String(req.query.skuId) : undefined), res, 'List hourly prices');
  }

  static createHourlyPrice(req: Request, res: Response) {
    return forward(() => locationPricingClient.createHourlyPrice(req.body), res, 'Create hourly price');
  }

  static updateHourlyPrice(req: Request, res: Response) {
    return forward(() => locationPricingClient.updateHourlyPrice(String(req.params.id), req.body), res, 'Update hourly price');
  }

  static resolveHourlyPrice(req: Request, res: Response) {
    return forward(() => locationPricingClient.resolveHourlyPrice(req.body), res, 'Resolve hourly price');
  }

  static resolveAddress(req: Request, res: Response) {
    return forward(() => locationPricingClient.resolveAddress(req.body), res, 'Resolve address');
  }

  static listHourlyHelperAvailabilities(req: Request, res: Response) {
    const params = {
      search: req.query.search ? String(req.query.search) : undefined,
      type: req.query.type ? String(req.query.type) : undefined,
      isEnabled: req.query.isEnabled !== undefined ? String(req.query.isEnabled) : undefined,
    };
    return forward(() => locationPricingClient.listHourlyHelperAvailabilities(params), res, 'List hourly helper availabilities');
  }

  static toggleHourlyHelperAvailability(req: Request, res: Response) {
    const { type, id } = req.params;
    const isEnabled = Boolean(req.body.isEnabled);
    const userEmail = (req as any).user?.email || (req as any).user?.uid || 'admin';
    return forward(
      () => locationPricingClient.toggleHourlyHelperAvailability(type, id, isEnabled, userEmail),
      res,
      'Toggle hourly helper availability',
    );
  }

  static removeHourlyHelperAvailability(req: Request, res: Response) {
    const { type, id } = req.params;
    const userEmail = (req as any).user?.email || (req as any).user?.uid || 'admin';
    return forward(
      () => locationPricingClient.removeHourlyHelperAvailability(type, id, userEmail),
      res,
      'Remove hourly helper availability',
    );
  }

  static listPostCompareAreaAvailabilities(req: Request, res: Response) {
    const params = {
      search: req.query.search ? String(req.query.search) : undefined,
    };
    return forward(
      () => locationPricingClient.listPostCompareAreaAvailabilities(params),
      res,
      'List Post & Compare area availabilities',
    );
  }

  static togglePostCompareAreaAvailability(req: Request, res: Response) {
    if (typeof req.body?.isEnabled !== 'boolean') {
      return res.status(400).json({ success: false, error: 'isEnabled must be a boolean' });
    }
    const updatedBy = req.admin?.email || req.admin?.userId || 'admin';
    return forward(
      () => locationPricingClient.togglePostCompareAreaAvailability(
        String(req.params.areaId),
        req.body.isEnabled,
        updatedBy,
      ),
      res,
      'Toggle Post & Compare area availability',
    );
  }

  static searchLocations(req: Request, res: Response) {
    const query = String(req.query.query || '').trim();
    if (query.length < 2) return res.json({ success: true, data: [] });
    return forward(
      async () => ({ success: true, data: await locationPricingClient.searchGooglePlaces(query) }),
      res,
      'Search locations',
    );
  }

  static async ensureGoogleLocation(req: Request, res: Response) {
    const candidate = req.body || {};
    const placeId = String(candidate.placeId || '').trim();
    if (!placeId) {
      return res.status(400).json({ success: false, error: 'A Google place is required' });
    }

    try {
      const details = await locationPricingClient.getGooglePlaceDetails(placeId);
      const addressComponents = Array.isArray(details?.address_components) ? details.address_components : [];
      const normalized = {
        provider: 'google',
        providerPlaceId: placeId,
        formattedAddress: details?.formatted_address || candidate.formattedAddress || candidate.address || '',
        area: pickAddressComponent(addressComponents, 'sublocality_level_1', 'sublocality', 'neighborhood', 'administrative_area_level_3'),
        city: pickAddressComponent(addressComponents, 'locality', 'postal_town', 'administrative_area_level_3'),
        state: pickAddressComponent(addressComponents, 'administrative_area_level_1'),
        country: pickAddressComponent(addressComponents, 'country') || 'India',
        pincode: pickAddressComponent(addressComponents, 'postal_code'),
        latitude: details?.geometry?.location?.lat,
        longitude: details?.geometry?.location?.lng,
      };

      const canonical = await locationPricingClient.ensureCanonicalLocation(normalized);
      return res.json(canonical);
    } catch (error: any) {
      logger.error('ensureGoogleLocation failed', error);
      return res.status(500).json({ success: false, error: error?.message || 'Failed to map the selected Google location' });
    }
  }
}
