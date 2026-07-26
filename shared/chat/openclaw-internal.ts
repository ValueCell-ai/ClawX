export const OPENCLAW_HEARTBEAT_POLL_SENTINEL = '[OpenClaw heartbeat poll]';
export const OPENCLAW_HEARTBEAT_ACK_SENTINEL = 'HEARTBEAT_OK';

export function containsOpenClawHeartbeatPollSentinel(value: string | null | undefined): boolean {
  return (value ?? '').includes(OPENCLAW_HEARTBEAT_POLL_SENTINEL);
}

export function isOpenClawHeartbeatPollText(value: string | null | undefined): boolean {
  return (value ?? '').trim() === OPENCLAW_HEARTBEAT_POLL_SENTINEL;
}

export function isOpenClawHeartbeatAckText(value: string | null | undefined): boolean {
  return (value ?? '').trim().toUpperCase() === OPENCLAW_HEARTBEAT_ACK_SENTINEL;
}
