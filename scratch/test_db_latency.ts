import dotenv from 'dotenv';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

dotenv.config({ path: path.join(__dirname, '../.env') });

const prodUri = process.env.PAYMENT_POSTGRESDB_URI;
const devUri = process.env.PAYMENT_DEV_POSTGRESDB_URI;

function buildClient(connectionString: string): PrismaClient {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

async function testDb(uri: string, name: string) {
  console.log(`\n=== Testing ${name} DB ===`);
  const db = buildClient(uri);

  console.log('Connecting/Warmup...');
  const t0 = Date.now();
  await db.$queryRaw`SELECT 1`;
  console.log(`Connection established in ${Date.now() - t0}ms`);

  const sql = `
    SELECT id, "escrowId", "transactionId", "razorpayOrderId", "taskId", "taskCategory",
           "applicationId", "posterUid", "performerUid", "bookingOrderId", amount, currency,
           "amountInRupees", "taskAmount", status, "razorpayPaymentId", "paymentStatus",
           "autoReleaseDate", "heldAt", "releasedAt", "refundedAt", "errorMessage",
           "errorCode", metadata, "createdAt", "updatedAt",
           COUNT(*) OVER() AS _total_count
    FROM   "Escrow"
    ORDER  BY "createdAt" DESC
    LIMIT  $1 OFFSET $2
  `;

  for (let i = 1; i <= 5; i++) {
    const start = Date.now();
    const res: any[] = await db.$queryRawUnsafe(sql, 10, 0);
    const duration = Date.now() - start;
    console.log(`Query ${i} took ${duration}ms. Rows returned: ${res.length}, Total count: ${res[0]?._total_count || 0}`);
  }

  await db.$disconnect();
}

async function run() {
  if (prodUri) {
    await testDb(prodUri, 'Production');
  } else {
    console.log('No production URI found');
  }

  if (devUri) {
    await testDb(devUri, 'Development');
  } else {
    console.log('No dev URI found');
  }
}

run();
