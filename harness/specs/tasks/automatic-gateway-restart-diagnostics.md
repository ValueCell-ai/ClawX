---
id: automatic-gateway-restart-diagnostics
title: Automatically capture actionable Gateway restart diagnostics in issue reports
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Diagnose slow Windows Gateway restarts and post-start unresponsiveness from the existing one-click issue report without asking users to run commands or enable debugging.
touchedAreas:
  - electron/gateway/manager.ts
  - electron/gateway/process-launcher.ts
  - electron/gateway/startup-stderr.ts
  - electron/gateway/process-diagnostics.ts
  - tests/unit/gateway-manager-diagnostics.test.ts
  - tests/unit/gateway-manager-restart-recovery.test.ts
  - tests/unit/gateway-startup-stderr.test.ts
  - tests/unit/gateway-process-launcher.test.ts
  - tests/unit/gateway-process-diagnostics.test.ts
  - harness/specs/tasks/automatic-gateway-restart-diagnostics.md
  - harness/specs/scenarios/gateway-startup-diagnostics.md
  - harness/specs/rules/gateway-diagnostic-logging.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
expectedUserBehavior:
  - Users export the existing issue report after a slow restart or unresponsive Gateway; no terminal commands or diagnostic switches are required.
  - Logs distinguish restart request, shutdown, spawn, handshake and actual agent readiness with one correlation identifier.
  - Automatic progress and missed-heartbeat snapshots provide resource and last-progress evidence even when the child no longer answers RPC.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - gateway-diagnostic-logging
  - backend-communication-boundary
  - gateway-readiness-policy
  - gateway-heartbeat-safety
  - docs-sync
requiredTests:
  - tests/unit/gateway-startup-stderr.test.ts
  - tests/unit/gateway-process-launcher.test.ts
  - tests/unit/gateway-process-diagnostics.test.ts
  - tests/unit/gateway-manager-diagnostics.test.ts
  - tests/unit/gateway-manager-restart-recovery.test.ts
  - tests/unit/gateway-ready-fallback.test.ts
  - tests/unit/issue-report-api.test.ts
acceptance:
  - Both stdout and stderr startup traces survive split UTF-8 chunks and unterminated final lines; line buffering is bounded.
  - Only normalized stage names and numeric trace values from stdout enter ClawX logs; arbitrary stdout is not copied.
  - Each accepted startup/restart has correlated lifecycle diagnostics including actual readiness after admission, and interrupted/failed attempts remain distinguishable.
  - Slow startup progress is sampled at most once every 30 seconds and stops on readiness, stop, failure or supersession.
  - Missed-heartbeat diagnostics record safe parent-observed CPU/memory metrics and liveness ages without sending additional Gateway RPCs or changing recovery policy.
  - Missing or failing platform metric APIs never fail Gateway startup or shutdown; unavailable measurements are not reported as zero.
  - Diagnostics exclude credentials, environment values, command lines, arbitrary RPC payloads and conversation content; data is included through the existing redacted ClawX log export.
  - Full request-to-ready timings and nested/parallel OpenClaw phase timings are clearly distinguished; no claim of CPU stacks, disk profiling or proven deadlock detection.
docs:
  required: true
references:
  - harness/specs/scenarios/gateway-startup-diagnostics.md
---

Regression evidence: the 2026-11-04 Windows report took about 195 seconds from
restart request to agent readiness. ClawX captured only stderr traces and omitted
the later stdout stages; handshake completion also preceded agent readiness.
Other attempts stopped responding after readiness. This is diagnostics-only:
do not alter readiness, shutdown budgets, retries, recovery or runtime data.

## Validation results

- Eight focused Gateway test files: 96 tests passed, including real manager
  admission polling with simulated process/socket events, process generation
  isolation, resource caching, output framing and privacy checks.
- Issue-report export: 9 tests passed; 2 existing symlink fixtures failed before
  exercising export because this Windows host refuses file symlink creation
  (`EPERM`). No export implementation or symlink policy was changed.
- TypeScript node/web checks, ESLint (0 errors, 7 existing renderer warnings),
  Vite/Electron compilation, communication replay and comparison passed.
- Task validation with `--since HEAD`, task dry-run and harness CI passed
  (22 baseline tests). The existing harness parser requires LF frontmatter;
  validation temporarily normalized local spec line endings, then restored
  unchanged files to their original checkout format. No parser change is part
  of this task.
- No packaged Windows/OpenClaw 2026.10.5 reproduction or performance improvement
  is claimed. Installed local OpenClaw dependencies still report 2026.7.1-2;
  target-runtime validation requires a rebuilt installation with matching deps.
