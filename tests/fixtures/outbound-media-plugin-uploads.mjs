// Exercise the upload code shipped by each plugin with synthetic remote responses.
import assert from 'node:assert/strict';
import { createDecipheriv, createHash } from 'node:crypto';
import { copyFile, readFile, rm, truncate } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { S as sendMediaFeishu } from '../../node_modules/@openclaw/feishu/dist/.setup/reply-delivery-result-QS_FCE--.mjs';
import { sendWeixinMediaFile } from '../../node_modules/@tencent-weixin/openclaw-weixin/dist/src/messaging/send-media.js';

import { wecomPlugin } from '../../node_modules/@wecom/wecom-openclaw-plugin/dist/src/channel.js';
import { setWeComWebSocket, deleteWeComWebSocket } from '../../node_modules/@wecom/wecom-openclaw-plugin/dist/src/state-manager.js';
import { uploadAndSendMedia } from '../../node_modules/@wecom/wecom-openclaw-plugin/dist/src/media-uploader.js';
import { n as sendMediaToDingTalk } from '../../node_modules/@dingtalk-real-ai/dingtalk-connector/dist/messaging-JY5zinFJ.mjs';
import { n as uploadMediaToDingTalk } from '../../node_modules/@dingtalk-real-ai/dingtalk-connector/dist/media-nyjwj7nU.mjs';
import { n as dingOapi, t as dingHttp } from '../../node_modules/@dingtalk-real-ai/dingtalk-connector/dist/http-client-8_Hh4c4N.mjs';

async function checkWeCom(filePath, workbook, oversized) {
  const events = [];
  const wsClient = {
    isConnected: true,
    async uploadMedia(bytes, metadata) {
      events.push('upload');
      assert.deepEqual(bytes, workbook);
      assert.deepEqual(metadata, { type: 'file', filename: basename(filePath) });
      return { media_id: 'test-wecom-file' };
    },
    async sendMediaMessage(chatId, type, mediaId) {
      events.push('send');
      assert.deepEqual([chatId, type, mediaId], ['fixture', 'file', 'test-wecom-file']);
      return { headers: { req_id: 'test-wecom-receipt' } };
    },
  };
  setWeComWebSocket('work', wsClient);
  const mediaLocalRoots = [dirname(filePath)];
  try {
    const result = await wecomPlugin.outbound.sendMedia({
      accountId: 'work', to: 'wecom:fixture', mediaUrl: filePath, mediaLocalRoots,
    });
    assert.equal(result.messageId, 'test-wecom-receipt');
    // The connector reports oversize to its caller; no attachment reaches the socket.
    const refused = await uploadAndSendMedia({ wsClient, chatId: 'fixture', mediaUrl: oversized, mediaLocalRoots });
    assert.equal(refused.ok, false);
    assert.match(refused.error ?? refused.rejectReason, /20MB|20971520/);
    assert.deepEqual(events, ['upload', 'send']);
  } finally {
    deleteWeComWebSocket('work');
  }
}

async function checkDingTalk(filePath, workbook, oversized) {
  const events = [];
  const previousOapi = dingOapi.defaults.adapter;
  const previousHttp = dingHttp.defaults.adapter;
  const transport = async (request) => {
    const url = new URL(request.url);
    let data;
    if (url.pathname === '/gettoken') data = { errcode: 0, access_token: 'test-oapi-token' };
    else if (url.pathname === '/v1.0/oauth2/accessToken') data = { accessToken: 'test-token', expireIn: 3600 };
    else if (url.pathname === '/media/upload') {
      events.push('upload');
      assert.equal(url.searchParams.get('type'), 'file');
      const stream = request.data.pipe(new PassThrough());
      const form = await new Response(stream, { headers: request.data.getHeaders() }).formData();
      const part = form.get('media');
      assert.equal(part.name, basename(filePath));
      assert.deepEqual(Buffer.from(await part.arrayBuffer()), workbook);
      data = { media_id: '@test-dingtalk-file' };
    } else if (url.pathname === '/v1.0/robot/oToMessages/batchSend') {
      events.push('send');
      const body = JSON.parse(request.data);
      assert.deepEqual(body.userIds, ['fixture']);
      assert.equal(body.msgKey, 'sampleFile');
      assert.deepEqual(JSON.parse(body.msgParam), {
        mediaId: '@test-dingtalk-file', fileName: basename(filePath), fileType: 'xlsm',
      });
      data = { processQueryKey: 'test-query' };
    } else throw new Error('Unexpected DingTalk request ' + url.pathname);
    return { status: 200, data, headers: {}, config: request };
  };
  dingHttp.defaults.adapter = dingOapi.defaults.adapter = transport;
  try {
    const result = await sendMediaToDingTalk({
      config: { clientId: 'fixture', clientSecret: 'synthetic' },
      target: 'user:fixture', mediaUrl: filePath.split('\\').join('/'),
    });
    assert.equal(result.processQueryKey, 'file-message-sent');
    // This is the normal robot file path; the separate chunk uploader is a different API.
    const warnings = [];
    assert.equal(await uploadMediaToDingTalk(oversized, 'file', 'test-oapi-token', undefined,
      { warn: message => warnings.push(message) }), null);
    assert.match(warnings.join(' '), /超过限制 20MB/);
    assert.deepEqual(events, ['upload', 'send']);
  } finally {
    dingOapi.defaults.adapter = previousOapi;
    dingHttp.defaults.adapter = previousHttp;
  }
}

