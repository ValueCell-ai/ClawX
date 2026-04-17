/**
 * Multi-agent routing helpers.
 *
 * ClawX uses a "primary + attached follow-up agents" model:
 * the current chat session remains the primary streamed conversation, and any
 * attached agents are invoked afterward in their own linked session keys. Their
 * final replies are then mirrored back into the primary chat for display.
 */
export function normalizeAgentId(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase() || 'main';
}

export function getAgentIdFromSessionKey(sessionKey: string): string {
  if (!sessionKey.startsWith('agent:')) return 'main';
  const [, agentId] = sessionKey.split(':');
  return normalizeAgentId(agentId);
}

function hashText(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return Math.abs(hash >>> 0).toString(36);
}

export function buildAttachedAgentSessionKey(anchorSessionKey: string, agentId: string): string {
  return `agent:${normalizeAgentId(agentId)}:attached-${hashText(anchorSessionKey)}`;
}

export function buildMainAgentSessionKey(agentId: string): string {
  return `agent:${normalizeAgentId(agentId)}:main`;
}

export function getAttachedAgentIds(
  currentAgentId: string,
  attachedAgentIds: string[] | undefined,
): string[] {
  const normalizedCurrent = normalizeAgentId(currentAgentId);
  return Array.from(
    new Set((attachedAgentIds ?? []).map((agentId) => normalizeAgentId(agentId))),
  ).filter((agentId) => agentId !== normalizedCurrent);
}
