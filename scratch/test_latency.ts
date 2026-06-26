import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const userServiceUrl = process.env.USER_SERVICE_URL || 'http://localhost:4001';
const taskServiceUrl = process.env.TASK_SERVICE_URL || 'http://localhost:4002';
const token = process.env.SERVICE_AUTH_TOKEN;

const userClient = axios.create({
  baseURL: userServiceUrl,
  timeout: 30000,
  headers: {
    'X-Service-Auth': token,
    'X-Service-Name': 'main-admin-service',
  },
});

const taskClient = axios.create({
  baseURL: taskServiceUrl,
  timeout: 30000,
  headers: {
    'X-Service-Auth': token,
    'X-Service-Name': 'main-admin-service',
    'X-User-Id': 'main-admin-service',
  },
});

async function run() {
  const uids = [
    'RaT25YT4qGareOKjVZv9gsgAlgB3',
    'c4mPkSdFNnTICiA8Mns4I1p66o92',
    'F0uD9YozHBSiHHHiID4GOMxOiu53',
    '3vsCkBGveYdBOQi2PFYLA1yXYcf1',
    'RaT25YT4qGareOKjVZv9gsgAlgB3',
    'RaT25YT4qGareOKjVZv9gsgAlgB3',
    'RaT25YT4qGareOKjVZv9gsgAlgB3',
    'c4mPkSdFNnTICiA8Mns4I1p66o92',
    'F0uD9YozHBSiHHHiID4GOMxOiu53',
    '3vsCkBGveYdBOQi2PFYLA1yXYcf1'
  ];

  const taskIds = [
    '6a3b914d6318e5cb304fd07f',
    'booknow-pending-3ebe4aa9-4525-4bec-a6a5-aa5675f35eb1',
    '6a191f3c05d3c4b968f34069',
    '6a3cbc8330c75ce1c5a3e510',
    '6a3cdc85ba5bd7529548bee0'
  ];

  console.log('Testing User Service batch latency with 10 UIDs...');
  const t0 = Date.now();
  try {
    const res = await userClient.post('/api/v1/profiles/batch/uids', { uids });
    console.log(`User Service took ${Date.now() - t0}ms. Count:`, res.data?.profiles?.length);
  } catch (e: any) {
    console.error('User Service failed:', e.message, e.response?.status, e.response?.data);
  }

  console.log('Testing Task Service batch latency with 5 task IDs...');
  const t1 = Date.now();
  try {
    const res = await taskClient.post('/api/v1/tasks/batch', { taskIds });
    console.log(`Task Service took ${Date.now() - t1}ms. Count:`, res.data?.tasks?.length);
  } catch (e: any) {
    console.error('Task Service failed:', e.message, e.response?.status, e.response?.data);
  }
}

run();
