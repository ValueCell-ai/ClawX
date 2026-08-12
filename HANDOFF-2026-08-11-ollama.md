# Handoff — ClawX gateway fix + Ollama context-overflow closeout (2026-08-11)

> **STATUS: CLOSED (2026-08-11, later session).** The gateway fix stands. The Ollama
> investigation is **closed as hardware-bound, not a software defect** — see §2, which has
> been rewritten. The original §2 root-cause theory ("provider never written to models.json")
> was **wrong**; it is preserved at the end of §2 only as a record of the misdiagnosis.
> The 66-failing-test blocker in §3 was **transient and is resolved** — the suite is green.
> **No further Ollama / LM Studio / local-agent work** until RAM is upgraded and/or the
> DRAM-cache SSDs are installed.

## TL;DR

Gateway crash-loop is **fixed and verified**. Ollama's "always token limit errors" is
**explained and closed**: a ~34k-token fixed overhead (MCP tool schemas + system prompt)
exceeds any local context window viable on this machine's current RAM and drive class. It is
**not fixable in software** and no code change is warranted. The 66-failing-test question is
**resolved** — those failures were transient (suite run mid-`pnpm install`); a clean run is
176/176 files and 1755/1755 tests green.

---

## 1. DONE — gateway crash-loop (verified)

**Cause:** version-guard deadlock. ClawX spawns the Gateway from its *bundled*
`node_modules/openclaw` via Electron `utilityProcess.fork`. That bundled copy was `2026.6.10`
while `~/.openclaw/openclaw.json` had been re-stamped by the global `2026.6.11`. The older
binary refuses startup migrations against a newer-stamped config → `exit 1` → ClawX supervisor
respawns forever (298 spawns logged on 2026-08-11).

**Two-sided version constraint (this is the durable lesson):**
- **Floor:** bundled version must be `>=` the version that last wrote `openclaw.json`. The
  global CLI re-stamps that file *every time it runs*, so global and bundled must match.
- **Ceiling:** bundled version must run on **Electron's embedded Node**, not `/usr/bin/node`.
  Electron 40.8.4 embeds **Node v24.14.0**. openclaw `2026.7.1-2` (npm `latest`) requires
  `>=22.22.3 <23 || >=24.15.0 <25 || >=25.9.0` — misses by one patch, dies instantly.
  The `2026.6.x` line requires only `>=22.19.0`. **Do not use `latest` until Electron is bumped.**

**Resolution:** pinned **both** global and ClawX to **`2026.6.34`** (`extended-stable`).
Verified: gateway reaches ready, binds 18789, `openclaw-acp` sidecar alive, zero respawns.

**Also fixed:** `~/.config/systemd/user/openclaw-gateway.service.d/clawx-managed.conf` neuters
the unit with `ExecStart=/bin/true`, but the base unit has `Restart=always` → systemd respawned
`/bin/true` every 5s until `start-limit-hit` (storms on the Jul 21 and Jul 29 boots). Added
`Restart=no` to the drop-in; verified by starting the unit deliberately (`NRestarts=0`).

**Note on the 3-day outage:** it was *not* the cause. The version-guard crash first appears in
`~/.config/clawx/logs/` on **Jul 19** (2,507 hits) and **Aug 4** (33,546 hits) — both weeks
before the Aug 8–11 outage. `journalctl --user -u openclaw-gateway.service --since "3 days ago"`
returns `-- No entries --`, so systemd never even attempted a start during the outage. Internet
was already restored when the session began (npm 200 in 3.9s) and it was *still* crash-looping.

---

## 2. CLOSED — Ollama context overflow is hardware-bound, not a defect

**Symptom:** every Ollama run fails `Context overflow: prompt too large for the model
(precheck)`, even with a 2-character user message on a brand-new session.

**Actual cause: the fixed per-turn overhead is ~34k tokens and the prompt never fits.**
Measured directly from the run's own `result.meta.systemPromptReport`:

| Component | chars |
|---|---|
| system prompt | 46,954 |
| 60 tool schemas | 70,494 |
| 60 tool summaries | 17,895 |
| **total** | **≈135,343 ≈ 34k tokens** |
| user message (`"hi"`) | 2 |

