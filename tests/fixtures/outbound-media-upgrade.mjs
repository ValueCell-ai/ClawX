// A new process for each phase makes OpenClaw reopen its actual SQLite queue.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { t as emptyRegistry } from '../../node_modules/openclaw/dist/registry-empty-mS6HujHb.mjs';
import { C as setActivePluginRegistry } from '../../node_modules/openclaw/dist/runtime-DbAbpcIy.mjs';
import { i as resolveOutboundMediaMaxBytes } from '../../node_modules/openclaw/dist/configured-max-bytes-gpyR5PVQ.mjs';
import { t as prepareOutboundPayloadBatch } from '../../node_modules/openclaw/dist/deliver-prepare-DAsx55vE.mjs';
import { i as stageAndEnqueueOutboundDelivery } from '../../node_modules/openclaw/dist/deliver-CpM4cWBb.mjs';
import { deliverOutboundPayloadsInternal } from '../../node_modules/openclaw/dist/deliver-runtime-BoN9WDtT.mjs';
import { drainPendingDeliveries } from '../../node_modules/openclaw/dist/plugin-sdk/delivery-queue-runtime.js';
import { r as PlatformMessageNotDispatchedError } from '../../node_modules/openclaw/dist/deliver-types-ChQJdCfP.mjs';
import { r as recoverPendingDeliveries } from '../../node_modules/openclaw/dist/delivery-queue-recovery-BhN1zhbH.mjs';

import { o as loadPluginMetadataSnapshot } from '../../node_modules/openclaw/dist/plugin-metadata-snapshot-BBKj8yr8.mjs';
import { c as setGatewayPluginMetadataSnapshot } from '../../node_modules/openclaw/dist/current-plugin-metadata-snapshot-xCazocy8.mjs';

const [phase] = process.argv.slice(2);
const stateDir = process.env.OPENCLAW_STATE_DIR;
const log = { info() {}, warn: console.warn, error: console.error };
const config = JSON.parse(await readFile(join(stateDir, 'openclaw.json'), 'utf8'));
const snapshot = loadPluginMetadataSnapshot({ config, stateDir, env: process.env });
setGatewayPluginMetadataSnapshot(snapshot, { config, env: process.env });
const channels = ['dingtalk', 'openclaw-weixin', 'wecom', 'feishu'];
const receipts = [];
const capMb = (channel, cfg = config) =>
  resolveOutboundMediaMaxBytes({ channel, accountId: 'work', cfg }) / (1024 * 1024);

if (phase === 'limits') {
  // Resolve in a cold process before any channel adapter is registered.
  const defaults = Object.fromEntries([...channels, 'telegram', 'unknown-channel'].map(c => [c, capMb(c)]));
  const configured = {};
  for (const id of channels) {
    const agent = { ...config, agents: { defaults: { mediaMaxMb: 7 } } };
    const channel = { ...agent, channels: { ...config.channels, [id]: { mediaMaxMb: 128 } } };
    const account = { ...channel, channels: { ...channel.channels,
      [id]: { mediaMaxMb: 128, accounts: { work: { mediaMaxMb: 5 } } },
    } };
    configured[id] = [agent, channel, account].map(cfg => capMb(id, cfg));
  }
  console.log(JSON.stringify({ defaults, configured }));
} else if (phase === 'plugin-uploads') {
  const { checkPluginUploads } = await import('./outbound-media-plugin-uploads.mjs');
  await checkPluginUploads(join(stateDir, 'workspace', 'report.xlsm'));
  console.log(JSON.stringify({ ok: true }));
} else {
  const registry = emptyRegistry();
  for (const id of channels) {
    registry.channels.push({ pluginId: id, plugin: {
      id, meta: { id, label: id },
      config: { resolveAccount: () => ({ accountId: 'work' }), listAccountIds: () => ['work'] },
      outbound: {
        deliveryMode: 'direct',
        sendText() { throw new Error('A file delivery must carry media'); },
        async sendMedia({ mediaUrl }) {
          if (phase === 'recover-offline' && id === 'wecom') {
            throw new PlatformMessageNotDispatchedError('test transport unavailable before dispatch', { retryable: true });
          }
          const bytes = await readFile(mediaUrl);
          receipts.push({ channel: id, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
          return { channel: id, messageId: 'test-' + id };
        },
      },
    } });
  }
  setActivePluginRegistry(registry);
  if (phase === 'enqueue') {
    for (const channel of channels) {
      const payloads = [{ text: 'Workbook', mediaUrl: join(stateDir, 'workspace', 'report.xlsm') }];
      const params = {
        cfg: config, channel, accountId: 'work', to: 'fixture', payloads,
        deliveryQueueStateDir: stateDir, queuePolicy: 'required',
        mediaAccess: { localRoots: [join(stateDir, 'workspace')] },
      };
      const batch = await prepareOutboundPayloadBatch(params);
      const smallCap = { ...config, channels: { ...config.channels, [channel]: { mediaMaxMb: 5 } } };
      await assert.rejects(stageAndEnqueueOutboundDelivery({ ...params, cfg: smallCap }, batch), /5MB limit.*9\.89MB/);
      assert.equal((await stageAndEnqueueOutboundDelivery(params, batch)).created, true);
    }
  } else if (phase === 'reconnect') {
    await drainPendingDeliveries({
      cfg: config, stateDir, log, drainKey: 'wecom', logLabel: 'reconnect',
      selectEntry: (entry) => ({ match: entry.channel === 'wecom', bypassBackoff: true }),
    });
  } else if (phase === 'recover-offline' || phase === 'recover') {
    const summary = await recoverPendingDeliveries({
      cfg: config, stateDir, log,
    }, deliverOutboundPayloadsInternal);
    assert.equal(summary.failed, phase === 'recover-offline' ? 1 : 0);
    assert.equal(summary.recovered, receipts.length);
  } else {
    throw new Error('Unknown phase: ' + phase);
  }
  console.log(JSON.stringify(receipts));
}
