export const SUPERVISED_SYSTEMD_ENV_KEYS = [
  'OPENCLAW_SYSTEMD_UNIT',
  'INVOCATION_ID',
  'SYSTEMD_EXEC_PID',
  'JOURNAL_STREAM',
] as const;

export type GatewayEnv = Record<string, string | undefined>;

/**
 * OpenClaw CLI treats certain environment variables as systemd supervisor hints.
 * When present in ClawX-owned child-process launches, it can mistakenly enter
 * a supervised process retry loop. Strip those variables so startup follows
 * ClawX lifecycle.
 */
export function stripSystemdSupervisorEnv(env: GatewayEnv): GatewayEnv {
  const next = { ...env };
  for (const key of SUPERVISED_SYSTEMD_ENV_KEYS) {
    delete next[key];
  }
  return next;
}
