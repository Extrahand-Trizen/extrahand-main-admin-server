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

  async getTasksBatch(taskIds: string[]): Promise<any> {
    const response = await this.client.post('/api/v1/tasks/batch', { taskIds });
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
    excludeOverdue?: string;
    category?: string;
    CustomerId?: string;
    assigneeId?: string;
    bookingSource?: string;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<any> {
    const normalizedParams: Record<string, any> = { ...params };

    // Task service filters by requesterId (profile ObjectId), while admin UI
    // sends CustomerId. Mirror it so posted-task queries are accurate.
    if (normalizedParams.CustomerId && !normalizedParams.requesterId) {
      normalizedParams.requesterId = normalizedParams.CustomerId;
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
   * Delete task (admin impersonates requester via X-Profile-Id so task-service authZ passes)
   */
  async deleteTask(
    taskId: string,
    reason: string,
    opts?: { requesterProfileId?: string },
  ): Promise<any> {
    const headers: Record<string, string> = {};
    if (opts?.requesterProfileId) {
      headers['X-Profile-Id'] = opts.requesterProfileId;
    }
    const response = await this.client.delete(`/api/v1/tasks/${taskId}`, {
      data: { reason },
      headers,
    });
    return response.data;
  }

  async listDeletedTasks(params?: { page?: number; limit?: number; search?: string }): Promise<any> {
    const response = await this.client.get('/api/v1/tasks/recycle-bin', { params });
    return response.data;
  }

  async restoreTask(taskId: string, opts?: { requesterProfileId?: string }): Promise<any> {
    const headers: Record<string, string> = {};
    if (opts?.requesterProfileId) {
      headers['X-Profile-Id'] = opts.requesterProfileId;
    }
    const response = await this.client.post(`/api/v1/tasks/${taskId}/restore`, {}, { headers });
    return response.data;
  }

  async permanentlyDeleteTask(
    taskId: string,
    opts?: { requesterProfileId?: string }
  ): Promise<any> {
    const headers: Record<string, string> = {};
    if (opts?.requesterProfileId) {
      headers['X-Profile-Id'] = opts.requesterProfileId;
    }
    const response = await this.client.delete(`/api/v1/tasks/${taskId}/permanent`, {
      headers,
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

  /**
   * Assign a helper to a Book Now task via task service.
   * adminUserId is passed as X-User-Id so task service records the acting admin.
   */
  async assignHelper(params: {
    orderId: string;
    helperUid: string;
    helperProfileId: string;
    helperName?: string;
    bookingItemId?: string;
  }, adminUserId?: string): Promise<any> {
    const headers: Record<string, string> = {};
    if (adminUserId) {
      headers['X-User-Id'] = adminUserId;
    }
    const response = await this.client.post('/api/v1/admin/assignments/assign', params, { headers });
    return response.data;
  }

  /**
   * Directly assign a helper to a task (fallback).
   */
  async assignHelperDirect(params: {
    taskId: string;
    helperUid: string;
    helperProfileId: string;
    helperName?: string;
  }, adminUserId?: string): Promise<any> {
    const headers: Record<string, string> = {};
    if (adminUserId) {
      headers['X-User-Id'] = adminUserId;
    }
    const response = await this.client.post('/api/v1/admin/assignments/assign-direct', params, { headers });
    return response.data;
  }

  /**
   * Get booking order info for a task (admin endpoint, no ownership check).
   */
  async getBookingByTaskId(taskId: string): Promise<any> {
    const response = await this.client.get(`/api/v1/admin/assignments/by-task/${taskId}`);
    return response.data;
  }

  async getCustomerAnalytics(requesterId: string, range: '7d' | '30d' | '90d' = '30d'): Promise<any> {
    const response = await this.client.get(`/api/v1/analytics/Customers/${requesterId}`, {
      params: { range },
    });
    return response.data;
  }

  async getCustomerSummary(range: '7d' | '30d' | '90d' = '30d'): Promise<any> {
    const response = await this.client.get('/api/v1/analytics/Customers/summary', {
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