The `hermes` MCP server alone is ~65% of that. The user message is irrelevant — this overhead
is paid before any model is selected, so it is identical on **every** local backend.

**The context window was never missing.** `~/.openclaw/openclaw.json` already contains a
fully-populated `models.providers.ollama` (`baseUrl` 127.0.0.1:11434, `apiKey "ollama-local"`,
`api "ollama"`, `llama3.2:3b` with `contextWindow: 16384`, `maxTokens: 4096`,
`params.num_ctx: 16384`), and the live run reports `agentMeta.contextTokens: 16384`. The
window resolves correctly; 34k simply does not fit in 16k.

**Secondary aggravator:** `agents.defaults.compaction.reserveTokensFloor` is **50000** — a
reserve larger than the entire 16,384 window. Tuned for the 256k-context OpenRouter default,
it independently kills any sub-50k model.

### Experiments run (all reverted; config restored byte-identical)

| Change | Result |
|---|---|
| `contextWindow`/`num_ctx` 16384 → 32768 | still overflows |
| + `reserveTokensFloor` 50000 → 2048 | still overflows |
| + `tools.profile: "minimal"` for that model | tools 60→52, **`schemaChars` unchanged at 70,494** |

That last row is the important one: **`tools.profile` and `tools.deny` (`group:*`) do not
filter MCP tools.** The pre-existing `byProvider` deny of `group:web`/`browser` never had any
effect on the dominant cost. Shrinking the MCP surface requires `openclaw mcp tools`
include/exclude filters or disabling the server — both **per-server global**, so they would
degrade the cloud models too.

### Why this is hardware-bound

Clearing ~34k tokens of overhead needs roughly a 48–64k context window. On this machine:

- **~7 GB free RAM** (30 total, 23 used). A 65536-token KV cache for a 3B model is ~7.3 GB —
  it does not fit, and the drive class on `/storage` and boot makes swapping into that
  working set non-viable.
- Raising `num_ctx` is therefore not an escape hatch, only a slower failure.

**Conclusion: no software fix is warranted.** This is a memory and storage-throughput ceiling.
Revisit only after a RAM upgrade and/or the DRAM-cache SSDs are installed.

### Standing decisions (by design, not defect)

- **Ollama stays embeddings-only.** `nomic-embed-text:latest` via `agents.defaults.memorySearch`
  runs through the memory-search path, never the agent prompt path, so it never sees the tool
  schemas and is entirely unaffected. This works today and should be left alone.
- **LM Studio stays disconnected.** It is not installed (no `~/.lmstudio`, no `lms` CLI,
  nothing on :1234); only its model directory `/models/LM-Studio-Models/` survives, borrowed by
  llama.cpp. Connecting it would change nothing — same 34k overhead.
- **llama.cpp is not a workaround.** `llama-server` (pid 1691, Vulkan) is live on :8080 serving
  Qwen2.5-Coder-14B, but with `--ctx-size 8192 --parallel 2` → **`n_ctx` 4096 per slot**, i.e.
  4× worse than the Ollama setup. It is not wired into ClawX as a provider, and should not be.
- `ollama-current` (port 11435) is **dead config** — nothing is listening there.

### Fastest way to re-confirm any of this later

```bash
openclaw agent --agent main --session-key probe --model ollama/llama3.2:3b -m "hi" --json
```
Read `result.meta.agentMeta.contextTokens` and `result.meta.systemPromptReport`
(`systemPrompt.chars`, per-tool `schemaChars`). **Do not infer from config files alone** —
that is precisely what produced the wrong answer below.

---

### ❌ Superseded — the original (incorrect) root-cause theory

Retained only so the misdiagnosis is not repeated.

The original claim was that `syncCustomProviderAgentModel()` bailed out on its
`if (!resolvedKey || !config.baseUrl) return;` guard because the seeded Ollama account has no
stored key, so provider `ollama` was "never written into models.json", so its rows never got an
inferred `contextWindow`, so OpenClaw fell back to a tiny default.

