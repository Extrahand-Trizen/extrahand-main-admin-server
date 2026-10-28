import { taskServiceClient } from './TaskServiceClient';
import { userServiceClient } from './UserServiceClient';
import { getTaskPostedEmailSettings, isPhoneExcluded } from './TaskPostedEmailSettingsService';

const PAGE_SIZE = 50;
const MAX_TASKS = 1000;

type TaskRow = Record<string, any>;
type ProfileRow = Record<string, any>;

type TeamTask = {
  task: TaskRow;
  requester: ProfileRow;
};

function stringifyId(value: unknown): string {
  if (value && typeof value === 'object') {
    const id = value as Record<string, unknown>;
    return stringifyId(id._id ?? id.id ?? id.$oid);
  }
  return String(value ?? '').trim();
}

function normalizeId(value: unknown): string {
  return stringifyId(value).toLowerCase();
}

function taskId(task: TaskRow): string {
  return normalizeId(task.taskId ?? task._id ?? task.id);
}

function requesterId(task: TaskRow): string {
  return normalizeId(task.CustomerId ?? task.customerId ?? task.requesterId);
}

function profileIdentifiers(profile: ProfileRow): string[] {
  return [profile._id, profile.id, profile.profileId, profile.userId, profile.uid]
    .map(normalizeId)
    .filter(Boolean);
}

