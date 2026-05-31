export type HostRequest = {
  id: string;
  module: string;
  action: string;
  payload?: unknown;
};

export type HostResponse<T = unknown> =
  | { id?: string; ok: true; data: T }
  | { id?: string; ok: false; error?: { code?: string; message?: string; details?: unknown } };
