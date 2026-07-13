import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type FeishuInboundMarkerArtifact = {
  createdAt: string;
  instruction: string;
  marker: string;
  accountId: string;
  domain: string;
  timeoutMs: number;
};

export function buildFeishuInboundMarkerArtifact(details: {
  marker: string;
  accountId: string;
  domain: string;
  timeoutMs: number;
  now?: Date;
}): FeishuInboundMarkerArtifact {
  return {
    createdAt: (details.now ?? new Date()).toISOString(),
    instruction: 'Send marker exactly as message text to the configured Feishu/Lark bot before timeout.',
    marker: details.marker,
    accountId: details.accountId,
    domain: details.domain,
    timeoutMs: details.timeoutMs,
  };
}

export async function writeFeishuInboundMarkerArtifact(root: string, details: {
  marker: string;
  accountId: string;
  domain: string;
  timeoutMs: number;
}): Promise<string> {
  const artifactDir = join(root, 'artifacts', 'cc-connect');
  const artifactPath = join(artifactDir, 'feishu-inbound-marker.json');
  await mkdir(artifactDir, { recursive: true });
  await writeFile(artifactPath, `${JSON.stringify(buildFeishuInboundMarkerArtifact(details), null, 2)}\n`, 'utf8');
  return artifactPath;
}
