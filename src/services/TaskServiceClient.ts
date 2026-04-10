import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';
import logger from '../config/logger';

export class TaskServiceClient {
  private client: AxiosInstance;
  
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
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<any> {
    const response = await this.client.get('/api/v1/tasks', { params });
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
