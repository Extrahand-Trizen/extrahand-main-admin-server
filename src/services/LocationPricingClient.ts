import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';

export class LocationPricingClient {
  private readonly client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: env.TASK_SERVICE_URL || 'http://localhost:4002',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
        'X-Service-Name': 'main-admin-service',
        'X-User-Id': 'main-admin-service',
      },
    });
  }

  async listLocations(params: Record<string, string | undefined>) {
    return (await this.client.get('/api/v1/catalog/internal/location-pricing/locations', { params })).data;
  }

  async createLocation(type: string, body: unknown) {
    return (await this.client.post(`/api/v1/catalog/internal/location-pricing/locations/${encodeURIComponent(type)}`, body)).data;
  }

  async updateLocation(type: string, id: string, body: unknown) {
    return (await this.client.patch(`/api/v1/catalog/internal/location-pricing/locations/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, body)).data;
  }

  async setLocationActive(type: string, id: string, active: boolean) {
    const action = active ? 'activate' : 'deactivate';
    return (await this.client.post(`/api/v1/catalog/internal/location-pricing/locations/${encodeURIComponent(type)}/${encodeURIComponent(id)}/${action}`)).data;
  }

  async listHourlySkus() {
    return (await this.client.get('/api/v1/catalog/internal/location-pricing/hourly-skus')).data;
  }

  async listPricingCategories() {
    return (await this.client.get('/api/v1/catalog/internal/location-pricing/categories')).data;
  }

  async listPricingSkus(categoryId?: string, sectionId?: string) {
    return (await this.client.get('/api/v1/catalog/internal/location-pricing/skus', { params: { categoryId, sectionId } })).data;
  }

  async listHourlyPrices(skuId?: string) {
    return (await this.client.get('/api/v1/catalog/internal/location-pricing/hourly-prices', { params: { skuId } })).data;
  }

  async createHourlyPrice(body: unknown) {
    return (await this.client.post('/api/v1/catalog/internal/location-pricing/hourly-prices', body)).data;
  }

  async updateHourlyPrice(id: string, body: unknown) {
    return (await this.client.patch(`/api/v1/catalog/internal/location-pricing/hourly-prices/${encodeURIComponent(id)}`, body)).data;
  }

  async resolveHourlyPrice(body: unknown) {
    return (await this.client.post('/api/v1/catalog/internal/location-pricing/hourly-prices/resolve', body)).data;
  }

  async resolveAddress(body: unknown) {
    return (await this.client.post('/api/v1/catalog/internal/location-pricing/resolve-address', body)).data;
  }

  async listHourlyHelperAvailabilities(params: Record<string, string | undefined>) {
    return (await this.client.get('/api/v1/catalog/internal/location-pricing/hourly-availability', { params })).data;
  }

  async toggleHourlyHelperAvailability(type: string, id: string, isEnabled: boolean, updatedBy?: string) {
    return (await this.client.post(`/api/v1/catalog/internal/location-pricing/hourly-availability/${encodeURIComponent(type)}/${encodeURIComponent(id)}/toggle`, { isEnabled, updatedBy })).data;
  }

  async removeHourlyHelperAvailability(type: string, id: string, removedBy?: string) {
    return (await this.client.delete(`/api/v1/catalog/internal/location-pricing/hourly-availability/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { data: { removedBy } })).data;
  }

  async listPostCompareAreaAvailabilities(params: Record<string, string | undefined>) {
    return (await this.client.get('/api/v1/catalog/internal/location-pricing/post-compare-availability/areas', { params })).data;
  }

  async togglePostCompareAreaAvailability(areaId: string, isEnabled: boolean, updatedBy: string) {
    return (await this.client.post(
      `/api/v1/catalog/internal/location-pricing/post-compare-availability/areas/${encodeURIComponent(areaId)}/toggle`,
      { isEnabled, updatedBy },
    )).data;
  }

  async ensureCanonicalLocation(body: unknown) {
    return (await this.client.post('/api/v1/catalog/internal/location-pricing/ensure-canonical-location', body)).data;
  }

  async getGooglePlaceDetails(placeId: string) {
    const apiKey = env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      throw new Error('Google Maps API key is not configured');
    }

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=formatted_address,name,address_components,geometry&key=${encodeURIComponent(apiKey)}&language=en`,
    );
    if (!response.ok) {
      throw new Error(`Google place details request failed with ${response.status}`);
    }
    const data = await response.json() as { status?: string; error_message?: string; result?: any };
    if (data.status !== 'OK' || !data.result) {
      throw new Error(data.error_message || 'Google place details are unavailable');
    }
    return data.result;
  }

  async searchGooglePlaces(query: string) {
    const apiKey = env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) throw new Error('Google Maps API key is not configured for the operations portal');

    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&components=country:in&language=en&key=${encodeURIComponent(apiKey)}`,
    );
    if (!response.ok) throw new Error(`Google Places search failed with ${response.status}`);
    const data = await response.json() as { status?: string; error_message?: string; predictions?: Array<{ place_id?: string; description?: string; structured_formatting?: { main_text?: string; secondary_text?: string } }> };
    if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
      throw new Error(data.error_message || `Google Places search failed: ${data.status || 'unknown status'}`);
    }
    return (data.predictions || []).filter((item) => item.place_id).slice(0, 5).map((item) => ({
      placeId: item.place_id as string,
      name: item.structured_formatting?.main_text || item.description || query,
      address: item.structured_formatting?.secondary_text || item.description || query,
      formattedAddress: item.description || query,
    }));
  }
}

export const locationPricingClient = new LocationPricingClient();
