# OpenClaw 补丁兼容性：真实 ClawX 验证报告

任务：[verify-openclaw-patch-behavior-live](../specs/tasks/verify-openclaw-patch-behavior-live.md)。

## 验证环境与证据边界

验证日期为 2026-10-28，环境为 macOS arm64、代码版本 `63422cb7`、Electron 41.10.7，
以及已安装并应用本地补丁的 `openclaw@2026.10.5`。用户明确授权使用真实用户配置、
重启 Gateway 和消耗模型额度。请求使用已选中的 `zai/glm-5.3-flash`，经过真实的
Renderer、Main host API、ACP 子进程、Gateway 和模型服务。Playwright 通过 CDP
操作正在运行的 Electron 窗口。以下真机证据没有使用模拟的 host 处理器、人工注入的
ACP 更新，也没有将提取函数后的 VM 测试结果当作真机证据。

测试请求放在专门的 `AUDIT-*` 对话中。验证对照了真实 Gateway 事件、ACP 通知和诊断轨迹、
通过只读 SQLite 查询获取的原生会话记录（transcript）与 ACP 事件账本（ledger），
以及 Chat 界面最终渲染的时间线。事件投递探针使用已安装 OpenClaw 的 `GatewayClient`，
以与 ACP 相同的 CLI 身份和能力连接同一个 Gateway，只订阅 `sessions.messages.subscribe`；
ClawX 的真实 host API 通过另一个连接触发压缩。测试没有用 Main 的全局订阅连接，
代替 ACP 实际使用的订阅连接来判断事件是否送达。

本次验证将当前运行时的实际行为与旧补丁文档承诺的行为进行对照，未同时启动旧运行时做
并排比较。结论不覆盖所有模型、平台、时序或错误路径，也不代表后续上游版本的状态。

## 验证结果与补丁决策

| 旧补丁保障 | 真机结果 | 决策 |
| --- | --- | --- |
| 已接受的请求能跨越 ClawX 管理的 Gateway 重启，并跟随替代 run 继续执行 | 已复现退化，用户现场确认；随后补丁修复，真机恢复结果已送达 ACP/UI | 已补回已接受请求的有限等待预算、可信恢复 run 接续和终态对账；保留新版原生恢复准入 |
| 中止时保留已发送或缓冲中的回复尾部 | 原生 abort 和界面停止按钮两种场景均未复现丢字；Gateway 会先补发增量，再发送中止终态 | 不能仅凭旧条件分支缺失就恢复旧的终态消息补丁 |
| 加载完整 ACP ledger 时，能恢复此后在当前 ACP 监听之外产生的 transcript 新消息 | 用户现场确认后已修复；既有故障对话和新后台任务均通过真机复测 | 原生提交时间与持久记录身份限定尾部，原子补入 ACP 自身账本，并去重回放期间的重叠事件 |
| 新建对话在父代理回复后能收到子代理完成通知 | 显式使用 `expectsCompletionMessage: true` 时通过；ClawX 的请求结束后加载流程激活了 ambient 事件投递 | 本场景不足以支持单独给 `newSession` 补激活逻辑 |
| 工具结果超限后仍可继续，不会陷入无效压缩或重试耗尽 | 四次真实的大结果调用经过两次原生压缩后完成，未复现旧卡死 | 保留新版恢复架构；旧裁剪算法另作证据收集或优化评估，暂不回搬 |
| 手动压缩和恢复过程中的压缩生命周期能送达 ACP 与 Chat | `/compact` 和真实超限恢复均缺少生命周期展示；仅订阅会话消息的连接漏收原生 RPC 的压缩事件 | 待对应问题现场确认后，修复事件生产端元数据、精确订阅者投递和 ACP 事件投影 |

### 重启：ACP 请求失败后，原生恢复仍成功完成

**2026-10-28 修复进展：** 用户观看现场复现并确认后，已在当前版本补回 ACP 接续链路。
第一次修复后真机复测会话为 `agent:main:session-1793141914851`：网关重启约 12 秒，
原 run `ab641c4f-8c4e-453a-9ff3-f7ef1efd6e11` 被可信恢复 run
`4ee19215-7cb1-464b-88d3-35a15bb51ab7` 接续，ACP 收到
“网关重启后，我已继续完成任务。FIX_RESTART_DONE”，原请求正常完成，没有结果未知提示。
该次测试还发现会话列表暂时缺项会让界面切走，已增加运行中会话保留及 Electron E2E 覆盖。
最终复测和自动化结果记录在本次修复任务中。

