/**
 * Revert: transfer claim back to the gmail account (asishvenkat.a2004@gmail.com)
 * which is the account Asish uses in production.
 * Run: node scratch/revert_claim_owner.js
 */
const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';

async function main() {
  await mongoose.connect(MONGODB_URI, { dbName: 'extrahand' });
  console.log('Connected to MongoDB Atlas\n');

  const db = mongoose.connection.db;

  // Revert: move claim back to the gmail account
  const result = await db.collection('kycreviews').updateMany(
    { 'claimedBy.userId': 'admin_1781093200916_eb684sv2i' }, // college email (wrong)
    {
      $set: {
        'claimedBy.userId': 'admin_1778569007154_j621bt0a8',
        'claimedBy.email': 'asishvenkat.a2004@gmail.com',
        'claimedBy.name': 'Asish',
      }
    }
  );

  console.log(`Reverted ${result.modifiedCount} claim(s) back to asishvenkat.a2004@gmail.com`);

  // Verify
  const claims = await db.collection('kycreviews').find(
    { 'claimedBy.userId': 'admin_1778569007154_j621bt0a8' },
    { projection: { userId: 1, 'claimedBy.email': 1, reviewStatus: 1 } }
  ).toArray();
  
  console.log('\nCurrent claims for gmail account:');
  for (const c of claims) {
    console.log(`  userId=${c.userId}, status=${c.reviewStatus}, claimedBy=${c.claimedBy?.email}`);
  }

  await mongoose.disconnect();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
