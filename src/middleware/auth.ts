import { Request, Response, NextFunction } from 'express';
import { AuthService, TokenPayload } from '../services/AuthService';
import { AdminUser } from '../models/AdminUser';
import logger from '../config/logger';
import { DashboardType } from '../types/dashboard';

// Extend Express Request to include admin user
declare global {
  namespace Express {
    interface Request {
      admin?: {
        userId: string;
        email: string;
        name: string;
        dashboardType: DashboardType;
        role: string;
        isSuperAdmin: boolean;
        permissions: string[];
      };
    }
  }
}

/**
 * Verify JWT token and attach admin user to request
 */
export const verifyAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ success: false, error: 'No token provided' });
      return;
    }
    
    const token = authHeader.substring(7);
    const payload = AuthService.verifyAccessToken(token);
    
    // Fetch user from database to get latest permissions
    const user = await AdminUser.findOne({ userId: payload.userId });
    
    if (!user || user.status !== 'active') {
      res.status(401).json({ success: false, error: 'User not found or inactive' });
      return;
    }
    
    // Verify dashboard access
    if (!user.canAccessDashboard(payload.dashboardType)) {
      res.status(403).json({ success: false, error: 'Access denied to this dashboard' });
      return;
    }
    
    // Get permissions for this dashboard and role
    const { PermissionService } = await import('../services/PermissionService');
    const permissions = PermissionService.getRolePermissions(
      payload.dashboardType,
      payload.role
    );
    
    // Attach admin info to request
    req.admin = {
      userId: user.userId,
      email: user.email,
      name: user.name,
      dashboardType: payload.dashboardType,
      role: payload.role,
      isSuperAdmin: user.isSuperAdmin,
      permissions: permissions,
    };
    
    next();
  } catch (error: any) {
    logger.error('Auth verification failed:', error);
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
};

/**
 * Require specific dashboard access
 */
export const requireDashboardAccess = (dashboardType: DashboardType) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    
    if (req.admin.dashboardType !== dashboardType && !req.admin.isSuperAdmin) {
      res.status(403).json({ success: false, error: 'Access denied to this dashboard' });
      return;
    }
    
    next();
  };
};

/**
 * Require specific permission
 */
export const requirePermission = (permission: string) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.admin) {
      res.status(401).json({ success: false, error: 'Authentication required' });
      return;
    }
    
    // Super admin has all permissions
    if (req.admin.isSuperAdmin) {
      next();
      return;
    }
    
    if (!req.admin.permissions.includes(permission)) {
      res.status(403).json({ 
        success: false, 
        error: 'Insufficient permissions',
        required: permission 
      });
      return;
    }
    
    next();
  };
};

/**
 * Require super admin
 */
export const requireSuperAdmin = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  if (!req.admin) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }
  
  if (!req.admin.isSuperAdmin) {
    res.status(403).json({ success: false, error: 'Super admin access required' });
    return;
  }
  
  next();
};
