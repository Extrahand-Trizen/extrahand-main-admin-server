/**
 * List all objects in the KYC vault bucket and build a local HTML gallery.
 *
 * Usage:
 *   npx ts-node scripts/list-kyc-vault-images.ts
 *   npx ts-node scripts/list-kyc-vault-images.ts --open
 *
 * Reads MinIO / KYC vault settings from .env in the project root.
 */

import AWS from 'aws-sdk';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PRESIGN_EXPIRY_SECONDS = 60 * 60; // 1 hour for manual review
const OUTPUT_DIR = path.join(__dirname, 'output');
const HTML_PATH = path.join(OUTPUT_DIR, 'kyc-vault-gallery.html');
const JSON_PATH = path.join(OUTPUT_DIR, 'kyc-vault-images.json');

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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function listAllObjects(
  s3: AWS.S3,
  bucket: string,
): Promise<AWS.S3.Object[]> {
  const objects: AWS.S3.Object[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await s3
      .listObjectsV2({
        Bucket: bucket,
        ContinuationToken: continuationToken,
        MaxKeys: 1000,
      })
      .promise();

    if (response.Contents?.length) {
      objects.push(...response.Contents);
    }
    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects.sort((a, b) => {
    const aTime = a.LastModified?.getTime() || 0;
    const bTime = b.LastModified?.getTime() || 0;
    return bTime - aTime;
  });
}

function parseKeyParts(key: string): { userId: string; sessionId: string; fileName: string } {
  // aadhaar-ocr/{userId}/{sessionId}/front_{uuid}.jpg
  const parts = key.split('/');
  return {
    userId: parts[1] || '-',
    sessionId: parts[2] || '-',
    fileName: parts.slice(3).join('/') || key,
  };
}

function buildHtmlGallery(
  bucket: string,
  endpoint: string,
  items: Array<{
    key: string;
    size: number;
    lastModified?: Date;
    url: string;
    userId: string;
    sessionId: string;
    fileName: string;
  }>,
): string {
  const generatedAt = new Date().toISOString();
  const cards = items
    .map((item) => {
      const isImage = /\.(jpe?g|png|webp|gif)$/i.test(item.key);
      const preview = isImage
        ? `<img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.fileName)}" loading="lazy" />`
        : `<div class="non-image">Not an image preview</div>`;

      return `
        <article class="card">
          ${preview}
          <div class="meta">
            <p><strong>File:</strong> ${escapeHtml(item.fileName)}</p>
            <p><strong>User:</strong> ${escapeHtml(item.userId)}</p>
            <p><strong>Session:</strong> ${escapeHtml(item.sessionId)}</p>
            <p><strong>Size:</strong> ${formatBytes(item.size)}</p>
            <p><strong>Modified:</strong> ${item.lastModified?.toISOString() || '-'}</p>
            <p><strong>Key:</strong> <code>${escapeHtml(item.key)}</code></p>
            <a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">Open presigned URL</a>
          </div>
        </article>`;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>KYC Vault Gallery — ${escapeHtml(bucket)}</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; background: #f3f4f6; color: #111827; }
    header { background: #111827; color: #fff; padding: 20px 24px; }
    header h1 { margin: 0 0 8px; font-size: 1.5rem; }
    header p { margin: 4px 0; color: #d1d5db; font-size: 0.95rem; }
    main { padding: 24px; max-width: 1400px; margin: 0 auto; }
    .grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); }
    .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.05); }
    .card img { width: 100%; height: 280px; object-fit: contain; background: #f9fafb; display: block; }
    .non-image { height: 280px; display: flex; align-items: center; justify-content: center; background: #f9fafb; color: #6b7280; }
    .meta { padding: 14px 16px; font-size: 0.9rem; }
    .meta p { margin: 0 0 8px; word-break: break-word; }
    .meta code { font-size: 0.8rem; }
    .meta a { color: #ea580c; font-weight: 600; text-decoration: none; }
    .empty { background: #fff; border: 1px dashed #d1d5db; border-radius: 12px; padding: 48px; text-align: center; color: #6b7280; }
  </style>
</head>
<body>
  <header>
    <h1>KYC Vault Gallery</h1>
    <p>Bucket: ${escapeHtml(bucket)}</p>
    <p>Endpoint: ${escapeHtml(endpoint)}</p>
    <p>Objects: ${items.length} · Generated: ${generatedAt}</p>
    <p>Presigned URLs expire in ${PRESIGN_EXPIRY_SECONDS / 60} minutes.</p>
  </header>
  <main>
    ${
      items.length === 0
        ? '<div class="empty">No objects found in this bucket.</div>'
        : `<div class="grid">${cards}</div>`
    }
  </main>
</body>
</html>`;
}

async function main(): Promise<void> {
  const endpoint = process.env.MINIO_ENDPOINT || process.env.MINIO_SERVER_URL || '';
  const accessKeyId = process.env.MINIO_ROOT_USER || '';
  const secretAccessKey = process.env.MINIO_ROOT_PASSWORD || '';
  const region = process.env.MINIO_REGION_NAME || 'us-east-1';
  const bucket = process.env.KYC_VAULT_BUCKET_NAME || 'extrahand-kyc-vault';

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    console.error('Missing MINIO_ENDPOINT, MINIO_ROOT_USER, or MINIO_ROOT_PASSWORD in .env');
    process.exit(1);
  }

  const endpointString = buildEndpointString(endpoint);
  const s3 = new AWS.S3({
    endpoint: endpointString,
    accessKeyId,
    secretAccessKey,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
    region,
  });

  console.log('Connecting to KYC vault...');
  console.log(`  Endpoint: ${endpointString}`);
  console.log(`  Bucket:   ${bucket}`);

  try {
    await s3.headBucket({ Bucket: bucket }).promise();
    console.log('  Bucket access: OK\n');
  } catch (error: any) {
    console.error(`  Bucket access failed: ${error.message || error.code || error}`);
    process.exit(1);
  }

  const objects = await listAllObjects(s3, bucket);
  console.log(`Found ${objects.length} object(s).\n`);

  const items = [];
  for (const object of objects) {
    const key = object.Key || '';
    if (!key) continue;

    const url = await s3.getSignedUrlPromise('getObject', {
      Bucket: bucket,
      Key: key,
      Expires: PRESIGN_EXPIRY_SECONDS,
    });

    const parts = parseKeyParts(key);
    items.push({
      key,
      size: object.Size || 0,
      lastModified: object.LastModified,
      url,
      ...parts,
    });

    console.log(`- ${key}`);
    console.log(`  size: ${formatBytes(object.Size || 0)}`);
    console.log(`  modified: ${object.LastModified?.toISOString() || '-'}`);
    console.log(`  url: ${url.slice(0, 120)}...`);
    console.log('');
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(JSON_PATH, JSON.stringify(items, null, 2), 'utf8');
  fs.writeFileSync(
    HTML_PATH,
    buildHtmlGallery(bucket, endpointString, items),
    'utf8',
  );

  console.log(`Saved JSON:  ${JSON_PATH}`);
  console.log(`Saved HTML:  ${HTML_PATH}`);

  if (process.argv.includes('--open')) {
    const opener = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(opener, [HTML_PATH], { shell: true, detached: true, stdio: 'ignore' }).unref();
    console.log('Opened gallery in browser.');
  } else {
    console.log('\nOpen the gallery:');
    console.log(`  ${HTML_PATH}`);
    console.log('Or run with --open to launch automatically.');
  }
}

main().catch((error) => {
  console.error('Script failed:', error);
  process.exit(1);
});
