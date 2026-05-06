import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';
import logger from '../config/logger';

export class PaymentServiceClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      // Mirror financial-admin backend default payment service port.
      baseURL: env.PAYMENT_SERVICE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
        'X-Service-Name': 'main-admin-service',
      },
    });

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error('Payment Service Response Error:', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
        return Promise.reject(error);
      }
    );
  }

  async get(path: string, params?: Record<string, any>): Promise<any> {
    const response = await this.client.get(path, { params });
    return response.data;
  }
}

export const paymentServiceClient = new PaymentServiceClient();