function mapProfiles(profiles: ProfileRow[]): Map<string, ProfileRow> {
  const result = new Map<string, ProfileRow>();
  for (const profile of profiles) {
    for (const id of profileIdentifiers(profile)) result.set(id, profile);
  }
  return result;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function isTeamPostedByExistingFilter(
  phone: string | undefined,
  excludedPhones: string[],
): boolean {
  return Boolean(phone && isPhoneExcluded(phone, excludedPhones));
}

export function filterTeamWorkByExistingClassification(
  tasks: TaskRow[],
  profiles: ProfileRow[],
  excludedPhones: string[],
): TeamTask[] {
  const profilesById = mapProfiles(profiles);
  return tasks
    .filter((task) => !task.isDeletedByCustomer && !task.isDeletedBySupport)
    .map((task) => ({ task, requester: profilesById.get(requesterId(task)) }))
    .filter((entry): entry is TeamTask => {
      const requester = entry.requester;
      return Boolean(
        requester && isTeamPostedByExistingFilter(requester.phone, excludedPhones),
      );
    });
}

function mapUpstreamPagination(payload: any): { pages: number } | undefined {
  const pagination = payload?.pagination ?? payload?.meta?.pagination;
  if (!pagination) return undefined;
  const pages = Number(pagination.pages ?? pagination.totalPages ?? 1);
  return Number.isFinite(pages) && pages > 0 ? { pages } : undefined;
}

async function fetchTasks(params: Record<string, unknown> = {}): Promise<{
  tasks: TaskRow[];
  truncated: boolean;
}> {
  const tasks: TaskRow[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const result = await taskServiceClient.listTasks({
      ...params,
      page,
      limit: PAGE_SIZE,
    });
    const rows = Array.isArray(result?.data) ? result.data : [];
    tasks.push(...rows);
    totalPages = mapUpstreamPagination(result)?.pages ??
      (rows.length === PAGE_SIZE ? page + 1 : page);
    page += 1;
  } while (page <= totalPages && tasks.length < MAX_TASKS);

  return {
    tasks: tasks.slice(0, MAX_TASKS),
    truncated: tasks.length >= MAX_TASKS && page <= totalPages,
  };
}

async function fetchProfiles(profileIds: string[]): Promise<ProfileRow[]> {
  const uniqueIds = Array.from(new Set(profileIds.filter(Boolean)));
  if (uniqueIds.length === 0) return [];
  const response = await userServiceClient.getProfilesBatch(uniqueIds);
  return Array.isArray(response?.profiles) ? response.profiles : [];
}

export async function listTeamWork(params: Record<string, unknown> = {}): Promise<{
  rows: TeamTask[];
  truncated: boolean;
}> {
  const [{ tasks, truncated }, settings] = await Promise.all([
    fetchTasks(params),
    getTaskPostedEmailSettings(),
  ]);
  const profiles = await fetchProfiles(tasks.map(requesterId));
  return {
    rows: filterTeamWorkByExistingClassification(tasks, profiles, settings.excludedPhones),
    truncated,
  };
}

export async function getTeamWork(workId: string): Promise<TeamTask | undefined> {
  const { rows } = await listTeamWork();
  const normalizedWorkId = normalizeId(workId);
  return rows.find(({ task }) => taskId(task) === normalizedWorkId);
}

export async function getPartnerById(workerId: string): Promise<ProfileRow | undefined> {
  const response = await userServiceClient.getUser(workerId);
  const profile = response?.data ?? response;
  const roles = Array.isArray(profile?.roles) ? profile.roles : [];
  if (!roles.includes('partner')) return undefined;
  return profile;
}

export async function listPartners(): Promise<{ profiles: ProfileRow[]; truncated: boolean }> {
  const profiles: ProfileRow[] = [];
  let page = 1;
  let pages = 1;
  do {
    const result = await userServiceClient.listUsers({
      role: 'partner',
      page,
      limit: PAGE_SIZE,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    });
    const rows = Array.isArray(result?.data) ? result.data : [];
    profiles.push(...rows);
    const pagination = result?.pagination;
    pages = Number(pagination?.pages ?? 1);
    page += 1;
  } while (page <= pages && profiles.length < MAX_TASKS);
  return {
    profiles: profiles.slice(0, MAX_TASKS),
    truncated: profiles.length >= MAX_TASKS && page <= pages,
  };
}

export function projectPartner(profile: ProfileRow): Record<string, unknown> {
  const partnerProfile = profile.partnerProfile ?? {};
  const location = profile.location ?? {};
  const addressDetails = location.addressDetails ?? {};
  const skills = partnerProfile.skills && typeof partnerProfile.skills === 'object'
    ? Object.fromEntries(
        Object.entries(partnerProfile.skills).map(([key, value]) => [key, stringArray(value)]),
      )
    : {};
  return {
    id: stringifyId(profile._id ?? profile.id ?? profile.profileId ?? profile.uid),
    name: profile.name ?? profile.fullName ?? null,
    phone: profile.phone ?? null,
    photoURL: profile.photoURL ?? null,
    isActive: profile.isActive ?? null,
    status: profile.status ?? null,
    location: {
      city: addressDetails.city ?? location.city ?? null,
      state: addressDetails.state ?? location.state ?? null,
      area: addressDetails.area ?? null,
    },
    partner: {
      status: partnerProfile.status ?? null,
      categories: stringArray(partnerProfile.categories),
      skills,
      workAreas: stringArray(partnerProfile.workAreas).length > 0
        ? stringArray(partnerProfile.workAreas)
        : stringArray(profile.helperWorkAreas),
      workShiftType: partnerProfile.workShiftType ?? null,
      workShifts: stringArray(partnerProfile.workShifts),
    },
  };
}

export function projectCustomer(profile: ProfileRow): Record<string, unknown> {
  return {
    id: stringifyId(profile._id ?? profile.id ?? profile.profileId ?? profile.uid),
    name: profile.name ?? profile.fullName ?? null,
    phone: profile.phone ?? null,
  };
}

export function projectWork(task: TaskRow, requester: ProfileRow, assignedPartner?: ProfileRow): Record<string, unknown> {
  const assignedPartnerId = task.assigneeId ?? task.assigneeUid ?? task.partnerId ?? task.partnerUid ?? null;
  const location = task.location ?? {};
  return {
    id: taskId(task),
    title: task.title ?? null,
    description: task.description ?? null,
    category: task.category ?? null,
    categorySlug: task.categorySlug ?? null,
    categoryLabel: task.categoryLabel ?? null,
    subcategory: task.subcategory ?? null,
    status: task.status ?? null,
    createdAt: task.createdAt ?? null,
    updatedAt: task.updatedAt ?? null,
    scheduledDate: task.scheduledDate ?? null,
    scheduledTimeStart: task.scheduledTimeStart ?? null,
    scheduledTimeEnd: task.scheduledTimeEnd ?? null,
    estimatedDuration: task.estimatedDuration ?? null,
    location: task.location
      ? {
          type: location.type ?? null,
          coordinates: Array.isArray(location.coordinates) ? location.coordinates : null,
          address: location.address ?? null,
          city: location.city ?? null,
          state: location.state ?? null,
          pinCode: location.pinCode ?? null,
          country: location.country ?? null,
          taskArea: location.taskArea ?? null,
        }
      : null,
    requester: projectCustomer(requester),
    assignment: {
      status: task.status === 'assigned' || task.assigneeId || task.assigneeUid || task.partnerId
        ? 'assigned'
        : 'unassigned',
      workerId: assignedPartnerId ? stringifyId(assignedPartnerId) : null,
      worker: assignedPartner ? projectPartner(assignedPartner) : null,
      assignedAt: task.assignedAt ?? null,
    },
  };
}

export function projectStatusHistory(task: TaskRow): Record<string, unknown> {
  const rescheduleHistory = Array.isArray(task.rescheduleHistory)
    ? task.rescheduleHistory.map((entry: Record<string, unknown>) => ({
        previousScheduledDate: entry.previousScheduledDate ?? null,
        previousScheduledTimeStart: entry.previousScheduledTimeStart ?? null,
        previousScheduledTimeEnd: entry.previousScheduledTimeEnd ?? null,
        newScheduledDate: entry.newScheduledDate ?? null,
        newScheduledTimeStart: entry.newScheduledTimeStart ?? null,
        newScheduledTimeEnd: entry.newScheduledTimeEnd ?? null,
        rescheduledAt: entry.rescheduledAt ?? null,
        actorRole: entry.actorRole ?? null,
        reason: entry.reason ?? null,
      }))
    : [];
  return {
    currentStatus: task.status ?? null,
    statusTransitions: null,
    rescheduleHistory,
    statusHistoryComplete: false,
    statusHistoryNote: 'The existing task data does not provide a complete status-transition history.',
  };
}

export function getWorkCategory(task: TaskRow): string {
  return String(task.categorySlug ?? task.categoryLabel ?? task.category ?? '').trim().toLowerCase();
}

export function getWorkAreas(task: TaskRow): string[] {
  const location = task.location ?? {};
  const details = location.addressDetails ?? {};
  return [location.taskArea, details.area, location.city, details.city]
    .map((value) => String(value ?? '').trim().toLowerCase())
    .filter(Boolean);
}

export function partnerMatchesWork(profile: ProfileRow, task: TaskRow): boolean {
  const partner = profile.partnerProfile ?? {};
  const roles = Array.isArray(profile.roles) ? profile.roles : [];
  if (!roles.includes('partner') || profile.isActive === false || profile.status !== 'active') return false;
  if (partner.status && partner.status !== 'approved') return false;

  const category = getWorkCategory(task);
  const partnerCategories = Array.isArray(partner.categories) ? partner.categories : [];
  const partnerSkills = Object.values(partner.skills ?? {}).flatMap((skills) =>
    Array.isArray(skills) ? skills : [],
  );
  if (category) {
    if (partnerCategories.length + partnerSkills.length === 0) return false;
    const normalized = [...partnerCategories, ...partnerSkills]
      .map((value) => String(value).trim().toLowerCase());
    if (!normalized.some((value) => value === category || category.includes(value) || value.includes(category))) {
      return false;
    }
  }

  const workAreas = getWorkAreas(task);
  const partnerAreas = [
    ...(Array.isArray(partner.workAreas) ? partner.workAreas : []),
    ...(Array.isArray(profile.helperWorkAreas) ? profile.helperWorkAreas : []),
    profile.location?.addressDetails?.area,
    profile.location?.addressDetails?.city,
    profile.location?.city,
  ].map((value) => String(value).trim().toLowerCase());
  return workAreas.length === 0 ||
    (partnerAreas.length > 0 &&
      workAreas.some((area) => partnerAreas.some((partnerArea) => area === partnerArea)));
}
