---
id: cc-connect-runtime-validation
title: cc-connect Runtime Validation
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - fast
  - comms
requiredTests:
  - pnpm run verify:runtime-bundles
  - pnpm run test:e2e:cc-connect
---

cc-connect runtime work must validate both mocked integration behavior and real bundled runtime startup.

Rules:

- Unit tests must cover provider profile conversion, capability fallback, bridge adapter behavior, and packaging path resolution.
- E2E tests must cover chat delivery through cc-connect BridgePlatform with mock binaries.
- In cc-connect runtime mode, ClawX must not invoke Codex directly or read Codex transcript/runtime state files directly. Codex executable path, `CODEX_HOME`, and provider profile materialization are allowed only as cc-connect launch/config inputs.
- Models token usage in cc-connect mode must be sourced from cc-connect-owned session stores or APIs, not from Codex transcript/runtime state files.
- E2E tests must cover real `build/cc-connect/<platform>-<arch>/cc-connect` and `build/codex/<platform>-<arch>/bin/codex` startup without replacing them with mock binaries.
- Real OpenAI/Codex OAuth chat must be available as an explicit opt-in E2E path gated by `CLAWX_REAL_OAUTH_E2E=1` and a caller-supplied isolated userData/CODEX_HOME.
- Real OAuth E2E must not copy tokens from user `~/.codex`, must not commit generated auth files, and must assert that public provider profiles do not contain token material.
- Runtime bundle verification must run after bundling cc-connect/Codex and before claiming local dev or packaged runtime validation.
- Runtime capability claims must distinguish top-level availability from unsupported sub-operations. A cc-connect capability group must not be treated as full OpenClaw parity while RPCs such as chat abort, doctor fix, channel connect/disconnect/delete, or cron toggle remain unsupported.
- Architecture docs or task specs must record any real-runtime gaps still covered only by mocks, especially sessions/history reload, cron Management API field mapping, channel lifecycle, generated artifact delivery, process cleanup, packaged app resources, and in-app Codex OAuth lifecycle.
