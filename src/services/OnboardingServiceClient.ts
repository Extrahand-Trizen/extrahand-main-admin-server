import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';
import logger from '../config/logger';

export class OnboardingServiceClient {
  private client?: AxiosInstance;

  constructor() {
    if (!env.ONBOARDING_SERVICE_URL) {
      return;
    }

    this.client = axios.create({
      baseURL: env.ONBOARDING_SERVICE_URL,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
        'X-Service-Name': 'main-admin-service',
      },
    });

    this.client.interceptors.request.use(
      (config) => {
        logger.debug(`Onboarding Service Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('Onboarding Service Request Error:', error);
        return Promise.reject(error);
      },
    );

    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error('Onboarding Service Response Error:', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
        return Promise.reject(error);
      },
    );
  }

  isEnabled(): boolean {
    return Boolean(this.client);
  }

  async lookupLeadByContact(params: {
    uid?: string;
    phone?: string;
    email?: string;
    adminUserId?: string;
  }): Promise<any | null> {
    if (!this.client) {
      return null;
    }

    const response = await this.client.get('/api/v1/internal/leads/lookup', {
      params: {
        uid: params.uid,
        phone: params.phone,
        email: params.email,
      },
      headers: params.adminUserId ? { 'X-User-Id': params.adminUserId } : {},
    });

    return response.data;
  }
}

export const onboardingServiceClient = new OnboardingServiceClient();
