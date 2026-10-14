import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';

export type BroadcastApp = 'customer_app' | 'helper_app' | 'seller_app';

export const BROADCAST_APPS: BroadcastApp[] = ['customer_app', 'helper_app', 'seller_app'];

/**
 * Client for extrahand-platform-notification-service campaign endpoints
 * (service-to-service auth).
 */
export class NotificationServiceClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: `${(env.NOTIFICATION_SERVICE_URL || 'http://localhost:4005').replace(/\/$/, '')}/api/v1/notifications`,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
        'X-Service-Name': 'main-admin-server',
      },
    });
  }

  async listBroadcasts(params: { app: BroadcastApp | 'any'; limit: number; skip: number }): Promise<any> {
    const response = await this.client.get('/campaigns', { params });
    return response.data;
  }

  async createBroadcast(payload: {
    app: BroadcastApp;
    title: string;
    body: string;
    imageUrl?: string;
    scheduledAt?: string;
    /** Omit to send to every user of the app. */
    userIds?: string[];
    createdBy: string;
  }): Promise<any> {
    const response = await this.client.post('/campaigns', payload);
    return response.data;
  }

  async cancelBroadcast(campaignId: string): Promise<any> {
    const response = await this.client.post(`/campaigns/${encodeURIComponent(campaignId)}/cancel`);
    return response.data;
  }

  async clearBroadcasts(app: BroadcastApp): Promise<any> {
    const response = await this.client.post('/campaigns/clear', { app });
    return response.data;
  }
}

export const notificationServiceClient = new NotificationServiceClient();
