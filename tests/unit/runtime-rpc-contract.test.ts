// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  getRuntimeRpcCoverage,
  getRuntimeOperationCapabilities,
  RUNTIME_RPC_CONTRACT,
  type RuntimeRpcSupport,
} from '@electron/runtime/rpc-contract';
import {
  CC_CONNECT_RUNTIME_CAPABILITIES,
  OPENCLAW_RUNTIME_CAPABILITIES,
} from '@electron/runtime/types';

const expectedCcConnectNativeMethods = [
  'chat.send',
  'chat.abort',
  'sessions.list',
  'chat.history',
  'sessions.delete',
  'providers.sync',
  'providers.profile',
  'skills.status',
  'skills.update',
  'channels.status',
  'channels.connect',
  'channels.disconnect',
  'channels.delete',
  'runtime.controlUi',
  'cron.list',
  'cron.create',
  'cron.update',
  'cron.delete',
  'cron.toggle',
  'cron.run',
  'doctor.run',
  'logs.list',
];

describe('runtime RPC contract', () => {
  it('documents every cc-connect primary runtime RPC as native or explicitly unsupported', () => {
    const ccConnectCoverage = getRuntimeRpcCoverage('cc-connect');
    const byMethod = new Map(ccConnectCoverage.map((entry) => [entry.method, entry]));

    for (const method of expectedCcConnectNativeMethods) {
      expect(byMethod.get(method), `${method} should be covered`).toMatchObject({
        runtime: 'cc-connect',
        support: 'native' satisfies RuntimeRpcSupport,
      });
    }

    expect(byMethod.get('doctor.memory.status')).toMatchObject({
      runtime: 'cc-connect',
      support: 'unsupported',
    });
  });

  it('keeps runtime capabilities backed by at least one declared RPC contract entry', () => {
    for (const [runtime, capabilities] of [
      ['openclaw', OPENCLAW_RUNTIME_CAPABILITIES],
      ['cc-connect', CC_CONNECT_RUNTIME_CAPABILITIES],
    ] as const) {
      for (const [capability, enabled] of Object.entries(capabilities)) {
        if (!enabled) continue;
        expect(
          RUNTIME_RPC_CONTRACT.some((entry) => (
            entry.runtime === runtime
            && entry.capability === capability
            && entry.support !== 'unsupported'
          )),
          `${runtime}.${capability} should have a supported RPC contract entry`,
        ).toBe(true);
      }
    }
  });

  it('exposes operation-level support so cc-connect degraded capabilities are visible', () => {
    const operations = getRuntimeOperationCapabilities('cc-connect');

    expect(operations['chat.send']).toMatchObject({
      capability: 'chat',
      support: 'native',
    });
    expect(operations['chat.abort']).toMatchObject({
      capability: 'chat',
      support: 'native',
    });
    expect(operations['doctor.fix']).toMatchObject({
      capability: 'doctor',
      support: 'unsupported',
    });
    expect(operations['channels.disconnect']).toMatchObject({
      capability: 'channels',
      support: 'native',
    });
    expect(operations['cron.toggle']).toMatchObject({
      capability: 'cron',
      support: 'native',
    });
  });
});
