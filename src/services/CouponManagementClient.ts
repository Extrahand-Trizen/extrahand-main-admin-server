import axios, { AxiosInstance, Method } from 'axios';
import { env } from '../config/env';

class CouponManagementClient {
  private readonly client: AxiosInstance;
  private readonly couponClient: AxiosInstance;

  constructor() {
    const serviceHeaders = {
      'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
      'X-Service-Name': 'main-admin-service',
    };
    this.client = axios.create({
      baseURL: env.TASK_SERVICE_URL || 'http://localhost:4002',
      timeout: 30000,
      headers: serviceHeaders,
    });
    this.couponClient = axios.create({
      baseURL: env.COUPON_SERVICE_URL,
      timeout: 30000,
      headers: serviceHeaders,
    });
  }

  async request(
    method: Method,
    url: string,
    params: Record<string, unknown>,
    data: unknown,
    adminUserId: string,
  ) {
    return this.client.request({
      method,
      url,
      params,
      data,
      headers: { 'X-User-Id': adminUserId },
    });
  }

  async requestCoupon(
    method: Method,
    url: string,
    params: Record<string, unknown>,
    data: unknown,
    adminUserId: string,
  ) {
    return this.couponClient.request({
      method,
      url,
      params,
      data,
      headers: { 'X-User-Id': adminUserId },
    });
  }
}

export const couponManagementClient = new CouponManagementClient();
