// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extraLocalRealEnvFiles,
  loadLocalRealEnvFiles,
  parseLocalRealEnvFile,
} from '../e2e/helpers/local-real-env';
import {
  buildFeishuInboundMarkerArtifact,
  writeFeishuInboundMarkerArtifact,
} from '../e2e/helpers/feishu-inbound-marker';

describe('E2E local real env loader', () => {
  it('builds a sanitized Feishu inbound marker handoff artifact', () => {
    expect(buildFeishuInboundMarkerArtifact({
      marker: 'CLAWX_FEISHU_INBOUND_123',
      accountId: 'real_feishu_bot',
      domain: 'feishu',
      timeoutMs: 180_000,
      now: new Date('2026-06-28T00:00:00.000Z'),
    })).toEqual({
      createdAt: '2026-06-28T00:00:00.000Z',
      instruction: 'Send marker exactly as message text to the configured Feishu/Lark bot before timeout.',
      marker: 'CLAWX_FEISHU_INBOUND_123',
      accountId: 'real_feishu_bot',
      domain: 'feishu',
      timeoutMs: 180_000,
    });
  });

  it('writes the Feishu inbound marker artifact without credential fields', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawx-feishu-marker-'));
    try {
      const path = await writeFeishuInboundMarkerArtifact(root, {
        marker: 'CLAWX_FEISHU_INBOUND_456',
        accountId: 'real_feishu_bot',
        domain: 'lark',
        timeoutMs: 120_000,
      });
      const artifact = JSON.parse(await readFile(path, 'utf8'));
      expect(artifact).toMatchObject({
        marker: 'CLAWX_FEISHU_INBOUND_456',
        accountId: 'real_feishu_bot',
        domain: 'lark',
        timeoutMs: 120_000,
      });
      expect(Object.keys(artifact).sort()).toEqual([
        'accountId',
        'createdAt',
        'domain',
        'instruction',
        'marker',
        'timeoutMs',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('parses shell-style local env files used by cc-connect real smokes', () => {
    expect(parseLocalRealEnvFile([
      '# comment',
      'CLAWX_REAL_OPENAI_API_KEY="sk-e2e-placeholder"',
      "export CLAWX_REAL_FEISHU_APP_ID='app-id'",
      'INVALID-NAME=value',
      'EMPTY=',
    ].join('\n'))).toEqual({
      CLAWX_REAL_OPENAI_API_KEY: 'sk-e2e-placeholder',
      CLAWX_REAL_FEISHU_APP_ID: 'app-id',
      EMPTY: '',
    });
  });

  it('loads local env files without overriding explicit process env values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawx-e2e-env-'));
    const env: NodeJS.ProcessEnv = {
      CLAWX_REAL_OPENAI_API_KEY: 'already-set',
    };
    try {
      await writeFile(join(root, '.env.cc-connect.local'), [
        'CLAWX_REAL_OPENAI_API_KEY=from-file',
        'CLAWX_REAL_FEISHU_APP_ID=from-file-app',
      ].join('\n'), 'utf8');

      expect(loadLocalRealEnvFiles({ root, env })).toEqual([
        {
          name: '.env.cc-connect.local',
          loaded: true,
          variableNames: ['CLAWX_REAL_FEISHU_APP_ID', 'CLAWX_REAL_OPENAI_API_KEY'],
          safety: {
            location: 'outside-repo',
            gitignored: true,
            tracked: false,
            safe: true,
          },
        },
        {
          name: '.env.local',
          loaded: false,
          variableNames: [],
          safety: {
            location: 'outside-repo',
            gitignored: true,
            tracked: false,
            safe: true,
          },
        },
        {
          name: '.env',
          loaded: false,
          variableNames: [],
          safety: {
            location: 'outside-repo',
            gitignored: true,
            tracked: false,
            safe: true,
          },
        },
      ]);
      expect(env).toMatchObject({
        CLAWX_REAL_OPENAI_API_KEY: 'already-set',
        CLAWX_REAL_FEISHU_APP_ID: 'from-file-app',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resolves explicit direct E2E env files from environment variables', () => {
    expect(extraLocalRealEnvFiles({
      CLAWX_REAL_ENV_FILE: ' /tmp/one.env ',
      CLAWX_REAL_ENV_FILES: ` /tmp/two.env ${delimiter}/tmp/three.env `,
    })).toEqual([
      '/tmp/one.env',
      '/tmp/two.env',
      '/tmp/three.env',
    ]);

    expect(extraLocalRealEnvFiles({
      CLAWX_REAL_ENV_FILE: '/tmp/one.env',
      CLAWX_REAL_ENV_FILES: `${delimiter}/tmp/one.env${delimiter}`,
    })).toEqual(['/tmp/one.env']);
  });

  it('loads explicit outside-repo env files without exposing absolute paths in summaries', async () => {
    const first = await mkdtemp(join(tmpdir(), 'clawx-e2e-env-explicit-first-'));
    const second = await mkdtemp(join(tmpdir(), 'clawx-e2e-env-explicit-second-'));
    const env: NodeJS.ProcessEnv = {};
    try {
      const firstFile = join(first, 'real-one.env');
      const secondFile = join(second, 'real-two.env');
      await writeFile(firstFile, [
        'CLAWX_REAL_OPENAI_MODEL=gpt-first',
        'CLAWX_REAL_FEISHU_DOMAIN=feishu',
      ].join('\n'), 'utf8');
      await writeFile(secondFile, [
        'CLAWX_REAL_OPENAI_MODEL=gpt-second',
        'CLAWX_REAL_FEISHU_APP_ID=app-id',
      ].join('\n'), 'utf8');

      expect(loadLocalRealEnvFiles({ root: first, env, files: [firstFile, secondFile] })).toEqual([
        {
          name: 'real-one.env',
          loaded: true,
          variableNames: ['CLAWX_REAL_FEISHU_DOMAIN', 'CLAWX_REAL_OPENAI_MODEL'],
          safety: {
            location: 'outside-repo',
            gitignored: true,
            tracked: false,
            safe: true,
          },
        },
        {
          name: 'real-two.env',
          loaded: true,
          variableNames: ['CLAWX_REAL_FEISHU_APP_ID', 'CLAWX_REAL_OPENAI_MODEL'],
          safety: {
            location: 'outside-repo',
            gitignored: true,
            tracked: false,
            safe: true,
          },
        },
      ]);
      expect(env).toMatchObject({
        CLAWX_REAL_OPENAI_MODEL: 'gpt-first',
        CLAWX_REAL_FEISHU_DOMAIN: 'feishu',
        CLAWX_REAL_FEISHU_APP_ID: 'app-id',
      });
    } finally {
      await Promise.all([
        rm(first, { recursive: true, force: true }),
        rm(second, { recursive: true, force: true }),
      ]);
    }
  });

  it('loads repo-local env files only when they are gitignored and untracked', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawx-e2e-env-gitignored-'));
    const env: NodeJS.ProcessEnv = {};
    try {
      execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
      await writeFile(join(root, '.gitignore'), '.env.cc-connect.local\n', 'utf8');
      await writeFile(join(root, '.env.cc-connect.local'), 'CLAWX_REAL_FEISHU_APP_ID=app-id\n', 'utf8');

      expect(loadLocalRealEnvFiles({ root, env })).toEqual([
        {
          name: '.env.cc-connect.local',
          loaded: true,
          variableNames: ['CLAWX_REAL_FEISHU_APP_ID'],
          safety: {
            location: 'repo',
            gitignored: true,
            tracked: false,
            safe: true,
          },
        },
        {
          name: '.env.local',
          loaded: false,
          variableNames: [],
          safety: {
            location: 'repo',
            gitignored: false,
            tracked: false,
            safe: false,
          },
        },
        {
          name: '.env',
          loaded: false,
          variableNames: [],
          safety: {
            location: 'repo',
            gitignored: false,
            tracked: false,
            safe: false,
          },
        },
      ]);
      expect(env.CLAWX_REAL_FEISHU_APP_ID).toBe('app-id');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips repo-local env files that are not gitignored without parsing names or values', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawx-e2e-env-unignored-'));
    const env: NodeJS.ProcessEnv = {};
    try {
      execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
      await writeFile(join(root, '.env.cc-connect.local'), 'CLAWX_REAL_FEISHU_APP_ID=app-id\n', 'utf8');

      expect(loadLocalRealEnvFiles({ root, env })[0]).toEqual({
        name: '.env.cc-connect.local',
        loaded: false,
        variableNames: [],
        safety: {
          location: 'repo',
          gitignored: false,
          tracked: false,
          safe: false,
        },
        skippedReason: expect.stringContaining('untracked and gitignored'),
      });
      expect(env.CLAWX_REAL_FEISHU_APP_ID).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('skips repo-local env files that are tracked even when ignored later', async () => {
    const root = await mkdtemp(join(tmpdir(), 'clawx-e2e-env-tracked-'));
    const env: NodeJS.ProcessEnv = {};
    try {
      execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
      await writeFile(join(root, '.env.cc-connect.local'), 'CLAWX_REAL_FEISHU_APP_ID=app-id\n', 'utf8');
      execFileSync('git', ['add', '.env.cc-connect.local'], { cwd: root, stdio: 'ignore' });
      await writeFile(join(root, '.gitignore'), '.env.cc-connect.local\n', 'utf8');

      expect(loadLocalRealEnvFiles({ root, env })[0]).toEqual({
        name: '.env.cc-connect.local',
        loaded: false,
        variableNames: [],
        safety: {
          location: 'repo',
          gitignored: false,
          tracked: true,
          safe: false,
        },
        skippedReason: expect.stringContaining('untracked and gitignored'),
      });
      expect(env.CLAWX_REAL_FEISHU_APP_ID).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
