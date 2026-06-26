import dotenv from 'dotenv';
dotenv.config();

import { PaymentController } from './controllers/PaymentController';
import { Request, Response } from 'express';

async function main() {
  const req = {
    query: {
      environment: 'production',
      limit: '10',
      offset: '0'
    }
  } as unknown as Request;

  const res = {
    json(data: any) {
      console.log('--- Production Payouts ---');
      console.log('Success:', data.success);
      console.log('Total:', data.total);
      console.log('Data length:', data.data?.length);
      if (data.data?.length > 0) {
        console.log('First record:', data.data[0]);
      }
    },
    status(code: number) {
      console.log('Status code:', code);
      return this;
    }
  } as unknown as Response;

  try {
    await PaymentController.listPayouts(req, res);
  } catch (err: any) {
    console.error('Error executing listPayouts:', err);
  }

  const reqDev = {
    query: {
      environment: 'development',
      limit: '10',
      offset: '0'
    }
  } as unknown as Request;

  const resDev = {
    json(data: any) {
      console.log('\n--- Development Payouts ---');
      console.log('Success:', data.success);
      console.log('Total:', data.total);
      console.log('Data length:', data.data?.length);
      if (data.data?.length > 0) {
        console.log('First record:', data.data[0]);
      }
    },
    status(code: number) {
      console.log('Status code:', code);
      return this;
    }
  } as unknown as Response;

  try {
    await PaymentController.listPayouts(reqDev, resDev);
  } catch (err: any) {
    console.error('Error executing listPayouts for Dev:', err);
  }
}

main().catch(console.error);
