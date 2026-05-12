import { Request, Response } from 'express';
import { AuthService } from '../services/AuthService';
import { DashboardType } from '../types/dashboard';
import logger from '../config/logger';
import { PermissionService } from '../services/PermissionService';

export class AuthController {
  /**
   * POST /api/v1/auth/login
   * Login with email and password
   */
  static async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password, dashboardType } = req.body;
      
      if (!email || !password || !dashboardType) {
        res.status(400).json({
          success: false,
          error: 'Email, password, and dashboardType are required',
        });
        return;
      }
      
      const validDashboardType = Object.values(DashboardType).find(
        (dt) => dt === dashboardType
      );
      
      if (!validDashboardType) {
        res.status(400).json({
          success: false,
          error: 'Invalid dashboardType',
        });
        return;
      }
      
      const { user, tokens } = await AuthService.login(
        email,
        password,
        validDashboardType
      );
      
      // Remove sensitive data
      const userResponse = {
        userId: user.userId,
        email: user.email,
        name: user.name,
        dashboardType: validDashboardType,
        role: user.getDashboardRole(validDashboardType),
        isSuperAdmin: user.isSuperAdmin,
      };
      
      res.json({
        success: true,
        data: {
          user: userResponse,
          tokens,
        },
      });
    } catch (error: any) {
      logger.error('Login error:', error);
      res.status(401).json({
        success: false,
        error: error.message || 'Login failed',
      });
    }
  }
  
  /**
   * GET/POST /api/v1/auth/verify
   * Verify JWT token and return user data
   */
  static async verify(req: Request, res: Response): Promise<void> {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        res.status(401).json({ success: false, error: 'No token provided' });
        return;
      }
      
      const token = authHeader.substring(7);
      const payload = AuthService.verifyAccessToken(token);
      
      // Get full user data
      const user = await AuthService.getUserById(payload.userId);
      
      if (!user) {
        res.status(401).json({ success: false, error: 'User not found' });
        return;
      }
      
      // Get user's role for the dashboard they're accessing
      const dashboardType = payload.dashboardType || 'main_admin';
      const role = user.getDashboardRole(dashboardType as any);
      const computedPermissions = role
        ? PermissionService.getRolePermissions(dashboardType as any, role)
        : [];
      
      const userResponse = {
        userId: user.userId,
        email: user.email,
        name: user.name,
        dashboardType: dashboardType,
        role,
        isSuperAdmin: user.isSuperAdmin,
        status: user.status,
        permissions: computedPermissions,
        lastLoginAt: user.lastLoginAt,
      };
      
      res.json({
        success: true,
        data: {
          user: userResponse,
        },
      });
    } catch (error: any) {
      logger.error('Token verification error:', error);
      res.status(401).json({
        success: false,
        error: error.message || 'Token verification failed',
      });
    }
  }
  
  /**
   * POST /api/v1/auth/refresh
   * Refresh access token
   */
  static async refresh(req: Request, res: Response): Promise<void> {
    try {
      const { refreshToken } = req.body;
      
      if (!refreshToken) {
        res.status(400).json({
          success: false,
          error: 'Refresh token is required',
        });
        return;
      }
      
      const tokens = await AuthService.refreshAccessToken(refreshToken);
      
      res.json({
        success: true,
        data: tokens,
      });
    } catch (error: any) {
      logger.error('Refresh token error:', error);
      res.status(401).json({
        success: false,
        error: error.message || 'Token refresh failed',
      });
    }
  }
  
  /**
   * POST /api/v1/auth/logout
   * Logout (client should discard tokens)
   */
  static async logout(req: Request, res: Response): Promise<void> {
    // In a stateless JWT system, logout is handled client-side
    // But we can log it for audit purposes
    if (req.admin) {
      logger.info(`Admin user logged out: ${req.admin.email}`);
    }
    
    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  }
}
