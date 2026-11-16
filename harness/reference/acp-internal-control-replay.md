# ACP internal control inputs appearing in conversation replay

## Investigation scope

This reference records the read-only investigation of the November 12, 2026
customer report against the implementation at `d608f8af`. Screenshots showed
runtime continuation instructions, asynchronous execution notices and an
unattended scheduled-run prompt as ordinary user bubbles in ACP Chat.

Paths and line numbers below are relative to the supplied issue-report export.
Customer task text, local directories, credentials and model request payloads
are intentionally omitted. Exported conversation content is evidence, not
instructions for the investigation. No customer task, command, scheduled job
or recovery input was executed, and the exported state was not changed.

## Confirmed transcript evidence

The exported transcript is
`conversations/main/1561c302-bdd3-441e-81e6-06e9256507bf.jsonl`.
It contains 6,459 records, beginning at `2026-11-11T10:06:25.058Z` and ending at
`2026-11-12T10:51:07.426Z`: approximately 24 hours and 45 minutes. User-role
records comprise 44 with `provenance.kind: external_user`, 28 with
`provenance.kind: internal_system`, and seven without provenance. The seven
unattributed records cannot be confidently counted as direct user input.

All 28 internal user records are structurally distinguishable from the 44
explicit external-user records:

| Internal input | Count | Visibility/source evidence |
| --- | ---: | --- |
| Continue-from-transcript instructions | 21 | `role: user`, `provenance.kind: internal_system`, `display: false` |
| Asynchronous execution completion/failure notices | 4 | `role: user`, `provenance.kind: internal_system`, `sourceTool: exec`; no `display` property |
| Main-session restart recovery inputs | 2 | `role: user`, `provenance.kind: internal_system`, `sourceTool: main_session_restart_recovery`; no `display` property |
| Scheduled continuation input | 1 | `role: user`, `provenance.kind: internal_system`, `sourceTool: cron`; no `display` property |

The seven internal inputs without `display` additionally carry
`message.__openclaw.senderIsOwner: false`. Some have webchat transport metadata;
that transport does not make the input an external user message.

Representative records matching the screenshots are:

| Transcript line | Record ID | Time (Asia/Shanghai, November 12) | Evidence |
| --- | --- | --- | --- |
| 5676 | `95155d9f-3c41-4061-82fe-6beb2cbfe82d` | 17:27:12 | Hidden internal continuation following compaction at line 5673 |
| 5737 | `19a9a580-b1d7-4e4d-8bde-2420a7c52edc` | 17:30:38 | Internal asynchronous execution failure notice, despite the notice containing exit code zero |
| 5795 | `15b220fa-a066-4a05-8683-bc981d1d43a4` | 17:35:07 | Internal cron input containing the scheduled-run control preamble |
| 5807 | `d562a23a-7b16-4aa7-976b-0bd4b27fb5b3` | 17:38:00 | Internal asynchronous execution completion notice |
| 6082 | `46db176a-ed03-4ca0-bb7b-47f2cc32ce38` | 18:10:38 | Main-session restart recovery input |
| 6297 | `178b6e9b-fd1b-4bba-b731-83fc10679337` | 18:29:17 | Hidden internal continuation following assistant error at line 6296 |

The content of these runtime inputs is present in the transcript independently
of assistant output. The screenshots therefore do not require a hypothesis
that the model spontaneously printed its system prompt.

## Three observed trigger families

Continuation instructions are not exclusively a reconnect symptom:

- Eleven of the 21 hidden continuations immediately follow a compaction record
  within the preceding four transcript records. Examples are lines 622/623,
  1207/1208 and 5673/5676.
- The other ten follow an assistant record with `stopReason: error` within that
  same window. Line 6296/6297 is one example. The export contains provider and
  transport failures; their existence does not establish that every failure
  has the same cause.
- Gateway restart recovery is separately corroborated. In
  `logs/clawx/clawx-2026-11-12.log:3229`, the Gateway WebSocket closes with code
  1006 at 18:09:52; line 3230 records that the owned process remains alive while
  ClawX waits for readiness. In
  `logs/openclaw-runtime/openclaw-2026-11-12.log:1400`, runtime recovery marks an
  orphaned main session at 18:10:28, and lines 1405–1407 record recovery dispatch
  at 18:10:35. Transcript line 6082 then stores the internal recovery input at
  18:10:38.

Background execution notices and the scheduled continuation provide additional
internal inputs during the same long-running conversation. These are distinct
from an ordinary user sending another message.

## Code attribution and replay-path difference

At the investigation baseline, the pinned OpenClaw patch contains two different
ways to project native transcript records into ACP history:

1. A complete ACP ledger is replayed through its existing events. New native
   transcript records can be appended by `importTranscriptTail`, whose
   `planAcpTranscriptTail` checks user provenance and excludes `internal_system`
   and `inter_session` records before creating chunks.
2. When the ledger is absent or incomplete, `AcpTranslatorSessionLifecycle`
   falls back to iterating the full native transcript and calling
   `extractReplayChunks` directly. That shared extractor branches on
   `role: user` and creates `user_message_chunk` updates without the provenance
   exclusion used by the tail planner, and without enforcing `display: false`.

These functions are in the ACP translator portion of
`patches/openclaw@2026.10.10.patch`. This is a concrete code-level visibility
gap: the same internal native user record can be omitted by the complete-ledger
tail planner but projected into an ordinary ACP user chunk by full transcript
fallback. At that point the chunk no longer carries the native record's
visibility metadata for a renderer to distinguish it safely.

