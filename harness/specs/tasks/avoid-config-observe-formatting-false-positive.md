---
id: avoid-config-observe-formatting-false-positive
title: Avoid config size-drop false positives after normalization
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Keep OpenClaw config observation from treating a formatting-only rewrite as a destructive size drop.
touchedAreas:
  - harness/specs/tasks/avoid-config-observe-formatting-false-positive.md
  - patches/openclaw@2026.7.1-2.patch
  - tests/unit/openclaw-config-observe-patch.test.ts
expectedUserBehavior:
  - Saving a valid configuration after formatting or JSON5 comments are normalized does not report a destructive size-drop anomaly.
  - A genuinely truncated configuration continues to report a size-drop anomaly.
requiredProfiles:
  - fast
  - comms
requiredRules:
  - openclaw-config-delivery
  - gateway-readiness-policy
  - backend-communication-boundary
  - comms-regression
requiredTests:
  - tests/unit/openclaw-config-observe-patch.test.ts
acceptance:
  - Config observation compares canonical JSON byte sizes when both the current config and the matching last-known-good backup can be parsed.
  - Whitespace and JSON5-comment removal alone does not emit size-drop-vs-last-good.
  - A genuinely truncated canonical config still emits size-drop-vs-last-good.
  - Existing raw byte counts remain available in config audit records.
docs:
  required: false
---

Patch the pinned OpenClaw runtime rather than adding a second ClawX config watcher.