async function checkFeishu(workbook) {
  const require = createRequire(new URL('../../node_modules/@openclaw/feishu/package.json', import.meta.url));
  const { defaultHttpInstance } = require('@larksuiteoapi/node-sdk');
  const previous = defaultHttpInstance.defaults.adapter;
  const cfg = { channels: { feishu: { appId: 'fixture', appSecret: 'synthetic', mediaMaxMb: 128 } } };
  const target = { cfg, to: 'oc_fixture' };
  const requests = [];
  defaultHttpInstance.defaults.adapter = async (request) => {
    const route = new URL(request.url).pathname;
    requests.push(route);
    let data;
    if (route.endsWith('/tenant_access_token/internal')) {
      data = { code: 0, tenant_access_token: 'test-token', expire: 3600 };
    } else if (route.endsWith('/im/v1/files')) {
      const part = request.data.get('file');
      assert.deepEqual(Buffer.from(await part.arrayBuffer()), workbook);
      data = { code: 0, data: { file_key: 'test-file' } };
    } else if (route.endsWith('/im/v1/messages')) {
      const body = JSON.parse(request.data);
      assert.equal(body.msg_type, 'file');
      assert.deepEqual(JSON.parse(body.content), { file_key: 'test-file' });
      data = { code: 0, data: { message_id: 'test-feishu-message' } };
    } else {
      throw new Error('Unexpected Feishu request ' + route);
    }
    return { status: 200, statusText: 'OK', data, headers: {}, config: request };
  };
  try {
    // Detection uses the bytes, so give this oversized image a real PNG signature and IHDR.
    const largePng = Buffer.alloc(10 * 1024 * 1024 + 1);
    Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').copy(largePng);
    await assert.rejects(sendMediaFeishu({ ...target, mediaBuffer: largePng, fileName: 'image.png' }), /Feishu image exceeds its 10485760-byte upload limit/);
    await assert.rejects(sendMediaFeishu({ ...target, mediaBuffer: Buffer.alloc(30 * 1024 * 1024 + 1), fileName: 'report.xlsm' }), /Feishu file exceeds its 31457280-byte upload limit/);
    assert.deepEqual(requests, []);
    const receipt = await sendMediaFeishu({ ...target, mediaBuffer: workbook, fileName: 'report.xlsm' });
    assert.equal(receipt.messageId, 'test-feishu-message');
    assert.equal(requests.filter(route => route.endsWith('/im/v1/files')).length, 1);
  } finally {
    defaultHttpInstance.defaults.adapter = previous;
  }
}

async function checkWeixin(filePath, workbook) {
  const previous = globalThis.fetch;
  const routes = [];
  let key;
  globalThis.fetch = async (url, options) => {
    const route = new URL(url).pathname;
    routes.push(route);
    if (route === '/ilink/bot/getuploadurl') {
      const meta = JSON.parse(options.body);
      assert.equal(meta.rawsize, workbook.length);
      assert.equal(meta.rawfilemd5, createHash('md5').update(workbook).digest('hex'));
      key = Buffer.from(meta.aeskey, 'hex');
      return Response.json({ upload_full_url: 'https://fixture.invalid/upload' });
    }
    if (route === '/upload') {
      const decipher = createDecipheriv('aes-128-ecb', key, null);
      assert.deepEqual(Buffer.concat([decipher.update(options.body), decipher.final()]), workbook);
      return new Response('', { headers: { 'x-encrypted-param': 'test-cdn-ref' } });
    }
    if (route === '/ilink/bot/sendmessage') {
      const [item] = JSON.parse(options.body).msg.item_list;
      assert.equal(item.file_item.file_name, basename(filePath));
      assert.equal(Number(item.file_item.len), workbook.length);
      assert.equal(item.file_item.media.encrypt_query_param, 'test-cdn-ref');
      return Response.json({ ret: 0, message_id: 'test-weixin-message' });
    }
    throw new Error('Unexpected Weixin request ' + route);
  };
  try {
    const result = await sendWeixinMediaFile({ filePath, to: 'fixture', text: '',
      opts: { baseUrl: 'https://fixture.invalid', token: 'synthetic', contextToken: 'fixture-context' },
      cdnBaseUrl: 'https://fixture.invalid' });
    assert.equal(result.serverMessageId, 'test-weixin-message');
    assert.deepEqual(routes, ['/ilink/bot/getuploadurl', '/upload', '/ilink/bot/sendmessage']);
  } finally {
    globalThis.fetch = previous;
  }
}

export async function checkPluginUploads(filePath) {
  const workbook = await readFile(filePath);
  const oversized = join(dirname(filePath), 'oversized.xlsm');
  await copyFile(filePath, oversized);
  try {
    await truncate(oversized, 20 * 1024 * 1024 + 1);
    await checkWeCom(filePath, workbook, oversized);
    await checkDingTalk(filePath, workbook, oversized);
    await checkFeishu(workbook);
    await checkWeixin(filePath, workbook);
  } finally {
    await rm(oversized, { force: true });
  }
}
