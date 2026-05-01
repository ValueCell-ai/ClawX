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

  // Electron main process QR login flows resolve these files from the
  // bundled OpenClaw runtime context in packaged builds.
  'qrcode-terminal',
];
