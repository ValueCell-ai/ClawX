import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, appendFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { RawMessage } from '@shared/chat/types';
import type { RuntimeSendWithMediaPayload } from './types';
import type { CodexProviderProfile } from './cc-connect-provider-profile';
import { assertCodexBundle, getCodexBundle, prependCodexPathDir, type CodexBundle } from './codex-paths';

type CodexBridgeOptions = {
  codexPath?: string;
  sessionsDir: string;
  workDir?: string;
  mode?: 'suggest' | 'auto-edit' | 'full-auto' | 'yolo';
  proxyEnvProvider?: () => Record<string, string> | Promise<Record<string, string>>;
  codexBundle?: CodexBundle;
};

export type CodexBridgeSendResult = {
  runId: string;
  assistantMessage: RawMessage;
};

type SessionMetadata = {
  key: string;
  displayName?: string;
  createdAt: number;
  updatedAt: number;
};

type TranscriptLine = {
  type: 'message';
  message: RawMessage;
};

const MAX_HISTORY_MESSAGES_IN_PROMPT = 16;
const MAX_PROMPT_CHARS = 80_000;

function safeSessionFileName(sessionKey: string): string {
  return `${createHash('sha256').update(sessionKey).digest('hex')}.jsonl`;
}

function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .flatMap((block) => {
      if (!block || typeof block !== 'object') return [];
      const record = block as Record<string, unknown>;
      if (typeof record.text === 'string') return [record.text];
      if (typeof record.thinking === 'string') return [record.thinking];
      return [];
    })
    .join('\n')
    .trim();
}

function normalizeTimestamp(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return value < 1e12 ? value * 1000 : value;
}

function buildPrompt(previousMessages: RawMessage[], nextMessage: string): string {
  const visibleHistory = previousMessages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .slice(-MAX_HISTORY_MESSAGES_IN_PROMPT)
    .map((message) => {
      const role = message.role === 'assistant' ? 'Assistant' : 'User';
      const text = messageText(message.content);
      return text ? `${role}: ${text}` : '';
    })
    .filter(Boolean)
    .join('\n\n');

  const prompt = visibleHistory
    ? [
        'Continue the existing ClawX GUI conversation. Use the prior messages as context.',
        '',
        visibleHistory,
        '',
        `User: ${nextMessage}`,
      ].join('\n')
    : nextMessage;

  if (prompt.length <= MAX_PROMPT_CHARS) return prompt;
  return prompt.slice(prompt.length - MAX_PROMPT_CHARS);
}

function appendMediaReferences(message: string, media: RuntimeSendWithMediaPayload['media'] | undefined): string {
  if (!media || media.length === 0) return message;
  const refs = media
    .map((item) => `[media attached: ${item.filePath} (${item.mimeType}) | ${item.fileName}]`)
    .join('\n');
  return message ? `${message}\n\n${refs}` : refs;
}

function extractTextFromCodexEvent(event: unknown): string {
  if (!event || typeof event !== 'object') return '';
  const record = event as Record<string, unknown>;

  const directText = record.text ?? record.delta;
  if (typeof directText === 'string' && directText.trim()) return directText;

  const item = record.item;
  if (item && typeof item === 'object') {
    const itemRecord = item as Record<string, unknown>;
    if (itemRecord.role === 'assistant') {
      const text = messageText(itemRecord.content);
      if (text) return text;
    }
  }

  const message = record.message;
  if (message && typeof message === 'object') {
    const messageRecord = message as Record<string, unknown>;
    if (messageRecord.role === 'assistant') {
      const text = messageText(messageRecord.content);
      if (text) return text;
    }
  }

  return '';
}

function codexModeArgs(mode: CodexBridgeOptions['mode']): string[] {
  switch (mode) {
    case 'yolo':
      return ['--dangerously-bypass-approvals-and-sandbox'];
    case 'suggest':
      return ['-c', 'approval_policy="never"', '--sandbox', 'read-only'];
    case 'auto-edit':
    case 'full-auto':
    default:
      return ['-c', 'approval_policy="never"', '--sandbox', 'workspace-write'];
  }
}

export class CodexCliBridge {
  private readonly codexPath: string;
  private readonly sessionsDir: string;
  private readonly workDir: string;
  private readonly mode: CodexBridgeOptions['mode'];
  private readonly proxyEnvProvider: NonNullable<CodexBridgeOptions['proxyEnvProvider']>;
  private readonly codexBundle: CodexBundle;
  private providerProfile: CodexProviderProfile | null = null;

