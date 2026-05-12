/**
 * Map upstream microservice HTTP status to a value safe to return to the admin SPA.
 *
 * Internal services (user-service gateway, etc.) return 401 when SERVICE_AUTH_TOKEN is
 * missing or wrong. If we forward that as 401 to the browser, the dashboard assumes the
 * admin JWT expired and clears tokens / redirects to login.
 */
export function getClientSafeStatus(error: unknown): number {
  const upstreamStatus = Number((error as any)?.response?.status || 0);
  if (upstreamStatus === 401) {
    return 502;
  }
  return upstreamStatus || 500;
}
