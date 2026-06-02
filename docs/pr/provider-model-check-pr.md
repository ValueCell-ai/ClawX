# Add provider model-check support

## Summary

This PR adds a lightweight **model check** workflow to the Add/Edit Provider UI so users can verify whether a provider endpoint, API key, and model ID are actually usable **before saving**.

## Why

Today, adding or editing a provider often requires trial-and-error:

- users may save an invalid model ID
- users may save a bad API key
- users may save an unreachable / misconfigured endpoint
- the actual failure is only discovered later when the provider is used

This change adds an explicit pre-save validation step that performs a real request and reports a clear result.

## What changed

### UI

- Added a **"检测模型" / model-check** action in both:
  - Add Provider dialog
  - Edit Provider panel
- Added inline feedback text for:
  - success
  - degraded / slow response
  - model not found
  - auth failure
  - timeout
  - unsupported protocol

### Frontend

- Added `src/lib/provider-model-check.ts`
- Wired `ProvidersSettings.tsx` to call the new API and surface results in the UI

### Backend

- Added `/api/provider-model-check`
- Added `electron/services/providers/provider-model-check.ts`
- The backend performs a real streaming request and treats the first returned chunk as proof that the model is usable

### Supported protocol paths

- `openai-completions`
- `openai-responses`
- `anthropic-messages`

## Validation behavior

The check intentionally stays lightweight:

- uses a tiny prompt (`Hi`)
- uses small token limits
- uses streaming mode
- considers the request successful once the first response chunk arrives

This makes the check fast while still proving that:

- the endpoint is reachable
- auth works
- the requested model exists / is accepted

## Verification

Validated locally on a clean upstream-based working tree with only the minimal feature patch applied.

Commands used:

```bash
pnpm run ext:bridge
pnpm exec tsc --noEmit
pnpm exec vite build
```

All passed successfully.

## Screenshot

A local verification screenshot is included in this branch:

- `docs/pr/provider-model-check-test.png`

It shows the provider settings UI with the model-check entry point and successful validation state used during testing.

## Scope / non-goals

This PR intentionally avoids unrelated customization:

- no branding changes
- no provider list policy changes
- no advanced-settings refactor
- no packaging / release pipeline changes

The goal is to keep this patch reviewable and upstream-friendly.
