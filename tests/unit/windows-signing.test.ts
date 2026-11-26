// @vitest-environment node
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type SigningEnvironment = Record<string, string | undefined>;
type Signature = { status: string; commonName: string | null; timestamped: boolean };
type ExecuteOptions = { cwd?: string; env: SigningEnvironment };
type Execute = (file: string, args: string[], options: ExecuteOptions) => Promise<string>;
type SignTask = { path: string; hash: string; isNest?: boolean };
type Options = {
  env?: SigningEnvironment;
  platform?: string;
  existsSync?: (file: string) => boolean;
  execute?: Execute;
  tempRoot?: string;
};
type SigningModule = {
  createWindowsSigner: (options: Options) => (task: SignTask) => Promise<void>;
  getWindowsSigningConfig: (env: SigningEnvironment, options?: Options) => null | {
    forceCodeSigning: boolean;
    win: {
      verifyUpdateCodeSignature: boolean;
      signtoolOptions: { sign: string; publisherName: string[]; signingHashAlgorithms: string[] };
    };
  };
  assertWindowsSigningReady: (env: SigningEnvironment, options?: Options) => unknown;
  checkCli: (args: string[], env: SigningEnvironment, options?: Options) => string;
};

const require = createRequire(import.meta.url);
const signing = require('../../scripts/windows-signing.cjs') as SigningModule;
const roots: string[] = [];
const publisher = 'ClawX Example, Inc.';
const validSignature: Signature = { status: 'Valid', commonName: publisher, timestamped: true };

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture(relativeFile = 'win-unpacked/ClawX.exe') {
  const root = mkdtempSync(join(tmpdir(), 'clawx-sign-test-'));
  roots.push(root);
  const file = join(root, relativeFile);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, 'original artifact');
  const toolDirectory = join(root, 'CodeSignTool');
  mkdirSync(join(toolDirectory, 'jar'), { recursive: true });
  mkdirSync(join(toolDirectory, 'conf'), { recursive: true });
  writeFileSync(join(toolDirectory, 'jar', 'code_sign_tool-1.3.3.jar'), 'fixture');
  writeFileSync(join(toolDirectory, 'conf', 'code_sign_tool.properties'), 'fixture');
  const javaHome = join(root, 'java');
  mkdirSync(join(javaHome, 'bin'), { recursive: true });
  writeFileSync(join(javaHome, 'bin', 'java.exe'), 'fixture');
  const env: SigningEnvironment = {
    CLAWX_WINDOWS_SIGNING: '1',
    ES_USERNAME: 'test-publisher@example.invalid',
    ES_PASSWORD: 'fake-%PATH% & !secret "quotes"',
    ES_CREDENTIAL_ID: 'fake-credential-id',
    ES_TOTP_SECRET: 'fake-totp-secret',
    WINDOWS_PUBLISHER_NAME: publisher,
    ES_CODE_SIGN_TOOL_PATH: toolDirectory,
    JAVA_HOME: javaHome,
  };
  const execute = vi.fn<Execute>(async (program, args) => {
    if (program === 'powershell.exe') return JSON.stringify(validSignature);
    const output = args.find((arg) => arg.startsWith('-output_dir_path='))!.slice('-output_dir_path='.length);
    writeFileSync(join(output, basename(file)), 'signed artifact');
    return 'signed successfully';
  });
  const options = { env, platform: 'win32', execute, tempRoot: root };
  return { root, file, env, execute, options, sign: signing.createWindowsSigner(options) };
}

