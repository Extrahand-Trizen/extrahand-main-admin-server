import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import logger from './logger';

// ─────────────────────────────────────────────────────────────────────────────
// Payment DB — read-only connection from admin server
// Shares the same Neon PostgreSQL database as extrahand-payment-service.
// Only list/read queries run here; all writes still go through payment service.
// ─────────────────────────────────────────────────────────────────────────────

let _prismaPayment: PrismaClient | null = null;
let _prismaPaymentDev: PrismaClient | null = null;

function buildClient(connectionString: string, label: string): PrismaClient {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
  });
  const adapter = new PrismaPg(pool);
  const client = new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
  logger.info(`✅ Payment DB Prisma client (${label}) initialized with connection pooling`);
  return client;
}

/** Production Neon DB — ep-solitary-frost */
export function getPrismaPayment(): PrismaClient {
  if (!_prismaPayment) {
    const uri = process.env.PAYMENT_POSTGRESDB_URI || process.env.POSTGRESDB_URI;
    if (!uri) throw new Error('PAYMENT_POSTGRESDB_URI (or POSTGRESDB_URI) is required');
    _prismaPayment = buildClient(uri, 'production');
  }
  return _prismaPayment;
}

/** Dev Neon DB — ep-solitary-violet (optional) */
export function getPrismaPaymentDev(): PrismaClient | null {
  const uri = process.env.PAYMENT_DEV_POSTGRESDB_URI || process.env.DEV_POSTGRESDB_URI;
  if (!uri) return null;
  if (!_prismaPaymentDev) {
    _prismaPaymentDev = buildClient(uri, 'development');
  }
  return _prismaPaymentDev;
}

export const prismaPayment = getPrismaPayment();
export const prismaPaymentDev = getPrismaPaymentDev();

// ─────────────────────────────────────────────────────────────────────────────
// Neon Serverless Postgres keep-alive pinger (runs every 4 minutes)
// Prevents Neon compute from sleeping (which causes a 3-7s cold start lag)
// ─────────────────────────────────────────────────────────────────────────────
setInterval(async () => {
  try {
    if (_prismaPayment) {
      await _prismaPayment.$queryRaw`SELECT 1`;
      logger.debug('Pinged production Neon DB for keep-alive');
    }
  } catch (err: any) {
    logger.warn('Failed to ping production Neon DB for keep-alive:', { message: err?.message });
  }
  try {
    if (_prismaPaymentDev) {
      await _prismaPaymentDev.$queryRaw`SELECT 1`;
      logger.debug('Pinged development Neon DB for keep-alive');
    }
  } catch (err: any) {
    logger.warn('Failed to ping development Neon DB for keep-alive:', { message: err?.message });
  }
}, 4 * 60 * 1000); // 4 minutes

