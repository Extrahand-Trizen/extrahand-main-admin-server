import dns from 'node:dns';
import mongoose from 'mongoose';
import logger from './logger';
import { env } from './env';

const DNS_FALLBACK_SERVERS = ['8.8.8.8', '8.8.4.4'];

function configureDnsFallback(): void {
  try {
    dns.setServers(DNS_FALLBACK_SERVERS);
    logger.info('✅ DNS fallback servers configured');
  } catch (error) {
    logger.warn(
      '⚠️ Unable to configure DNS fallback servers, continuing with system defaults',
      error
    );
  }

  try {
    dns.setDefaultResultOrder?.('ipv4first');
    logger.info('✅ IPv4-first DNS resolution enabled');
  } catch (error) {
    logger.warn(
      '⚠️ Unable to set IPv4-first DNS resolution, continuing with system defaults',
      error
    );
  }
}

configureDnsFallback();

export const connectDatabase = async (): Promise<void> => {
  try {
    await mongoose.connect(env.MONGODB_URI, {
      dbName: env.MONGO_DB,
      family: 4,
      serverSelectionTimeoutMS: 20000,
      socketTimeoutMS: 60000,
      connectTimeoutMS: 20000,
      maxPoolSize: 10,
      minPoolSize: 2,
    });

    logger.info('✅ MongoDB connected');
  } catch (error) {
    logger.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
};

export const disconnectDatabase = async (): Promise<void> => {
  try {
    await mongoose.disconnect();
    logger.info('✅ MongoDB disconnected');
  } catch (error) {
    logger.error('❌ MongoDB disconnection failed:', error);
  }
};