最终真机复测会话 `agent:main:session-1793142646764` 已通过：重启耗时 12,221 ms，
原 run `74c7b9e9-46db-458a-935d-4ca284875c3a` 接续为
`3b97c507-a8fa-44d5-ad1f-15d33e64ff57`。全程选中的会话保持不变；恢复后新工具
`call_b512536ede7d4395a27255e5` 的开始、结果和 completed 状态均通过 ACP 送达，界面显示
3 张工具卡片及 `VERIFIED_RESTART_DONE` 最终回复；`sending=false`、`error=null`。
被重启中断的旧工具标记为 failed，与新恢复工具分开记录。

修复过程中还确认：新 ACP 会话在首次发送前可能尚无原生会话行，初次消息订阅会失败。
补丁保留该请求的订阅意图，在接收确认后补订阅，并在恢复对账时重试暂时失败的订阅；
否则恢复 run 虽已执行工具，ACP 仍看不到卡片。真实子进程测试现包含原生会话未落盘和
连续两次重连订阅失败的条件。最终 7 组相关单元测试共 137 项通过，Electron 重启场景
E2E、类型检查、通信回放/对比及 harness CI 检查通过。

实现保留新版原生恢复准入机制，从已验证的恢复记录提取前驱关系；已接受请求使用 Main
传入的 8 分钟预算，未确认请求保留 5 秒期限，失败重连不会重置截止时间。测试覆盖真实
ACP 子进程的重连、无效来源/跨会话事件、连续恢复、工具、取消、已完成恢复 run 对账和超时。
离线 transcript 尾部回放与压缩生命周期仍属于后续独立问题。

修复前，在新对话中发起一次 Code Mode 调用，内部通过 shell 执行 `sleep 45`，完成后回复一个
唯一标记。工具开始运行后，通过 ClawX 真实的 `gateway.restart` host 操作重启网关。
本次重启约耗时 13 秒。替代 Gateway 尚未进入运行状态时，原 ACP 请求就以如下提示结束：

`The Gateway disconnected after accepting this message, so its final outcome is unknown.`

即：Gateway 在接受消息后断开连接，因此最终结果未知。

原生恢复随后使用新的 run ID 继续执行，最终发出包含 `AUDIT_RESTART_FINISHED_20261028`
的回复。会话条目持久化保存了原 run 与恢复 run 的关联。此时 ClawX 仍显示中断提示，
ACP ledger 也没有这条恢复后的最终回复。本次同时观察到了原 run、替代 run、原生终态，
以及 ACP/界面中缺失的结果。

这说明内核具备恢复能力，但 ACP 的接续链路不完整。修复必须使用当前版本可信的恢复来源信息，
不能只凭相同 session key 猜测 run 之间的关系，也不能盲目恢复已废弃的内部请求字段。
修复时还需要覆盖连续重启、取消、工具调用、审批和错误终态等行为。

### 中止：事件生产端的发送顺序补偿了旧分支的缺失

本次捕获了两个可控的真实模型场景：

- 输出到达时，通过 ClawX host API 发起原生 `chat.abort`：中止终态中的文本与拼接后的
  ACP 文本完全一致，均为 1,932 个字符。
- 已收到四个可见输出的 ACP 文本块后，点击界面停止按钮：终态文本与 ACP 输出完全一致，
  均为 77 个字符；界面保留了部分回复，并结束发送状态。

Gateway 会在发送终态快照前调用 `flushBufferedChatDeltaIfNeeded`，先补发缓冲增量。
因此，`handleChatEvent` 中缺少 `aborted` 条件分支，本身不足以证明当前生产端会丢字。
本次结果不覆盖所有慢客户端或重试路径。此前一次在任何输出可见前就停止的尝试，
未计入丢尾字的结论；另一次被模型拒绝的重复文本请求，也未计入有效测试。

