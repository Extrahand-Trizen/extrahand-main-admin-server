import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || '';
const MONGO_DB = process.env.MONGO_DB || 'extrahand';
const KYC_DB = process.env.KYC_VERIFICATION_DB || 'extrahand_verifications';

const AADHAAR_NOTIFICATION_TYPES = [
  'aadhaar_verification_failed',
  'aadhaar_verification_under_review',
];

async function run() {
  await mongoose.connect(MONGODB_URI, { dbName: MONGO_DB });
  const conn = mongoose.connection;

  const notifications = await conn
    .collection('adminnotifications')
    .find({
      dashboardType: 'main_admin',
      type: { $in: AADHAAR_NOTIFICATION_TYPES },
    })
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray();

  const latestByUserId = new Map<string, any>();
  for (const n of notifications) {
    const userId = String(n.metadata?.userId || '').trim();
    if (!userId || latestByUserId.has(userId)) continue;
    latestByUserId.set(userId, n);
  }

  const pendingReviews = await conn
    .collection('kycreviews')
    .find({
      $or: [{ reviewStatus: 'pending' }, { followUpStatus: 'followup_uploaded' }],
    })
    .toArray();

  const kycConn = conn.useDb(KYC_DB);
  const kycSessions = await kycConn
    .collection('kycsessions')
    .find({
      sessionType: { $regex: '^aadhaar', $options: 'i' },
      visibleStatus: { $in: ['expired', 'under_review', 'failed', 'rejected', 'pending'] },
    })
    .toArray();

  const kycSessionsActive = await kycConn
    .collection('kycsessions')
    .find({
      sessionType: { $regex: '^aadhaar', $options: 'i' },
      visibleStatus: { $in: ['under_review', 'failed', 'pending'] },
    })
    .toArray();

  const userIdsSet = new Set<string>(latestByUserId.keys());
  for (const r of pendingReviews) {
    const userId = String(r.userId || '').trim();
    if (userId) userIdsSet.add(userId);
  }
  for (const s of kycSessions) {
    const userId = String(s.userId || '').trim();
    if (userId) userIdsSet.add(userId);
  }

  const userIdsSetActiveOnly = new Set<string>(latestByUserId.keys());
  for (const r of pendingReviews) {
    const userId = String(r.userId || '').trim();
    if (userId) userIdsSetActiveOnly.add(userId);
  }
  for (const s of kycSessionsActive) {
    const userId = String(s.userId || '').trim();
    if (userId) userIdsSetActiveOnly.add(userId);
  }

  const onlyFromSessions = [...userIdsSet].filter((id) => !latestByUserId.has(id) && !pendingReviews.some((r) => String(r.userId) === id));
  const onlyFromExpiredRejected = kycSessions
    .filter((s) => ['expired', 'rejected'].includes(String(s.visibleStatus)))
    .map((s) => String(s.userId))
    .filter((id) => id && !latestByUserId.has(id));

  console.log('Notification unique users:', latestByUserId.size);
  console.log('Pending KycReviews:', pendingReviews.length);
  console.log('KycSessions (all statuses):', kycSessions.length, 'unique users:', new Set(kycSessions.map((s) => s.userId)).size);
  console.log('KycSessions (active only):', kycSessionsActive.length, 'unique users:', new Set(kycSessionsActive.map((s) => s.userId)).size);
  console.log('Current combined unique userIds:', userIdsSet.size);
  console.log('Active-session combined unique userIds:', userIdsSetActiveOnly.size);
  console.log('Extra users from KycSession (not in notifications/pending):', onlyFromSessions.length);
  console.log('Extra from expired/rejected sessions only:', new Set(onlyFromExpiredRejected).size);

  // Check profiles for duplicate uid mapping
  const profiles = conn.collection('profiles');
  const allIds = [...userIdsSet];
  const profileMatches = await profiles
    .find({ $or: [{ uid: { $in: allIds } }, { _id: { $in: allIds.filter((id) => /^[a-f0-9]{24}$/i.test(id)) } }] })
    .project({ uid: 1, name: 1, phone: 1, isAadhaarVerified: 1 })
    .toArray();

  const uidGroups = new Map<string, string[]>();
  for (const id of allIds) {
    const profile = profileMatches.find((p) => p.uid === id || String(p._id) === id);
    const canonical = profile?.uid || id;
    const list = uidGroups.get(canonical) || [];
    list.push(id);
    uidGroups.set(canonical, list);
  }
  const duplicateGroups = [...uidGroups.entries()].filter(([, ids]) => ids.length > 1);
  console.log('Duplicate userId groups (same profile uid):', duplicateGroups.length);
  if (duplicateGroups.length > 0) {
    console.log('Sample duplicates:', duplicateGroups.slice(0, 5));
  }

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
