import { Request, Response } from 'express';
import { getLocationCatalog } from '../models/LocationCatalog';
import logger from '../config/logger';

type LocationNode = {
  id: string;
  name: string;
  enabled: boolean;
  zones?: LocationNode[];
  areas?: LocationNode[];
  latitude?: number;
  longitude?: number;
};

type Mutation = (cities: LocationNode[], req: Request) => void;

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function requireName(value: unknown): string {
  const name = String(value || '').trim();
  if (!name || name.length > 100) {
    const error = new Error('Name is required and must be 100 characters or fewer') as Error & { status?: number };
    error.status = 400;
    throw error;
  }
  return name;
}

function findNode(nodes: LocationNode[] | undefined, id: string): LocationNode | undefined {
  return nodes?.find((node) => node.id === id);
}

function ensureUniqueName(nodes: LocationNode[], name: string, currentId?: string): void {
  if (nodes.some((node) => node.id !== currentId && node.name.toLowerCase() === name.toLowerCase())) {
    const error = new Error('A location with this name already exists at this level') as Error & { status?: number };
    error.status = 409;
    throw error;
  }
}

function ensureNode(nodes: LocationNode[] | undefined, id: string, type: string): LocationNode {
  const node = findNode(nodes, id);
  if (!node) {
    const error = new Error(`${type} not found`) as Error & { status?: number };
    error.status = 404;
    throw error;
  }
  return node;
}

function locationId(nodes: LocationNode[], name: string): string {
  const base = slugify(name) || 'location';
  let id = base;
  let suffix = 2;
  while (nodes.some((node) => node.id === id)) id = `${base}-${suffix++}`;
  return id;
}

function activeCatalog(cities: LocationNode[]): LocationNode[] {
  return cities
    .filter((city) => city.enabled !== false)
    .map((city) => ({
      ...city,
      areas: (city.areas || []).filter((area) => area.enabled !== false),
      zones: city.areas?.length ? [] : (city.zones || [])
        .filter((zone) => zone.enabled !== false)
        .map((zone) => ({
          ...zone,
          areas: (zone.areas || []).filter((area) => area.enabled !== false),
        })),
    }));
}

async function saveMutation(req: Request, res: Response, mutation: Mutation): Promise<void> {
  try {
    const catalog = await getLocationCatalog();
    const cities = (catalog?.get('cities') || []) as LocationNode[];
    mutation(cities, req);
    catalog?.set('cities', cities);
    catalog?.markModified('cities');
    catalog?.set('updatedBy', req.admin?.userId);
    await catalog?.save();
    res.json({ success: true, data: { cities } });
  } catch (error) {
    const status = (error as Error & { status?: number }).status || 500;
    if (status >= 500) logger.error('Location catalog mutation failed:', error);
    res.status(status).json({
      success: false,
      error: status === 500 ? 'Failed to update location catalog' : (error as Error).message,
    });
  }
}

export class LocationController {
  static async getActive(_req: Request, res: Response): Promise<void> {
    try {
      const catalog = await getLocationCatalog();
      const cities = (catalog?.get('cities') || []) as LocationNode[];
      res.setHeader('Cache-Control', 'no-store');
      res.json({ success: true, data: { cities: activeCatalog(cities) } });
    } catch (error) {
      logger.error('Get active locations failed:', error);
      res.status(500).json({ success: false, error: 'Failed to load locations' });
    }
  }

  static async getAll(_req: Request, res: Response): Promise<void> {
    try {
      const catalog = await getLocationCatalog();
      res.json({ success: true, data: { cities: catalog?.get('cities') || [] } });
    } catch (error) {
      logger.error('Get location catalog failed:', error);
      res.status(500).json({ success: false, error: 'Failed to load location catalog' });
    }
  }

  static createCity(req: Request, res: Response): Promise<void> {
    return saveMutation(req, res, (cities) => {
      const name = requireName(req.body.name);
      ensureUniqueName(cities, name);
      cities.push({ id: locationId(cities, name), name, enabled: true, zones: [] });
    });
  }

  static updateCity(req: Request, res: Response): Promise<void> {
    return saveMutation(req, res, (cities) => {
      const city = ensureNode(cities, req.params.cityId, 'City');
      if (req.body.name !== undefined) {
        const name = requireName(req.body.name);
        ensureUniqueName(cities, name, city.id);
        city.name = name;
      }
      if (req.body.enabled !== undefined) city.enabled = Boolean(req.body.enabled);
    });
  }

  static deleteCity(req: Request, res: Response): Promise<void> {
    return saveMutation(req, res, (cities) => {
      ensureNode(cities, req.params.cityId, 'City');
      const index = cities.findIndex((city) => city.id === req.params.cityId);
      cities.splice(index, 1);
    });
  }

  static createZone(req: Request, res: Response): Promise<void> {
    return saveMutation(req, res, (cities) => {
      const city = ensureNode(cities, req.params.cityId, 'City');
      const zones = city.zones || (city.zones = []);
      const name = requireName(req.body.name);
      ensureUniqueName(zones, name);
      zones.push({ id: locationId(zones, name), name, enabled: true, areas: [] });
    });
  }

