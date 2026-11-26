import { timingSafeEqual } from 'crypto';

export function getNotificationBroadcastAccessToken(
  authorizationHeader: string | undefined,
): string | undefined {
  return authorizationHeader?.match(/^Bearer\s+(\S+)$/i)?.[1];
}

export function matchesNotificationBroadcastAccessToken(
  providedToken: string | undefined,
  configuredToken: string | undefined,
): boolean {
  if (!providedToken || !configuredToken) return false;

  const providedBuffer = Buffer.from(providedToken, 'utf8');
  const configuredBuffer = Buffer.from(configuredToken, 'utf8');
  if (providedBuffer.length !== configuredBuffer.length) return false;

  return timingSafeEqual(providedBuffer, configuredBuffer);
}
