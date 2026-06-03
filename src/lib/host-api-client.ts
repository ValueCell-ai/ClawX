import type {
  HostApiAction,
  HostApiModule,
  HostApiPayloadArgs,
  HostApiResult,
} from '@shared/host-api/contract';
import type { TypedHostRequest } from '@shared/host-api/types';

function createRequestId(): string {
  return crypto.randomUUID();
}

export async function invokeHost<
  M extends HostApiModule,
  A extends HostApiAction<M>,
>(
  module: M,
  action: A,
  ...payloadArgs: HostApiPayloadArgs<M, A>
): Promise<HostApiResult<M, A>> {
  const bridge = window.clawx?.hostInvoke;
  if (!bridge) {
    throw new Error('Host invoke bridge is unavailable');
  }

  const request: TypedHostRequest<M, A> = {
    id: createRequestId(),
    module,
    action,
  };
  if (payloadArgs.length > 0) {
    request.payload = payloadArgs[0];
  }

  const response = await bridge<HostApiResult<M, A>>(request);

  if (!response.ok) {
    throw new Error(response.error?.message || `Host request failed: ${module}.${action}`);
  }

  return response.data;
}
