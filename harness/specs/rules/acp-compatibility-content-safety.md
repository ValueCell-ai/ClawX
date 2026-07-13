---
id: acp-compatibility-content-safety
title: ACP Compatibility Content Safety
type: ai-coding-rule
appliesTo:
  - acp-chat-experience
  - gateway-backend-communication
---

Standard ACP content is authoritative and preferred. A compatibility supplement is allowed only when it is explicitly marked by source, retained in memory, backed by approved structured runtime evidence or explicit assistant transcript evidence, and accompanied by reason-coded diagnostics. Compatibility data must never be represented as a native ACP event.

Approved transcript evidence has two bounded forms: asynchronous image-generation completion with proven image-generation context, including explicit internal-UI `message` tool source replies; and general attachment recovery from line-leading assistant OpenClaw `MEDIA:` directives outside fenced code blocks. The general attachment form does not require image-generation context and projects only attachment references, never surrounding transcript prose. A trusted image-generation source reply may provide user-facing completion or failure text. Do not extract bare paths, inline prose paths, unknown URI schemes, incidental tool paths, or unrelated assistant prose as attachments or completion messages.

Compatibility logic must not reconstruct ordinary assistant messages, thoughts, tools, plans, permissions, file activity, or a parallel Chat history. Unmatched or ambiguous evidence is skipped rather than attached by guesswork, and native ACP resource content wins over equivalent compatibility evidence.
