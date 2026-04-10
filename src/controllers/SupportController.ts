import { Request, Response } from 'express';
import { supportServiceClient } from '../services/SupportServiceClient';
import logger from '../config/logger';
import { createAuditLog } from '../middleware/audit';
import { Resource, Action } from '../types/permissions';

export class SupportController {
  /**
   * GET /api/v1/support/tickets
   * List support tickets (contact messages)
   */
  static async listTickets(req: Request, res: Response): Promise<void> {
    try {
      const params = {
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        status: req.query.status as string,
      };
      
      const result = await supportServiceClient.getContactMessages(params);
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('List support tickets error:', error);
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Failed to list support tickets',
      });
    }
  }
  
  /**
   * GET /api/v1/support/tickets/:ticketId
   * Get support ticket by ID
   */
  static async getTicket(req: Request, res: Response): Promise<void> {
    try {
      const { ticketId } = req.params;
      
      const result = await supportServiceClient.getContactMessage(ticketId);
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('Get support ticket error:', error);
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Failed to get support ticket',
      });
    }
  }
  
  /**
   * PATCH /api/v1/support/tickets/:ticketId/status
   * Update ticket status
   */
  static async updateTicketStatus(req: Request, res: Response): Promise<void> {
    try {
      const { ticketId } = req.params;
      const { status } = req.body;
      
      if (!status || !['new', 'read', 'replied', 'closed'].includes(status)) {
        res.status(400).json({
          success: false,
          error: 'Valid status is required (new, read, replied, closed)',
        });
        return;
      }
      
      const result = await supportServiceClient.updateContactMessageStatus(
        ticketId,
        status as any,
        req.admin?.userId
      );
      
      await createAuditLog(
        req,
        `${Resource.SUPPORT_TICKET}.update`,
        Resource.SUPPORT_TICKET,
        ticketId,
        { status }
      );
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('Update ticket status error:', error);
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Failed to update ticket status',
      });
    }
  }
  
  /**
   * GET /api/v1/support/articles
   * List support articles
   */
  static async listArticles(req: Request, res: Response): Promise<void> {
    try {
      const params = {
        page: req.query.page ? Number(req.query.page) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        category: req.query.category as string,
        search: req.query.search as string,
      };
      
      const result = await supportServiceClient.getArticles(params);
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('List articles error:', error);
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Failed to list articles',
      });
    }
  }
  
  /**
   * GET /api/v1/support/articles/:articleId
   * Get article by ID
   */
  static async getArticle(req: Request, res: Response): Promise<void> {
    try {
      const { articleId } = req.params;
      
      const result = await supportServiceClient.getArticle(articleId);
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('Get article error:', error);
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Failed to get article',
      });
    }
  }
  
  /**
   * POST /api/v1/support/articles
   * Create support article
   */
  static async createArticle(req: Request, res: Response): Promise<void> {
    try {
      const { title, description, category, content, imageUrl } = req.body;
      
      if (!title || !description || !category || !content) {
        res.status(400).json({
          success: false,
          error: 'Title, description, category, and content are required',
        });
        return;
      }
      
      const result = await supportServiceClient.createArticle({
        title,
        description,
        category,
        content,
        imageUrl,
        author: req.admin?.name || 'Admin',
      });
      
      await createAuditLog(
        req,
        `${Resource.CONTENT}.create`,
        Resource.CONTENT,
        result.data?._id || 'unknown',
        { title, category }
      );
      
      res.status(201).json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('Create article error:', error);
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Failed to create article',
      });
    }
  }
  
  /**
   * PATCH /api/v1/support/articles/:articleId
   * Update support article
   */
  static async updateArticle(req: Request, res: Response): Promise<void> {
    try {
      const { articleId } = req.params;
      
      const result = await supportServiceClient.updateArticle(articleId, req.body);
      
      await createAuditLog(
        req,
        `${Resource.CONTENT}.update`,
        Resource.CONTENT,
        articleId,
        { updates: req.body }
      );
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('Update article error:', error);
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Failed to update article',
      });
    }
  }
  
  /**
   * DELETE /api/v1/support/articles/:articleId
   * Delete support article
   */
  static async deleteArticle(req: Request, res: Response): Promise<void> {
    try {
      const { articleId } = req.params;
      const { reason } = req.body;
      
      if (!reason) {
        res.status(400).json({
          success: false,
          error: 'Reason is required for deleting an article',
        });
        return;
      }
      
      const result = await supportServiceClient.deleteArticle(articleId);
      
      await createAuditLog(
        req,
        `${Resource.CONTENT}.delete`,
        Resource.CONTENT,
        articleId,
        { reason }
      );
      
      res.json({
        success: true,
        data: result.data || result,
      });
    } catch (error: any) {
      logger.error('Delete article error:', error);
      res.status(error.response?.status || 500).json({
        success: false,
        error: error.response?.data?.error || 'Failed to delete article',
      });
    }
  }
}
