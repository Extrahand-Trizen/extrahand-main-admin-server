import axios from 'axios';

async function run() {
  const adminUrl = 'http://localhost:4007';
  console.log('Logging in to Admin Server...');
  try {
    const loginRes = await axios.post(`${adminUrl}/api/v1/auth/login`, {
      email: 'operationsmanager@extrahand.in',
      password: 'operationsmanager@123',
      dashboardType: 'main_admin',
    });

    const token = loginRes.data?.data?.tokens?.accessToken;
    if (!token) {
      console.error('Failed to get access token:', loginRes.data);
      return;
    }
    console.log('Token acquired successfully.');

    const headers = {
      Authorization: `Bearer ${token}`,
    };

    console.log('Fetching production transactions...');
    const t0 = Date.now();
    try {
      const prodRes = await axios.get(`${adminUrl}/api/v1/payments/transactions?environment=production&limit=10`, { headers });
      console.log(`Production request took ${Date.now() - t0}ms.`);
      console.log('Production response data count:', prodRes.data?.data?.length);
      console.log('Production total:', prodRes.data?.total);
    } catch (e: any) {
      console.error('Error fetching production transactions:', e.response?.status, e.response?.data || e.message);
    }

    console.log('Fetching development transactions...');
    const t1 = Date.now();
    try {
      const devRes = await axios.get(`${adminUrl}/api/v1/payments/transactions?environment=development&limit=10`, { headers });
      console.log(`Development request took ${Date.now() - t1}ms.`);
      console.log('Development response data count:', devRes.data?.data?.length);
      console.log('Development total:', devRes.data?.total);
    } catch (e: any) {
      console.error('Error fetching development transactions:', e.response?.status, e.response?.data || e.message);
    }

  } catch (e: any) {
    console.error('Login failed:', e.response?.status, e.response?.data || e.message);
  }
}

run();
