export const EXTRA_BUNDLED_PACKAGES = [
  '@whiskeysockets/baileys',
  // Built-in Feishu extension imports this package from dist/extensions/feishu/*.js,
  // which resolves from the bundled OpenClaw top-level node_modules in packaged builds.
  '@larksuiteoapi/node-sdk',
  // Electron main process QR login flows resolve these files from the
  // bundled OpenClaw runtime context in packaged builds.
  'qrcode-terminal',
];
