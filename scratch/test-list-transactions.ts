import axios from 'axios';

async function testTransactions() {
  try {
    console.time('fetch');
    const res = await axios.get('http://localhost:4007/api/v1/payments/transactions?limit=5');
    console.timeEnd('fetch');
    console.log('Success:', res.data.success);
    console.log('Total:', res.data.pagination?.total || res.data.total);
    console.log('Data length:', res.data.data?.length);
    
    if (res.data.data?.length > 0) {
      res.data.data.forEach((tx: any, idx: number) => {
        console.log(`[${idx}] Escrow: ${tx.escrowId}, Amount: ${tx.amountInRupees}, Payout: ${tx.payoutAmount}`);
      });
    }
  } catch (err: any) {
    console.error('Error:', err.message);
    if (err.response) {
      console.error(err.response.data);
    }
  }
}

testTransactions();
