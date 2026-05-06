import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().transform(Number).default('4007'),
  MONGODB_URI: z.string().url(),
  MONGO_DB: z.string().default('extrahand'),
  
  // JWT Authentication
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  
  // Microsoft OAuth (optional)
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT_ID: z.string().optional(),
  MICROSOFT_REDIRECT_URI: z.string().url('MICROSOFT_REDIRECT_URI must be a valid URL').optional(),
  
  // Frontend URLs
  ADMIN_DASHBOARD_URL: z.string().url().default('http://localhost:3000'),
  MAIN_ADMIN_DASHBOARD_URL: z.string().url().default('http://localhost:3001'),
  SUPER_ADMIN_DASHBOARD_URL: z.string().url().default('http://localhost:3002'),
  
  // External Services
  USER_SERVICE_URL: z.string().url().optional(),
  TASK_SERVICE_URL: z.string().url().optional(),
  PAYMENT_SERVICE_URL: z.string().url().default('http://localhost:4009'),
  SUPPORT_SERVICE_URL: z.string().url().optional(),
  SERVICE_AUTH_TOKEN: z.string().min(32),
  
  // Email Service (for invites)
  EMAIL_SERVICE_URL: z.string().url().optional(),
  
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

export const env = envSchema.parse(process.env);