**Why it was wrong:**

1. Only `~/.openclaw/agents/main/agent/models.json` was checked. The **global**
   `~/.openclaw/openclaw.json` did have a complete `models.providers.ollama` entry with a valid
   `contextWindow` all along. The window was never missing, and `contextTokens: 16384` in the
   live run proves it resolved.
2. Even on its own terms the proposed fix could not have worked:
   - the seeded `ollama` account has **no `model` selected**, so `models: []`, and
     `openclaw-auth.ts:2912` only assigns `existing.models` when `mergedModels.length > 0`;
   - `openclaw-auth.ts:2898` gates `contextWindow` inference on
     `providerType.startsWith('custom-')`, and the seeded account's runtime key is plain
     `ollama`. The comment at `openclaw-auth.ts:913` states this exclusion is **deliberate**:
     *"small local models (ollama) must not inherit a large window."*
   - it would have written `api: 'openai-completions'`, while the working rows use `api: 'ollama'`.
3. `DEFAULT_CUSTOM_MODEL_CONTEXT_WINDOW = 131_072` would not have helped regardless: Ollama
   silently truncates to `num_ctx`, so advertising 131072 without a matching `params.num_ctx`
   trades a loud overflow error for silent context truncation — strictly worse.

The `OLLAMA_LOCAL_API_KEY = 'ollama-local'` sentinel patch written for this theory has been
**reverted and must not be committed.**

---

## 3. ✅ RESOLVED — the 66 failing test files were transient

`npx vitest run` on a quiet tree now reports **176/176 files, 1755/1755 tests, exit 0.**

The previously-reported 66 failed files / 315 failed tests were **not** pre-existing and **not**
fallout from the openclaw `2026.6.10 → 2026.6.34` bump. That run was made while `pnpm install`
was still rewriting `node_modules`; the failures were `ERR_LOAD_URL` module-resolution errors,
not assertion failures. `tests/unit/workspace-browser-body.test.tsx` — the example cited as
evidence of unrelated breakage — passes standalone (13/13) and in the full suite.

**No `git stash` / downgrade bisect is needed.** The procedure previously described here has
been removed to stop anyone spending time on it.

**Verified green after reverting the sentinel patch:**
- full suite — 176 files / 1755 tests ✅
- `tests/unit/provider-runtime-sync.test.ts` + `provider-keys` + `provider-model-capabilities`
  — 42/42 ✅
- `npx tsc --noEmit -p tsconfig.node.json --composite false` — clean ✅

---

## 4. Working tree — what to commit, and how to split

Branch `fix/ollama-provider-key`, 3 commits already pushed to remote **`fork`**
(`Grynder02/ClawX`, up to date at `01f7fcd`). `origin` is upstream `ValueCell-ai/ClawX` —
**do not push there directly.**

| File | Change | Disposition |
|---|---|---|
| `electron/utils/openclaw-auth.ts` | export `extractFallbackModelIds`, accept `fallbackModelIds` param | **committed to fork** |
| `electron/services/providers/provider-runtime-sync.ts` | thread `fallbackModelIds` into `syncProviderConfigToOpenClaw` | **committed to fork** |
| `tests/unit/provider-runtime-sync.test.ts` | add `extractFallbackModelIds` to the `openclaw-auth` mock; add `expect.any(Array)` 4th arg to 2 stale assertions | **committed to fork** |
| ~~`OLLAMA_LOCAL_API_KEY` sentinel~~ | ~~keyless-Ollama fallback + its regression test~~ | **REVERTED — do not commit** (see §2) |
| `package.json` + `pnpm-lock.yaml` | openclaw `2026.6.10` → `2026.6.34` | **still uncommitted** — see note below |
| `electron/main/index.ts` | `win.webContents.openDevTools()` commented out | **local preference — never push upstream** |
| `src/stores/settings.ts` | `telemetryEnabled: true → false` | **local preference — never push upstream** |

The last two were already dirty before this work and were deliberately excluded from the
commit. Keep them out of any upstream PR.

