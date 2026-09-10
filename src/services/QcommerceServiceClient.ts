import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';

class QcommerceServiceClient {
  private readonly client: AxiosInstance = axios.create({
    baseURL: env.QCOMMERCE_SERVICE_URL,
    timeout: 15000,
    headers: {
      'Content-Type': 'application/json',
      'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
      'X-Service-Name': 'main-admin-service',
    },
  });

  async listOrders(params: Record<string, string | number | undefined>) {
    const response = await this.client.get('/api/v1/internal/admin/qcommerce/orders', { params });
    return response.data;
  }

  async getOrder(id: string) {
    const response = await this.client.get(`/api/v1/internal/admin/qcommerce/orders/${encodeURIComponent(id)}`);
    return response.data;
  }

  async assignHelper(id: string, body: Record<string, unknown>) {
    const response = await this.client.post(`/api/v1/internal/admin/qcommerce/orders/${encodeURIComponent(id)}/assign`, body);
    return response.data;
  }

  async updateStatus(id: string, status: string) {
    const response = await this.client.patch(`/api/v1/internal/admin/qcommerce/orders/${encodeURIComponent(id)}/status`, { status });
    return response.data;
  }
}

export const qcommerceServiceClient = new QcommerceServiceClient();