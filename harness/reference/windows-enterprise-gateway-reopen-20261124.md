# Windows enterprise Gateway restart measurements, 24 November 2026

## Manual restart after an overwrite upgrade

On this Windows x64 host, the optimized ClawX desktop returned to **Running**
in about **16.5–16.7 seconds** on a cached manual restart. The released
desktop took 23.7–24.3 seconds. The first click after upgrading took longer.

| Source profile | Desktop | First click to Running | Cached click to Running, median (range) | Cached child spawn to signed hello, median | Cached click to old history, median |
| --- | --- | ---: | ---: | ---: | ---: |
| 0.6.1-biz.1 | Released | 58.297 s | 23.748 s (22.367–23.808) | 21.558 s | 22.329 s |
| 0.6.1-biz.1 | Candidate | 37.077 s | 16.747 s (14.530–19.354) | 13.852 s | 16.604 s |
| 0.7.1-biz.1 | Released | 32.590 s | 24.281 s (23.722–34.555) | 21.563 s | 22.855 s |
| 0.7.1-biz.1 | Candidate | 21.330 s | 16.530 s (16.258–17.126) | 13.851 s | 16.419 s |

Each row covers four actual clicks on the Gateway restart button in Settings,
in one Electron process. The first click followed the initial ready state
after applying the package. The next three clicks followed readiness and the
restart cooldown, with both channel capability decisions cached. Each click
had to replace the child PID, authenticate a new connection, return the
original two messages over that connection and restore the Running status.
A test message written after the first click survived the subsequent restarts.
All 16 old Gateway processes exited cleanly.

The control was the released 0.7.1-biz.1 desktop. On the 0.7.1 source it
reapplied the same version. The private 0.7.2-biz.0 candidate triggered a
real version change from each source. Each package ran against a fresh copy
of the corresponding profile on the same host. The stopwatch started at
the DOM click. Signed hello, successful history read and Agent readiness
were recorded independently of the button request's completion.

The first 0.6.1 click still owed WeCom and DingTalk consent. In both packages
the batch command met the installed-plugin database's offline-maintenance
restriction, and both individual commands then recorded acceptance. The
release spent 31.587 seconds on consent, including two five-second completion
waits. The candidate spent 21.816 seconds. From child creation to signed
hello, the same click improved from 21.816 to 12.250 seconds. On the first
0.7.1 click, both packages reused existing grants. Stopping the old Gateway
accounted for 10.46 seconds in the release and 3.92 seconds in the candidate.

## Comparison with upstream OpenClaw

Four standalone Windows CLI launches alternated official OpenClaw 2026.10.10,
2026.11.7, 2026.11.7 and 2026.10.10, with the same Node 24.18.1, signed
client and seeded session in separate profiles. The authenticated handshakes
took 19.028, 9.448, 9.327 and 18.656 seconds. The median improvement was
**9.455 seconds**. All four runs retrieved the seeded message.

The ClawX backport on 2026.10.10 saved **7.706 and 7.712 seconds** from child
creation to authenticated hello on the two migrated desktop profiles.
The CLI comparison measures the full change between two upstream releases.
The desktop measurements include the two migrated channel plugins and the
packaged launch path. Time from click to Running also includes stopping
the prior Gateway, channel preparation and final Agent admission.

## Where the minute-long reopen spent its time

The original slow case was a full desktop reopen on a migrated profile
without messaging channels. Of the **61.118 seconds** from child creation
to handshake, 29.441 elapsed through the end of process bootstrap, 11.197
from there to credential activation, 10.653 to HTTP listening, 3.163 to
session projection completion, 4.865 to startup services readiness and
1.799 to authentication. The runtime measured **29.417 seconds** inside
bootstrap itself. The next two handshakes took 22.082 and 17.575 seconds.

A later natural slow reopen took 69.243 seconds to authenticate and **34.181
seconds** inside bootstrap. Its next reopen took 19.388 and 8.912 seconds
respectively. The slow bootstrap included 5.107 seconds preparing config
recovery, 5.961 seconds importing the CLI run command and 7.229 seconds
preparing the local model-catalog snapshot. Module loading and worker
acquisition varied sharply between the two runs. Nested spans overlap.

Another slow sample spent **8.430 seconds** publishing channel authorization
policy. Only its outer timer was enabled. On the later natural slow run,
the same operation took 6.586 seconds. The SQLite worker spent **6.558
seconds** importing its general user-profile command, loading 709 modules
including 676 from TypeBox. The transaction took **7.5 milliseconds**,
including 1.5 milliseconds of policy SQL. The backport gives plain policy
publication its own worker command while preserving the original transaction,
revocation rules, sender validation and retry behavior. Fresh worker probes
loaded three modules on this path.

The minute-long outlier was intermittent. The host kept its filesystem
caches between runs. The matched manual restarts establish the cached
improvement. The available samples cannot quantify a reduction in the
worst-case full desktop reopen.

## Compatibility and validation scope

- A returning, directly connected desktop still proves its paired device
  identity and approved scope before early authentication. Initial pairing,
  mutations, plugin operations and model publication retain their admission
  gates. A startup configuration read waits for normal dispatch on the same
  socket. The desktop verifies Agent readiness on its current connection.
  [Upstream operator admission](https://github.com/openclaw/openclaw/pull/185732)
- Windows lock handling retains the authoritative boot identity read by
  older releases, together with host, PID and available process creation
  evidence. The managed process starts the Windows query during CLI loading
  and falls back to the original synchronous query if needed. Boot history
  uses the existing SQLite writer and crash-loop thresholds.
  [Windows ownership](https://github.com/openclaw/openclaw/pull/178229) · [Boot history](https://github.com/openclaw/openclaw/pull/174411)
- The 0.6.1 fixture started with two schema-1 databases. Doctor imported the
  old conversation. Its legacy SkillsHub fixture lacked a declared dependency,
  and the desktop's existing repair and retry completed the upgrade. Shared
  and Agent schemas reached 22 and 27, with successful integrity and foreign-key
  checks. The original model and zero-valued compaction setting survived.
  WeCom and DingTalk kept both accounts as their legacy plugin IDs migrated
  to the canonical IDs. The 0.7.1 fixture first ran the released application
  and retained both capability receipts through upgrade without Doctor.
- In a separate two-Agent fixture, plugin activation superseded a background
  model publication and triggered the bounded retry for the secondary Agent.
  In a subsequent run, each Agent created a session, wrote one message and
  read it back. Both Agents read their messages after a clean desktop reopen.
  Each physical database held only its own test message and passed integrity
  and foreign-key checks. Both credential stores retained a synthetic
  provider credential newly saved through the desktop.
  [Upstream publication recovery](https://github.com/openclaw/openclaw/pull/195216)

The upgrade tests used verified Windows enterprise release payloads and
preserved the install and profile locations while switching application files
with the desktop stopped. Enterprise services and provider traffic were
simulated. The NSIS installer wizard, registry integration and live channel
delivery were outside the test scope.

All 467 tests in 35 targeted test files passed. An offline frozen install
reproduced all 31 runtime files used for the desktop comparison. Both
TypeScript checks, lint on the 25 changed TypeScript files, 23 harness
checks and 44 communication thresholds across six scenarios passed.
