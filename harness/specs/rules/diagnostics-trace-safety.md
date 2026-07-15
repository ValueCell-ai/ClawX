---
id: diagnostics-trace-safety
title: Diagnostics Trace Safety
type: ai-coding-rule
appliesTo:
  - acp-chat-experience
  - gateway-backend-communication
---

ACP diagnostics are bounded, memory-only, and reason-coded. Trace records may contain bounded counts, source categories, session and generation routing data, operation outcomes, and hashed evidence or attachment identities.

Trace producers and storage sanitization must exclude transcript bodies, user or assistant message content, credentials, tokens, secrets, file contents, raw attachment references, and full or otherwise sensitive filesystem paths. Diagnostic failures remain best effort and must not expose sensitive payloads or change successful Chat behavior.
