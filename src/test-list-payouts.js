require('dotenv').config();
const axios = require('axios');

async function testEndpoint(env) {
  try {
    console.log(`\n--- Calling payouts endpoint with environment=${env} ---`);
    const res = await axios.get(`http://localhost:4007/api/v1/payments/payouts?environment=${env}&limit=10`);
    console.log('Success:', res.data.success);
    console.log('Total:', res.data.total);
    console.log('Data length:', res.data.data.length);
    if (res.data.data.length > 0) {
      console.log('First row sample:', res.data.data[0]);
    }
  } catch (err) {
    console.error('Error calling payouts endpoint:', err.message);
    if (err.response) {
      console.error('Response data:', err.response.data);
    }
  }
}

async function main() {
  await testEndpoint('production');
  await testEndpoint('development');
}

main().catch(console.error);
