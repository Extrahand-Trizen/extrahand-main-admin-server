import assert from 'node:assert/strict';
import type { Request, Response, NextFunction } from 'express';
import { requireSuperAdmin } from '../middleware/auth';
import { DashboardType } from '../types/dashboard';

type ResponseState = {
  statusCode?: number;
  body?: unknown;
  nextCalled: boolean;
};

function invokeGuard(admin?: Request['admin']): ResponseState {
  const state: ResponseState = { nextCalled: false };
  const req = Object.assign({} as Request, { admin });
  const res = Object.assign({} as Response, {
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    json(body: unknown) {
      state.body = body;
      return this;
    },
  });
  const next: NextFunction = () => {
    state.nextCalled = true;
  };
  requireSuperAdmin(req, res, next);
  return state;
}

assert.equal(invokeGuard().statusCode, 401);
assert.equal(invokeGuard({
  userId: 'operator',
  email: 'operator@example.com',
  name: 'Operator',
  dashboardType: DashboardType.MAIN_ADMIN,
  role: 'operations_admin',
  isSuperAdmin: false,
  permissions: [],
}).statusCode, 403);
assert.equal(invokeGuard({
  userId: 'admin',
  email: 'admin@example.com',
  name: 'Admin',
  dashboardType: DashboardType.MAIN_ADMIN,
  role: 'super_admin',
  isSuperAdmin: true,
  permissions: [],
}).nextCalled, true);

console.log('postCompareAvailabilityAuthorization.test.ts passed');
