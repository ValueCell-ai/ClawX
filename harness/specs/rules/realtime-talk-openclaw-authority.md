---
id: realtime-talk-openclaw-authority
title: Realtime Talk OpenClaw Authority
type: ai-coding-rule
appliesTo:
  - realtime-talk
  - gateway-backend-communication
  - acp-chat-experience
requiredProfiles:
  - comms
---

Talk supports only OpenClaw Gateway Relay. Electron Main owns every provider-facing Gateway RPC, typed `talk.event` routing, relay identity validation, and the single global relay lifecycle. Renderer uses the typed Host API and host events only; it must not open a Gateway HTTP, WebSocket, provider WebSocket, WebRTC, or other direct provider path.

Direct Talk text and audio are transient Renderer state. Do not create a ClawX transcript ledger, sidecar, cache, persistence key, direct transcript-file write, synthetic ACP entry, or custom durable timeline projection. OpenClaw and ACP own durable Agent-consult history: a consult uses OpenClaw's existing path and is visible only through normal ACP replay.

Talk configuration is Main-owned and catalog-validated. Basic Settings may select only the configured realtime provider, model, speaker voice, and readiness state through the existing OpenClaw configuration transaction. It must not expose or persist provider secrets, transports, VAD controls, recordings, video, dictation, or a transport picker.