### ⚠️ Open item: the version bump is still uncommitted

`package.json` / `pnpm-lock.yaml` still carry openclaw `2026.6.10 → 2026.6.34` as working-tree
changes. `node_modules` is at 2026.6.34 and the gateway is verified healthy on it, but **the
repo still declares 2026.6.10** — so the next clean `pnpm install` will silently reinstate the
crash-looping version described in §1. Commit this separately (with the Electron-Node ceiling
rationale from §1) before doing any fresh install.

### Note on the test-mock fix
Without `extractFallbackModelIds` in the `vi.mock('@electron/utils/openclaw-auth')` factory,
5 tests threw `TypeError` — earlier uncommitted work had left the suite broken. Two further
assertions failed because the new 4th `fallbackModelIds` argument was missing from their
`toHaveBeenCalledWith`. All seven are fixed and committed.

---

## 5. Environment facts worth keeping

- Global openclaw: `~/.npm-global/lib/node_modules/openclaw` → **2026.6.34**
- ClawX bundled: `~/projects/ClawX/node_modules/openclaw` → **2026.6.34**
- npm dist-tags: `latest=2026.7.1-2`, `extended-stable=2026.6.34`, `beta=2026.8.1-beta.1`
- `/usr/bin/node` = **v22.23.2**; Electron 40.8.4 embeds **Node v24.14.0**
- Gateway port **18789**, loopback only. Start ClawX with `pnpm dev` (vite + electron).
- Config backup from this session: `~/.openclaw/backups/openclaw.json.20260811-165415.bak`
- Ollama at `127.0.0.1:11434` with `llama3.2:3b`. Native context is 131072, but the config pins
  `num_ctx: 16384` and ~7 GB free RAM caps how far that can rise. **Embeddings-only by decision** —
  `nomic-embed-text:latest` via `agents.defaults.memorySearch`. See §2.
- `ollama-current` (`127.0.0.1:11435`) is **dead config** — nothing listening.
- `llama-server` (llama.cpp, Vulkan) live on `127.0.0.1:8080` serving Qwen2.5-Coder-14B from
  `/models/LM-Studio-Models/`, `--ctx-size 8192 --parallel 2` → `n_ctx` 4096/slot. **Not** a
  ClawX provider and not a workaround (§2).
- LM Studio is **not installed** (no `~/.lmstudio`, no `lms` CLI, nothing on :1234). Only its
  model directory remains, borrowed by llama.cpp.
- `agents.defaults.compaction.reserveTokensFloor` = **50000** — intentional for 256k cloud
  models, fatal for any sub-50k local model. Leave as-is unless local models return.
- Config backup from the closeout session: `~/.openclaw/backups/openclaw.json.ctxprobe-bak`
  (identical to live config — all experiments were reverted).
- `agents.defaults.model.fallbacks` is correctly populated and `agents.list[0]` has no `model`
  key — matches the guidance in the `openclaw-fallback-config` memory. Don't regress that.
- PR #1160 (preserve agent model fallbacks) **is merged** into this checkout as `a9d9376`;
  the old local patch to `electron/utils/agent-config.ts` is superseded and no longer needed.
- `~/.config/systemd/user/openclaw-gateway.service.bak` (Jun 30) is pre-existing, not mine —
  left in place, review separately.

---

## 6. Status and what's left

**Done:**
1. §3 blocker resolved — suite is green (176 files / 1755 tests).
2. §2 root cause corrected — hardware-bound, closed; no software fix warranted.
3. Sentinel patch reverted; the fallback-model-ids work + 7 test repairs committed to `fork`.

**Only open item:** commit `package.json` + `pnpm-lock.yaml` (openclaw `2026.6.34`) before any
clean `pnpm install`, or §1's crash-loop returns. See the warning in §4.

**Explicitly out of scope — do not restart:** Ollama, LM Studio, llama.cpp, or any local-agent
integration work. Revisit only after a RAM upgrade and/or the DRAM-cache SSDs are installed.
Ollama remains embeddings-only and LM Studio remains disconnected **by design, not by defect.**
