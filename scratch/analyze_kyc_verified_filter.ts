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

function isVerified(profile: any): boolean {
  if (!profile) return false;
  if (profile.isAadhaarVerified === true) return true;
  const status = String(
    profile?.aadhaarKyc?.visibleStatus ||
      profile?.aadhaarKyc?.internalStatus ||
      profile?.aadhaarKyc?.status ||
      '',
  ).toLowerCase();
  return status === 'verified';
}

async function run() {
  await mongoose.connect(MONGODB_URI, { dbName: MONGO_DB });
  const conn = mongoose.connection;
  const profiles = conn.collection('profiles');

  const notifications = await conn
    .collection('adminnotifications')
    .find({ dashboardType: 'main_admin', type: { $in: AADHAAR_NOTIFICATION_TYPES } })
    .sort({ createdAt: -1 })
    .limit(500)
    .toArray();

  const latestByUserId = new Map<string, any>();
  for (const n of notifications) {
    const userId = String(n.metadata?.userId || '').trim();
    if (!userId || latestByUserId.has(userId)) continue;
    latestByUserId.set(userId, n);
  }

  const pendingReviews = await conn.collection('kycreviews').find({
    $or: [{ reviewStatus: 'pending' }, { followUpStatus: 'followup_uploaded' }],
  }).toArray();

  const kycSessions = await conn.useDb(KYC_DB).collection('kycsessions').find({
    sessionType: { $regex: '^aadhaar', $options: 'i' },
    visibleStatus: { $in: ['under_review', 'failed', 'pending'] },
  }).toArray();

  const userIdsSet = new Set<string>(latestByUserId.keys());
  for (const r of pendingReviews) {
    const id = String(r.userId || '').trim();
    if (id) userIdsSet.add(id);
  }
  for (const s of kycSessions) {
    const id = String(s.userId || '').trim();
    if (id) userIdsSet.add(id);
  }

  const allIds = [...userIdsSet];
  const profileDocs = await profiles.find({ uid: { $in: allIds } }).toArray();
  const profileByUid = new Map(profileDocs.map((p) => [p.uid, p]));

  const notifOnly = latestByUserId.size;
  const combined = allIds.length;
  const withoutVerified = allIds.filter((id) => !isVerified(profileByUid.get(id))).length;
  const notifWithoutVerified = [...latestByUserId.keys()].filter((id) => !isVerified(profileByUid.get(id))).length;

  console.log('Notifications only:', notifOnly);
  console.log('Notifications excluding verified profiles:', notifWithoutVerified);
  console.log('Combined (current logic):', combined);
  console.log('Combined excluding verified:', withoutVerified);

  const kycSessionsActive = await conn.useDb(KYC_DB).collection('kycsessions').find({
    sessionType: { $regex: '^aadhaar', $options: 'i' },
    visibleStatus: { $in: ['under_review', 'failed', 'pending'] },
  }).toArray();

  const activeSet = new Set<string>(latestByUserId.keys());
  for (const r of pendingReviews) {
    const id = String(r.userId || '').trim();
    if (id) activeSet.add(id);
  }
  for (const s of kycSessionsActive) {
    const id = String(s.userId || '').trim();
    if (id) activeSet.add(id);
  }
  const activeIds = [...activeSet];
  const activeWithoutVerified = activeIds.filter((id) => !isVerified(profileByUid.get(id))).length;
  console.log('Active-session combined:', activeIds.length);
  console.log('Active-session excluding verified:', activeWithoutVerified);

  await mongoose.disconnect();
}

run().catch(console.error);
