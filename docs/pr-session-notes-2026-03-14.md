# PR Session Notes (2026-03-14)

## Scope
本次工作围绕两条主线推进：
1. 通信层优化（减少重复处理、降低重启频率、提高稳定性）
2. 回归与可观测性（可回放、可比较、可量化）

---

## 1) 通信层优化

### 1.1 事件链路收敛与去重
- `electron/gateway/event-dispatch.ts`
  - 取消 `agent` 事件到 `chat:message` 的重复转发，保留主通知链路，避免双通道重复消费。
- `src/stores/gateway.ts`
  - 增加网关事件去重（带 TTL），在 `notification`/`chat-message` 入站前进行幂等过滤。
- `src/stores/chat.ts`
  - 增加聊天事件幂等键去重（`runId + sessionKey + seq + state` 风格）。

### 1.2 历史与会话拉取降载
- `src/stores/chat.ts`
  - `loadSessions` 增加 single-flight + 节流。
  - `loadHistory` 增加按 session single-flight + quiet 模式节流。
  - 发送态改为“事件优先 + 轮询兜底”，最近有事件时跳过不必要轮询。

### 1.3 重连/重启防抖
- `electron/gateway/manager.ts`
  - 增加重启冷却窗口（`RESTART_COOLDOWN_MS=2500`）。
  - `scheduleReconnect()` 应用冷却下限，避免短时连环切换。

### 1.4 辅助性能修正
- `electron/main/ipc-handlers.ts`
  - `gateway:httpProxy` 的超时 timer 改为 `finally` 统一清理。
- `electron/utils/logger.ts`
  - log tail 改为尾部读取，避免整文件读取带来的 I/O 峰值。

---

## 2) 通信刷新策略（reload vs restart）优化

### 2.1 现状核查结论
- 之前多数 channel/provider 更新路径会触发 `restart`，与“改模型/改channel常重启”的反馈一致。

### 2.2 改动策略（保守）
- `electron/main/ipc-handlers.ts`
  - `channel:saveConfig` 改为按 channel 分流：
    - 强制 `restart`：`dingtalk / wecom / feishu / whatsapp`
    - 其余默认 `reload`（失败自动 fallback 到 restart）
  - `channel:deleteConfig` 与 `channel:setEnabled` 继续 `restart`（保持安全语义）。
- `electron/services/providers/provider-runtime-sync.ts`
  - `provider save/update/setDefault`：由 `debouncedRestart` 调整为 `debouncedReload`。
  - `provider delete`：继续强制 `restart`。

### 2.3 reload 是否生效的可判定日志
- `electron/gateway/manager.ts` 增加结构化 `[gateway-refresh]` 日志：
  - `mode=reload result=applied_in_place`：明确原地生效
  - `mode=reload result=fallback_restart ...`：明确降级重启
  - `mode=restart result=applied ...`：明确发生重启

### 2.4 E2E 发现并修复的真实链路偏差
- 问题：`/api/channels/config`（Host API 路由）最初仍走 `debouncedRestart`，与 IPC 路径优化不一致。
- 修复：`electron/api/routes/channels.ts` 对 `saveConfig` 同步改为“优先 reload / 必要时 restart”策略。
- 结果：同值保存 `telegram` 后，日志出现 `mode=reload`，不再是主进程显式 `mode=restart`。

---

## 3) “127.0.0.1 fallback 原则”强化

- `src/lib/host-api.ts`
  - 默认禁止浏览器侧 localhost fallback；
  - 仅在显式策略开关 `clawx:allow-localhost-fallback=1` 时允许。
- `tests/unit/host-api.test.ts`
  - 更新相关测试，新增“策略关闭时不 fallback”用例。

---

## 4) 回归体系与 CI（通信专项）

### 4.1 本地回放与基线
- 新增脚本：
  - `scripts/comms/replay.mjs`
  - `scripts/comms/baseline.mjs`
  - `scripts/comms/compare.mjs`
- 新增数据集：
  - `scripts/comms/datasets/happy-path-chat.jsonl`
  - `scripts/comms/datasets/gateway-restart-during-run.jsonl`
  - `scripts/comms/datasets/network-degraded.jsonl`
- 新增基线：
  - `scripts/comms/baseline/metrics.baseline.json`
