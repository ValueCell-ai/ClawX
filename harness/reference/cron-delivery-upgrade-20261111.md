# Scheduled delivery recipient migration from 0.6.1

Related task: [WeChat delivery targets](../specs/tasks/fix-wechat-cron-delivery-targets.md).
Production fix: [PR #1341](https://github.com/ValueCell-ai/ClawX/pull/1341),
merged as `3e7badbe`.

## Scope

The `v0.6.1` source pins OpenClaw `2026.7.1-2` and discovers channel recipients
from `agents/<agent>/sessions/sessions.json`. Its legacy entries use top-level
`deliveryContext`, `lastChannel`/`lastTo`/`lastAccountId`, or `origin` fields.
OpenClaw `2026.10.10` migrates these into SQLite `session_nodes.entry_json`, with
external routing under `delivery.context` and `delivery.origin`.

The original PR tested legacy reads and canonical SQLite reads independently.
This follow-up verifies that native migration connects those two states without
losing the sending account or changing case-sensitive recipient IDs.

## Native Doctor probe on Windows

On 2026-11-11, an isolated synthetic home was populated with four legacy session
records and transcripts across `main` and `secondary`: two WeChat bot accounts,
Telegram last-route fields, and a WeCom target. No real credentials were used.

The actual pinned `openclaw doctor --fix --yes --non-interactive` completed, and
the production ClawX session reader/account resolver passed all four checks:

1. The legacy JSON entries are discoverable before migration.
2. Doctor creates four canonical external SQLite rows and removes the consumed
   legacy metadata fields from those rows.
3. Both WeChat accounts, every recipient ID, and ID casing remain unchanged.
4. Restoring stale `sessions.json` files cannot override the SQLite entries.

Machine-local evidence is under
`C:/Users/70954/clawx-delivery-upgrade-KydxXZ/`: `doctor.log`, `before.log`,
`after.log`, `after-stale-json.log`, and `result.json`. The local probe runner is
`artifacts/probe-delivery-upgrade-20261111.mjs` and is not part of CI.

## Durable regression coverage

`tests/unit/session-util.test.ts` covers keyed and array legacy JSON indexes,
two Agents, two WeChat accounts, Telegram, WeCom, and DingTalk. It loads the
pinned runtime's actual `normalizeLegacySessionEntryDelivery` function, writes
its results into real SQLite, and verifies the same recipients/accounts before
and after migration while a conflicting old JSON index remains on disk.
The eight tests in that file pass.

This is data-migration validation using synthetic legacy records. It does not
claim a fresh installer-over-0.6.1 acceptance run, enterprise authentication,
or live message delivery. No additional production-code change was needed.
