---
id: provider-default-invariant
title: Provider Default Invariant
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - fast
  - comms
---

Provider account deletion must keep the ClawX account store and OpenClaw runtime default model aligned.

Rules:

- when deleting the current default and at least one provider account remains, exactly one remaining account must be selected as the default
- deleting the current default account must select a remaining enabled account before any disabled account
- replacement selection must be deterministic, preferring the most recently updated account within the same enabled state
- deleting a non-default account must not change the current default
- deleting the last account may leave the default account and OpenClaw default model unset
- replacement defaults must be persisted through the provider service and synchronized to OpenClaw before the deleted provider runtime config is removed
- tests must cover deleting the default account, a non-default account, and the last account
