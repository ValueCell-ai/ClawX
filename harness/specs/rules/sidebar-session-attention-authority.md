---
id: sidebar-session-attention-authority
title: Sidebar Session Attention Authority
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
  - chat-workspace-and-navigation
---

Sidebar attention MUST derive only from normalized OpenClaw Gateway session rows in the existing Renderer catalog. Rows and attention MUST match by exact normalized catalog key; ACP prompt/timeline state, local sending state, and Gateway agent runtime events MUST NOT derive or override it. Run-scoped cron keys MUST NOT be folded into base-row attention while `sessions.list` cannot recover that relationship.

List rows and event patches MUST use the shared allowlisted normalizer. Event merge MUST preserve explicit `false`, clear optional fields only for explicit `null`, leave omitted fields unchanged, reject conflicting envelope/nested keys, and insert unknown rows only from reliable nested snapshots.

Run projection MUST apply terminal status before boolean `hasActiveRun`, then the `running` fallback, then unknown. Unknown MUST preserve attention. Unread MUST arise only from an observed exact-key busy-to-idle transition, never from `updatedAt`; entering busy MUST retain any older unread bit, with presentation ordered `busy > unread > timeago`.

Only exact-key observed-busy and unread presentation state MAY persist. Visibility MUST remain memory-only. A conversation is read only while its Chat view is visibly mounted or when its sidebar row is activated; retaining `currentSessionKey` on another route is not read authority.

Every ready Gateway epoch MUST call `sessions.subscribe` for `sessions.changed` and force canonical list hydration. List flights MUST buffer events, accept timestamp equality, reject strictly older epoch/per-key results, and preserve attention under unorderable or failed reconciliation until canonical recovery. Missing list rows MUST NOT prune attention. Exact deletion MUST clear attention and advance same-key label-hydration incarnation before recreation.

Algorithms, rationale, limitations, future Gateway-unread migration, and validation anchors are defined in `harness/reference/sidebar-session-attention.md`.
