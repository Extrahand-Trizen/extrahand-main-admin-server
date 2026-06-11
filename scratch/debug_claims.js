/**
 * Debug script: query KycReview claims from MongoDB Atlas
 * Run: node scratch/debug_claims.js
 */
const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';

async function main() {
  await mongoose.connect(MONGODB_URI, { dbName: 'extrahand' });
  console.log('Connected to MongoDB Atlas\n');

  const db = mongoose.connection.db;

  // 1. Show ALL KycReview documents with claimedBy set
  const claimedReviews = await db.collection('kycreviews').find(
    { 'claimedBy.userId': { $exists: true, $ne: null } },
    { projection: { userId: 1, sessionId: 1, 'claimedBy.userId': 1, 'claimedBy.email': 1, 'claimedBy.name': 1, reviewStatus: 1, createdAt: 1 } }
  ).toArray();

  console.log(`=== KycReview documents with claims (${claimedReviews.length} total) ===`);
  for (const r of claimedReviews) {
    console.log(JSON.stringify(r, null, 2));
  }

  // 2. Show all admin users  
  const admins = await db.collection('admin_users').find(
    {},
    { projection: { userId: 1, email: 1, name: 1, status: 1 } }
  ).toArray();

  console.log(`\n=== Admin Users (${admins.length} total) ===`);
  for (const a of admins) {
    console.log(JSON.stringify(a, null, 2));
  }

  // 3. Show AdminNotifications for aadhaar types (last 10)
  const notifications = await db.collection('adminnotifications').find(
    { type: { $in: ['aadhaar_verification_failed', 'aadhaar_verification_under_review'] } },
    { projection: { type: 1, 'metadata.userId': 1, 'metadata.userName': 1, createdAt: 1 } }
  ).sort({ createdAt: -1 }).limit(10).toArray();

  console.log(`\n=== Recent Aadhaar Notifications (last 10) ===`);
  for (const n of notifications) {
    console.log(JSON.stringify(n, null, 2));
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
