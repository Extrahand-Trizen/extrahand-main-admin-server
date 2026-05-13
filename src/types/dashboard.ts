export enum DashboardType {
  MAIN_ADMIN = 'main_admin',
  SUPER_ADMIN = 'super_admin',
  LEADS_ONBOARDING = 'leads_onboarding',
  PAYMENT_ADMIN = 'payment_admin',
}

export interface IDashboardAccess {
  dashboardType: DashboardType;
  role: string; // Dashboard-specific role
  status: 'active' | 'suspended' | 'inactive';
  permissions: string[]; // Cached permissions for this role
  grantedBy: string; // Super admin userId who granted access
  grantedAt: Date;
  lastAccessAt?: Date;
  notes?: string;
}
