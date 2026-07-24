/**
 * Fix script: transfer the Ananth Yadav claim from Asish's gmail account
 * to Asish's college email account (the one used in production).
 * 
 * Run: node scratch/fix_claim_owner.js
 */
const mongoose = require('mongoose');

const MONGODB_URI = 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';

async function main() {
  await mongoose.connect(MONGODB_URI, { dbName: 'extrahand' });
  console.log('Connected to MongoDB Atlas\n');

  const db = mongoose.connection.db;

  // The claim was made under the gmail account (local)
  // but production uses the college email account
  const OLD_ADMIN_USER_ID = 'admin_1778569007154_j621bt0a8'; // asishvenkat.a2004@gmail.com
  const NEW_ADMIN_USER_ID = 'admin_1781093200916_eb684sv2i'; // avvaruasishvenkat.22.cse@anits.edu.in

  // Find all claims by the old account
  const oldClaims = await db.collection('kycreviews').find({
    'claimedBy.userId': OLD_ADMIN_USER_ID,
  }).toArray();

  console.log(`Found ${oldClaims.length} claim(s) under gmail account:`);
  for (const c of oldClaims) {
    console.log(`  - ${c.userId} (${c.reviewStatus})`);
  }

  if (oldClaims.length === 0) {
    console.log('Nothing to transfer.');
    await mongoose.disconnect();
    return;
  }

  // Transfer all claims to the production account
  const result = await db.collection('kycreviews').updateMany(
    { 'claimedBy.userId': OLD_ADMIN_USER_ID },
    {
      $set: {
        'claimedBy.userId': NEW_ADMIN_USER_ID,
        'claimedBy.email': 'avvaruasishvenkat.22.cse@anits.edu.in',
        'claimedBy.name': 'Asish',
      }
    }
  );

  console.log(`\nTransferred ${result.modifiedCount} claim(s) to production account.`);
  console.log('Claims are now owned by: avvaruasishvenkat.22.cse@anits.edu.in');

  await mongoose.disconnect();
  console.log('\nDone!');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
