---
id: tokendance-oauth-provider
title: TokenDance OAuth Provider
type: ai-coding-rule
appliesTo:
  - gateway-backend-communication
requiredProfiles:
  - fast
  - comms
---

TokenDance desktop authorization provisions an API key through Authorization Code plus S256 PKCE; it does not produce a renewable OAuth token. Keep the verifier in Electron Main, use a random `127.0.0.1` loopback callback, validate the callback flow identifier, exchange the code within ten minutes, and persist only the returned key through the API-key secret path.

Use `https://clawx.com.cn` as the stable ClawX attribution URL in both OAuth `app_url` and every TokenDance model request's `X-App-URL` header. The runtime provider uses `https://tokendance.space/gateway/v1` with `openai-completions`. Do not expose the authorization code, verifier, or API key to Renderer state, URLs beyond the one-time callback code, logs, or checked-in configuration.

Only recognize the documented `TokenDance-Recovery-Action` values: `top_up_balance`, `reauthorize_api_key`, and `api_key_quota`. Main-owned validation returns this value as typed data. The pinned OpenClaw runtime may preserve a recognized response header as a non-secret marker in provider error text so Renderer can replace it with localized guidance; unknown or absent values retain normal provider error behavior. Recovery guidance must be localized in all supported locales.

TokenDance discovery is available only when the ClawX interface language resolves to Chinese. English, Japanese, Russian, and unsupported fallback locales must not show TokenDance in the add-provider catalog. This presentation gate must remain declarative and reactive to language changes; it must not delete, disable, or hide an already configured TokenDance account, because users still need to manage that account and receive localized recovery guidance after switching languages.