describe('Windows signing configuration and preflight', () => {
  it('keeps local unsigned builds opt-in and rejects misspelled switches', () => {
    expect(signing.getWindowsSigningConfig({})).toBeNull();
    expect(signing.getWindowsSigningConfig({ CLAWX_WINDOWS_SIGNING: '0' })).toBeNull();
    expect(() => signing.getWindowsSigningConfig({ CLAWX_WINDOWS_SIGNING: 'yes' })).toThrow('must be 0 or 1');
  });

  it('supplies the builder 26 hook, publisher pin and only SHA-256', () => {
    const { env, options } = fixture();
    const config = signing.getWindowsSigningConfig(env, options)!;
    expect(config.forceCodeSigning).toBe(true);
    expect(config.win.verifyUpdateCodeSignature).toBe(true);
    expect(config.win.signtoolOptions.publisherName).toEqual([publisher]);
    expect(config.win.signtoolOptions.signingHashAlgorithms).toEqual(['sha256']);
    expect(config.win.signtoolOptions.sign).toBe(resolve('scripts/windows-signing.cjs'));
  });

  it('fails closed on missing credentials, missing tools and non-Windows hosts', () => {
    const { env, options } = fixture();
    expect(() => signing.getWindowsSigningConfig({ ...env, ES_PASSWORD: '' }, options)).toThrow('ES_PASSWORD');
    expect(() => signing.getWindowsSigningConfig(env, { ...options, existsSync: () => false })).toThrow('Java executable is missing');
    expect(() => signing.getWindowsSigningConfig(env, {
      ...options, existsSync: (file) => !file.endsWith('.jar'),
    })).toThrow('CodeSignTool installation is missing');
    expect(() => signing.getWindowsSigningConfig(env, { ...options, platform: 'linux' })).toThrow('Windows runner');
  });

  it('validates --check without executing the signer or printing configuration values', () => {
    const { env, options, execute } = fixture();
    const output = signing.checkCli(['--check'], env, options);
    expect(output).toContain('no signing request was sent');
    expect(output).not.toContain(publisher);
    for (const name of ['ES_USERNAME', 'ES_PASSWORD', 'ES_CREDENTIAL_ID', 'ES_TOTP_SECRET']) {
      expect(output).not.toContain(env[name]);
    }
    expect(execute).not.toHaveBeenCalled();
    expect(() => signing.checkCli(['--check', 'file.exe'], env, options)).toThrow('Usage:');
    expect(() => signing.checkCli(['--check'], { ...env, CLAWX_WINDOWS_SIGNING: '0' }, options)).toThrow('enable Windows signing');
  });
});

