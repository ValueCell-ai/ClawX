import type { HostRequest } from './host-api-types';

function createRequestId(): string {
  return crypto.randomUUID();
}

export async function invokeHost<T>(
  module: string,
  action: string,
  payload?: unknown,
): Promise<T> {
  const bridge = window.clawx?.hostInvoke;
  if (!bridge) {
    throw new Error('Host invoke bridge is unavailable');
  }

  const request: HostRequest = {
    id: createRequestId(),
    module,
    action,
    payload,
  };
  const response = await bridge<T>(request);

  if (!response.ok) {
    throw new Error(response.error?.message || `Host request failed: ${module}.${action}`);
  }

  return response.data;
}
