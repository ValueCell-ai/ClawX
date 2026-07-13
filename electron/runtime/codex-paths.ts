import { app } from 'electron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type CodexBundle = {
  baseDir: string;
  binaryPath: string;
  pathDir: string;
  targetTriple: string;
};

function codexBinaryName(): string {
  return process.platform === 'win32' ? 'codex.exe' : 'codex';
}

function codexTargetTriple(platform = process.platform, arch = process.arch): string {
  if (platform === 'darwin' && arch === 'x64') return 'x86_64-apple-darwin';
  if (platform === 'darwin' && arch === 'arm64') return 'aarch64-apple-darwin';
  if (platform === 'linux' && arch === 'x64') return 'x86_64-unknown-linux-musl';
  if (platform === 'linux' && arch === 'arm64') return 'aarch64-unknown-linux-musl';
  if (platform === 'win32' && arch === 'x64') return 'x86_64-pc-windows-msvc';
  if (platform === 'win32' && arch === 'arm64') return 'aarch64-pc-windows-msvc';
  throw new Error(`Unsupported Codex target: ${platform}-${arch}`);
}

function baseDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'codex');
  }
  if (process.env.CLAWX_CODEX_PATH) {
    return dirname(dirname(process.env.CLAWX_CODEX_PATH));
  }
  return join(process.cwd(), 'build', 'codex', `${process.platform}-${process.arch}`);
}

export function getCodexBundle(): CodexBundle {
  const base = baseDir();
  return {
    baseDir: base,
    binaryPath: join(base, 'bin', codexBinaryName()),
    pathDir: join(base, 'codex-path'),
    targetTriple: codexTargetTriple(),
  };
}

export function assertCodexBundle(candidate = getCodexBundle()): CodexBundle {
  if (!existsSync(candidate.binaryPath)) {
    throw new Error(
      `Codex binary not found at ${candidate.binaryPath}. Run pnpm run bundle:codex:current before selecting cc-connect runtime.`,
    );
  }
  return candidate;
}

export function prependCodexPathDir(env: NodeJS.ProcessEnv, bundle = getCodexBundle()): NodeJS.ProcessEnv {
  if (!existsSync(bundle.pathDir)) return env;
  const delimiter = process.platform === 'win32' ? ';' : ':';
  return {
    ...env,
    PATH: [bundle.pathDir, env.PATH || ''].filter(Boolean).join(delimiter),
  };
}
