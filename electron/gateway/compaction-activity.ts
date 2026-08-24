import { GATEWAY_COMPACTION_RECOVERY_GRACE_MS } from './recovery-budget';

const COMPACTION_DIAGNOSTIC_PATTERN = /\[compaction-diag\]\s+(start|end)\b/;

/** Tracks the OpenClaw compaction lifecycle reported by the owned process. */
export class GatewayCompactionActivity {
  private active = false;
  private expiryTimer: NodeJS.Timeout | null = null;

  constructor(private readonly onChange: (active: boolean) => void) {}

  isActive(): boolean {
    return this.active;
  }

  recordStderrLine(line: string): void {
    const phase = COMPACTION_DIAGNOSTIC_PATTERN.exec(line)?.[1];
    if (phase === 'start') {
      this.setActive(true);
    } else if (phase === 'end') {
      this.setActive(false);
    }
  }

  reset(): void {
    this.setActive(false);
  }

  private setActive(active: boolean): void {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
    if (this.active === active) {
      if (active) this.scheduleExpiry();
      return;
    }

    this.active = active;
    if (active) this.scheduleExpiry();
    this.onChange(active);
  }

  private scheduleExpiry(): void {
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      this.setActive(false);
    }, GATEWAY_COMPACTION_RECOVERY_GRACE_MS);
  }
}
