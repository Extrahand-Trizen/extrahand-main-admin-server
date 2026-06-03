/**
 * One-time repair: assign each KYC user to one cyclic ops admin and fix legacy notifications.
 *
 * Usage: npx ts-node scripts/repair-aadhaar-kyc-assignments.ts
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { AdminNotification } from '../src/models/AdminNotification';
import { DashboardType } from '../src/types/dashboard';
import { ensureKycAssigneeForUser } from '../src/services/AadhaarKycRecipientService';

dotenv.config();

async function main(): Promise<void> {
  await connectDatabase();

  const notifications = await AdminNotification.find({
    dashboardType: DashboardType.MAIN_ADMIN,
    type: { $in: ['aadhaar_verification_failed', 'aadhaar_verification_under_review'] },
    'metadata.userId': { $exists: true, $ne: '' },
  })
    .select('metadata.userId')
    .lean();

  const userIds = Array.from(
    new Set(
      notifications
        .map((row) => String(row.metadata?.userId || '').trim())
        .filter(Boolean),
    ),
  );

  console.log(`Repairing ${userIds.length} KYC user assignment(s)...`);

  for (const userId of userIds) {
    const assignee = await ensureKycAssigneeForUser(userId);
    console.log(
      assignee
        ? `  ${userId} -> ${assignee.name} (${assignee.email})`
        : `  ${userId} -> skipped (no cyclic recipient)`,
    );
  }

  await disconnectDatabase();
  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
