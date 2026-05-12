import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';
import logger from '../config/logger';

export class UserServiceClient {
  private client: AxiosInstance;
  
  constructor() {
    this.client = axios.create({
      baseURL: env.USER_SERVICE_URL || 'http://localhost:4001',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
        'X-Service-Name': 'main-admin-service',
      },
    });
    
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        logger.debug(`User Service Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('User Service Request Error:', error);
        return Promise.reject(error);
      }
    );
    
    // Response interceptor
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error('User Service Response Error:', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
        return Promise.reject(error);
      }
    );
  }
  
  /**
   * Get user by ID
   */
  async getUser(userId: string, adminUserId?: string): Promise<any> {
    const response = await this.client.get(`/api/v1/users/${userId}`, {
      headers: adminUserId ? { 'X-User-Id': adminUserId } : {},
    });
    return response.data;
  }
  
  /**
   * List users with filters
   */
  async listUsers(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    role?: string;
    isAadhaarVerified?: boolean;
    createdFrom?: string;
    createdTo?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<any> {
    const response = await this.client.get('/api/v1/users', { params });
    return response.data;
  }

  /**
   * Get role counts aggregated from profiles.roles in user-service
   */
  async getRoleCounts(): Promise<any> {
    const response = await this.client.get('/api/v1/users/stats/roles');
    return response.data;
  }

  /**
   * Preview or delete users that have no role saved.
   * dryRun=true (default) — returns a list without deleting anything.
   * dryRun=false — performs full cascade deletion.
   */
  async cleanupUsersWithoutRoles(dryRun = true): Promise<any> {
    if (dryRun) {
      const response = await this.client.get('/api/v1/users/cleanup/no-role');
      return response.data;
    }
    const response = await this.client.post('/api/v1/users/cleanup/no-role', { dry_run: false });
    return response.data;
  }

  /**
   * Get count of Helpers with Aadhaar verified.
   */
  async getHelperAadhaarVerifiedCount(): Promise<any> {
    const response = await this.client.get('/api/v1/profiles/internal/stats/taskers/aadhaar-verified');
    return response.data;
  }

  /**
   * Get helper counts by skill categories (service auth).
   */
  async getHelperCategoryCounts(): Promise<any> {
    const response = await this.client.get('/api/v1/profiles/internal/stats/taskers/category-counts');
    return response.data;
  }

  /**
   * Get multiple profiles by ObjectId for enrichment
   */
  async getProfilesBatch(profileIds: string[]): Promise<any> {
    const response = await this.client.post('/api/v1/profiles/batch', { profileIds });
    return response.data;
  }

  async getProfilesBatchByUids(uids: string[]): Promise<any> {
    const response = await this.client.post('/api/v1/profiles/batch/uids', { uids });
    return response.data;
  }
  
  /**
   * Update user
   */
  async updateUser(userId: string, updates: any, adminUserId: string): Promise<any> {
    const response = await this.client.patch(`/api/v1/users/${userId}`, updates, {
      headers: { 'X-User-Id': adminUserId },
    });
    return response.data;
  }
  
  /**
   * Ban user
   */
  async banUser(userId: string, reason: string, adminUserId: string): Promise<any> {
    const response = await this.client.post(
      `/api/v1/users/${userId}/ban`,
      { reason },
      { headers: { 'X-User-Id': adminUserId } }
    );
    return response.data;
  }
  
  /**
   * Unban user
   */
  async unbanUser(userId: string, adminUserId: string): Promise<any> {
    const response = await this.client.post(
      `/api/v1/users/${userId}/unban`,
      {},
      { headers: { 'X-User-Id': adminUserId } }
    );
    return response.data;
  }
  
  /**
   * Suspend user
   */
  async suspendUser(userId: string, reason: string, adminUserId: string): Promise<any> {
    const response = await this.client.post(
      `/api/v1/users/${userId}/suspend`,
      { reason },
      { headers: { 'X-User-Id': adminUserId } }
    );
    return response.data;
  }
  
  /**
   * Unsuspend user
   */
  async unsuspendUser(userId: string, adminUserId: string): Promise<any> {
    const response = await this.client.post(
      `/api/v1/users/${userId}/unsuspend`,
      {},
      { headers: { 'X-User-Id': adminUserId } }
    );
    return response.data;
  }
}

export const userServiceClient = new UserServiceClient();
