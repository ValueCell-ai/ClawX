---
id: acp-compatibility-content-safety
title: ACP Compatibility Content Safety
type: ai-coding-rule
appliesTo:
  - acp-chat-experience
  - gateway-backend-communication
---

Standard ACP content is authoritative and preferred. A compatibility supplement is allowed only when it is explicitly marked by source, retained in memory, backed by approved structured runtime evidence or explicit assistant transcript evidence, and accompanied by reason-coded diagnostics. Compatibility data must never be represented as a native ACP event.

Approved transcript evidence has three bounded forms: asynchronous image-generation completion with proven image-generation context, including explicit internal-UI `message` tool source replies; canonical persisted assistant `__openclaw.media` facts; and general attachment recovery from whole-line, line-leading assistant OpenClaw `MEDIA:` directives outside fenced code blocks. Canonical facts and directives accept only the documented local path, `file:`, execution-cwd-relative, HTTP, and HTTPS forms. Quoted directive references may contain spaces, while unquoted directives may not; canonical structured values may contain spaces. General recovery projects only ordered attachment references and declared media metadata, never surrounding transcript prose. A trusted image-generation source reply may provide user-facing completion or failure text. Reject malformed or wrapped directives, bare or inline prose paths without canonical media facts, unknown URI schemes, incidental tool paths, and unrelated assistant prose.

Compatibility logic must not reconstruct ordinary assistant messages, thoughts, tools, plans, permissions, file activity, or a parallel Chat history. User-side OpenClaw prompt projection may be reconstructed only from structured ACP content already present in the same timeline; generated-looking user prose is not evidence and must not be stripped or parsed. Unmatched or ambiguous evidence is skipped rather than attached by guesswork. Deduplication is turn-scoped and uses only a Main-authorized opaque identity; native ACP resource content wins over equivalent compatibility evidence, generated-image evidence remains inline, and an unavailable result does not block a later available upgrade.
