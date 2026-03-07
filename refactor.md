# Refactor Summary

## Scope
This branch captures local refactors focused on frontend UX polish, IPC call consolidation, transport abstraction, and channel page responsiveness.

## Key Changes

### 1. Frontend IPC consolidation
- Replaced scattered direct `window.electron.ipcRenderer.invoke(...)` calls with unified `invokeIpc(...)` usage.
- Added lint guard to prevent new direct renderer IPC invokes outside the API layer.
- Introduced a centralized API client with:
  - error normalization (`AppError`)
  - unified `app:request` support + compatibility fallback
  - retry helper for timeout/network errors

### 2. Transport abstraction (extensible protocol layer)
- Added transport routing abstraction inside `src/lib/api-client.ts`:
  - `ipc`, `ws`, `http`
  - rule-based channel routing
  - transport registration/unregistration
  - failure backoff and fallback behavior
- Added default transport initialization in app entry.
- Added gateway-specific transport adapters for WS/HTTP.

### 3. HTTP path moved to Electron main-process proxy
- Added `gateway:httpProxy` IPC handler in main process to avoid renderer-side CORS issues.
- Preload allowlist updated for `gateway:httpProxy`.
- Gateway HTTP transport now uses IPC proxy instead of browser `fetch` direct-to-gateway.

### 4. Settings improvements (Developer-focused transport control)
- Added persisted setting `gatewayTransportPreference`.
- Added runtime application of transport preference in app bootstrap.
- Added UI option (Developer section) to choose routing strategy:
  - WS First / HTTP First / WS Only / HTTP Only / IPC Only
- Added i18n strings for EN/ZH/JA.

### 5. Channel page performance optimization
- `fetchChannels` now supports options:
  - `probe` (manual refresh can force probe)
  - `silent` (background refresh without full-page loading lock)
- Channel status event refresh now debounced (300ms) to reduce refresh storms.
- Initial loading spinner only shown when no existing data.
- Manual refresh uses local spinner state and non-blocking update.

### 6. UX and component enhancements
- Added shared feedback state component for consistent empty/loading/error states.
- Added telemetry helpers and quick-action/dashboard refinements.
- Setup/settings/providers/chat/skills/cron pages received targeted UX and reliability fixes.

### 7. IPC main handler compatibility improvements
- Expanded `app:request` coverage for provider/update/settings/cron/usage actions.
- Unsupported app requests now return structured error response instead of throwing, reducing noisy handler exceptions.

### 8. Tests
- Added unit tests for API client behavior and feedback state rendering.
- Added transport fallback/backoff coverage in API client tests.

## Files Added
- `src/lib/api-client.ts`
- `src/lib/telemetry.ts`
- `src/components/common/FeedbackState.tsx`
- `tests/unit/api-client.test.ts`
- `tests/unit/feedback-state.test.tsx`
- `refactor.md`

## Notes
- Navigation order in sidebar is kept aligned with `main` ordering.
- This commit snapshots current local refactor state for follow-up cleanup/cherry-pick work.

## Incremental Updates (2026-03-08)

### 9. Channel i18n fixes
- Added missing `channels` locale keys in EN/ZH/JA to prevent raw key fallback:
  - `configured`, `configuredDesc`, `configuredBadge`, `deleteConfirm`
- Fixed confirm dialog namespace usage on Channels page:
  - `common:actions.confirm`, `common:actions.delete`, `common:actions.cancel`

### 10. Channel save/delete behavior aligned to reload-first strategy
- Added Gateway reload capability in `GatewayManager`:
  - `reload()` (SIGUSR1 on macOS/Linux, restart fallback on failure/unsupported platforms)
  - `debouncedReload()` for coalesced config-change reloads
- Wired channel config operations to reload pipeline:
  - `channel:saveConfig`
  - `channel:deleteConfig`
  - `channel:setEnabled`
- Removed redundant renderer-side forced restart call after WhatsApp configuration.

### 11. OpenClaw config compatibility for graceful reload
- Ensured `commands.restart = true` is persisted in OpenClaw config write paths:
  - `electron/utils/channel-config.ts`
  - `electron/utils/openclaw-auth.ts`
- Added sanitize fallback that auto-enables `commands.restart` before Gateway start.

### 12. Channels page data consistency fixes
- Unified configured state derivation so the following sections share one source:
  - stats cards
  - configured channels list
  - available channel configured badge
- Fixed post-delete refresh by explicitly refetching both:
  - configured channel types
  - channel status list

### 13. Channels UX resilience during Gateway restart/reconnect
- Added delayed gateway warning display to reduce transient false alarms.
- Added "running snapshot" rendering strategy:
  - keep previous channels/configured view during `starting/reconnecting` when live response is temporarily empty
  - avoids UI flashing to zero counts / empty configured state
- Added automatic refresh once Gateway transitions back to `running`.

### 14. Channel enable/disable UX rollback
- Rolled back renderer-side channel enable/disable controls due to multi-channel state mixing risk.
- Removed channel-card toggle entry point and setup-dialog enable switch.
- Restored stable channel configuration flow (save/delete + refresh consistency).

### 15. Cron i18n completion and consistency
- Replaced remaining hardcoded Cron UI strings with i18n keys:
  - dialog actions (`Cancel`, `Saving...`)
  - card actions (`Edit`, `Delete`)
  - trigger failure message
  - confirm dialog namespace usage (`common:actions.*`)
- Refactored cron schedule display parser to return localized strings instead of hardcoded English.
- Added new locale keys in EN/ZH/JA:
  - `toast.failedTrigger`
  - `schedule.everySeconds/everyMinutes/everyHours/everyDays/onceAt/weeklyAt/monthlyAtDay/dailyAt/unknown`

### 16. Gateway log noise reduction
- Added stderr classification downgrade for expected loopback websocket transient logs:
  - `[ws] handshake timeout ... remote=127.0.0.1`
  - `[ws] closed before connect ... remote=127.0.0.1`
- These lines now log at debug level instead of warn during reload/reconnect windows.

### 17. External gateway shutdown compatibility
- Added capability cache for externally managed Gateway shutdown RPC.
- If `shutdown` is unsupported (`unknown method: shutdown`), mark it unsupported and skip future shutdown RPC attempts to avoid repeated warnings.

### 18. Chat history sidebar grouping (ChatGPT-style buckets)
- Updated chat session history display in sidebar to time buckets:
  - Today / Yesterday / Within 1 Week / Within 2 Weeks / Within 1 Month / Older than 1 Month
- Added `historyBuckets` locale keys in EN/ZH/JA (`chat` namespace).
- Fixed i18n namespace usage for bucket labels in sidebar:
  - explicitly resolves via `chat:historyBuckets.*` to avoid raw key fallback.
- Removed forced uppercase rendering for bucket headers to preserve localized casing.
- Grouping now applies to all sessions (including `:main`) for consistent bucket visibility and behavior.
