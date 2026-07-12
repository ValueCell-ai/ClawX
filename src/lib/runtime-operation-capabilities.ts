import type { GatewayStatus, RuntimeOperationCapability } from '@/types/gateway';

export function getRuntimeOperationCapability(
  status: Pick<GatewayStatus, 'operationCapabilities'> | null | undefined,
  method: string,
): RuntimeOperationCapability | undefined {
  return status?.operationCapabilities?.[method];
}

export function isRuntimeOperationSupported(
  status: Pick<GatewayStatus, 'operationCapabilities'> | null | undefined,
  method: string,
): boolean {
  const operations = status?.operationCapabilities;
  if (!operations) return true;
  return method in operations && operations[method]?.support !== 'unsupported';
}

export function getUnsupportedRuntimeOperation(
  status: Pick<GatewayStatus, 'operationCapabilities'> | null | undefined,
  method: string,
): RuntimeOperationCapability | undefined {
  const capability = getRuntimeOperationCapability(status, method);
  return capability?.support === 'unsupported' ? capability : undefined;
}

export function assertRuntimeOperationSupported(
  status: Pick<GatewayStatus, 'operationCapabilities'> | null | undefined,
  method: string,
): void {
  const unsupported = getUnsupportedRuntimeOperation(status, method);
  if (!unsupported) {
    if (!status?.operationCapabilities || method in status.operationCapabilities) return;
    throw new Error(`Runtime operation ${method} is not declared by the selected runtime.`);
  }
  const detail = unsupported.notes ? ` ${unsupported.notes}` : '';
  throw new Error(`Runtime operation ${method} is unavailable for the selected runtime.${detail}`);
}