- 新增 npm scripts（`package.json`）：
  - `comms:replay`
  - `comms:baseline`
  - `comms:compare`

### 4.2 CI 门禁
- 新增工作流：
  - `.github/workflows/comms-regression.yml`
- 行为：
  - 运行回放 + 指标对比
  - 上传 `artifacts/comms` 结果
- `.gitignore` 新增：
  - `artifacts/`

---

## 5) 重连指标与 PostHog 埋点

### 5.1 新增通信重连指标
- `electron/gateway/manager.ts`
  - 记录重连累计：
    - `reconnectAttemptsTotal`
    - `reconnectSuccessTotal`
  - 每次重连结果（成功/失败）都上报：
    - 本地 metric 日志：`[metric] gateway.reconnect`
    - PostHog 事件：`gateway_reconnect`
  - 属性包含：
    - `gateway_reconnect_success_count`
    - `gateway_reconnect_attempt_count`
    - `gateway_reconnect_success_rate`
    - `outcome / attemptNo / maxAttempts / delayMs / error(失败时)`

### 5.2 PostHog OS tag
- `electron/utils/telemetry.ts`
  - 公共属性新增 `os_tag: process.platform`
  - 保留原有 `$os`

### 5.3 日志降噪（不改失败语义）
- `electron/gateway/startup-stderr.ts`
  - 将已确认高噪声、低行动价值日志降级到 `debug`：
    - `[gateway] security warning: dangerous config flags enabled ...`
    - `[ws] closed before connect ... code=1005`
  - 未命中的未知日志仍保持 `warn`（fail-open，避免隐藏真实异常）。

---

## 6) 验证记录

执行并通过：
- `pnpm run typecheck`
- `pnpm run test`（全量：34 files, 184 tests）
- `pnpm run test -- tests/unit/provider-runtime-sync.test.ts`（新增：刷新策略单测）
- `pnpm run comms:replay`
- `pnpm run comms:baseline`
- `pnpm run comms:compare`（PASS）

### 6.1 本地真实 E2E（使用现有 provider/channel 配置）
- 前置：启动 dev 运行态，确认 Host API 与 Gateway 在线。
- E2E-1（同值保存 telegram channel）：
  - 旧行为（修复前）：`/api/channels/config` 走 `debouncedRestart`，出现 `mode=restart` 与 PID 切换。
  - 修复后：`/api/channels/config` 对 telegram 走 `debouncedReload`，日志出现 `mode=reload`.
- E2E-2（同值设置 default provider）：
  - 走 `debouncedReload`，日志出现 `mode=reload result=applied_in_place pidBefore=... pidAfter=...`。
- 运行态观察：
  - OpenClaw 在 reload 后会出现 `WebSocket code=1012 service restart`，随后管理器自动 reconnect 并成功；
  - 新增的 `gateway.reconnect` 指标记录成功次数与成功率（本次观察到 success_rate=1）。

### 6.2 无变化请求短路优化（降低无效刷新）
- Provider 路由（`electron/api/routes/providers.ts`）：
  - `PUT /api/provider-accounts/default`：若目标已是当前默认，直接返回 `{ success: true, noChange: true }`，不触发 reload。
  - `PUT /api/providers/default`：同上（legacy 路径）。
  - `PUT /api/provider-accounts/:id` 与 `PUT /api/providers/:id`：若 patch 无变化且未提交 apiKey 变更，直接 `noChange` 返回。
- Channel 路由（`electron/api/routes/channels.ts`）：
  - `POST /api/channels/config`：若 form 值与已存配置等价，返回 `noChange`，避免无意义刷新。

### 6.3 路由错配问题（Feishu 入站回 Telegram）与修复
- 现场现象：Feishu 收到的消息，回复被发到了 Telegram。
- 排查结果：
  - `~/.openclaw/openclaw.json` 中 `bindings` 曾为空，通道路由退化到默认回退路径，存在跨通道误投递风险。
- 即时修复（环境层）：
  - 显式写入绑定：
    - `telegram + default -> main`
    - `feishu + default -> main`
