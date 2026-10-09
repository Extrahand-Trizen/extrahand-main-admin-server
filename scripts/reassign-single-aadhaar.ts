/**
 * One-off: Reassign Aadhaar follow-up for Revele Pavan Kumar (+916302874112)
 * to the admin avvkat456@gmail.com
 *
 * Usage: npx ts-node scripts/reassign-single-aadhaar.ts
 */

import dotenv from 'dotenv';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { AadhaarKycAssignment } from '../src/models/AadhaarKycAssignment';
import { AdminUser } from '../src/models/AdminUser';
import { userServiceClient } from '../src/services/UserServiceClient';

dotenv.config();

const TARGET_PHONE   = '+916302874112';
const TARGET_NAME    = 'Revele Pavan Kumar';
const NEW_ADMIN_EMAIL = 'avvkat456@gmail.com';

async function main(): Promise<void> {
  await connectDatabase();

  // ── 1. Find the new admin ──────────────────────────────────────────────────
  const newAdmin = await AdminUser.findOne({
    email: NEW_ADMIN_EMAIL,
  }).select('userId email name').lean();

  if (!newAdmin) {
    console.error(`❌ Admin not found: ${NEW_ADMIN_EMAIL}`);
    console.error('   Make sure this admin account exists in admin_users collection.');
    await disconnectDatabase();
    process.exit(1);
  }

  console.log(`\n✅ New admin found: ${newAdmin.name} <${newAdmin.email}> (userId: ${newAdmin.userId})`);

  // ── 2. Find the helper by phone via user-service ───────────────────────────
  console.log(`\n🔍 Searching for helper: ${TARGET_NAME} (${TARGET_PHONE})...`);

  let helperUserId: string | null = null;

  try {
    // Search by phone number
    const result = await userServiceClient.listUsers({
      role: 'helper',
      search: TARGET_PHONE,
      limit: 10,
    });

    const users = result?.data || result?.users || [];
    const match = users.find((u: any) => {
      const phone = String(u.phone || '').replace(/\s/g, '');
      return phone === TARGET_PHONE || phone === TARGET_PHONE.replace('+', '');
    });

    if (match) {
      helperUserId = String(match.userId || match._id || match.id || '').trim();
      console.log(`   Found: userId=${helperUserId}, name=${match.name}, phone=${match.phone}`);
    }
  } catch (err: any) {
    console.warn('   user-service search failed:', err.message);
  }

  // ── 3. If not found via user-service, search aadhaar_kyc_assignments directly ──
  if (!helperUserId) {
    console.log('   Falling back to direct assignment lookup...');
    const existing = await AadhaarKycAssignment.find({}).select('userId assignedToName').lean();
    console.log(`   Total assignments in DB: ${existing.length}`);
    console.log('   ⚠️  Could not find helper userId via phone. Please provide userId manually.');
    await disconnectDatabase();
    process.exit(1);
  }

  // ── 4. Find and update the assignment ─────────────────────────────────────
  const existing = await AadhaarKycAssignment.findOne({ userId: helperUserId }).lean();

  if (!existing) {
    console.log(`\n⚠️  No aadhaar_kyc_assignment found for userId=${helperUserId}`);
    console.log('   Creating a new assignment...');
  } else {
    console.log(`\n📋 Current assignment:`);
    console.log(`   userId       : ${existing.userId}`);
    console.log(`   assignedTo   : ${existing.assignedToName} <${existing.assignedToEmail}>`);
  }

  const updated = await AadhaarKycAssignment.findOneAndUpdate(
    { userId: helperUserId },
    {
      userId: helperUserId,
      assignedToUserId: newAdmin.userId,
      assignedToEmail: newAdmin.email,
      assignedToName: newAdmin.name,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  console.log(`\n✅ Successfully reassigned!`);
  console.log(`   Helper  : ${TARGET_NAME} (${TARGET_PHONE})`);
  console.log(`   userId  : ${helperUserId}`);
  console.log(`   Now assigned to: ${updated.assignedToName} <${updated.assignedToEmail}>`);

  await disconnectDatabase();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