  static updateZone(req: Request, res: Response): Promise<void> {
    return saveMutation(req, res, (cities) => {
      const city = ensureNode(cities, req.params.cityId, 'City');
      const zone = ensureNode(city.zones, req.params.zoneId, 'Zone');
      if (req.body.name !== undefined) {
        const name = requireName(req.body.name);
        ensureUniqueName(city.zones || [], name, zone.id);
        zone.name = name;
      }
      if (req.body.enabled !== undefined) zone.enabled = Boolean(req.body.enabled);
    });
  }

  static deleteZone(req: Request, res: Response): Promise<void> {
    return saveMutation(req, res, (cities) => {
      const city = ensureNode(cities, req.params.cityId, 'City');
      ensureNode(city.zones, req.params.zoneId, 'Zone');
      city.zones = (city.zones || []).filter((zone) => zone.id !== req.params.zoneId);
    });
  }

  static createCityArea(req: Request, res: Response): Promise<void> {
    return saveMutation(req, res, (cities) => {
      const city = ensureNode(cities, req.params.cityId, 'City');
      const areas = city.areas || (city.areas = []);
      const name = requireName(req.body.name);
      ensureUniqueName(areas, name);
      const latitude = req.body.latitude === undefined ? undefined : Number(req.body.latitude);
      const longitude = req.body.longitude === undefined ? undefined : Number(req.body.longitude);
      if ((latitude !== undefined && !Number.isFinite(latitude)) || (longitude !== undefined && !Number.isFinite(longitude))) {
        const error = new Error('Coordinates must be valid numbers') as Error & { status?: number };
        error.status = 400;
        throw error;
      }
      areas.push({ id: locationId(areas, name), name, enabled: true, latitude, longitude });
    });
  }

  static updateCityArea(req: Request, res: Response): Promise<void> {
    return saveMutation(req, res, (cities) => {
      const city = ensureNode(cities, req.params.cityId, 'City');
      const areas = city.areas || [];
      const area = ensureNode(areas, req.params.areaId, 'Area');
      if (req.body.name !== undefined) {
        const name = requireName(req.body.name);
        ensureUniqueName(areas, name, area.id);
        area.name = name;
      }
      if (req.body.enabled !== undefined) area.enabled = Boolean(req.body.enabled);
      for (const key of ['latitude', 'longitude'] as const) {
        if (req.body[key] !== undefined) {
          const value = Number(req.body[key]);
          if (!Number.isFinite(value)) {
            const error = new Error('Coordinates must be valid numbers') as Error & { status?: number };
            error.status = 400;
            throw error;
          }
          area[key] = value;
        }
      }
    });
  }

  static deleteCityArea(req: Request, res: Response): Promise<void> {
    return saveMutation(req, res, (cities) => {
      const city = ensureNode(cities, req.params.cityId, 'City');
      ensureNode(city.areas, req.params.areaId, 'Area');
      city.areas = (city.areas || []).filter((area) => area.id !== req.params.areaId);
    });
  }

  static createArea(req: Request, res: Response): Promise<void> {
    return saveMutation(req, res, (cities) => {
      const city = ensureNode(cities, req.params.cityId, 'City');
      const zone = ensureNode(city.zones, req.params.zoneId, 'Zone');
      const areas = zone.areas || (zone.areas = []);
      const name = requireName(req.body.name);
      ensureUniqueName(areas, name);
      const latitude = req.body.latitude === undefined ? undefined : Number(req.body.latitude);
      const longitude = req.body.longitude === undefined ? undefined : Number(req.body.longitude);
      if ((latitude !== undefined && !Number.isFinite(latitude)) || (longitude !== undefined && !Number.isFinite(longitude))) {
        const error = new Error('Coordinates must be valid numbers') as Error & { status?: number };
        error.status = 400;
        throw error;
      }
      areas.push({ id: locationId(areas, name), name, enabled: true, latitude, longitude });
    });
  }

  static updateArea(req: Request, res: Response): Promise<void> {
    return saveMutation(req, res, (cities) => {
      const city = ensureNode(cities, req.params.cityId, 'City');
      const zone = ensureNode(city.zones, req.params.zoneId, 'Zone');
      const areas = zone.areas || [];
      const area = ensureNode(areas, req.params.areaId, 'Area');
      if (req.body.name !== undefined) {
        const name = requireName(req.body.name);
        ensureUniqueName(areas, name, area.id);
        area.name = name;
      }
      if (req.body.enabled !== undefined) area.enabled = Boolean(req.body.enabled);
      for (const key of ['latitude', 'longitude'] as const) {
        if (req.body[key] !== undefined) {
          const value = Number(req.body[key]);
          if (!Number.isFinite(value)) {
            const error = new Error('Coordinates must be valid numbers') as Error & { status?: number };
            error.status = 400;
            throw error;
          }
          area[key] = value;
        }
      }
    });
  }

  static deleteArea(req: Request, res: Response): Promise<void> {
    return saveMutation(req, res, (cities) => {
      const city = ensureNode(cities, req.params.cityId, 'City');
      const zone = ensureNode(city.zones, req.params.zoneId, 'Zone');
      ensureNode(zone.areas, req.params.areaId, 'Area');
      zone.areas = (zone.areas || []).filter((area) => area.id !== req.params.areaId);
    });
  }
}