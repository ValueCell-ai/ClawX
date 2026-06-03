import type { HostApiContract } from '../../../src/lib/host-api-contract';

export type HostRequest = {
  id: string;
  module: string;
  action: string;
  payload?: unknown;
};

export type HostErrorCode = 'VALIDATION' | 'UNSUPPORTED' | 'INTERNAL';

export type HostResponse<T = unknown> =
  | { id?: string; ok: true; data: T }
  | { id?: string; ok: false; error: { code: HostErrorCode; message: string; details?: unknown } };

export type RuntimeHostAction = (payload?: unknown) => Promise<unknown> | unknown;

export type HostServiceRegistry = {
  [M in keyof HostApiContract]?: Partial<HostApiContract[M]>;
};
export type CompleteHostServiceRegistry = {
  [M in keyof HostApiContract]: HostApiContract[M];
};

export type HostApiContribution = {
  module: string;
  actions: Record<string, RuntimeHostAction>;
};

export type HostApiContributionRegistrar = {
  register: (extensionId: string, contributions: HostApiContribution[]) => () => void;
};

export function isHostRequest(value: unknown): value is HostRequest {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && record.id.length > 0
    && typeof record.module === 'string'
    && record.module.length > 0
    && typeof record.action === 'string'
    && record.action.length > 0;
}
