import axios, { AxiosInstance } from 'axios';
import { env } from '../config/env';
import logger from '../config/logger';

export class SupportServiceClient {
  private client: AxiosInstance;
  
  constructor() {
    const supportServiceUrl = env.SUPPORT_SERVICE_URL || 'http://localhost:5001';
    
    this.client = axios.create({
      baseURL: supportServiceUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    this.client.interceptors.request.use(
      (config) => {
        logger.debug(`Support Service Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('Support Service Request Error:', error);
        return Promise.reject(error);
      }
    );
    
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error('Support Service Response Error:', {
          status: error.response?.status,
          data: error.response?.data,
          message: error.message,
        });
        return Promise.reject(error);
      }
    );
  }
  
  /**
   * Get contact messages/tickets
   * Note: This requires admin authentication from support service
   */
  async getContactMessages(params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<any> {
    // Note: Support service uses its own auth system
    // We'll need to pass admin token or use service-to-service auth
    const response = await this.client.get('/api/contact', { params });
    return response.data;
  }
  
  /**
   * Get contact message by ID
   * Note: This endpoint may need to be added to support service
   */
  async getContactMessage(messageId: string): Promise<any> {
    try {
      const response = await this.client.get(`/api/contact/${messageId}`);
      return response.data;
    } catch (error: any) {
      // If endpoint doesn't exist, fetch all and filter
      if (error.response?.status === 404) {
        const allMessages = await this.getContactMessages();
        const message = allMessages.data?.find((m: any) => m._id === messageId);
        if (message) {
          return { success: true, data: message };
        }
      }
      throw error;
    }
  }
  
  /**
   * Update contact message status
   * Note: This endpoint may need to be added to support service
   */
  async updateContactMessageStatus(
    messageId: string,
    status: 'new' | 'read' | 'replied' | 'closed',
    adminUserId?: string
  ): Promise<any> {
    try {
      const response = await this.client.patch(
        `/api/contact/${messageId}/status`,
        { status, updatedBy: adminUserId }
      );
      return response.data;
    } catch (error: any) {
      // If endpoint doesn't exist, we'll need to add it to support service
      if (error.response?.status === 404) {
        throw new Error('Update contact message endpoint not available. Please add PATCH /api/contact/:id/status to support service.');
      }
      throw error;
    }
  }
  
  /**
   * Get support articles
   */
  async getArticles(params?: {
    page?: number;
    limit?: number;
    category?: string;
    search?: string;
  }): Promise<any> {
    const response = await this.client.get('/api/articles', { params });
    return response.data;
  }
  
  /**
   * Get article by ID
   */
  async getArticle(articleId: string): Promise<any> {
    const response = await this.client.get(`/api/articles/${articleId}`);
    return response.data;
  }
  
  /**
   * Create article (admin only)
   * Note: This endpoint may need to be added to support service
   */
  async createArticle(articleData: {
    title: string;
    description: string;
    category: string;
    content: string;
    imageUrl?: string;
    author?: string;
  }): Promise<any> {
    try {
      const response = await this.client.post('/api/articles', articleData);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error('Create article endpoint not available. Please add POST /api/articles to support service.');
      }
      throw error;
    }
  }
  
  /**
   * Update article (admin only)
   * Note: This endpoint may need to be added to support service
   */
  async updateArticle(articleId: string, updates: any): Promise<any> {
    try {
      const response = await this.client.patch(`/api/articles/${articleId}`, updates);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error('Update article endpoint not available. Please add PATCH /api/articles/:id to support service.');
      }
      throw error;
    }
  }
  
  /**
   * Delete article (admin only)
   * Note: This endpoint may need to be added to support service
   */
  async deleteArticle(articleId: string): Promise<any> {
    try {
      const response = await this.client.delete(`/api/articles/${articleId}`);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        throw new Error('Delete article endpoint not available. Please add DELETE /api/articles/:id to support service.');
      }
      throw error;
    }
  }
}

export const supportServiceClient = new SupportServiceClient();
