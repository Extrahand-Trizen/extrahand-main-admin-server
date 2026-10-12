import { RoundRobinTeamSettings } from '../models/RoundRobinTeamSettings';
import { AdminUser } from '../models/AdminUser';
import { DashboardType } from '../types/dashboard';
import {
  TASK_POSTED_ROUND_ROBIN_EMAILS,
  normalizeAdminEmail,
  resolveAssignedDisplayName,
} from '../constants/taskAssignment';

const SETTINGS_KEY = 'support_team_round_robin';
const OPS_DASHBOARD_ROLES = ['operations_admin', 'operation_admin', 'operations'];

export interface RoundRobinMemberDetail {
  userId: string;
  name: string;
  email: string;
}

export interface RoundRobinTeamSettingsData {
  teamMembers: RoundRobinMemberDetail[];
  availableOpsAdmins: RoundRobinMemberDetail[];
}

export function isOpsAdmin(admin: {
  isSuperAdmin?: boolean;
  dashboardAccess?: Array<{
    dashboardType: string;
    status: string;
    role: string;
  }>;
}): boolean {
  if (admin.isSuperAdmin) return true;
  return Boolean(
    admin.dashboardAccess?.some(
      (access) =>
        access.dashboardType === DashboardType.MAIN_ADMIN &&
        access.status === 'active' &&
        OPS_DASHBOARD_ROLES.includes(access.role),
    ),
  );
}

/**
 * Get the current ordered list of round-robin emails.
 * Uses DB if configured, otherwise falls back to TASK_POSTED_ROUND_ROBIN_EMAILS.
 */
export async function getRoundRobinEmails(): Promise<string[]> {
  const doc = await RoundRobinTeamSettings.findOne({ key: SETTINGS_KEY }).lean();
  if (doc?.emails && doc.emails.length > 0) {
    return doc.emails.map(normalizeAdminEmail).filter(Boolean);
  }
  return [...TASK_POSTED_ROUND_ROBIN_EMAILS].map(normalizeAdminEmail);
}

/**
 * Update the ordered list of round-robin emails.
 */
export async function updateRoundRobinEmails(
  emails: string[],
  updatedBy?: string,
): Promise<string[]> {
  const normalized = Array.from(
    new Set(emails.map(normalizeAdminEmail).filter(Boolean)),
  );

  if (normalized.length === 0) {
    throw new Error('Round-robin team must have at least one member');
  }

  const doc = await RoundRobinTeamSettings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $set: { emails: normalized, updatedBy } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  ).lean();

  return doc?.emails || normalized;
}

/**
 * Get full team details for the settings UI (team members in order + available unassigned ops admins).
 */
export async function getRoundRobinTeamDetails(): Promise<RoundRobinTeamSettingsData> {
  const currentEmails = await getRoundRobinEmails();

  const allActiveAdmins = await AdminUser.find({
    status: 'active',
  })
    .select('userId email name isSuperAdmin dashboardAccess')
    .lean();

  // Filter to eligible operations admins
  const eligibleOpsAdmins = allActiveAdmins.filter(isOpsAdmin);

  // Map current emails in exact order
  const teamMembers: RoundRobinMemberDetail[] = currentEmails.map((email) => {
    const admin = allActiveAdmins.find(
      (a) => normalizeAdminEmail(a.email) === normalizeAdminEmail(email),
    );
    return {
      userId: admin?.userId || '',
      email,
      name: resolveAssignedDisplayName(email, admin?.name),
    };
  });

  const memberEmailSet = new Set(currentEmails.map(normalizeAdminEmail));

  // Available operational admins who are not currently in the team
  const availableOpsAdmins: RoundRobinMemberDetail[] = eligibleOpsAdmins
    .filter((admin) => !memberEmailSet.has(normalizeAdminEmail(admin.email)))
    .map((admin) => ({
      userId: admin.userId,
      email: normalizeAdminEmail(admin.email),
      name: resolveAssignedDisplayName(admin.email, admin.name),
    }));

  return {
    teamMembers,
    availableOpsAdmins,
  };
}