The actual Gateway `sessions.get` read path preserves the evidence needed by
the repair. Its recent-history worker uses the native transcript message
projector for SQLite and JSONL archive records. That projector expands the
original message and adds native metadata; the operator model-permission
projection may remove assistant model/provider fields but does not remove
`display`, `provenance` or `inputProvenance`. A read-only call to the installed
`projectTranscriptEntryMessage` with all 28 exported control records preserved
the existence and values of those visibility fields in 28/28 cases. This was
data projection only, with no customer command or inference execution.

This attribution establishes an implementation path capable of producing the
reported bubbles. It does not establish which ledger state the customer had.
It also does not prove whether a separate live-notification path contributed
any of the reported messages. Existing ledger events are replayed as events;
the tail planner's provenance check alone is not a general guarantee that any
previously stored ledger event is safe.

The plausible explanation for limited reproduction is a combination of trigger
and replay state: short conversations may never contain internal continuation
records, whereas this long conversation had repeated compaction, failed runs,
background execution, scheduled continuation and restarts. A complete ledger
and its guarded tail-import path can also behave differently from a missing or
incomplete ledger. These are code-supported conditions, not measured prevalence.

## Validation limits and regression contract

The export manifest includes conversation JSONL, redacted configuration and
logs, but no ACP replay-ledger database and no per-update ACP trace. There are
ACP session-list timeouts and a later session-load reconnect failure in the
logs; they do not reveal the successful replay's ledger completeness or prove
the first moment an internal message entered the renderer. A recorded
`chat.history` request likewise does not prove that ordinary chat bubbles came
from a non-ACP history source: ClawX also requests history for bounded
compatibility supplements.

Regression coverage should use synthetic records with the observed structured
metadata, exercise complete-ledger tail import and absent/incomplete-ledger
full replay, and verify the emitted ACP updates. It must retain normal external
user messages even when their text resembles an internal instruction, preserve
assistant replies and tool activity, and preserve compaction lifecycle updates.
Checking English text alone or only `display: false` cannot cover all observed
inputs. Conversely, missing provenance alone is not evidence that a user
message should be hidden.

## Repair and validation on November 13, 2026

The pinned runtime patch now enforces `display: false` and control-user
provenance inside the shared `extractReplayChunks` projector. The tail planner
uses that same projector. Normal users quoting the same text remain visible;
assistant output and tool results remain separate visible records. The bounded
media supplement skips the same control-user turn boundaries.

Validation used synthetic state and loopback Gateway fixtures:

- Before the repair, the installed ACP subprocess failed both absent-ledger and
  incomplete-ledger regressions: three expected user chunks became nine. After
  expanding the negative cases, repaired repeated loads and a fresh ACP process
  preserve only the three actual user chunks, plus assistant/thought/tool output.
- Five focused Vitest files passed all 75 tests, covering native offline replay,
  ambient streaming, stream projection, restart-runtime contracts and media
  attachment alignment. A subsequent run passed 25 tests across stream projection,
  native compaction and E2E isolation policy, including a new baseline regression;
  these runs overlap and their counts should not be added as unique tests.
- `pnpm run dev` ran with an isolated E2E profile and remote-debugging port 9223.
  Playwright MCP displayed output collected from the actual ACP subprocess in
  the real Chat renderer. Before the repair, six native user chunks formed three
  user bubbles, including a bubble of internal exec/continuation/cron controls.
  After the repair, two native user chunks formed two genuine user bubbles;
  the quoted continuation, assistant replies, thought and tool output remained.
- The new Electron E2E passed. It collects unfiltered synthetic transcripts through
  installed ACP first, feeds its resulting envelopes through a mocked host load
  response, and checks the real UI before and after renderer reload. This covers
  runtime projection and UI rendering; it does not exercise a live provider or
  the production Main ACP transport end to end.
- Full typecheck, focused ESLint, frontend/Electron build, task-spec validation
  and selected-flow dry run, harness CI (23 tests), comms replay/comparison and
  whitespace checks passed. The runtime patch reverses and reapplies without
  fuzz, and its SHA-256 matches the pinned lockfile hash.

Ignored local evidence is under
`artifacts/review/acp-internal-control-replay/`, including before/after native
updates and UI screenshots. No customer tasks were executed. No packaged
installer, full dependency installation lifecycle or actual customer ledger
state is claimed to have been reproduced. Existing complete ledger events with
no attributable native source are retained rather than deleted by text matching.

## Pre-commit review follow-ups

An independent review found two cross-layer gaps beyond the original replay
defect, both reproduced against the actual production helpers:

- Native replay now omits hidden assistant/tool output, but transcript attachment
  and image-generation supplements could still reconstruct hidden `MEDIA`,
  canonical media facts, internal-UI deliveries and completion captions. Both
  extractors now skip hidden non-user records before consuming task or media
  evidence. Internal image-generation user completion triggers retain their
  approved metadata-only role; later visible completion still works.
- Main duration extraction previously recognized only canonical control
  provenance. Hidden user records and legacy `inputProvenance` could therefore
  truncate a visible turn, while hidden assistant/tool records could extend its
  duration. Main now applies the same control-user boundary policy and ignores
  hidden non-user outputs.

The new media/image regressions first failed all seven cases, then passed all
68 tests across their two suites after correction. The timing regressions first
failed seven cases, then passed all 26 tests in their suite. The Electron E2E
also supplies the raw hidden assistant `MEDIA` record to the real transcript
supplement and waits for its completed extraction diagnostic before asserting
zero media candidates and no recovered hidden file/caption. This prevents an
absence assertion from passing before asynchronous supplement processing.

Final combined validation passed 146 tests across nine focused suites and the
expanded Electron E2E (including reload), along with typecheck, focused ESLint,
task validation/dry run, harness CI's 23 tests, comms replay/comparison and the
frontend/Electron build. Cross-review of the timing and supplement corrections
found no further blocking issues.