- 代码修复（防复发）：
  - `electron/api/routes/channels.ts` 保存配置时，仅在请求显式带 `accountId` 时补齐 `channel+account -> agent` 绑定。
  - `electron/main/ipc-handlers.ts` 移除“保存时强制绑定到 main”的逻辑，避免多 agent 误覆盖。
  - 多 agent 语义：不带 `accountId` 的全局保存不再自动改绑定；带 `accountId` 才做 scoped 绑定。

### 6.4 `invalid json/syntax` 日志定位与防护
- 日志确认（2026-03-14 22:25:16 / 22:26:09）：
  - `config.patch` 返回 `INVALID_REQUEST`，错误为 `SyntaxError: JSON5: invalid character 'a' at 1:1`。
  - 同时段还有 `raw required` 与配置 schema 警告，属于输入格式不合法导致的拒绝，而非通信链路随机丢包。
- 代码防护（`src/lib/api-client.ts`）：
  - 对 `gateway:rpc` 的 `config.patch` 增加前置参数校验：
    - `params` 必须为 object
    - `params.patch` 必须为 object
  - 非法输入在客户端直接失败并返回明确错误，不再把坏 payload 发到 gateway。
- 单测补齐（`tests/unit/api-client.test.ts`）：
  - 新增 2 条用例，验证非法 `config.patch` 参数会在发送前被拒绝，且不会调用 `gateway:httpProxy`。
- 验证：
  - `pnpm vitest run tests/unit/api-client.test.ts` 通过（18/18）。

### 6.5 回归 case 扩充（通信优化专项）
- 新增回放数据集（`scripts/comms/datasets/`）：
  - `invalid-config-patch-recovered.jsonl`：覆盖配置 patch 异常后的恢复路径。
  - `history-overlap-guard.jsonl`：覆盖 history single-flight/防重入路径。
  - `multi-agent-channel-switch.jsonl`：覆盖多 agent 会话切换与路由稳定性。
- `compare` 门禁增强（`scripts/comms/compare.mjs`）：
  - 从仅 aggregate 判定，升级为“required scenario + 每场景 hard thresholds + aggregate 阈值”。
  - required 场景缺失将直接失败，避免回归覆盖面被静默缩减。
- 新增脚本单测（`tests/unit/comms-scripts.test.ts`）：
  - 验证 replay 指标计算（去重、inflight、p95）与 aggregate 行为。
  - 验证 compare 对 required scenario 缺失会 fail。
- 验证：
  - `node scripts/comms/replay.mjs`
  - `node scripts/comms/baseline.mjs`
  - `node scripts/comms/compare.mjs`（PASS）
  - `pnpm vitest run tests/unit/comms-scripts.test.ts tests/unit/api-client.test.ts`（21/21）
  - `pnpm run typecheck`

---

## 7) 主要改动文件清单

- `.github/workflows/comms-regression.yml` (new)
- `.gitignore`
- `package.json`
- `scripts/comms/*` (new)
- `electron/gateway/event-dispatch.ts`
- `electron/gateway/manager.ts`
- `electron/gateway/startup-stderr.ts`
- `electron/main/ipc-handlers.ts`
- `electron/api/routes/channels.ts`
- `electron/api/routes/providers.ts`
- `electron/services/providers/provider-runtime-sync.ts`
- `electron/utils/logger.ts`
- `electron/utils/telemetry.ts`
- `src/lib/host-api.ts`
- `src/lib/api-client.ts`
- `src/stores/chat.ts`
- `src/stores/gateway.ts`
- `tests/unit/api-client.test.ts`
- `tests/unit/host-api.test.ts`

---

## 8) PR Description 可直接复用（简版）

### What
- 优化通信链路，减少重复事件处理与不必要的 Gateway 重启。
- 建立通信回放 + 指标对比回归体系，并接入 CI。
- 增加重连成功次数/成功率指标，并上报到本地 metrics 与 PostHog（含 `os_tag`）。

### Why
- 之前 channel/provider 变更经常触发重启，影响稳定性与体验。
- 缺少通信专项可量化回归与观测，难以确认优化效果。

### How
- 事件收敛 + 去重、history/sessions single-flight + 节流、重启防抖。
- channel/provider 刷新策略改为“优先 reload，必要时 restart”。
- 新增 comms replay/baseline/compare 与 CI regression workflow。
- 新增 `gateway_reconnect` 指标事件（success count/rate）。
