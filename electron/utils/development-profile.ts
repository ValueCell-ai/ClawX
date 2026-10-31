/** Validated paths for opt-in developer runtimes. Default launches are unchanged. */
import { lstatSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export interface DevelopmentProfile {
  name: 'legacy';
  root: string;
  stateDir: string;
  configPath: string;
  userDataDir: string;
  gatewayPort: number;
}

function contains(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function rejectSymlinkAncestors(path: string): void {
  for (let current = path; ; current = dirname(current)) {
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`Developer profile cannot use a symlink: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (dirname(current) === current) break;
  }
}

export function getDevelopmentProfile(env: NodeJS.ProcessEnv = process.env): DevelopmentProfile | null {
  if (!env.CLAWX_DEV_PROFILE?.trim()) return null;
  if (env.CLAWX_DEV_PROFILE !== 'legacy') throw new Error('Unknown ClawX development profile');
  const configured = env.CLAWX_DEV_PROFILE_ROOT?.trim();
  if (!configured || !isAbsolute(configured)) throw new Error('Legacy profile requires an absolute CLAWX_DEV_PROFILE_ROOT');
  const root = resolve(configured);
  for (const primary of [join(homedir(), '.openclaw'), join(homedir(), '.clawx')]) {
    if (contains(primary, root) || contains(root, primary)) throw new Error('Legacy profile must be separate from shared runtime data');
  }
  rejectSymlinkAncestors(root);
  const stateDir = join(root, 'openclaw');
  const userDataDir = join(root, 'clawx');
  const configPath = join(stateDir, 'openclaw.json');
  for (const [key, expected] of Object.entries({
    OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: configPath,
    CLAWX_USER_DATA_DIR: userDataDir, CLAWX_CONFIG_DIR: userDataDir,
  })) {
    if (env[key] !== expected) throw new Error(`Legacy profile requires ${key}=${expected}`);
    rejectSymlinkAncestors(expected);
  }
  if (env.CLAWX_PORT_OPENCLAW_GATEWAY !== '19789') throw new Error('Legacy profile requires its dedicated Gateway port');
  return { name: 'legacy', root, stateDir, configPath, userDataDir, gatewayPort: 19789 };
}
