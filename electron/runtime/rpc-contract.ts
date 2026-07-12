import type {
  RuntimeCapabilities,
  RuntimeKind,
  RuntimeOperationCapabilities,
  RuntimeOperationSupport,
} from './types';

export type RuntimeRpcContractEntry = {
  runtime: RuntimeKind;
  method: string;
  capability: keyof RuntimeCapabilities;
  support: RuntimeOperationSupport;
  notes: string;
};

const OPENCLAW_PROXY_METHODS: Array<[string, keyof RuntimeCapabilities, string]> = [
  ['chat.send', 'chat', 'Sent through OpenClaw Gateway chat.send.'],
  ['chat.abort', 'chat', 'Forwarded to OpenClaw Gateway.'],
  ['chat.approval.respond', 'chat', 'Forwarded to OpenClaw Gateway.'],
  ['sessions.list', 'sessions', 'Served by the OpenClaw session API facade.'],
  ['chat.history', 'history', 'Served by the OpenClaw session API facade.'],
  ['sessions.delete', 'sessions', 'Served by the OpenClaw session API facade.'],
  ['session.delete', 'sessions', 'Compatibility alias for sessions.delete.'],
  ['chat.session.delete', 'sessions', 'Compatibility alias for sessions.delete.'],
  ['sessions.rename', 'sessions', 'Served by the OpenClaw session API facade.'],
  ['session.rename', 'sessions', 'Compatibility alias for sessions.rename.'],
  ['providers.sync', 'providers', 'Forwarded to OpenClaw Gateway/provider services.'],
  ['providers.profile', 'providers', 'Forwarded to OpenClaw Gateway/provider services.'],
  ['models.sync', 'models', 'Forwarded to OpenClaw Gateway/model services.'],
  ['models.profile', 'models', 'Forwarded to OpenClaw Gateway/model services.'],
  ['skills.status', 'skills', 'Forwarded to OpenClaw skills service.'],
  ['skills.update', 'skills', 'Forwarded to OpenClaw skills service.'],
  ['channels.status', 'channels', 'Forwarded to OpenClaw Gateway.'],
  ['channels.add', 'channels', 'Forwarded to OpenClaw Gateway.'],
  ['channels.requestQr', 'channels', 'Forwarded to OpenClaw Gateway.'],
  ['channels.connect', 'channels', 'Forwarded to OpenClaw Gateway.'],
  ['channels.disconnect', 'channels', 'Forwarded to OpenClaw Gateway.'],
  ['channels.delete', 'channels', 'Forwarded to OpenClaw Gateway.'],
  ['runtime.controlUi', 'controlUi', 'Opens the OpenClaw Control UI.'],
  ['cron.list', 'cron', 'Adapted by the OpenClaw runtime provider.'],
  ['cron.create', 'cron', 'Adapted by the OpenClaw runtime provider.'],
  ['cron.add', 'cron', 'Compatibility alias for cron.create.'],
  ['cron.update', 'cron', 'Adapted by the OpenClaw runtime provider.'],
  ['cron.delete', 'cron', 'Adapted by the OpenClaw runtime provider.'],
  ['cron.remove', 'cron', 'Compatibility alias for cron.delete.'],
  ['cron.toggle', 'cron', 'Adapted by the OpenClaw runtime provider.'],
  ['cron.run', 'cron', 'Adapted by the OpenClaw runtime provider.'],
  ['logs.list', 'logs', 'Served from the OpenClaw log buffer.'],
  ['doctor.run', 'doctor', 'Runs openclaw doctor.'],
  ['doctor.fix', 'doctor', 'Runs openclaw doctor --fix.'],
  ['doctor.memory.status', 'doctor', 'Forwarded to OpenClaw memory doctor RPCs.'],
];