  constructor(options: CodexBridgeOptions) {
    this.codexBundle = options.codexBundle ?? getCodexBundle();
    this.codexPath = options.codexPath || assertCodexBundle(this.codexBundle).binaryPath;
    this.sessionsDir = options.sessionsDir;
    this.workDir = options.workDir || process.env.CLAWX_CODEX_WORKDIR || process.cwd();
    this.mode = options.mode || 'full-auto';
    this.proxyEnvProvider = options.proxyEnvProvider ?? defaultProxyEnvProvider;
  }

  getSessionsDir(): string {
    return this.sessionsDir;
  }

  setProviderProfile(profile: CodexProviderProfile | null): void {
    this.providerProfile = profile;
  }

  async diagnose(): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
    return this.runProcess(['--version'], { captureStdout: true });
  }

  async send(payload: RuntimeSendWithMediaPayload): Promise<CodexBridgeSendResult> {
    if (!payload.sessionKey || typeof payload.sessionKey !== 'string') {
      throw new Error('Invalid Codex send payload: sessionKey is required');
    }
    if (!payload.idempotencyKey || typeof payload.idempotencyKey !== 'string') {
      throw new Error('Invalid Codex send payload: idempotencyKey is required');
    }
    if (typeof payload.message !== 'string') {
      throw new Error('Invalid Codex send payload: message is required');
    }
    if (this.providerProfile && !this.providerProfile.supported) {
      throw new Error(this.providerProfile.unsupportedReason || 'Selected provider is not supported by the cc-connect Codex runtime');
    }
    const sessionKey = payload.sessionKey;
    const runId = `codex-${randomUUID()}`;
    const startedAt = Date.now();
    const userMessage: RawMessage = {
      id: `${runId}:user`,
      role: 'user',
      content: payload.message,
      timestamp: startedAt,
      ...(payload.media && payload.media.length > 0
        ? {
            _attachedFiles: payload.media.map((item) => ({
              fileName: item.fileName,
              mimeType: item.mimeType,
              fileSize: 0,
              preview: null,
              filePath: item.filePath,
              source: 'user-upload' as const,
            })),
          }
        : {}),
    };
    const previousMessages = await this.readMessages(sessionKey);
    await this.appendMessage(sessionKey, userMessage);

    const prompt = buildPrompt(
      previousMessages,
      appendMediaReferences(payload.message, payload.media),
    );
    const outputFile = join(this.sessionsDir, `${runId}.last-message.txt`);
    const args = [
      'exec',
      '--json',
      '--ignore-user-config',
      '-C',
      this.workDir,
      '--output-last-message',
      outputFile,
      ...(this.providerProfile?.codexArgs ?? []),
      ...codexModeArgs(this.mode),
      prompt,
    ];

    const result = await this.runProcess(args, {
      captureStdout: true,
      env: this.providerProfile?.env,
    });
    let assistantText = '';
    if (existsSync(outputFile)) {
      assistantText = (await readFile(outputFile, 'utf8').catch(() => '')).trim();
      await rm(outputFile, { force: true }).catch(() => {});
    }
    if (!assistantText) {
      assistantText = this.extractLastAssistantText(result.stdout).trim();
    }
    if (!assistantText && result.stderr) {
      assistantText = result.stderr.trim();
    }
    if (!assistantText) assistantText = result.success ? '' : 'Codex did not return a response.';

    const assistantMessage: RawMessage = {
      id: `${runId}:assistant`,
      role: result.success ? 'assistant' : 'system',
      content: assistantText,
      timestamp: Date.now(),
      ...(result.success ? {} : { isError: true, errorMessage: result.error || result.stderr || 'Codex failed' }),
    };
    await this.appendMessage(sessionKey, assistantMessage);
    return { runId, assistantMessage };
  }

  async listSessions(): Promise<SessionMetadata[]> {
    await mkdir(this.sessionsDir, { recursive: true });
    const names = await readdir(this.sessionsDir).catch(() => []);
    const sessions: SessionMetadata[] = [];
    for (const name of names) {
      if (!name.endsWith('.jsonl')) continue;
      const messages = await this.readMessagesFromPath(join(this.sessionsDir, name));
      if (messages.length === 0) continue;
      const firstUser = messages.find((message) => message.role === 'user');
      const lastTimestamp = messages.reduce((latest, message) => {
        const ts = normalizeTimestamp(message.timestamp);
        return ts ? Math.max(latest, ts) : latest;
      }, 0);
      const sessionKey = await this.readSessionKeyFromPath(join(this.sessionsDir, name));
      if (!sessionKey) continue;
      sessions.push({
        key: sessionKey,
        displayName: messageText(firstUser?.content).slice(0, 80) || sessionKey,
        createdAt: normalizeTimestamp(messages[0]?.timestamp) ?? lastTimestamp,
        updatedAt: lastTimestamp,
      });
    }
    return sessions.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async loadHistory(sessionKey: string, limit = 200): Promise<RawMessage[]> {
    const messages = await this.readMessages(sessionKey);
    return messages.slice(-Math.max(1, Math.min(Math.floor(limit), 1000)));
  }

  async deleteSession(sessionKey: string): Promise<void> {
    await rm(this.transcriptPath(sessionKey), { force: true });
  }

  async summarizeSessions(sessionKeys: string[]): Promise<Array<{ sessionKey: string; firstUserText: string | null; lastTimestamp: number | null }>> {
    return Promise.all(sessionKeys.map(async (sessionKey) => {
      const messages = await this.readMessages(sessionKey);
      const firstUser = messages.find((message) => message.role === 'user');
      const lastTimestamp = messages.reduce<number | null>((latest, message) => {
        const ts = normalizeTimestamp(message.timestamp);
        if (!ts) return latest;
        return latest == null ? ts : Math.max(latest, ts);
      }, null);
      return {
        sessionKey,
        firstUserText: messageText(firstUser?.content) || null,
        lastTimestamp,
      };
    }));
  }

  private async appendMessage(sessionKey: string, message: RawMessage): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
    const line = JSON.stringify({ type: 'message', sessionKey, message }) + '\n';
    await appendFile(this.transcriptPath(sessionKey), line, 'utf8');
  }

  private async readMessages(sessionKey: string): Promise<RawMessage[]> {
    return this.readMessagesFromPath(this.transcriptPath(sessionKey));
  }

  private async readMessagesFromPath(path: string): Promise<RawMessage[]> {
    const raw = await readFile(path, 'utf8').catch(() => '');
    if (!raw.trim()) return [];
    return raw.split(/\r?\n/).flatMap((line): RawMessage[] => {
      if (!line.trim()) return [];
      try {
        const parsed = JSON.parse(line) as TranscriptLine;
        if (parsed?.type === 'message' && parsed.message && typeof parsed.message === 'object') {
          return [parsed.message];
        }
      } catch {
        return [];
      }
      return [];
    });
  }

  private async readSessionKeyFromPath(path: string): Promise<string | null> {
    const raw = await readFile(path, 'utf8').catch(() => '');
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as { sessionKey?: unknown };
        if (typeof parsed.sessionKey === 'string' && parsed.sessionKey) return parsed.sessionKey;
      } catch {
        return null;
      }
    }
    return null;
  }

  private transcriptPath(sessionKey: string): string {
    return join(this.sessionsDir, safeSessionFileName(sessionKey));
  }

  private extractLastAssistantText(stdout: string): string {
    let last = '';
    for (const line of stdout.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const text = extractTextFromCodexEvent(JSON.parse(line));
        if (text.trim()) last = text.trim();
      } catch {
        // Ignore non-JSON diagnostic lines.
      }
    }
    return last;
  }

  private async runProcess(
    args: string[],
    options: { captureStdout?: boolean; env?: Record<string, string> } = {},
  ): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
    await mkdir(this.sessionsDir, { recursive: true });
    const proxyEnv = await this.proxyEnvProvider();
    return new Promise((resolve) => {
      const baseEnv = prependCodexPathDir({
        ...process.env,
        ...proxyEnv,
        ...(options.env ?? {}),
      }, this.codexBundle);
      const child = spawn(this.codexPath, args, {
        cwd: this.workDir,
        env: baseEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (data) => {
        if (options.captureStdout) stdout += String(data);
      });
      child.stderr?.on('data', (data) => {
        stderr += String(data);
      });
      child.on('error', (error) => {
        resolve({
          success: false,
          stdout,
          stderr,
          error: error instanceof Error ? error.message : String(error),
        });
      });
      child.on('exit', (code) => {
        resolve({
          success: code === 0,
          stdout,
          stderr,
          ...(code === 0 ? {} : { error: `Codex exited with code ${code}` }),
        });
      });
    });
  }
}

async function defaultProxyEnvProvider(): Promise<Record<string, string>> {
  try {
    const [{ getAllSettings }, { buildProxyEnv }] = await Promise.all([
      import('@electron/utils/store'),
      import('@electron/utils/proxy'),
    ]);
    return buildProxyEnv(await getAllSettings());
  } catch {
    return {};
  }
}
