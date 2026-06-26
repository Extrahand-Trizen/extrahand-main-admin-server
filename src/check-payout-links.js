require('dotenv').config();
const pg = require('pg');

const prodUri = process.env.PAYMENT_POSTGRESDB_URI;

async function main() {
  if (!prodUri) {
    console.error('PAYMENT_POSTGRESDB_URI is missing');
    return;
  }
  const client = new pg.Client({ connectionString: prodUri });
  await client.connect();

  console.log('--- Inspecting Payouts and their Escrow links ---');
  const res = await client.query(`
    SELECT 
      p.id AS payout_db_id,
      p."payoutId",
      p."escrowId" AS payout_escrow_fk,
      p."netAmount",
      p.status AS payout_status,
      e.id AS escrow_db_id,
      e."escrowId",
      e."amountInRupees",
      e.status AS escrow_status
    FROM "Payout" p
    LEFT JOIN "Escrow" e ON p."escrowId" = e.id
  `);

  for (const row of res.rows) {
    console.log(row);
  }

  await client.end();
}

main().catch(console.error);
