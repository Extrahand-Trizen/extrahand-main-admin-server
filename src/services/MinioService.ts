/**
 * MinIO / S3 service for the admin server.
 * Used exclusively to generate short-lived pre-signed GET URLs
 * so that KYC review admins can view Aadhaar photos inline.
 *
 * Images are stored in the KYC vault bucket by the user-verification-service.
 * The admin server NEVER writes to the vault — read-only presign only.
 */

import AWS from 'aws-sdk';
import { env } from '../config/env';
import logger from '../config/logger';

const PRESIGN_EXPIRY_SECONDS = 60 * 15; // 15-minute presigned URLs

function buildEndpointString(rawEndpoint: string): string {
  try {
    if (rawEndpoint.includes('://')) {
      const url = new URL(rawEndpoint);
      const port = url.port ? `:${url.port}` : '';
      return `${url.protocol}//${url.hostname}${port}`;
    }
    return `https://${rawEndpoint}`;
  } catch {
    return `https://${rawEndpoint}`;
  }
}

class MinioService {
  private s3: AWS.S3 | null = null;
  private bucketName: string = '';
  private initialized = false;

  initialize(): void {
    const endpoint = env.MINIO_ENDPOINT || env.MINIO_SERVER_URL || '';
    const accessKeyId = env.MINIO_ROOT_USER || '';
    const secretAccessKey = env.MINIO_ROOT_PASSWORD || '';
    const region = env.MINIO_REGION_NAME || 'us-east-1';
    // KYC images are stored in the dedicated vault bucket, NOT the categories/banners bucket.
    this.bucketName = env.KYC_VAULT_BUCKET_NAME || 'extrahand-kyc-vault';

    if (!endpoint || !accessKeyId || !secretAccessKey) {
      logger.warn(
        'MinioService: MINIO_ENDPOINT / MINIO_ROOT_USER / MINIO_ROOT_PASSWORD not set — Aadhaar image presigning disabled',
      );
      return;
    }

    const endpointString = buildEndpointString(endpoint);

    this.s3 = new AWS.S3({
      endpoint: endpointString,
      accessKeyId,
      secretAccessKey,
      s3ForcePathStyle: true,
      signatureVersion: 'v4',
      region,
    });

    this.initialized = true;
    logger.info('MinioService initialized', { endpoint: endpointString, bucket: this.bucketName });
  }

  /**
   * Upload a file buffer to the KYC vault bucket.
   * Returns the object key on success, throws on failure.
   */
  async uploadFile(key: string, buffer: Buffer, contentType: string): Promise<void> {
    if (!this.initialized || !this.s3) {
      throw new Error('MinioService: storage not configured — cannot upload');
    }

    await this.s3
      .putObject({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
      .promise();

    logger.info('MinioService: file uploaded', { key, bucket: this.bucketName, size: buffer.length });
  }

  /**
   * Returns a presigned GET URL for the given object key, or null if MinIO is
   * not configured or an error occurs.  Never throws — callers degrade gracefully.
   */
  async getPresignedUrl(key: string): Promise<string | null> {
    if (!this.initialized || !this.s3 || !key) return null;

    try {
      const url = await this.s3.getSignedUrlPromise('getObject', {
        Bucket: this.bucketName,
        Key: key,
        Expires: PRESIGN_EXPIRY_SECONDS,
      });
      return url;
    } catch (error: any) {
      logger.warn('MinioService: failed to presign URL', { key, error: error.message });
      return null;
    }
  }

  /**
   * List object keys under a prefix (newest first).
   */
  async listObjectKeys(prefix: string): Promise<Array<{ key: string; lastModified?: Date }>> {
    if (!this.initialized || !this.s3 || !prefix) return [];

    const items: Array<{ key: string; lastModified?: Date }> = [];
    let continuationToken: string | undefined;

    try {
      do {
        const response = await this.s3
          .listObjectsV2({
            Bucket: this.bucketName,
            Prefix: prefix,
            ContinuationToken: continuationToken,
            MaxKeys: 1000,
          })
          .promise();

        for (const object of response.Contents || []) {
          if (object.Key) {
            items.push({ key: object.Key, lastModified: object.LastModified });
          }
        }

        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);
    } catch (error: any) {
      logger.warn('MinioService: failed to list objects', { prefix, error: error.message });
      return [];
    }

    return items.sort(
      (a, b) => (b.lastModified?.getTime() || 0) - (a.lastModified?.getTime() || 0),
    );
  }

  /**
   * Presign multiple keys in parallel.  Keys that fail are silently omitted.
   */
  async getPresignedUrls(
    keys: Array<{ key: string; label: string }>,
  ): Promise<Array<{ label: string; url: string }>> {
    if (!this.initialized || keys.length === 0) return [];

    const results = await Promise.all(
      keys.map(async ({ key, label }) => {
        const url = await this.getPresignedUrl(key);
        return url ? { label, url } : null;
      }),
    );

    return results.filter(Boolean) as Array<{ label: string; url: string }>;
  }

  get isReady(): boolean {
    return this.initialized;
  }
}

export const minioService = new MinioService();
