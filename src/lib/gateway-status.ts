import type { GatewayStatus } from '@/types/gateway';

export function isGatewayRestarting(status: GatewayStatus): boolean {
  return status.state === 'starting'
    || status.state === 'reconnecting'
    || (status.state === 'running' && status.gatewayReady === false);
}

export function isGatewayStopped(status: GatewayStatus): boolean {
  return status.state === 'stopped' || status.state === 'error';
}
