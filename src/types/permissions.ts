// Global Permission Vocabulary
// Format: <resource>.<action>

export enum Resource {
  // User Management
  USER = 'user',
  USER_PROFILE = 'user.profile',
  
  // Task Management
  TASK = 'task',
  TASK_APPLICATION = 'task.application',
  
  // Dispute Management
  DISPUTE = 'dispute',
  
  // Content Moderation
  CONTENT = 'content',
  REVIEW = 'review',
  
  // Support
  SUPPORT_TICKET = 'support.ticket',
  
  // Admin Management
  ADMIN_USER = 'admin.user',
  ADMIN_INVITE = 'admin.invite',
  DASHBOARD_CONFIG = 'dashboard.config',
  
  // Analytics
  ANALYTICS = 'analytics',

  // Payments
  PAYMENT = 'payment',
}

export enum Action {
  // Read actions
  VIEW = 'view',
  LIST = 'list',
  SEARCH = 'search',
  
  // Write actions
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  
  // State actions
  APPROVE = 'approve',
  REJECT = 'reject',
  ACTIVATE = 'activate',
  DEACTIVATE = 'deactivate',
  BAN = 'ban',
  UNBAN = 'unban',
  SUSPEND = 'suspend',
  UNSUSPEND = 'unsuspend',
  
  // Special actions
  QUALIFY = 'qualify',
  ASSIGN = 'assign',
  RESOLVE = 'resolve',
  ESCALATE = 'escalate',
  EXPORT = 'export',
  BULK_UPDATE = 'bulk.update',
}

export type Permission = `${Resource}.${Action}`;

