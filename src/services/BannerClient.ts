import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';

export class BannerClient {
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

  async listBanners(params?: { placement?: string }) {
    return (await this.client.get('/api/v1/catalog/internal/banners', { params })).data;
  }

  async getBannerById(id: string) {
    return (await this.client.get(`/api/v1/catalog/internal/banners/${encodeURIComponent(id)}`)).data;
  }

  async createBanner(body: unknown) {
    return (await this.client.post('/api/v1/catalog/internal/banners', body)).data;
  }

  async updateBanner(id: string, body: unknown) {
    return (await this.client.patch(`/api/v1/catalog/internal/banners/${encodeURIComponent(id)}`, body)).data;
  }

  async deleteBanner(id: string) {
    return (await this.client.delete(`/api/v1/catalog/internal/banners/${encodeURIComponent(id)}`)).data;
  }

  async reorderBanners(orderedIds: string[]) {
    return (await this.client.post('/api/v1/catalog/internal/banners/reorder', { orderedIds })).data;
  }
}

export const bannerClient = new BannerClient();
