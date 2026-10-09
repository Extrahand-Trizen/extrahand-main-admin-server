/**
 * One-time migration: redistribute all aadhaar_kyc_assignments that were assigned to
 * tadembharat@cognitbotz.com equally (round-robin) across the 3 new ops admins:
 *   1. shivakumar@cognitbotz.com
 *   2. bharatr@cognitbotz.com       (bandelabharathreddy)
 *   3. saikumarn@cognitbotz.com     (saikumar)
 *
 * Usage:
 *   npx ts-node scripts/migrate-tadembharat-aadhaar-assignments.ts
 *
 * Safe to re-run — only touches rows still assigned to tadembharat.
 */

import dotenv from 'dotenv';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { AadhaarKycAssignment } from '../src/models/AadhaarKycAssignment';
import { AdminUser } from '../src/models/AdminUser';

dotenv.config();

const OLD_EMAIL = 'tadembharat@cognitbotz.com';

const NEW_ADMIN_EMAILS = [
  'shivakumar@cognitbotz.com',
  'bharatr@cognitbotz.com',
  'saikumarn@cognitbotz.com',
];

const DISPLAY_NAMES: Record<string, string> = {
  'shivakumar@cognitbotz.com': 'shivakumar',
  'bharatr@cognitbotz.com': 'bandelabharathreddy',
  'saikumarn@cognitbotz.com': 'saikumar',
};

async function main(): Promise<void> {
  await connectDatabase();

  // ── 1. Fetch the 3 new admin user records ─────────────────────────────────
  const newAdmins = await AdminUser.find({
    email: { $in: NEW_ADMIN_EMAILS },
  })
    .select('userId email name')
    .lean();

  if (newAdmins.length === 0) {
    console.error(
      '❌ None of the new admin accounts were found in admin_users.\n' +
      '   Make sure shivakumar, bharatr, and saikumarn accounts exist first.',
    );
    await disconnectDatabase();
    process.exit(1);
  }

  // Build ordered recipient list following NEW_ADMIN_EMAILS order
  const recipients = NEW_ADMIN_EMAILS.map((email) => {
    const admin = newAdmins.find(
      (row) => row.email.toLowerCase().trim() === email,
    );
    return admin
      ? { userId: admin.userId, email: admin.email, name: DISPLAY_NAMES[email] || admin.name }
      : null;
  }).filter((r): r is NonNullable<typeof r> => Boolean(r));

  if (recipients.length === 0) {
    console.error('❌ Could not resolve any new recipient records. Aborting.');
    await disconnectDatabase();
    process.exit(1);
  }

  console.log(`\n✅ New recipients (${recipients.length}):`);
  recipients.forEach((r, i) =>
    console.log(`   ${i + 1}. ${r.name} <${r.email}> (userId: ${r.userId})`),
  );

  // ── 2. Find all aadhaar_kyc_assignments owned by tadembharat ──────────────
  const oldAssignments = await AadhaarKycAssignment.find({
    assignedToEmail: OLD_EMAIL,
  })
    .select('userId assignedToEmail assignedToName')
    .lean();

  if (oldAssignments.length === 0) {
    console.log(`\nℹ️  No aadhaar_kyc_assignments found for ${OLD_EMAIL}. Nothing to migrate.`);
    await disconnectDatabase();
    return;
  }

  console.log(`\n📋 Found ${oldAssignments.length} Aadhaar follow-up assignment(s) under ${OLD_EMAIL}`);

  // ── 3. Redistribute round-robin ──────────────────────────────────────────
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < oldAssignments.length; i++) {
    const assignment = oldAssignments[i];
    const recipient = recipients[i % recipients.length];

    try {
      await AadhaarKycAssignment.findOneAndUpdate(
        { userId: assignment.userId },
        {
          assignedToUserId: recipient.userId,
          assignedToEmail: recipient.email,
          assignedToName: recipient.name,
        },
        { new: true },
      );

      console.log(
        `   [${i + 1}/${oldAssignments.length}] ✅  userId=${assignment.userId}` +
        ` → ${recipient.name} <${recipient.email}>`,
      );
      successCount++;
    } catch (err) {
      console.error(
        `   [${i + 1}/${oldAssignments.length}] ❌  userId=${assignment.userId} ERROR:`,
        err,
      );
      errorCount++;
    }
  }

  // ── 4. Summary ───────────────────────────────────────────────────────────
  console.log('\n──────────────────────────────────────────────');
  console.log('Aadhaar Follow-up Migration complete:');
  console.log(`  Total found  : ${oldAssignments.length}`);
  console.log(`  ✅ Updated   : ${successCount}`);
  console.log(`  ❌ Errors    : ${errorCount}`);

  const perPerson = recipients.map((r) => ({
    name: r.name,
    count: oldAssignments.filter((_, i) => recipients[i % recipients.length].email === r.email).length,
  }));
  console.log('\nDistribution:');
  perPerson.forEach((p) => console.log(`  ${p.name}: ${p.count} helper(s)`));
  console.log('──────────────────────────────────────────────\n');

  await disconnectDatabase();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
