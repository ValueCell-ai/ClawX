---
id: refine-add-model-service
title: Keep model service configuration distinct and actionable
scenario: gateway-backend-communication
scenarios:
  - chat-workspace-and-navigation
taskType: runtime-bridge
intent: Make service drafts, validation, connection presets and OAuth state explicit while keeping the existing typed credential paths.
touchedAreas:
  - src/components/settings/**
  - src/components/ui/config-dialog-content.tsx
  - src/lib/providers.ts
  - shared/i18n/locales/*/settings.json
  - shared/host-api/contract.ts
  - electron/services/providers-api.ts
  - electron/utils/*oauth.ts
  - tests/**
  - harness/specs/tasks/refine-add-model-service.md
  - harness/specs/rules/models-configuration-experience.md
  - README*.md
expectedUserBehavior:
  - Choose a service or regional endpoint on the left and configure it on the right in one bounded dialog.
  - Switching authentication in the same service preserves its input, while changing services starts from that service's defaults.
  - Missing or invalid fields receive inline feedback before validation or creation requests.
  - The shared footer shows the next OAuth action, and OAuth saves the submitted model ID.
  - General API and Code Plan keep separate URL and model drafts and show one relevant documentation link.
  - Connection fields use consistent labels, and optional Ollama credentials appear below its connection settings.
requiredProfiles:
  - fast
  - comms
  - e2e
requiredRules:
  - models-configuration-experience
  - renderer-main-boundary
  - backend-communication-boundary
  - ui-i18n-design-tokens
  - docs-sync
requiredTests:
  - tests/e2e/provider-lifecycle.spec.ts
  - tests/e2e/models-layout.spec.ts
  - tests/unit/browser-oauth.test.ts
  - tests/unit/device-oauth.test.ts
acceptance:
  - Switching services and authentication keeps the dialog and footer actions in place.
  - Keys, protocols and reveal states cannot carry across service selections.
  - Authorization locks the chosen method and keeps cancel reachable while the flow is pending.
  - Public form fields retain position when switching idle authentication modes.
  - API-key validation and OAuth persistence continue through the existing Main-owned Host API.
docs:
  required: true
---
