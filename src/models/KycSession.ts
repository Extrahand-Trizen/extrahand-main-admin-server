/**
 * Read-only KycSession model for the admin server.
 *
 * The user-verification-service writes KycSession documents to the
 * `extrahand_verifications` MongoDB database (see KYC_VERIFICATION_DB). The admin
 * server only reads `ocr.frontImageKey` and `ocr.backImageKey` from these
 * documents to generate presigned MinIO URLs for the KYC review panel.
 *
 * We intentionally keep this model minimal — admin server never writes to it.
 */

import mongoose, { Document, Model, Schema } from 'mongoose';
import { env } from '../config/env';

function getKycVerificationDbName(): string {
  return (
    env.KYC_VERIFICATION_DB ||
    env.VERIFICATION_MONGODB_DB ||
    process.env.MONGODB_DB ||
    'extrahand_verifications'
  );
}

interface KycSessionOcr {
  frontImageKey?: string;
  backImageKey?: string;
  maskedAadhaar?: string;
}

export interface KycSessionDocument extends Document {
  verification_id: string;
  userId: string;
  sessionType: string;
  internalStatus: string;
  visibleStatus: string;
  ocr?: KycSessionOcr;
  createdAt: Date;
  updatedAt: Date;
}

const KycSessionSchema = new Schema<KycSessionDocument>(
  {
    verification_id: { type: String, index: true },
    userId: { type: String, index: true },
    sessionType: { type: String },
    internalStatus: { type: String },
    visibleStatus: { type: String },
    ocr: {
      frontImageKey: { type: String },
      backImageKey: { type: String },
    },
  },
  {
    timestamps: true,
    // Do NOT enforce strict mode — verification service may have extra fields
    strict: false,
    // Read from the exact collection the verification service writes to
    collection: 'kycsessions',
  },
);

function getKycSessionModel(): Model<KycSessionDocument> {
  const dbName = getKycVerificationDbName();
  const connection = mongoose.connection.useDb(dbName, { useCache: true });

  return (
    (connection.models['AdminKycSession'] as Model<KycSessionDocument> | undefined) ||
    connection.model<KycSessionDocument>('AdminKycSession', KycSessionSchema, 'kycsessions')
  );
}

/** Read-only KycSession on the verification-service database. */
export const KycSession = new Proxy({} as Model<KycSessionDocument>, {
  get(_target, prop, receiver) {
    const model = getKycSessionModel();
    const value = Reflect.get(model, prop, receiver);
    return typeof value === 'function' ? value.bind(model) : value;
  },
});
