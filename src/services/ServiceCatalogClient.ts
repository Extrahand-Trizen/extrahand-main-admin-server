import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';

export interface CreateServiceCatalogItem {
  categorySlug?: string;
  categoryName?: string;
  categoryDescription?: string;
  categoryIconUrl?: string;
  categorySortOrder?: number;
  name: string;
  description?: string;
  imageUrl?: string;
  basePrice: number;
  durationMinutes: number;
  pricingUnit: 'fixed' | 'hourly';
  partnerCategoryId: string;
}

export interface UpdateServiceCatalogItem {
  categorySlug: string;
  name: string;
  description: string;
  imageUrl?: string;
  basePrice: number;
  offerPrice: number | null;
  durationMinutes: number;
  pricingUnit: 'fixed' | 'hourly';
  partnerCategoryId: string;
  isActive: boolean;
}

export class ServiceCatalogClient {
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

  async listServices() {
    return (await this.client.get('/api/v1/catalog/internal/services')).data;
  }

  async listCategoryContent() {
    return (
      await this.client.get('/api/v1/catalog/internal/categories/content', {
        params: { includeInactive: true },
      })
    ).data;
  }

  async upsertCategoryContent(body: Record<string, unknown>) {
    return (
      await this.client.post('/api/v1/catalog/internal/categories/content', body)
    ).data;
  }

  async listSkuContent() {
    return (
      await this.client.get('/api/v1/catalog/internal/skus/content', {
        params: { includeInactive: true },
      })
    ).data;
  }

  async updateSkuScope(
    categorySlug: string,
    skuSlug: string,
    displayName: string,
    includes: string[],
    excludes: string[],
  ) {
    const result = await this.listSkuContent();
    if (!result?.success || !Array.isArray(result.data)) {
      throw new Error('Task service returned an invalid service package content response');
    }
    const content = result.data.find(
      (item: { categorySlug?: string; skuSlug?: string; _id?: string }) =>
        item.categorySlug?.toLowerCase() === categorySlug.toLowerCase() &&
        item.skuSlug?.toLowerCase() === skuSlug.toLowerCase(),
    );

    if (content?._id) {
      return (
        await this.client.patch(
          `/api/v1/catalog/internal/skus/content/${encodeURIComponent(content._id)}`,
          { displayName, includes, excludes },
        )
      ).data;
    }

    return (
      await this.client.post('/api/v1/catalog/internal/skus/content', {
        categorySlug,
        skuSlug,
        displayName,
        includes,
        excludes,
      })
    ).data;
  }

  async listBookNowLocationAvailability(params: {
    search?: string;
    type?: string;
    isEnabled?: boolean;
    catalogId?: string;
  }) {
    return (
      await this.client.get('/api/v1/catalog/internal/book-now/location-availability', {
        params,
      })
    ).data;
  }

  async updateBookNowLocationAvailability(
    type: string,
    id: string,
    isEnabled: boolean,
    catalogId?: string,
  ) {
    return (
      await this.client.post(
        `/api/v1/catalog/internal/book-now/location-availability/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
        { isEnabled, ...(catalogId ? { catalogId } : {}) },
      )
    ).data;
  }

  async removeBookNowLocation(type: string, id: string) {
    return (
      await this.client.delete(
        `/api/v1/catalog/internal/book-now/location-availability/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
      )
    ).data;
  }

  async createService(body: CreateServiceCatalogItem) {
    return (await this.client.post('/api/v1/catalog/internal/services', body)).data;
  }

  async updateService(id: string, body: UpdateServiceCatalogItem) {
    return (
      await this.client.patch(
        `/api/v1/catalog/internal/services/${encodeURIComponent(id)}`,
        body,
      )
    ).data;
  }

  async updateServiceStatus(id: string, isActive: boolean) {
    return (
      await this.client.patch(
        `/api/v1/catalog/internal/services/${encodeURIComponent(id)}/status`,
        { isActive },
      )
    ).data;
  }

  async updateServiceImage(id: string, imageUrl: string) {
    return (
      await this.client.patch(
        `/api/v1/catalog/internal/services/${encodeURIComponent(id)}/image`,
        { imageUrl },
      )
    ).data;
  }

  async updateServiceOffer(id: string, offerPrice: number | null) {
    return (
      await this.client.patch(
        `/api/v1/catalog/internal/services/${encodeURIComponent(id)}/offer`,
        { offerPrice },
      )
    ).data;
  }
}

export const serviceCatalogClient = new ServiceCatalogClient();
