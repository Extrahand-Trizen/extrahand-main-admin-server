import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../src/config/database';
import { listAadhaarKycRecipients, repairLegacyAadhaarNotificationsForUser } from '../src/services/AadhaarKycRecipientService';
import { userServiceClient } from '../src/services/UserServiceClient';
import { AadhaarKycAssignment } from '../src/models/AadhaarKycAssignment';

dotenv.config();

async function main() {
  await connectDatabase();

  console.log('Fetching active operations admins...');
  const recipients = await listAadhaarKycRecipients();
  console.log('Active recipients:', recipients.map(r => `${r.name} (${r.email})`));

  if (recipients.length === 0) {
    console.error('No active operations admins found! Exiting.');
    await disconnectDatabase();
    return;
  }

  console.log('Fetching all helpers whose Aadhaar is not verified...');
  const helpers: any[] = [];
  let page = 1;
  while (true) {
    const result = await userServiceClient.listUsers({
      role: 'Helper',
      isAadhaarVerified: false,
      limit: 50,
      page,
    });
    const pageData = result?.data || [];
    if (pageData.length === 0) break;
    helpers.push(...pageData);
    if (pageData.length < 50) break;
    page++;
  }
  console.log(`Found ${helpers.length} unverified helpers in total.`);

  if (helpers.length === 0) {
    console.log('No unverified helpers found.');
    await disconnectDatabase();
    return;
  }

  // Sort helpers by userId/uid to make assignment deterministic
  helpers.sort((a: any, b: any) => {
    const aId = String(a.userId || a.uid || '');
    const bId = String(b.userId || b.uid || '');
    return aId.localeCompare(bId);
  });

  console.log('Assigning helpers equally to operations admins...');
  
  let assignedCount = 0;
  const adminCounts: Record<string, number> = {};
  for (const r of recipients) {
    adminCounts[r.userId] = 0;
  }

  for (let i = 0; i < helpers.length; i++) {
    const helper = helpers[i];
    const userId = String(helper.userId || helper.uid || '').trim();
    if (!userId) continue;

    const recipient = recipients[i % recipients.length];
    
    // We overwrite/set the assignment to ensure they are assigned equally
    await AadhaarKycAssignment.findOneAndUpdate(
      { userId },
      {
        userId,
        assignedToUserId: recipient.userId,
        assignedToEmail: recipient.email,
        assignedToName: recipient.name,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Also repair any legacy notifications for this user
    await repairLegacyAadhaarNotificationsForUser(userId, recipient);

    adminCounts[recipient.userId]++;
    assignedCount++;
  }

  console.log(`Successfully assigned ${assignedCount} helpers.`);
  console.log('Assignment breakdown:');
  for (const r of recipients) {
    console.log(`  - ${r.name}: ${adminCounts[r.userId]} helpers`);
  }

  await disconnectDatabase();
  console.log('Done.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
