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
