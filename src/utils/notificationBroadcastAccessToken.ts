import { timingSafeEqual } from 'crypto';

export function getNotificationBroadcastAccessToken(
  authorizationHeader: string | undefined,
): string | undefined {
  return authorizationHeader?.match(/^Bearer\s+(\S+)$/i)?.[1];
}

export function matchesNotificationBroadcastAccessToken(
  providedToken: string | undefined,
  configuredToken: string | undefined,
  ttl: string | undefined,
  createdAt: string | undefined,
  now: number = Date.now(),
): boolean {
  if (!providedToken || !configuredToken || !ttl) return false;

  if (ttl !== 'never') {
    const ttlMatch = ttl.match(/^([1-9]\d*)d?$/i);
    if (!ttlMatch || !createdAt || !/^\d{4}-\d{2}-\d{2}$/.test(createdAt)) return false;

    const creationTime = Date.parse(`${createdAt}T00:00:00.000Z`);
    if (!Number.isFinite(creationTime) || new Date(creationTime).toISOString().slice(0, 10) !== createdAt) {
      return false;
    }

    const expirationTime = creationTime + Number(ttlMatch[1]) * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(expirationTime) || expirationTime <= now) return false;
  }

  const providedBuffer = Buffer.from(providedToken, 'utf8');
  const configuredBuffer = Buffer.from(configuredToken, 'utf8');
  if (providedBuffer.length !== configuredBuffer.length) return false;

  return timingSafeEqual(providedBuffer, configuredBuffer);
}
