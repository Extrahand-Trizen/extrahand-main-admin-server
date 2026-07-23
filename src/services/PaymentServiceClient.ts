import axios, { AxiosInstance, InternalAxiosRequestConfig } from 'axios';
import { env } from '../config/env';
import logger from '../config/logger';

export class PaymentServiceClient {
  private client: AxiosInstance;
  private readonly serviceUserId = 'main-admin-service';

  constructor() {
    this.client = axios.create({
      baseURL: env.PAYMENT_SERVICE_URL || 'http://localhost:4003',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
        'X-Service-Name': 'main-admin-service',
      },
    });

    this.client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        config.headers = config.headers || {};
        if (!config.headers['X-User-Id']) {
          config.headers['X-User-Id'] = this.serviceUserId;
        }
        logger.debug(`Payment Service Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error: unknown) => {
        logger.error('Payment Service Request Error:', error);
        return Promise.reject(error);
      },
    );

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error('Payment Service Response Error:', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
          url: error.config?.url,
          method: error.config?.method,
        });
        return Promise.reject(error);
      },
    );
  }

  async get(path: string, params?: Record<string, any>): Promise<any> {
    const response = await this.client.get(path, { params });
    return response.data;
  }

  async patch(path: string, body: Record<string, any>): Promise<any> {
    const response = await this.client.patch(path, body);
    return response.data;
  }

  async listManualOpsPayoutQueue(params?: {
    status?: string;
    limit?: number;
    offset?: number;
  }): Promise<any> {
    const response = await this.client.get('/api/v1/payouts/ops/manual-queue', {
      params,
    });
    return response.data;
  }
}

export const paymentServiceClient = new PaymentServiceClient();
