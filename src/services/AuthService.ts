import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { env } from '../config/env';
import { AdminUser, IAdminUser } from '../models/AdminUser';
import logger from '../config/logger';
import { DashboardType } from '../types/dashboard';

export interface TokenPayload {
  userId: string;
  email: string;
  dashboardType: DashboardType;
  role: string;
  isSuperAdmin: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export class AuthService {
  private static isPrivilegedOpsManager(email: string): boolean {
    return email.toLowerCase() === 'operationsmanager@extrahand.in';
  }
  /**
   * Generate access and refresh tokens
   */
  static generateTokens(payload: TokenPayload): AuthTokens {
    const accessToken = jwt.sign(
      payload,
      env.JWT_SECRET,
      { expiresIn: env.JWT_ACCESS_EXPIRY } as jwt.SignOptions
    );
    
    const refreshToken = jwt.sign(
      { userId: payload.userId, type: 'refresh' },
      env.JWT_REFRESH_SECRET,
      { expiresIn: env.JWT_REFRESH_EXPIRY } as jwt.SignOptions
    );
    
    // Calculate expiresIn in seconds
    const expiresIn = this.parseExpiry(env.JWT_ACCESS_EXPIRY);
    
    return { accessToken, refreshToken, expiresIn };
  }
  
  /**
   * Verify access token
   */
  static verifyAccessToken(token: string): TokenPayload {
    try {
      return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    } catch (error) {
      throw new Error('Invalid or expired access token');
    }
  }
  
  /**
   * Verify refresh token
   */
  static verifyRefreshToken(token: string): { userId: string } {
    try {
      const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET) as any;
      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }
      return { userId: decoded.userId };
    } catch (error) {
      throw new Error('Invalid or expired refresh token');
    }
  }

  /**
   * Get user by ID (userId field, not _id)
   */
  static async getUserById(userId: string): Promise<IAdminUser | null> {
    return await AdminUser.findOne({ userId });
  }
  
  /**
   * Login with email and password
   */
  static async login(
    email: string,
    password: string,
    dashboardType: DashboardType
  ): Promise<{ user: IAdminUser; tokens: AuthTokens }> {
    const user = await AdminUser.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      throw new Error('Invalid email or password');
    }
    
    if (user.status !== 'active') {
      throw new Error('Account is suspended or inactive');
    }
    
    if (!user.canAccessDashboard(dashboardType)) {
      throw new Error('You do not have access to this dashboard');
    }
    
    // Verify password
    if (user.passwordHash) {
      const isValid = await user.verifyPassword(password);
      if (!isValid) {
        throw new Error('Invalid email or password');
      }
    } else {
      throw new Error('Password not set. Please use OAuth or set a password.');
    }
    
    // Update login info
    user.lastLoginAt = new Date();
    user.loginCount = (user.loginCount || 0) + 1;
    
    // Update last access for this dashboard
    const dashboardAccess = user.dashboardAccess.find(
      (a) => a.dashboardType === dashboardType
    );
    if (dashboardAccess) {
      dashboardAccess.lastAccessAt = new Date();
    }
    
    await user.save();
    
    // Generate tokens
    const role = user.getDashboardRole(dashboardType) || 'unknown';
    const tokens = this.generateTokens({
      userId: user.userId,
      email: user.email,
      dashboardType,
      role,
      isSuperAdmin: user.isSuperAdmin || this.isPrivilegedOpsManager(user.email),
    });
    
    // Store refresh token
    const refreshExpiry = new Date();
    refreshExpiry.setTime(refreshExpiry.getTime() + this.parseExpiry(env.JWT_REFRESH_EXPIRY) * 1000);
    user.addRefreshToken(tokens.refreshToken, refreshExpiry);
    await user.save();
    
    logger.info(`Admin user logged in: ${user.email} (${dashboardType})`);
    
    return { user, tokens };
  }
  
  /**
   * Refresh access token
   */
  static async refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
    const { userId } = this.verifyRefreshToken(refreshToken);
    
    const user = await AdminUser.findOne({ userId });
    if (!user || user.status !== 'active') {
      throw new Error('User not found or inactive');
    }
    
    // Verify refresh token is in user's token list
    user.cleanupExpiredTokens();
    const tokenExists = user.refreshTokens.some(
      (t) => t.token === refreshToken && t.expiresAt > new Date()
    );
    
    if (!tokenExists) {
      throw new Error('Invalid refresh token');
    }
    
    // For refresh, we need to know which dashboard - this is a limitation
    // In practice, you might store dashboardType in the refresh token or require it in the request
    // For now, we'll use the first active dashboard access
    const activeAccess = user.dashboardAccess.find((a) => a.status === 'active');
    if (!activeAccess && !user.isSuperAdmin) {
      throw new Error('No active dashboard access');
    }
    
    const dashboardType = user.isSuperAdmin 
      ? DashboardType.SUPER_ADMIN 
      : (activeAccess?.dashboardType || DashboardType.MAIN_ADMIN);
    
    const role = user.getDashboardRole(dashboardType) || 'unknown';
    
    const tokens = this.generateTokens({
      userId: user.userId,
      email: user.email,
      dashboardType,
      role,
      isSuperAdmin: user.isSuperAdmin || this.isPrivilegedOpsManager(user.email),
    });
    
    // Update refresh token
    const refreshExpiry = new Date();
    refreshExpiry.setTime(refreshExpiry.getTime() + this.parseExpiry(env.JWT_REFRESH_EXPIRY) * 1000);
    user.addRefreshToken(tokens.refreshToken, refreshExpiry);
    await user.save();
    
    return tokens;
  }
  
  /**
   * Parse expiry string (e.g., "15m", "7d") to seconds
   */
  private static parseExpiry(expiry: string): number {
    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) return 3600; // Default 1 hour
    
    const value = parseInt(match[1]);
    const unit = match[2];
    
    const multipliers: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };
    
    return value * (multipliers[unit] || 1);
  }
}
