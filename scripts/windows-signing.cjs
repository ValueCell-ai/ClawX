'use strict';

// electron-builder 26 custom signing hook. SSL.com only receives the digest;
// credentials are arguments to Java directly, never a shell command or log.
const { execFile } = require('node:child_process');
const { existsSync, promises: fs } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

const REQUIRED_ENV = Object.freeze([
  'ES_USERNAME', 'ES_PASSWORD', 'ES_CREDENTIAL_ID', 'ES_TOTP_SECRET',
  'WINDOWS_PUBLISHER_NAME', 'ES_CODE_SIGN_TOOL_PATH',
]);
const TOOL_JAR = 'code_sign_tool-1.3.3.jar';
const SIGNATURE_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
  $signature = Get-AuthenticodeSignature -LiteralPath $env:CLAWX_SIGNATURE_FILE
  $commonName = $null
  if ($null -ne $signature.SignerCertificate) {
    $commonName = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  }
  [ordered]@{
    status = $signature.Status.ToString()
    commonName = $commonName
    timestamped = ($null -ne $signature.TimeStamperCertificate)
  } | ConvertTo-Json -Compress
} catch { exit 1 }
`;

function isWindowsSigningEnabled(env = process.env) {
  const value = env.CLAWX_WINDOWS_SIGNING;
  if (value === undefined || value === '' || value === '0') return false;
  if (value === '1') return true;
  throw new Error('CLAWX_WINDOWS_SIGNING must be 0 or 1.');
}

function assertWindowsSigningReady(env = process.env, options = {}) {
  if (!isWindowsSigningEnabled(env)) {
    throw new Error('Set CLAWX_WINDOWS_SIGNING=1 to enable Windows signing.');
  }
  if ((options.platform || process.platform) !== 'win32') {
    throw new Error('Windows release signing requires a Windows runner.');
  }
  const missing = REQUIRED_ENV.filter((name) => !env[name] || !env[name].trim());
  if (missing.length) throw new Error(`Missing Windows signing configuration: ${missing.join(', ')}.`);
  // The publisher is the certificate CN, not a complete distinguished name.
  if (/[\r\n\0]/.test(env.WINDOWS_PUBLISHER_NAME)) {
    throw new Error('WINDOWS_PUBLISHER_NAME must be a single certificate common name.');
  }
  const javaHome = env.JAVA_HOME || env.JAVA_HOME_17_X64;
  if (!javaHome) throw new Error('Windows signing requires Java 17 (JAVA_HOME).');
  const toolDirectory = path.resolve(env.ES_CODE_SIGN_TOOL_PATH);
  const javaPath = path.join(javaHome, 'bin', 'java.exe');
  const jarPath = path.join(toolDirectory, 'jar', TOOL_JAR);
  const hasFile = options.existsSync || existsSync;
  if (!hasFile(javaPath)) throw new Error('Windows signing Java executable is missing.');
  if (!hasFile(jarPath) || !hasFile(path.join(toolDirectory, 'conf', 'code_sign_tool.properties'))) {
    throw new Error('Pinned CodeSignTool installation is missing; run scripts/setup-windows-signing.ps1.');
  }
  return { toolDirectory, javaPath, jarPath, publisherName: env.WINDOWS_PUBLISHER_NAME };
}

function getWindowsSigningConfig(env = process.env, options = {}) {
  if (!isWindowsSigningEnabled(env)) return null;
  const { publisherName } = assertWindowsSigningReady(env, options);
  return {
    forceCodeSigning: true,
    win: {
      verifyUpdateCodeSignature: true,
      signtoolOptions: {
        sign: __filename,
        publisherName: [publisherName],
        signingHashAlgorithms: ['sha256'],
      },
    },
  };
}

function executeCaptured(file, args, options) {
  return new Promise((resolve, reject) => {
    execFile(file, args, {
      ...options,
      shell: false,
      windowsHide: true,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    }, (error, stdout) => {
      // execFile errors contain the command line, including credentials. Never
      // propagate the original error/cause or the program's stdout/stderr.
      if (error) reject(new Error('Signing subprocess failed (output suppressed).'));
      else resolve(stdout);
    });
  });
}

async function readSignature(file, env, execute) {
  try {
    const output = await execute('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
      Buffer.from(SIGNATURE_SCRIPT, 'utf16le').toString('base64'),
    ], { env: { ...env, CLAWX_SIGNATURE_FILE: file } });
    const signature = JSON.parse(output.replace(/^\uFEFF/, '').trim());
    if (typeof signature.status !== 'string' || typeof signature.timestamped !== 'boolean') throw new Error();
    return signature;
  } catch {
    throw new Error('Windows Authenticode inspection failed (output suppressed).');
  }
}

function assertExpectedSignature(signature, publisherName) {
  if (signature.status !== 'Valid') throw new Error('Windows Authenticode signature is not valid.');
  if (signature.commonName !== publisherName) throw new Error('Windows Authenticode publisher does not match WINDOWS_PUBLISHER_NAME.');
  if (!signature.timestamped) throw new Error('Windows Authenticode signature has no trusted timestamp.');
}

function isUpstreamHelper(file) {
  // Only unchanged, known bundled helpers may retain their vendor identity.
  // In particular, never skip the app, an installer or an arbitrary signed EXE.
  // cua-driver.exe is intentionally excluded: its PE subsystem is patched.
  return /[\\/]resources[\\/]bin[\\/](?:node|uv|agent-browser)\.exe$/i.test(file);
}

function createWindowsSigner(options = {}) {
  const env = options.env || process.env;
  const execute = options.execute || executeCaptured;
  return async function signWindowsFile(configuration) {
    const ready = assertWindowsSigningReady(env, options);
    if (configuration.hash !== 'sha256' || configuration.isNest) {
      throw new Error('Windows signing requires one SHA-256 signing pass.');
    }
    if (typeof configuration.path !== 'string' || !configuration.path) {
      throw new Error('Windows signing requires an input file.');
    }
    const inputFile = path.resolve(configuration.path);
    try {
      if (!(await fs.stat(inputFile)).isFile()) throw new Error();
    } catch {
      throw new Error('Windows signing input file is missing or unreadable.');
    }

    if (isUpstreamHelper(inputFile)) {
      const existing = await readSignature(inputFile, env, execute);
      if (existing.status === 'Valid' && existing.timestamped && typeof existing.commonName === 'string' && existing.commonName) return;
    }

    let outputDirectory;
    try {
      outputDirectory = await fs.mkdtemp(path.join(options.tempRoot || tmpdir(), 'clawx-sign-'));
      const args = [
        '-jar', ready.jarPath, 'sign',
        `-username=${env.ES_USERNAME}`,
        `-password=${env.ES_PASSWORD}`,
        `-credential_id=${env.ES_CREDENTIAL_ID}`,
        `-totp_secret=${env.ES_TOTP_SECRET}`,
        `-input_file_path=${inputFile}`,
        `-output_dir_path=${outputDirectory}`,
      ];
      try {
        await execute(ready.javaPath, args, {
          cwd: ready.toolDirectory,
          env: { ...env, CODE_SIGN_TOOL_PATH: ready.toolDirectory },
        });
      } catch {
        throw new Error('CodeSignTool failed; release signing stopped (output suppressed).');
      }
      const signedFile = path.join(outputDirectory, path.basename(inputFile));
      try {
        if (!(await fs.stat(signedFile)).isFile()) throw new Error();
      } catch {
        throw new Error('CodeSignTool did not produce the signed file.');
      }
      assertExpectedSignature(await readSignature(signedFile, env, execute), ready.publisherName);
      // Only replace the original after the returned file has passed verification.
      await fs.copyFile(signedFile, inputFile);
      assertExpectedSignature(await readSignature(inputFile, env, execute), ready.publisherName);
    } finally {
      if (outputDirectory) await fs.rm(outputDirectory, { recursive: true, force: true });
    }
  };
}

function checkCli(args, env = process.env, options = {}) {
  if (args.length !== 1 || args[0] !== '--check') throw new Error('Usage: node scripts/windows-signing.cjs --check');
  assertWindowsSigningReady(env, options);
  return 'Windows signing configuration is ready; no signing request was sent.';
}

module.exports = createWindowsSigner();
module.exports.createWindowsSigner = createWindowsSigner;
module.exports.getWindowsSigningConfig = getWindowsSigningConfig;
module.exports.assertWindowsSigningReady = assertWindowsSigningReady;
module.exports.isWindowsSigningEnabled = isWindowsSigningEnabled;
module.exports.checkCli = checkCli;

if (require.main === module) {
  try {
    console.log(checkCli(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
