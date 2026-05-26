import { onboardingServiceClient } from '../src/services/OnboardingServiceClient';
import { userServiceClient } from '../src/services/UserServiceClient';
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

async function run() {
  console.log('ONBOARDING_SERVICE_URL:', process.env.ONBOARDING_SERVICE_URL);
  console.log('Is onboarding client enabled?:', onboardingServiceClient.isEnabled());

  const userId = 's5NKtmEXo1fv547S8X5X0ozTgnX2';
  
  // Connect to mongoose if required by user service client
  if (process.env.MONGODB_URI) {
    await mongoose.connect(process.env.MONGODB_URI);
  }

  const userResult = await userServiceClient.getUser(userId);
  const user = userResult?.data || userResult;
  console.log('User fetched:', {
    userId: user?.userId || user?.uid,
    email: user?.email,
    phone: user?.phone,
  });

  const lookup = await onboardingServiceClient.lookupLeadByContact({
    email: user?.email,
    phone: user?.phone,
  });

  console.log('Lookup Result:', JSON.stringify(lookup, null, 2));

  await mongoose.disconnect();
}

run().catch(console.error);