### 回放：在当前 ACP 监听之外完成的回复，重新加载后仍缺失

**2026-10-28 修复及复测：** 用户在真实 ClawX 中确认缺失后，已修复原生 ACP 的
complete-ledger 加载路径。故障会话 `agent:main:session-1793142847299` 保留原账本，
原来的 11 条事件全部保持不变；新增 2 条带持久来源身份的更新（thought、assistant），
事件时间保留为原生提交时间 `1793142961930`，恢复了 `OFFLINE_CHILD_FINISHED_20261028`。
应用及 ACP 重启后再次进入，回复仍只显示一次。

新增真机复测会话为 `agent:main:session-1793143785992`。父代理发出
`REPLAY_FIX_PARENT_READY_20261028` 后，ClawX 在 `1793143826666` 切到另一对话。
后台子任务等待约 45 秒后完成，原生 announce 在 `1793143880775` 发出最终回复；
此时 ACP 尚未收到这段 assistant 文本。切回来后，ClawX 成功通过 `session/load` 补回
`REPLAY_FIX_CHILD_DONE_20261028`；再次切走/切回、刷新 Renderer 并重新选择对话后，
对应完成段落始终只有 1 份。账本仍为 complete，原生记录的 thought/text 两条导入更新
各仅保存一次，`loading=false`、`sending=false`、`error=null`。判定依据为原生事件、
SQLite 记录和实际界面断言。

补丁在 OpenClaw 内部完成：读取已有的有界原生历史，只处理有限提交时间严格晚于账本
高水位且有持久 ID/位置的记录，在事务内重读账本并原子补入，避免并发加载、重复记录或
写入中途失败产生半批数据。导入操作的墙钟时间不会充当历史覆盖时间。已知 run 的文本
仅在有界原生聚合与账本前缀匹配时追加后缀，既有内容不被改写；回放期间缓冲的 live
事件使用 run、工具和终态基线去重。此规则不补齐已覆盖区间内部的历史缺口。

真实 ACP 子进程测试覆盖旧 complete ledger、原生提交时间/记录身份、工具顺序、重复加载、
后续 prompt、进程重建、双 ACP 并发、导入事务回滚、无效记录、读取失败、部分前缀和
回放/live 重叠（包括 incomplete-ledger fallback）。5 组相关单元测试共 29 项、Electron
离线回放 E2E、类型检查、通信回放/对比和 harness CI 检查通过。证据保存在忽略目录
`artifacts/review/openclaw-offline-replay-fix/`，包括 `live-verified.json`、`live-verified.png`
和新旧会话的 transcript/ledger 快照。

以下为修复前的验证记录：

父代理以 `expectsCompletionMessage: true` 启动子代理，然后返回自己的标记。
用户切换到其他对话后，子代理完成，原生 announce run 将一条包含
`AUDIT_CHILD_DONE_OFFLINE_20261028` 的新回复写入父会话 transcript。

ACP ledger 仍标记为 `complete = 1`，其中只有之前的父代理回复。切回会话时，
ACP `session/load` 成功，但界面仍只显示父回复。刷新整个 Renderer 后再次选择该对话，
结果相同，排除了前端内存导航缓存的影响。

因此，标记为完整的 ledger 确实可能缺少较新的 transcript 尾部记录。但本次并未证明
只按时间戳合并就是充分修复。覆盖范围或游标、去重、加载代次、工具顺序，以及既有 ledger
的恢复，都应在 OpenClaw 的 ACP 投影与持久化层处理。Renderer 不应另外维护一套
基于 transcript 的历史内容。

