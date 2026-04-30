import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';
import logger from '../config/logger';

export class TaskServiceClient {
  private client: AxiosInstance;
  private readonly serviceUserId = 'main-admin-service';
  
  constructor() {
    this.client = axios.create({
      baseURL: env.TASK_SERVICE_URL || 'http://localhost:4002',
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
        'X-Service-Auth': env.SERVICE_AUTH_TOKEN,
        'X-Service-Name': 'main-admin-service',
      },
    });
    
    this.client.interceptors.request.use(
      (config) => {
        config.headers = config.headers || {};
        if (!config.headers['X-User-Id']) {
          config.headers['X-User-Id'] = this.serviceUserId;
        }
        logger.debug(`Task Service Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('Task Service Request Error:', error);
        return Promise.reject(error);
      }
    );
    
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error('Task Service Response Error:', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
        return Promise.reject(error);
      }
    );
  }
  
  /**
   * Get task by ID
   */
  async getTask(taskId: string): Promise<any> {
    const response = await this.client.get(`/api/v1/tasks/${taskId}`);
    return response.data;
  }
  
  /**
   * List tasks with filters
   */
  async listTasks(params: {
    page?: number;
    limit?: number;
    search?: string;
    status?: string;
    category?: string;
    posterId?: string;
    assigneeId?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<any> {
    const normalizedParams: Record<string, any> = { ...params };

    // Task service filters by requesterId (profile ObjectId), while admin UI
    // sends posterId. Mirror it so posted-task queries are accurate.
    if (normalizedParams.posterId && !normalizedParams.requesterId) {
      normalizedParams.requesterId = normalizedParams.posterId;
    }

    const response = await this.client.get('/api/v1/tasks', { params: normalizedParams });
    return response.data;
  }
  
  /**
   * Update task
   */
  async updateTask(taskId: string, updates: any): Promise<any> {
    const response = await this.client.patch(`/api/v1/tasks/${taskId}`, updates);
    return response.data;
  }
  
  /**
   * Delete task
   */
  async deleteTask(taskId: string, reason: string): Promise<any> {
    const response = await this.client.delete(`/api/v1/tasks/${taskId}`, {
      data: { reason },
    });
    return response.data;
  }
  
  /**
   * Get task applications
   */
  async getTaskApplications(taskId: string, params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<any> {
    const response = await this.client.get(`/api/v1/tasks/${taskId}/applications`, { params });
    return response.data;
  }

  /**
   * List applications with filters
   */
  async listApplications(params: {
    page?: number;
    limit?: number;
    status?: string;
    taskId?: string;
    mine?: boolean;
  }, profileId?: string): Promise<any> {
    const response = await this.client.get('/api/v1/applications', {
      params,
      headers: profileId ? { 'X-Profile-Id': profileId } : undefined,
    });
    return response.data;
  }

  async getPosterAnalytics(requesterId: string, range: '7d' | '30d' | '90d' = '30d'): Promise<any> {
    const response = await this.client.get(`/api/v1/analytics/posters/${requesterId}`, {
      params: { range },
    });
    return response.data;
  }

  async getPosterSummary(range: '7d' | '30d' | '90d' = '30d'): Promise<any> {
    const response = await this.client.get('/api/v1/analytics/posters/summary', {
      params: { range },
    });
    return response.data;
  }

  async getTaskCategoryBreakdown(range: '7d' | '30d' | '90d' = '30d'): Promise<any> {
    const response = await this.client.get('/api/v1/analytics/categories/breakdown', {
      params: { range },
    });
    return response.data;
  }

  async getTaskCategoryPerformance(range: '7d' | '30d' | '90d' = '30d'): Promise<any> {
    const response = await this.client.get('/api/v1/analytics/categories/performance', {
      params: { range },
    });
    return response.data;
  }

  async getTaskCancellationAnalytics(range: '7d' | '30d' | '90d' = '30d'): Promise<any> {
    const response = await this.client.get('/api/v1/analytics/tasks/cancellations', {
      params: { range },
    });
    return response.data;
  }

  async getUserAnalytics(
    profileId: string,
    uid: string,
    range: '7d' | '30d' | '90d' = '30d'
  ): Promise<any> {
    const response = await this.client.get(`/api/v1/analytics/users/${profileId}`, {
      params: { uid, range },
    });
    return response.data;
  }
  
  /**
   * Update application status
   */
  async updateApplicationStatus(
    taskId: string,
    applicationId: string,
    status: string
  ): Promise<any> {
    const response = await this.client.patch(
      `/api/v1/tasks/${taskId}/applications/${applicationId}`,
      { status }
    );
    return response.data;
  }
}

export const taskServiceClient = new TaskServiceClient();