const CC_CONNECT_NATIVE_METHODS: Array<[string, keyof RuntimeCapabilities, string]> = [
  ['chat.send', 'chat', 'Delivered through cc-connect BridgePlatform into Codex.'],
  ['chat.abort', 'chat', 'Sends cc-connect /stop to the active Bridge session; runtime restart is only a disconnected-Bridge fallback.'],
  ['chat.approval.respond', 'chat', 'Returns a validated card_action through cc-connect BridgePlatform for the pending Codex approval.'],
  ['sessions.list', 'sessions', 'Loaded from the cc-connect public Management session API.'],
  ['chat.history', 'history', 'Loaded from the cc-connect public Management session history API.'],
  ['sessions.delete', 'sessions', 'Deletes the runtime session through the cc-connect public Management API.'],
  ['session.delete', 'sessions', 'Compatibility alias for sessions.delete.'],
  ['chat.session.delete', 'sessions', 'Compatibility alias for sessions.delete.'],
  ['sessions.rename', 'sessions', 'Stores a ClawX display label without mutating cc-connect private session files.'],
  ['session.rename', 'sessions', 'Compatibility alias for sessions.rename.'],
  ['providers.sync', 'providers', 'Writes the managed Codex provider profile and restarts when needed.'],
  ['providers.profile', 'providers', 'Returns the managed Codex profile plus public cc-connect project provider/model state without restart.'],
  ['models.sync', 'models', 'Aliases provider sync for the active Codex model profile.'],
  ['models.profile', 'models', 'Returns the managed Codex model plus public cc-connect project provider/model state without restart.'],
  ['skills.status', 'skills', 'Synchronizes skills into the managed cc-connect Codex home.'],
  ['skills.update', 'skills', 'Synchronizes skills into the managed cc-connect Codex home.'],
  ['channels.status', 'channels', 'Reads configured channel accounts plus live cc-connect project platform status.'],
  ['channels.connect', 'channels', 'Reloads cc-connect channel platform config through the Management API.'],
  ['channels.disconnect', 'channels', 'Reloads cc-connect channel platform config through the Management API.'],
  ['channels.delete', 'channels', 'Reloads cc-connect channel platform config after channel config deletion.'],
  ['runtime.controlUi', 'controlUi', 'Opens the cc-connect Web Admin.'],
  ['cron.list', 'cron', 'Uses cc-connect management API.'],
  ['cron.create', 'cron', 'Uses cc-connect management API.'],
  ['cron.add', 'cron', 'Compatibility alias for cron.create.'],
  ['cron.update', 'cron', 'Uses cc-connect management API.'],
  ['cron.delete', 'cron', 'Uses cc-connect management API.'],
  ['cron.remove', 'cron', 'Compatibility alias for cron.delete.'],
  ['cron.toggle', 'cron', 'Uses cc-connect management API update with enabled=true/false.'],
  ['cron.run', 'cron', 'Uses cc-connect management API.'],
  ['logs.list', 'logs', 'Served from managed cc-connect config and runtime paths.'],
  ['doctor.run', 'doctor', 'Runs cc-connect doctor user-isolation.'],
];

const CC_CONNECT_UNSUPPORTED_METHODS: Array<[string, keyof RuntimeCapabilities, string]> = [
  ['channels.add', 'channels', 'Channel accounts are configured through the ClawX Host API before cc-connect reload.'],
  ['channels.requestQr', 'channels', 'cc-connect does not expose the OpenClaw QR pairing RPC.'],
  ['doctor.fix', 'doctor', 'cc-connect Doctor does not support fix mode.'],
  ['doctor.memory.status', 'doctor', 'OpenClaw Dreams memory doctor RPCs do not have a cc-connect equivalent.'],
];

function entries(
  runtime: RuntimeKind,
  support: RuntimeOperationSupport,
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

export function getRuntimeOperationCapabilities(runtime: RuntimeKind): RuntimeOperationCapabilities {
  return Object.fromEntries(getRuntimeRpcCoverage(runtime).map((entry) => [
    entry.method,
    {
      capability: entry.capability,
      support: entry.support,
      notes: entry.notes,
    },
  ]));
}
