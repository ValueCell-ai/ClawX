import type { RuntimeCapabilities, RuntimeKind } from './types';

export type RuntimeRpcSupport = 'native' | 'proxy' | 'unsupported';

export type RuntimeRpcContractEntry = {
  runtime: RuntimeKind;
  method: string;
  capability: keyof RuntimeCapabilities;
  support: RuntimeRpcSupport;
  notes: string;
};

const OPENCLAW_PROXY_METHODS: Array<[string, keyof RuntimeCapabilities, string]> = [
  ['chat.send', 'chat', 'Sent through OpenClaw Gateway chat.send.'],
  ['chat.abort', 'chat', 'Forwarded to OpenClaw Gateway.'],
  ['sessions.list', 'sessions', 'Served by the OpenClaw session API facade.'],
  ['chat.history', 'history', 'Served by the OpenClaw session API facade.'],
  ['sessions.delete', 'sessions', 'Served by the OpenClaw session API facade.'],
  ['providers.sync', 'providers', 'Forwarded to OpenClaw Gateway/provider services.'],
  ['providers.profile', 'providers', 'Forwarded to OpenClaw Gateway/provider services.'],
  ['models.sync', 'models', 'Forwarded to OpenClaw Gateway/model services.'],
  ['models.profile', 'models', 'Forwarded to OpenClaw Gateway/model services.'],
  ['skills.status', 'skills', 'Forwarded to OpenClaw skills service.'],
  ['skills.update', 'skills', 'Forwarded to OpenClaw skills service.'],
  ['channels.status', 'channels', 'Forwarded to OpenClaw Gateway.'],
  ['channels.connect', 'channels', 'Forwarded to OpenClaw Gateway.'],
  ['channels.disconnect', 'channels', 'Forwarded to OpenClaw Gateway.'],
  ['channels.delete', 'channels', 'Forwarded to OpenClaw Gateway.'],
  ['runtime.controlUi', 'controlUi', 'Opens the OpenClaw Control UI.'],
  ['cron.list', 'cron', 'Adapted by the OpenClaw runtime provider.'],
  ['cron.create', 'cron', 'Adapted by the OpenClaw runtime provider.'],
  ['cron.update', 'cron', 'Adapted by the OpenClaw runtime provider.'],
  ['cron.delete', 'cron', 'Adapted by the OpenClaw runtime provider.'],
  ['cron.toggle', 'cron', 'Adapted by the OpenClaw runtime provider.'],
  ['cron.run', 'cron', 'Adapted by the OpenClaw runtime provider.'],
  ['logs.list', 'logs', 'Served from the OpenClaw log buffer.'],
  ['doctor.run', 'doctor', 'Runs openclaw doctor.'],
  ['doctor.fix', 'doctor', 'Runs openclaw doctor --fix.'],
  ['doctor.memory.status', 'doctor', 'Forwarded to OpenClaw memory doctor RPCs.'],
];

const CC_CONNECT_NATIVE_METHODS: Array<[string, keyof RuntimeCapabilities, string]> = [
  ['chat.send', 'chat', 'Delivered through cc-connect BridgePlatform into Codex.'],
  ['sessions.list', 'sessions', 'Loaded from cc-connect bridge session state.'],
  ['chat.history', 'history', 'Loaded from cc-connect bridge session history.'],
  ['sessions.delete', 'sessions', 'Deletes cc-connect bridge session state.'],
  ['providers.sync', 'providers', 'Writes the managed Codex provider profile and restarts when needed.'],
  ['providers.profile', 'providers', 'Returns the managed Codex provider profile.'],
  ['models.sync', 'models', 'Aliases provider sync for the active Codex model profile.'],
  ['models.profile', 'models', 'Aliases provider profile for the active Codex model profile.'],
  ['skills.status', 'skills', 'Synchronizes skills into the managed cc-connect Codex home.'],
  ['skills.update', 'skills', 'Synchronizes skills into the managed cc-connect Codex home.'],
  ['channels.status', 'channels', 'Projects configured channel accounts into cc-connect platform status.'],
  ['runtime.controlUi', 'controlUi', 'Opens the cc-connect Web Admin.'],
  ['cron.list', 'cron', 'Uses cc-connect management API.'],
  ['cron.create', 'cron', 'Uses cc-connect management API.'],
  ['cron.update', 'cron', 'Uses cc-connect management API.'],
  ['cron.delete', 'cron', 'Uses cc-connect management API.'],
  ['cron.run', 'cron', 'Uses cc-connect management API.'],
  ['logs.list', 'logs', 'Served from managed cc-connect config and runtime paths.'],
  ['doctor.run', 'doctor', 'Runs cc-connect doctor user-isolation.'],
];

const CC_CONNECT_UNSUPPORTED_METHODS: Array<[string, keyof RuntimeCapabilities, string]> = [
  ['chat.abort', 'chat', 'cc-connect BridgePlatform does not expose an abort RPC yet.'],
  ['channels.connect', 'channels', 'Channel credentials are configured in ClawX and materialized during runtime config refresh.'],
  ['channels.disconnect', 'channels', 'Channel credentials are configured in ClawX and materialized during runtime config refresh.'],
  ['channels.delete', 'channels', 'Channel credentials are configured in ClawX and materialized during runtime config refresh.'],
  ['cron.toggle', 'cron', 'Use cron.update with enabled=false/true for cc-connect.'],
  ['doctor.fix', 'doctor', 'cc-connect v1.3.2 does not support doctor fix mode.'],
  ['doctor.memory.status', 'doctor', 'OpenClaw Dreams memory doctor RPCs do not have a cc-connect equivalent.'],
];

function entries(
  runtime: RuntimeKind,
  support: RuntimeRpcSupport,
  items: Array<[string, keyof RuntimeCapabilities, string]>,
): RuntimeRpcContractEntry[] {
  return items.map(([method, capability, notes]) => ({
    runtime,
    method,
    capability,
    support,
    notes,
  }));
}

export const RUNTIME_RPC_CONTRACT: RuntimeRpcContractEntry[] = [
  ...entries('openclaw', 'proxy', OPENCLAW_PROXY_METHODS),
  ...entries('cc-connect', 'native', CC_CONNECT_NATIVE_METHODS),
  ...entries('cc-connect', 'unsupported', CC_CONNECT_UNSUPPORTED_METHODS),
];

export function getRuntimeRpcCoverage(runtime: RuntimeKind): RuntimeRpcContractEntry[] {
  return RUNTIME_RPC_CONTRACT.filter((entry) => entry.runtime === runtime);
}
