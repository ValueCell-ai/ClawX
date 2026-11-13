---
id: fix-acp-multi-stage-duplicate-output
title: Reconcile multi-stage ACP terminal aggregates
scenario: gateway-backend-communication
taskType: runtime-bridge
intent: Reproduce and repair repeated assistant stories in a normal think, respond, inspect files and respond interaction, while preserving internal-input visibility and authoritative replay.
touchedAreas:
  - patches/openclaw@2026.10.10.patch
  - pnpm-lock.yaml
  - tests/unit/openclaw-acp-stream-patch.test.ts
  - tests/unit/openclaw-acp-offline-replay-runtime.test.ts
  - tests/unit/openclaw-acp-ambient-stream.test.ts
  - tests/unit/openclaw-acp-restart-runtime.test.ts
  - tests/unit/acp-chat-store.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
  - tests/e2e/fixtures/acp-native-replay.ts
  - harness/specs/tasks/fix-acp-multi-stage-duplicate-output.md
  - harness/specs/rules/acp-chat-state-and-history.md
  - harness/specs/scenarios/acp-chat-experience.md
  - harness/reference/acp-chat.md
  - README.md
  - README.zh-CN.md
  - README.ja-JP.md
  - tests/e2e/chat-acp-internal-replay.spec.ts
  - src/lib/acp/openclaw-media-compat.ts
  - src/lib/acp/image-generation-compat.ts
  - electron/services/sessions-api.ts
  - tests/unit/acp-media-attachments.test.ts
  - tests/unit/acp-image-generation-compat.test.ts
  - tests/unit/sessions-api-workspace.test.ts
  - harness/specs/tasks/fix-acp-internal-control-replay.md
  - harness/reference/acp-internal-control-replay.md
expectedUserBehavior:
  - A response before a tool call and a response after it each appear once in their original order.
  - Prompt settlement, session switches and window reload retain each story and tool result once.
  - Internal control inputs remain hidden and actual repeated user-authored content is not removed by a text-matching Renderer filter.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - backend-communication-boundary
  - renderer-main-boundary
  - acp-chat-state-and-history
  - acp-compatibility-content-safety
  - comms-regression
  - docs-sync
requiredTests:
  - tests/unit/openclaw-acp-stream-patch.test.ts
  - tests/unit/openclaw-acp-offline-replay-runtime.test.ts
  - tests/unit/openclaw-acp-ambient-stream.test.ts
  - tests/unit/openclaw-acp-restart-runtime.test.ts
  - tests/e2e/chat-acp-inline-timeline.spec.ts
acceptance:
  - Reproduce the user's exact Chinese prompt through Playwright MCP against the normal dev ClawX and compare raw live ACP, settled replay and native transcript evidence.
  - Identify whether this is introduced by the internal-input visibility change or an existing stream/replay defect before assigning causality.
  - Add a deterministic installed-runtime regression anchored in the observed producer events and exercise the same visible multi-stage behavior in Electron.
  - Respect native stream operations and scope deduplication to the producer/run/message identity; do not globally remove repeated assistant text.
  - Document that prefix reconciliation depends on accurately reconstructing the owning run's emitted prefix and is not a general replacement protocol or a repair for interior gaps, rewritten content or mismatched message scope.
  - Distinguish the negotiated ACP v1 append-only output from draft v2 message-ID replacement semantics; future wire changes require explicit negotiation and preserved producer message identities.
  - Retain successful existing internal-control, offline completion, compaction and restart recovery coverage.
docs:
  required: true
---

Reported prompt: 请先思考一会儿，然后讲一个 200 字的故事，然后看看当前目录有什么文件，然后再讲个 100 字的故事

The earlier internal-control demonstration exercised migrated history fallback;
this task additionally exercises ordinary live multi-stage turns and their
automatic settled replay. Read-only diagnostics may observe protocol/store
updates for the dedicated reproduction session, without changing their content.

The real-provider comparison reproduced terminal aggregate duplication on both
the reported commit and the unmodified origin/main runtime at d608f8af. Native
transcript records held each story once; the ACP live ledger appended the
Gateway's whole-run final snapshot after both message streams. This task repairs
that producer/consumer scope mismatch independently of the structured
internal-input visibility policy.

The compatibility fix and its verified cases do not establish universal
exactly-once output or authoritative final-snapshot correction. A model that
does not rewrite text can still produce a non-prefix comparison after incomplete
delivery or a mismatch in scope, segment boundaries or whitespace normalization.
The existing fallback can then repeat content. See
[reliability preconditions and limitations](../../reference/acp-chat.md#reliability-preconditions-and-limitations)
and the [replacement model](../../reference/acp-chat.md#replacement-model-and-removal-condition).

This follow-up clarifies the existing implementation and validation scope;
it changes no runtime behavior or user-facing interface and requires no README
translation changes.
