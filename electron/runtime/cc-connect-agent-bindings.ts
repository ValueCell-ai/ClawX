import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { app } from 'electron';
import { getClawXDataLayout, resolveClawXDataRoot } from '../utils/clawx-data-layout';

export type CcConnectPermissionMode = 'suggest' | 'full-auto';

type AgentBinding = {
  providerAccountId?: string;
  permissionMode?: CcConnectPermissionMode;
  updatedAt: string;
};

type AgentBindingDocument = {
  schema: 'clawx-agent-bindings';
  version: 1;
  agents: Record<string, AgentBinding>;
};

function bindingsPath(): string {
  const layout = getClawXDataLayout(resolveClawXDataRoot(process.env, app.getPath('userData')));
  return join(layout.appDir, 'agent-bindings.json');
}

async function readDocument(): Promise<AgentBindingDocument> {
  try {
    const parsed = JSON.parse(await readFile(bindingsPath(), 'utf8')) as Partial<AgentBindingDocument>;
    if (parsed.schema === 'clawx-agent-bindings' && parsed.version === 1 && parsed.agents) {
      return parsed as AgentBindingDocument;
    }
  } catch {
    // Missing or malformed bindings start empty and are replaced atomically on write.
  }
  return { schema: 'clawx-agent-bindings', version: 1, agents: {} };
}

async function writeDocument(document: AgentBindingDocument): Promise<void> {
  const path = bindingsPath();
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(document, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temporaryPath, path);
}

export async function listCcConnectAgentProviderBindings(): Promise<Record<string, string>> {
  const document = await readDocument();
  return Object.fromEntries(Object.entries(document.agents).flatMap(([agentId, binding]) => (
    binding.providerAccountId ? [[agentId, binding.providerAccountId]] : []
  )));
}

export async function listCcConnectAgentPermissionModes(): Promise<Record<string, CcConnectPermissionMode>> {
  const document = await readDocument();
  return Object.fromEntries(Object.entries(document.agents).flatMap(([agentId, binding]) => (
    binding.permissionMode === 'suggest' || binding.permissionMode === 'full-auto'
      ? [[agentId, binding.permissionMode]]
      : []
  )));
}

export async function setCcConnectAgentProviderBinding(
  agentId: string,
  providerAccountId: string | null,
): Promise<void> {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) throw new Error('agentId is required');
  const document = await readDocument();
  const normalizedAccountId = providerAccountId?.trim();
  if (normalizedAccountId) {
    document.agents[normalizedAgentId] = {
      ...document.agents[normalizedAgentId],
      providerAccountId: normalizedAccountId,
      updatedAt: new Date().toISOString(),
    };
  } else {
    const existing = document.agents[normalizedAgentId];
    if (existing?.permissionMode) {
      document.agents[normalizedAgentId] = {
        permissionMode: existing.permissionMode,
        updatedAt: new Date().toISOString(),
      };
    } else {
      delete document.agents[normalizedAgentId];
    }
  }
  await writeDocument(document);
}

export async function setCcConnectAgentPermissionMode(
  agentId: string,
  permissionMode: CcConnectPermissionMode,
): Promise<void> {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) throw new Error('agentId is required');
  if (permissionMode !== 'suggest' && permissionMode !== 'full-auto') {
    throw new Error('permissionMode must be suggest or full-auto');
  }
  const document = await readDocument();
  document.agents[normalizedAgentId] = {
    ...document.agents[normalizedAgentId],
    permissionMode,
    updatedAt: new Date().toISOString(),
  };
  await writeDocument(document);
}

export async function deleteCcConnectAgentBinding(agentId: string): Promise<void> {
  const normalizedAgentId = agentId.trim();
  if (!normalizedAgentId) return;
  const document = await readDocument();
  if (!(normalizedAgentId in document.agents)) return;
  delete document.agents[normalizedAgentId];
  await writeDocument(document);
}
