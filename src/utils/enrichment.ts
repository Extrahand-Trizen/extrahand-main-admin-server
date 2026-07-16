import { Profile } from '../models/Profile';
import { Task } from '../models/Task';

interface UserInfo {
  userId?: string;
  name?: string;
}

export interface EnrichmentResult {
  userCache: Map<string, UserInfo>;
  taskTitleCache: Map<string, string>;
  taskAssigneeCache?: Map<string, string>;
}

function populateUserCache(userCache: Map<string, UserInfo>, profiles: any[]) {
  (profiles || []).forEach((u: any) => {
    if (!u) return;
    const info: UserInfo = { userId: u.uid, name: u.name };
    if (u.uid) userCache.set(u.uid, info);
    if (u._id) userCache.set(String(u._id), info);
  });
}

function isObjectId(id: string): boolean {
  return /^[0-9a-fA-F]{24}$/.test(id);
}

/**
 * Shared enrichment engine for Payments module.
 * Batch-fetches profiles and tasks directly from MongoDB using Mongoose models.
 * No HTTP calls to User Service or Task Service.
 */
export async function enrichEntities(
  taskIds: string[],
  userUids: string[],
  includeTaskAssignees = false,
): Promise<EnrichmentResult> {
  const userCache = new Map<string, UserInfo>();
  const taskTitleCache = new Map<string, string>();
  const taskAssigneeCache = includeTaskAssignees ? new Map<string, string>() : undefined;

  const uniqueTaskIds = [...new Set(taskIds.filter(Boolean))];
  const firebaseUids: string[] = [];
  const objectIds: string[] = [];

  for (const id of new Set(userUids.filter(Boolean))) {
    if (id === 'pending_assignment') continue;
    if (isObjectId(id)) objectIds.push(id);
    else firebaseUids.push(id);
  }

  // Single batch query per collection — no N+1, no HTTP hops
  const taskQuery: any = uniqueTaskIds.length > 0
    ? {
        $or: [
          { _id: { $in: uniqueTaskIds.filter(isObjectId) } },
          { id: { $in: uniqueTaskIds } },
        ],
      }
    : null;

  const [taskDocs, uidProfiles, objIdProfiles] = await Promise.all([
    taskQuery
      ? Task.find(taskQuery)
          .select('title assigneeUid assigneeId id')
          .lean()
          .catch(() => [])
      : Promise.resolve([]),
    firebaseUids.length > 0
      ? Profile.find({ uid: { $in: firebaseUids } })
          .select('uid name')
          .lean()
          .catch(() => [])
      : Promise.resolve([]),
    objectIds.length > 0
      ? Profile.find({ _id: { $in: objectIds } })
          .select('uid name')
          .lean()
          .catch(() => [])
      : Promise.resolve([]),
  ]);

  populateUserCache(userCache, uidProfiles);
  populateUserCache(userCache, objIdProfiles);

  for (const t of taskDocs) {
    if (t.title) {
      taskTitleCache.set(String(t._id), t.title);
      if ((t as any).id && String((t as any).id) !== String(t._id)) {
        taskTitleCache.set(String((t as any).id), t.title);
      }
    }
    if (includeTaskAssignees && taskAssigneeCache) {
      const assigneeUid = t.assigneeUid || (t.assigneeId ? String(t.assigneeId) : undefined);
      if (assigneeUid && assigneeUid !== 'pending_assignment') {
        taskAssigneeCache.set(String(t._id), assigneeUid);
        if ((t as any).id && String((t as any).id) !== String(t._id)) {
          taskAssigneeCache.set(String((t as any).id), assigneeUid);
        }
      }
    }
  }

  // Fetch profiles for task assignees not already in the user cache
  if (includeTaskAssignees && taskAssigneeCache) {
    const extraUids: string[] = [];
    for (const t of taskDocs) {
      const aid = t.assigneeUid || (t.assigneeId ? String(t.assigneeId) : undefined);
      if (aid && aid !== 'pending_assignment' && !userCache.has(aid)) {
        extraUids.push(aid);
      }
    }
    if (extraUids.length > 0) {
      const extraFirebase = extraUids.filter((id) => !isObjectId(id));
      const extraObjectIds = extraUids.filter((id) => isObjectId(id));
      const [extraUidResult, extraObjIdResult] = await Promise.all([
        extraFirebase.length > 0
          ? Profile.find({ uid: { $in: extraFirebase } })
              .select('uid name')
              .lean()
              .catch(() => [])
          : Promise.resolve([]),
        extraObjectIds.length > 0
          ? Profile.find({ _id: { $in: extraObjectIds } })
              .select('uid name')
              .lean()
              .catch(() => [])
          : Promise.resolve([]),
      ]);
      populateUserCache(userCache, extraUidResult);
      populateUserCache(userCache, extraObjIdResult);
    }
  }

  return { userCache, taskTitleCache, taskAssigneeCache };
}
