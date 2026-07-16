const dns = require('node:dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

process.env.DATABASE_URL = 'postgresql://neondb_owner:npg_Ac0txfqXWd3U@ep-falling-glade-a47szxlx-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require';

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
