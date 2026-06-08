export const CC_CONNECT_MANAGEMENT_PORT = 9820;

export function buildCcConnectWebAdminUrl(port = CC_CONNECT_MANAGEMENT_PORT): string {
  const normalizedPort = Number.isFinite(port) && port > 0
    ? Math.trunc(port)
    : CC_CONNECT_MANAGEMENT_PORT;
  return `http://127.0.0.1:${normalizedPort}/`;
}
