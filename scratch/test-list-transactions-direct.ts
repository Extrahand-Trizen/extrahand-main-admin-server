import { PrismaClient } from '@prisma/client';
import { prismaPayment as prisma } from '../src/config/prismaPayment';

async function testTransactionsDirect() {
  try {
    const raw: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, "escrowId", "transactionId", "razorpayOrderId", "taskId", "taskCategory",
             "applicationId", "posterUid", "performerUid", "bookingOrderId", amount, currency,
             "amountInRupees", "taskAmount", status, "razorpayPaymentId", "paymentStatus",
             "autoReleaseDate", "heldAt", "releasedAt", "refundedAt", "errorMessage",
             "errorCode", metadata, "createdAt", "updatedAt",
             COUNT(*) OVER() AS _total_count
      FROM   "Escrow"
      ORDER BY "createdAt" DESC
      LIMIT 10 OFFSET 0
    `);

    const allRows = raw.map((r: any) => ({
      ...r,
      metadata: typeof r.metadata === 'string' ? JSON.parse(r.metadata) : (r.metadata ?? null),
    }));

    const escrowDbIds = allRows.map((r: any) => r.id).filter(Boolean);

    const payouts = await prisma.payout.findMany({
      where: { escrowId: { in: escrowDbIds } },
      select: { escrowId: true, netAmount: true, performerUid: true, status: true },
      orderBy: { createdAt: 'desc' },
    });

    const payoutMap = new Map<string, any>();
    payouts.forEach((p) => {
      if (p.escrowId && !payoutMap.has(p.escrowId)) payoutMap.set(p.escrowId, p);
    });

    for (const row of allRows) {
      const payout = payoutMap.get(row.id);
      let payoutAmount: string | null = null;
      if (payout) {
        payoutAmount = payout.netAmount ? payout.netAmount.toString() : null;
      } else if (row.taskAmount != null) {
        try {
          const taskAmount = Number(row.taskAmount);
          const commission = taskAmount * 0.05;
          const gstOnCommission = commission * 0.18;
          const netAmount = taskAmount - commission - gstOnCommission;
          payoutAmount = netAmount.toFixed(2);
        } catch { /* ignore */ }
      }
      console.log(`Escrow: ${row.escrowId}, Amount: ${row.amountInRupees}, Payout: ${payoutAmount}, Payout Record Exists: ${!!payout}`);
    }

  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    await prisma.$disconnect();
  }
}

testTransactionsDirect();
