const dns = require('node:dns');
const path = require('node:path');
const dotenv = require('dotenv');

dns.setServers(['8.8.8.8', '8.8.4.4']);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const databaseUrl = process.env.PAYMENT_POSTGRESDB_URI || process.env.DEV_POSTGRESDB_URI || process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('No database URL found. Set PAYMENT_POSTGRESDB_URI or DATABASE_URL in extrahand-main-admin-server/.env');
}

process.env.DATABASE_URL = databaseUrl;

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  console.log('Querying Escrows...');
  const escrows = await prisma.escrow.findMany({
    take: 5,
    orderBy: { createdAt: 'desc' }
  });
  console.log('First 5 Escrows:', escrows.map(e => ({
    id: e.id,
    typeOfId: typeof e.id,
    escrowId: e.escrowId,
    taskId: e.taskId,
    posterUid: e.posterUid,
    performerUid: e.performerUid
  })));
  
  await prisma.$disconnect();
}

run().catch(console.error);
