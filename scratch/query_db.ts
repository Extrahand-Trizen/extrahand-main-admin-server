import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

// Load env variables
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://adminUser:admin123@cluster0.f0cebtz.mongodb.net/extrahand?retryWrites=true&w=majority';
const MONGO_DB = process.env.MONGO_DB || 'extrahand';
const KYC_DB = process.env.KYC_VERIFICATION_DB || 'extrahand_verifications';

async function run() {
  try {
    console.log('Connecting to MongoDB...', MONGODB_URI);
    await mongoose.connect(MONGODB_URI, { dbName: MONGO_DB });
    console.log('Connected to extrahand database.');

    const connection = mongoose.connection;

    // 1. Search in profiles collection
    const Profile = connection.collection('profiles');
    const profiles = await Profile.find({
      $or: [
        { name: /Ananth/i },
        { email: /Ananth/i }
      ]
    }).toArray();

    console.log('\n--- Profiles matching "Ananth" ---');
    console.log(profiles.map(p => ({
      _id: p._id,
      uid: p.uid,
      name: p.name,
      email: p.email,
      phone: p.phone,
      isAadhaarVerified: p.isAadhaarVerified,
      aadhaarKyc: p.aadhaarKyc
    })));

    // 2. Search in adminnotifications
    const AdminNotification = connection.collection('adminnotifications');
    const notifications = await AdminNotification.find({
      $or: [
        { 'metadata.userName': /Ananth/i },
        { 'metadata.userId': { $in: profiles.map(p => p.uid) } }
      ]
    }).toArray();

    console.log('\n--- Notifications for "Ananth" ---');
    console.log(notifications.map(n => ({
      _id: n._id,
      type: n.type,
      title: n.title,
      targetAdminUserIds: n.targetAdminUserIds,
      metadata: n.metadata,
      createdAt: n.createdAt
    })));

    // 3. Search in kycreviews
    const KycReview = connection.collection('kycreviews');
    const reviews = await KycReview.find({
      userId: { $in: [...profiles.map(p => p.uid), ...profiles.map(p => String(p._id))] }
    }).toArray();

    console.log('\n--- KYC Reviews in extrahand database ---');
    console.log(reviews);

    // 4. Switch to KYC DB and search kycsessions
    const kycConnection = connection.useDb(KYC_DB);
    const KycSession = kycConnection.collection('kycsessions');
    const sessions = await KycSession.find({
      userId: { $in: [...profiles.map(p => p.uid), ...profiles.map(p => String(p._id))] }
    }).toArray();

    console.log(`\n--- KYC Sessions in database "${KYC_DB}" ---`);
    console.log(sessions);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

run();