// Permission definitions for Main Admin Dashboard roles
export const MAIN_ADMIN_PERMISSIONS: Record<string, Permission[]> = {
  platform_admin: [
    // Users
    `${Resource.USER}.${Action.VIEW}`,
    `${Resource.USER}.${Action.LIST}`,
    `${Resource.USER}.${Action.SEARCH}`,
    `${Resource.USER}.${Action.UPDATE}`,
    `${Resource.USER}.${Action.BAN}`,
    `${Resource.USER}.${Action.UNBAN}`,
    `${Resource.USER}.${Action.SUSPEND}`,
    `${Resource.USER}.${Action.UNSUSPEND}`,
    `${Resource.USER_PROFILE}.${Action.VIEW}`,
    `${Resource.USER_PROFILE}.${Action.UPDATE}`,
    
    // Tasks
    `${Resource.TASK}.${Action.VIEW}`,
    `${Resource.TASK}.${Action.LIST}`,
    `${Resource.TASK}.${Action.SEARCH}`,
    `${Resource.TASK}.${Action.UPDATE}`,
    `${Resource.TASK}.${Action.DELETE}`,
    `${Resource.TASK}.${Action.ASSIGN}`,
    `${Resource.TASK_APPLICATION}.${Action.VIEW}`,
    `${Resource.TASK_APPLICATION}.${Action.LIST}`,
    `${Resource.TASK_APPLICATION}.${Action.UPDATE}`,
    
    // Disputes
    `${Resource.DISPUTE}.${Action.VIEW}`,
    `${Resource.DISPUTE}.${Action.LIST}`,
    `${Resource.DISPUTE}.${Action.RESOLVE}`,
    `${Resource.DISPUTE}.${Action.ESCALATE}`,
    
    // Content
    `${Resource.CONTENT}.${Action.VIEW}`,
    `${Resource.CONTENT}.${Action.LIST}`,
    `${Resource.CONTENT}.${Action.DELETE}`,
    `${Resource.REVIEW}.${Action.VIEW}`,
    `${Resource.REVIEW}.${Action.LIST}`,
    `${Resource.REVIEW}.${Action.DELETE}`,
    
    // Support
    `${Resource.SUPPORT_TICKET}.${Action.VIEW}`,
    `${Resource.SUPPORT_TICKET}.${Action.LIST}`,
    `${Resource.SUPPORT_TICKET}.${Action.UPDATE}`,
    `${Resource.SUPPORT_TICKET}.${Action.ASSIGN}`,
    
    // Analytics
    `${Resource.ANALYTICS}.${Action.VIEW}`,
    `${Resource.ANALYTICS}.${Action.EXPORT}`,

    // Payments
    `${Resource.PAYMENT}.${Action.VIEW}`,
    `${Resource.PAYMENT}.${Action.LIST}`,
  ],
  
  operations: [
    // Users
    `${Resource.USER}.${Action.VIEW}`,
    `${Resource.USER}.${Action.LIST}`,
    `${Resource.USER}.${Action.SEARCH}`,
    `${Resource.USER_PROFILE}.${Action.VIEW}`,
    
    // Tasks
    `${Resource.TASK}.${Action.VIEW}`,
    `${Resource.TASK}.${Action.LIST}`,
    `${Resource.TASK}.${Action.SEARCH}`,
    `${Resource.TASK}.${Action.UPDATE}`,
    `${Resource.TASK}.${Action.DELETE}`,
    `${Resource.TASK}.${Action.ASSIGN}`,
    `${Resource.TASK_APPLICATION}.${Action.VIEW}`,
    `${Resource.TASK_APPLICATION}.${Action.LIST}`,
    
    // Analytics
    `${Resource.ANALYTICS}.${Action.VIEW}`,
  ],

  // Invite flow role aliases
  operations_admin: [
    // Users
    `${Resource.USER}.${Action.VIEW}`,
    `${Resource.USER}.${Action.LIST}`,
    `${Resource.USER}.${Action.SEARCH}`,
    `${Resource.USER_PROFILE}.${Action.VIEW}`,

    // Tasks
    `${Resource.TASK}.${Action.VIEW}`,
    `${Resource.TASK}.${Action.LIST}`,
    `${Resource.TASK}.${Action.SEARCH}`,
    `${Resource.TASK}.${Action.UPDATE}`,
    `${Resource.TASK}.${Action.DELETE}`,
    `${Resource.TASK}.${Action.ASSIGN}`,
    `${Resource.TASK_APPLICATION}.${Action.VIEW}`,
    `${Resource.TASK_APPLICATION}.${Action.LIST}`,

    // Analytics
    `${Resource.ANALYTICS}.${Action.VIEW}`,
  ],
  
  support: [
    // Users
    `${Resource.USER}.${Action.VIEW}`,
    `${Resource.USER}.${Action.LIST}`,
    `${Resource.USER_PROFILE}.${Action.VIEW}`,
    
    // Tasks
    `${Resource.TASK}.${Action.VIEW}`,
    `${Resource.TASK}.${Action.LIST}`,
    `${Resource.TASK_APPLICATION}.${Action.VIEW}`,
    `${Resource.TASK_APPLICATION}.${Action.LIST}`,
  ],

  // Invite flow role aliases
  support_admin: [
    // Users
    `${Resource.USER}.${Action.VIEW}`,
    `${Resource.USER}.${Action.LIST}`,
    `${Resource.USER_PROFILE}.${Action.VIEW}`,

    // Tasks
    `${Resource.TASK}.${Action.VIEW}`,
    `${Resource.TASK}.${Action.LIST}`,
    `${Resource.TASK_APPLICATION}.${Action.VIEW}`,
    `${Resource.TASK_APPLICATION}.${Action.LIST}`,
  ],

  payments_admin: [
    `${Resource.PAYMENT}.${Action.VIEW}`,
    `${Resource.PAYMENT}.${Action.LIST}`,
  ],
  
  trust: [
    // Users
    `${Resource.USER}.${Action.VIEW}`,
    `${Resource.USER}.${Action.LIST}`,
    `${Resource.USER_PROFILE}.${Action.VIEW}`,
    
    // Disputes
    `${Resource.DISPUTE}.${Action.VIEW}`,
    `${Resource.DISPUTE}.${Action.LIST}`,
    `${Resource.DISPUTE}.${Action.RESOLVE}`,
    `${Resource.DISPUTE}.${Action.ESCALATE}`,
    
    // Content
    `${Resource.CONTENT}.${Action.VIEW}`,
    `${Resource.CONTENT}.${Action.LIST}`,
    `${Resource.REVIEW}.${Action.VIEW}`,
    `${Resource.REVIEW}.${Action.LIST}`,
  ],
};

// Super Admin permissions (full access)
export const SUPER_ADMIN_PERMISSIONS: Permission[] = [
  // Admin Management
  `${Resource.ADMIN_USER}.${Action.VIEW}`,
  `${Resource.ADMIN_USER}.${Action.LIST}`,
  `${Resource.ADMIN_USER}.${Action.CREATE}`,
  `${Resource.ADMIN_USER}.${Action.UPDATE}`,
  `${Resource.ADMIN_USER}.${Action.DELETE}`,
  `${Resource.ADMIN_USER}.${Action.SUSPEND}`,
  `${Resource.ADMIN_USER}.${Action.UNSUSPEND}`,
  `${Resource.ADMIN_INVITE}.${Action.CREATE}`,
  `${Resource.ADMIN_INVITE}.${Action.LIST}`,
  `${Resource.ADMIN_INVITE}.${Action.DELETE}`,
  `${Resource.DASHBOARD_CONFIG}.${Action.VIEW}`,
  `${Resource.DASHBOARD_CONFIG}.${Action.UPDATE}`,
  
  // All Main Admin permissions
  ...MAIN_ADMIN_PERMISSIONS.platform_admin,
];
