---
id: comms-regression
title: Comms Regression
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - comms
---

Changes to gateway events, runtime send/receive, channel delivery, or fallback behavior must run `pnpm run comms:replay` and `pnpm run comms:compare`.
