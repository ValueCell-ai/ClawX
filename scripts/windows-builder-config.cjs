const path = require('node:path');
const { getWindowsSigningConfig } = require('./windows-signing.cjs');

const signing = getWindowsSigningConfig(process.env, { platform: process.platform });
if (!signing) {
  throw new Error('This release configuration requires CLAWX_WINDOWS_SIGNING=1.');
}

module.exports = {
  extends: path.resolve(__dirname, '..', 'electron-builder.yml'),
  ...signing,
};
