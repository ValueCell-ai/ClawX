---
id: capability-owner-resolution
title: Capability Owner Resolution
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
  - plugin-lifecycle-management
---

Plugin discovery may find multiple packages that declare the same capability. Resolution must choose the canonical owner before activation.

Rules:

- single-owner capabilities, including channel capabilities such as `feishu`, must resolve to at most one active owner
- discovery code must not treat a found package as automatically active
- bundled and external package ownership decisions must be explicit and covered by migration tests when changed
- losing owners must be removed, disabled, or marked inactive according to the runtime's loading behavior
- business configuration, such as channel account credentials and bindings, must be preserved while plugin ownership is migrated
