import { Request, Response } from 'express';
import mongoose from 'mongoose';
import { supportServiceClient } from '../services/SupportServiceClient';
import logger from '../config/logger';
import { createAuditLog } from '../middleware/audit';
import { Resource, Action } from '../types/permissions';
import { getClientSafeStatus } from '../utils/upstreamHttp';
import { Profile } from '../models/Profile';

type IssueReportRecord = {
  _id: mongoose.Types.ObjectId;
  issueType?: string;
  issueLabel?: string;
  pageContext?: string;
  message?: string;
  status?: string;
  userId?: string;
  userUid?: string;
  metadata?: Record<string, unknown>;
  replies?: Array<{
    message: string;
    repliedBy?: string;
    createdAt: Date;
  }>;
  createdAt?: Date;
  updatedAt?: Date;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeTicketStatus(status: string | undefined): 'new' | 'read' | 'replied' | 'closed' {
  if (status === 'open' || !status) return 'new';
  if (status === 'read' || status === 'replied' || status === 'closed') return status;
  return 'new';
}

async function toSupportTickets(reports: IssueReportRecord[]) {
  const userIds = Array.from(
    new Set(reports.flatMap((report) => [report.userUid, report.userId].filter(Boolean) as string[])),
  );
  const objectIds = userIds
    .filter((userId) => mongoose.Types.ObjectId.isValid(userId))
    .map((userId) => new mongoose.Types.ObjectId(userId));
  const profiles =
    userIds.length > 0
      ? await Profile.find({
          $or: [
            { uid: { $in: userIds } },
            ...(objectIds.length > 0 ? [{ _id: { $in: objectIds } }] : []),
          ],
        })
          .select('uid name email')
          .lean()
      : [];
  const profileById = new Map<string, { name?: string; email?: string }>();
  profiles.forEach((profile) => {
    const details = { name: profile.name, email: profile.email };
    if (profile.uid) profileById.set(profile.uid, details);
    if (profile._id) profileById.set(String(profile._id), details);
  });

  return reports.map((report) => {
    const profile = profileById.get(report.userUid || '') || profileById.get(report.userId || '');
    const metadata = report.metadata || {};
    return {
      _id: String(report._id),
      name: profile?.name || report.userUid || report.userId || 'Customer',
      email: profile?.email || '',
      subject: report.issueLabel || 'Customer support request',
      message: report.message || '',
      status: normalizeTicketStatus(report.status),
      userId: report.userId,
      userUid: report.userUid,
      issueType: report.issueType,
      pageContext: report.pageContext,
      source: metadata.source,
      platform: metadata.platform,
      taskId: metadata.taskId,
      paymentId: metadata.paymentId,
      refundId: metadata.refundId,
      userAgent: metadata.userAgent,
      replies: report.replies || [],
      createdAt: report.createdAt,
      updatedAt: report.updatedAt,
    };
  });
}

export class SupportController {
  /**
   * GET /api/v1/support/tickets
   * List customer-submitted issue reports
   */
  static async listTickets(req: Request, res: Response): Promise<void> {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
      const fetchLimit = Math.min(5000, (page - 1) * limit + limit);
      const status = typeof req.query.status === 'string' ? req.query.status : '';
      if (status && !['new', 'read', 'replied', 'closed'].includes(status)) {
        res.status(400).json({ success: false, error: 'Invalid ticket status filter' });
        return;
      }

      const filter: Record<string, unknown> = {};
      if (status === 'new') filter.status = { $in: ['new', 'open'] };
      else if (status) filter.status = status;

      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      if (search) {
        const searchRegex = new RegExp(escapeRegex(search), 'i');
        const matchingProfiles = await Profile.find({
          $or: [{ name: searchRegex }, { email: searchRegex }],
        })
          .select('uid')
          .limit(2000)
          .lean();
        const matchingUserIds = matchingProfiles.flatMap((profile) =>
          [profile.uid, profile._id ? String(profile._id) : undefined].filter(Boolean) as string[],
        );
        filter.$or = [
          { issueLabel: searchRegex },
          { message: searchRegex },
          { pageContext: searchRegex },
          { issueType: searchRegex },
          { userId: searchRegex },
          { userUid: searchRegex },
          ...(matchingUserIds.length > 0
            ? [
                { userId: { $in: matchingUserIds } },
                { userUid: { $in: matchingUserIds } },
              ]
            : []),
        ];
      }

      const reportsCollection = mongoose.connection.collection<IssueReportRecord>('issuereports');
      const [total, reports] = await Promise.all([
        reportsCollection.countDocuments(filter),
        reportsCollection
          .find(filter)
          .sort({ createdAt: -1 })
          .limit(fetchLimit)
          .toArray(),
      ]);
      let contactResult: any = { data: [], total: 0 };
      let warning: string | undefined;
      try {
        contactResult = await supportServiceClient.getContactMessages({
          page: 1,
          limit: fetchLimit,
          status: status || undefined,
          search: search || undefined,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn('Legacy support messages unavailable; returning customer issue reports only', {
          message,
        });
        warning = 'Older support messages are temporarily unavailable; customer app tickets are shown.';
      }

      const issueTickets = await toSupportTickets(reports);
      const contactData = contactResult?.data ?? contactResult?.messages ?? contactResult;
      const contactRows = Array.isArray(contactData)
        ? contactData
        : Array.isArray(contactData?.messages)
          ? contactData.messages
          : [];
      const contactTickets = contactRows.map((ticket: any) => ({
        ...ticket,
        _id: String(ticket._id || ticket.id),
        source: ticket.source || 'Support Service',
      }));
      const contactTotal =
        contactResult?.pagination?.total ??
        contactData?.pagination?.total ??
        contactResult?.total ??
        contactTickets.length;
      const tickets = [...issueTickets, ...contactTickets]
        .sort(
          (left, right) =>
            new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime(),
        )
        .slice((page - 1) * limit, page * limit);
      const combinedTotal = total + contactTotal;

      res.json({
        success: true,
        data: tickets,
        pagination: {
          page,
          limit,
          total: combinedTotal,
          pages: Math.ceil(combinedTotal / limit),
        },
        ...(warning ? { warning } : {}),
      });
    } catch (error: any) {
      logger.error('List support tickets error:', error);
      res.status(getClientSafeStatus(error)).json({
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
      const report = mongoose.Types.ObjectId.isValid(ticketId)
        ? await mongoose.connection
            .collection<IssueReportRecord>('issuereports')
            .findOne({ _id: new mongoose.Types.ObjectId(ticketId) })
        : null;
      if (report) {
        const [ticket] = await toSupportTickets([report]);
        res.json({ success: true, data: ticket });
        return;
      }

      const contactResult = await supportServiceClient.getContactMessage(ticketId);
      res.json({
        success: true,
        data: {
          ...(contactResult.data || contactResult),
          source: 'Support Service',
        },
      });
    } catch (error: any) {
      logger.error('Get support ticket error:', error);
      res.status(getClientSafeStatus(error)).json({
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

      const reportsCollection = mongoose.connection.collection<IssueReportRecord>('issuereports');
      const ticketObjectId = mongoose.Types.ObjectId.isValid(ticketId)
        ? new mongoose.Types.ObjectId(ticketId)
        : null;
      const report = ticketObjectId
        ? await reportsCollection.findOne({ _id: ticketObjectId })
        : null;
      let updatedTicket: any;
      if (report && ticketObjectId) {
        await reportsCollection.updateOne(
          { _id: ticketObjectId },
          { $set: { status, updatedAt: new Date() } },
        );
        const updatedReport = await reportsCollection.findOne({ _id: ticketObjectId });
        if (!updatedReport) {
          res.status(500).json({ success: false, error: 'Updated support ticket could not be loaded' });
          return;
        }
        [updatedTicket] = await toSupportTickets([updatedReport]);
      } else {
        const result = await supportServiceClient.updateContactMessageStatus(
          ticketId,
          status as 'new' | 'read' | 'replied' | 'closed',
          req.admin?.userId,
        );
        updatedTicket = {
          ...(result.data || result),
          source: 'Support Service',
        };
      }

      await createAuditLog(
        req,
        `${Resource.SUPPORT_TICKET}.update`,
        Resource.SUPPORT_TICKET,
        ticketId,
        { status }
      );

      res.json({
        success: true,
        data: updatedTicket,
      });
    } catch (error: any) {
      logger.error('Update ticket status error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to update ticket status',
      });
    }
  }

  /**
   * POST /api/v1/support/tickets/:ticketId/replies
   * Add a customer-visible response to a customer app ticket.
   */
  static async replyToTicket(req: Request, res: Response): Promise<void> {
    try {
      const { ticketId } = req.params;
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      if (!message || message.length > 2000) {
        res.status(400).json({
          success: false,
          error: 'Reply must be between 1 and 2000 characters',
        });
        return;
      }

      if (!mongoose.Types.ObjectId.isValid(ticketId)) {
        res.status(404).json({ success: false, error: 'Support ticket not found' });
        return;
      }

      const reportsCollection = mongoose.connection.collection<IssueReportRecord>('issuereports');
      const ticketObjectId = new mongoose.Types.ObjectId(ticketId);
      const report = await reportsCollection.findOne({ _id: ticketObjectId });
      if (!report) {
        res.status(404).json({ success: false, error: 'Support ticket not found' });
        return;
      }

      await reportsCollection.updateOne(
        { _id: ticketObjectId },
        {
          $push: {
            replies: {
              message,
              repliedBy: req.admin?.name || req.admin?.userId || 'Support Team',
              createdAt: new Date(),
            },
          },
          $set: { status: 'replied', updatedAt: new Date() },
        },
      );
      const updatedReport = await reportsCollection.findOne({ _id: ticketObjectId });
      if (!updatedReport) {
        res.status(500).json({ success: false, error: 'Updated support ticket could not be loaded' });
        return;
      }

      const [updatedTicket] = await toSupportTickets([updatedReport]);
      await createAuditLog(
        req,
        `${Resource.SUPPORT_TICKET}.reply`,
        Resource.SUPPORT_TICKET,
        ticketId,
        { replyLength: message.length },
      );
      res.json({ success: true, data: updatedTicket });
    } catch (error: any) {
      logger.error('Reply to support ticket error:', error);
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to send support ticket reply',
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
      res.status(getClientSafeStatus(error)).json({
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
      res.status(getClientSafeStatus(error)).json({
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
      res.status(getClientSafeStatus(error)).json({
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
      res.status(getClientSafeStatus(error)).json({
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
      res.status(getClientSafeStatus(error)).json({
        success: false,
        error: error.response?.data?.error || 'Failed to delete article',
      });
    }
  }
}
