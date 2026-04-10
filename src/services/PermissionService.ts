import { MAIN_ADMIN_PERMISSIONS, SUPER_ADMIN_PERMISSIONS, Permission } from '../types/permissions';
import { DashboardType } from '../types/dashboard';

export class PermissionService {
  /**
   * Get permissions for a role in a specific dashboard
   */
  static getRolePermissions(dashboardType: DashboardType, role: string): Permission[] {
    if (dashboardType === DashboardType.SUPER_ADMIN && role === 'super_admin') {
      return SUPER_ADMIN_PERMISSIONS;
    }
    
    if (dashboardType === DashboardType.MAIN_ADMIN) {
      return MAIN_ADMIN_PERMISSIONS[role] || [];
    }
    
    // For other dashboards, return empty array (they'll define their own permissions)
    return [];
  }
  
  /**
   * Check if a user has a specific permission
   */
  static hasPermission(
    userPermissions: Permission[],
    requiredPermission: Permission
  ): boolean {
    return userPermissions.includes(requiredPermission);
  }
  
  /**
   * Check if user has any of the required permissions
   */
  static hasAnyPermission(
    userPermissions: Permission[],
    requiredPermissions: Permission[]
  ): boolean {
    return requiredPermissions.some(perm => userPermissions.includes(perm));
  }
  
  /**
   * Check if user has all required permissions
   */
  static hasAllPermissions(
    userPermissions: Permission[],
    requiredPermissions: Permission[]
  ): boolean {
    return requiredPermissions.every(perm => userPermissions.includes(perm));
  }
  
  /**
   * Get audit level for an action
   */
  static getAuditLevel(action: string): 'low' | 'medium' | 'high' | 'critical' {
    const criticalActions = ['delete', 'ban', 'suspend', 'activate', 'deactivate'];
    const highActions = ['approve', 'reject', 'resolve', 'escalate'];
    const mediumActions = ['update', 'assign', 'create'];
    
    if (criticalActions.some(a => action.includes(a))) {
      return 'critical';
    }
    if (highActions.some(a => action.includes(a))) {
      return 'high';
    }
    if (mediumActions.some(a => action.includes(a))) {
      return 'medium';
    }
    return 'low';
  }
  
  /**
   * Check if action requires a reason
   */
  static requiresReason(action: string): boolean {
    const actionsRequiringReason = [
      'ban', 'suspend', 'reject', 'delete', 'deactivate'
    ];
    return actionsRequiringReason.some(a => action.includes(a));
  }
}
