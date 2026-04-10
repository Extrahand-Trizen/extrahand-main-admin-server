import { Request, Response, NextFunction } from 'express';
import { AuditLog, AuditLevel } from '../models/AuditLog';
import { PermissionService } from '../services/PermissionService';
import logger from '../config/logger';

/**
 * Create audit log entry
 */
export const createAuditLog = async (
  req: Request,
  action: string,
  resourceType: string,
  resourceId: string,
  details?: Record<string, any>,
  previousState?: Record<string, any>,
  newState?: Record<string, any>
): Promise<void> => {
  try {
    if (!req.admin) return;
    
    const level = PermissionService.getAuditLevel(action) as AuditLevel;
    const requiresReason = PermissionService.requiresReason(action);
    
    // For high/critical actions, ensure reason is provided
    if ((level === AuditLevel.HIGH || level === AuditLevel.CRITICAL) && requiresReason) {
      const reason = req.body.reason || req.query.reason;
      if (!reason) {
        logger.warn(`Audit log created without reason for action: ${action}`);
      }
    }
    
    await AuditLog.create({
      auditId: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      userId: req.admin.userId,
      userName: req.admin.name,
      action,
      resourceType,
      resourceId,
      dashboardType: req.admin.dashboardType,
      role: req.admin.role,
      level,
      details: details || {},
      ipAddress: req.ip || req.headers['x-forwarded-for'] as string,
      userAgent: req.headers['user-agent'],
      reason: req.body.reason || req.query.reason,
      previousState,
      newState,
      timestamp: new Date(),
    });
  } catch (error) {
    logger.error('Failed to create audit log:', error);
    // Don't throw - audit logging should not break the request
  }
};

/**
 * Middleware to automatically audit requests
 * Use this for routes that need automatic auditing
 */
export const auditMiddleware = (
  action: string,
  resourceType: string,
  getResourceId: (req: Request) => string = (req) => req.params.id || 'unknown'
) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Store original json method
    const originalJson = res.json.bind(res);
    
    // Override json to capture response
    res.json = function(body: any) {
      // Create audit log after response is determined
      const resourceId = getResourceId(req);
      createAuditLog(
        req,
        action,
        resourceType,
        resourceId,
        { method: req.method, path: req.path },
        undefined,
        body
      ).catch(err => logger.error('Audit log error:', err));
      
      return originalJson(body);
    };
    
    next();
  };
};
