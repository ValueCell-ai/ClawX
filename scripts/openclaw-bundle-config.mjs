export const EXTRA_BUNDLED_PACKAGES = [
  '@whiskeysockets/baileys',
  // Electron main process QR login flows resolve these files from the
  // bundled OpenClaw runtime context in packaged builds.
  'qrcode-terminal',
];