ledger 已覆盖区间*内部*的文本缺失，例如
[CHAT-ACP-01](openclaw-2026-10-5-upgrade.md#chat-acp-01-assistant-text-before-a-tool-call-is-absent-from-acp-replay)，
属于另一种情况；只补尾部记录不能宣称同时修复该问题。

### 新会话订阅：ClawX 已通过一次后续加载补偿

最初的校准子任务使用了 `expectsCompletionMessage: false`，本就不应收到通知，
所以没有计入退化结论。有效的新会话测试显式将该标志设为 true。父代理先于子代理完成回复，
之后子代理完成通知正常显示，全程没有重新选择该对话。

诊断轨迹先记录了 `createIfMissing: true`，随后记录了请求结束后执行的 `loadAcpSession`，
后者使用 `createIfMissing: false`。这一步进入 `loadSession`，激活 ambient 订阅，
即对没有待处理请求时发生的会话事件进行监听。此前只检查 `newSession`，漏看了 ClawX
已有的这一步补偿。但这种补偿无法修复另一个会话持有 ambient 订阅期间产生的事件缺失。

### 工具结果压力：恢复完成，但缺少可观测性

通过 Gateway `config.patch`，临时把模型有效的 `contextTokens` 设为 48,000，
保留原模型和原生的 1,048,576 token 窗口。四次独立 Code Mode 调用生成确定性的虚构记录，
每次序列化后的工具输出约为 25,134 个字符。真实的轮内预检先后报告估计输入为 46,113 和
46,419 token，而请求预算为 36,000 token；两次均为 `route=compact_only`，
且 `toolResultReducibleChars=0`。

SQLite transcript 中存在两条真实压缩记录。四次调用全部完成，最终回复确认成功，
未出现旧版因 `no real conversation messages` 而重试耗尽的失败。原生压缩统计不能单独
视为最终发送给模型服务的输入大小，因为新版运行时还具有压缩回放和上下文投影机制。
因此，旧的聚合裁剪目标优化缺失，并不足以支持把整套旧控制流程作为稳定性修复搬回来。

两次实际压缩均没有产生 `openclaw.ai/compaction` ACP 元数据，也没有在 Chat 中出现
压缩状态行。这是另一个已复现的可观测性缺口。

测试后已恢复原模型定义，并确认临时 `contextTokens` 字段被移除。第一次仅写回原来的
最小模型条目时，按 ID 合并数组的机制仍保留了该字段；随后通过显式 null 补丁将其删除。
证据中未包含凭据，也没有手工改写数据库。

### 压缩：区分命令路径与订阅连接

在真实 Chat 中执行 `/compact` 成功，返回 `Compacted (21k → 653)`，但没有产生
生命周期 ACP 元数据或压缩状态行。不能因为 `sessions.compact` 带有开始、结束元数据，
就认为 `/compact` 命令路径也已完整覆盖。

原生 RPC 探针成功压缩了另一个测试会话，token 数从 15,083 降至 702。Main 收到了开始和
结束事件，但 Main 还通过 `sessions.subscribe` 持有全局订阅。在同一次操作期间，
另一个真实 CLI 客户端已经成功订阅指定会话的 `sessions.messages.subscribe`，
却收到 **零条** `session.operation` 事件。其 45 秒观察区间完整覆盖了压缩操作。
这在没有模拟订阅者集合的情况下，复现了精确会话订阅连接的事件投递缺失。

修复必须保留权限边界，对同时持有两类订阅的客户端去重，并覆盖 `/compact`，以及直接由
预检或超限恢复触发的压缩事件生产端。Main 持有全局订阅，不代表 ACP 已收到事件。

## 验证检查与本地证据

相关补丁测试共 5 个文件、23 个测试，全部通过。Comms 回放和回归比较也通过。
这些现有检查没有实际覆盖上述失败的真机路径，不能据此认定补丁已完整迁移。
后续修复任务需要为上述成功和失败场景补充确定性的行为测试。

本地证据位于被 Git 忽略的 `artifacts/review/openclaw-patch-audit/`，包括：

- `managed-restart-complete.json`，以及对应的 transcript/ledger 快照和截图；
- `offline-completion-reload.json`，以及对应的 transcript/ledger 快照和截图；
- `fresh-session-announcement.json` 和截图；
- `gateway-abort-tail.json` 与 `ui-stop-button.json`；
- `manual-compact-command.json`、`message-subscription-producer.json`、
  `message-subscription-probe.json` 和原生投递探针脚本；
- `tool-result-pressure.json`、`pressure-runtime-log.json` 与
  `pressure-compaction-records.json`。

本次未修改依赖补丁。已检查 README 中的相关流程；这些改动只记录验证证据，
没有引入新的产品行为或用户操作流程。
