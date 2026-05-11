export const EXTRA_BUNDLED_PACKAGES = [
  '@whiskeysockets/baileys',

  // Built-in channel/runtime extension deps that are not always pulled in by the
  // OpenClaw package's own transitive dependency graph, but are required in
  // packaged builds when dist/extensions/<channel>/*.js resolves bare imports
  // from resources/openclaw/node_modules.
  '@larksuiteoapi/node-sdk',
  '@grammyjs/runner',
  '@grammyjs/transformer-throttler',
  'grammy',
  '@buape/carbon',
  '@discordjs/voice',
  'discord-api-types',
  'opusscript',
  '@tencent-connect/qqbot-connector',
  'mpg123-decoder',
  'silk-wasm',

  // The built-in acpx extension already ships its direct "acpx" package under
  // dist/extensions/acpx/node_modules, but its runtime path reaches
  // "acpx/runtime", whose reachable bare runtime dependency is
  // @agentclientprotocol/sdk. Package it explicitly to keep packaged builds
  // self-contained even when the extension dep graph is flattened.
  '@agentclientprotocol/sdk',

  // OpenClaw's built-in browser extension resolves playwright-core at runtime.
  // Package it explicitly because it is not always present in openclaw's own
  // transitive dependency graph from the app bundle context.
  'playwright-core',

  // Electron main process QR login flows resolve these files from the
  // bundled OpenClaw runtime context in packaged builds.
  'qrcode-terminal',
];