describe('Windows cloud signing hook', () => {
  it.skipIf(process.platform !== 'win32')('preserves a Chinese publisher through Windows PowerShell 5.1 output', async () => {
    const { file, env, execute, sign } = fixture();
    env.WINDOWS_PUBLISHER_NAME = '北京示例有限公司';
    const mockCertificate = `
function Get-AuthenticodeSignature {
  $cert = New-Object PSObject
  $cert | Add-Member -MemberType ScriptMethod -Name GetNameInfo -Value { return '北京示例有限公司' }
  return [pscustomobject]@{ Status = 'Valid'; SignerCertificate = $cert; TimeStamperCertificate = $true }
}
`;
    execute.mockImplementation(async (program, args, options) => {
      if (program === 'powershell.exe') {
        const script = Buffer.from(args[args.length - 1], 'base64').toString('utf16le');
        return execFileSync(program, [
          '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand',
          Buffer.from(mockCertificate + script, 'utf16le').toString('base64'),
        ], { encoding: 'utf8', windowsHide: true, env: { ...process.env, ...options.env } });
      }
      const output = args.find((arg) => arg.startsWith('-output_dir_path='))!.slice('-output_dir_path='.length);
      writeFileSync(join(output, basename(file)), 'signed artifact');
      return '';
    });
    await sign({ path: file, hash: 'sha256' });
    expect(readFileSync(file, 'utf8')).toBe('signed artifact');
  });

  it.each(['win-unpacked/ClawX.exe', '__uninstaller-nsis-clawx.exe', 'ClawX-1.0.0-win-x64.exe'])(
    'signs and verifies %s before and after replacement', async (name) => {
      const { file, env, execute, sign } = fixture(name);
      await sign({ path: file, hash: 'sha256' });
      expect(readFileSync(file, 'utf8')).toBe('signed artifact');
      expect(execute).toHaveBeenCalledTimes(3);
      const [program, args, options] = execute.mock.calls[0];
      expect(program).toBe(join(env.JAVA_HOME!, 'bin', 'java.exe'));
      expect(args).toContain(`-password=${env.ES_PASSWORD}`);
      expect(args).toContain(`-input_file_path=${file}`);
      expect(args).toContain('sign');
      expect(options.cwd).toBe(env.ES_CODE_SIGN_TOOL_PATH);
      const firstInspection = execute.mock.calls[1][2].env.CLAWX_SIGNATURE_FILE!;
      expect(firstInspection).not.toBe(file);
      expect(execute.mock.calls[2][2].env.CLAWX_SIGNATURE_FILE).toBe(file);
      expect(existsSync(dirname(firstInspection))).toBe(false);
    },
  );

  it('rejects extra/SHA-1 passes before making a chargeable request', async () => {
    const { file, execute, sign } = fixture();
    await expect(sign({ path: file, hash: 'sha1' })).rejects.toThrow('one SHA-256');
    await expect(sign({ path: file, hash: 'sha256', isNest: true })).rejects.toThrow('one SHA-256');
    expect(execute).not.toHaveBeenCalled();
  });

  it('suppresses tool errors and credentials, leaving the original intact', async () => {
    const { file, env, execute, sign } = fixture();
    execute.mockRejectedValueOnce(new Error(`command failed -password=${env.ES_PASSWORD} -totp_secret=${env.ES_TOTP_SECRET}`));
    await expect(sign({ path: file, hash: 'sha256' })).rejects.toThrow(
      'CodeSignTool failed; release signing stopped (output suppressed).',
    );
    expect(readFileSync(file, 'utf8')).toBe('original artifact');
    const output = execute.mock.calls[0][1].find((arg) => arg.startsWith('-output_dir_path='))!.slice('-output_dir_path='.length);
    expect(existsSync(output)).toBe(false);
  });

  it('rejects zero-exit tool failures which do not produce an artifact', async () => {
    const { file, execute, sign } = fixture();
    execute.mockResolvedValueOnce('Error: remote signing failed');
    await expect(sign({ path: file, hash: 'sha256' })).rejects.toThrow('did not produce');
    expect(readFileSync(file, 'utf8')).toBe('original artifact');
  });

  it.each([
    [{ ...validSignature, status: 'HashMismatch' }, 'signature is not valid'],
    [{ ...validSignature, commonName: 'Another Publisher' }, 'publisher does not match'],
    [{ ...validSignature, timestamped: false }, 'no trusted timestamp'],
  ] as const)('rejects untrusted or unexpected returned signatures', async (signature, message) => {
    const { file, execute, sign } = fixture();
    execute.mockImplementationOnce(async (_program, args) => {
      const output = args.find((arg) => arg.startsWith('-output_dir_path='))!.slice('-output_dir_path='.length);
      writeFileSync(join(output, basename(file)), 'bad signed artifact');
      return '';
    }).mockResolvedValueOnce(JSON.stringify(signature));
    await expect(sign({ path: file, hash: 'sha256' })).rejects.toThrow(message);
    expect(readFileSync(file, 'utf8')).toBe('original artifact');
  });

  it('suppresses Authenticode subprocess output instead of treating it as a signature', async () => {
    const { file, env, execute, sign } = fixture('win-unpacked/resources/bin/node.exe');
    execute.mockResolvedValueOnce(`failure containing ${env.ES_PASSWORD}`);
    await expect(sign({ path: file, hash: 'sha256' })).rejects.toThrow('Authenticode inspection failed (output suppressed)');
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each(['node.exe', 'uv.exe', 'agent-browser.exe'])('retains a valid timestamped upstream %s without a signing request', async (helper) => {
    const { file, execute, sign } = fixture(`win-unpacked/resources/bin/${helper}`);
    execute.mockResolvedValueOnce(JSON.stringify({ ...validSignature, commonName: 'Upstream Vendor' }));
    await sign({ path: file, hash: 'sha256' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toBe('powershell.exe');
    expect(readFileSync(file, 'utf8')).toBe('original artifact');
  });

  it.each(['NotSigned', 'HashMismatch'])('signs a helper with status %s instead of silently skipping it', async (status) => {
    const { file, execute, sign } = fixture('win-unpacked/resources/bin/node.exe');
    execute.mockResolvedValueOnce(JSON.stringify({ status, commonName: null, timestamped: false }));
    await sign({ path: file, hash: 'sha256' });
    expect(execute).toHaveBeenCalledTimes(4);
    expect(readFileSync(file, 'utf8')).toBe('signed artifact');
  });

  it.each(['resources/bin/cua-driver.exe', 'resources/bin/unexpected.exe', 'resources/bin/nested/node.exe', 'ClawX.exe'])(
    'does not apply the upstream exception to %s', async (name) => {
      const { file, execute, sign } = fixture(`win-unpacked/${name}`);
      await sign({ path: file, hash: 'sha256' });
      expect(execute.mock.calls[0][0]).not.toBe('powershell.exe');
    },
  );
});
