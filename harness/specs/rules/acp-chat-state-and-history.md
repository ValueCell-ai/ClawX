---
id: acp-chat-state-and-history
title: ACP Chat State And History Authority
type: ai-coding-rule
appliesTo:
  - acp-chat-experience
  - acp-file-activity
  - gateway-backend-communication
---

Main owns ACP process, SDK, routing lifecycle, and serialization of operations on the shared ACP connection; Renderer owns semantic reduction into an in-memory timeline. Notifications emitted during `session/load` are returned as one generation-scoped raw batch and reduced in one Renderer state commit. Renderer may temporarily buffer matching host events during the IPC result handoff, while ordinary live prompt updates continue through host events. A pending prompt may retain a bounded Main routing context and Renderer timeline snapshot so navigation cannot drop its stream; those contexts must be keyed by session and generation, remain memory-only, and be released when the prompt settles. Permission requests are interactive only for an active prompt. Stale session generations are ignored, and ClawX does not persist a second ACP ledger or reduced Chat history.

ACP replay is the primary history authority. The only approved transcript supplements are best-effort recovery of asynchronous image-generation completions with proven `image_generate` context and recovery of explicit line-leading assistant OpenClaw `MEDIA:` attachment directives omitted by ACP. The general attachment exception does not require image-generation context, but it recovers only attachment references. Both exceptions remain marked and in memory; do not generalize them to bare paths, surrounding transcript prose, ordinary messages, tool cards, plans, permissions, thoughts, file activity, or any parallel history.

The shared historical transcript read is limited to the newest `1000` messages. A successful live prompt reads immediately and retries exactly once after `1500 ms`. General attachment alignment treats that history as a suffix and matches the binary-free OpenClaw prompt-text projection of structured ACP user blocks by duplicate occurrence from the tail; it must not parse or globally remove user-authored resource marker text. Attachment-only empty projections remain eligible, and live alignment also requires the current optimistic user identity. Every asynchronous result must retain the same active session, generation, supplement operation and attempt, and live turn where applicable. Unmatched, ambiguous, superseded, or stale work cannot mutate the timeline.
