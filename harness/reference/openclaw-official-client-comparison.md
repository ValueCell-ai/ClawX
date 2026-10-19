# OpenClaw 官方客户端 vs ClawX：可借鉴项与可删减项

> 分析日期：2026-10-19
> 对比基线：OpenClaw 官方仓库 `main`（macOS / iOS / Android / Tauri 桌面 / Control UI）与 ClawX `6aebbf5d`（`feat/openclaw-2026-10-5`）。
> 本文是决策参考。文末“Phase 1 执行记录”列出本轮已经落地的低风险清理。

## 0. 结论摘要

1. **官方客户端是“薄壳 + Gateway/Control UI”，ClawX 是“全量重写 + 自带 Main 配置层”。**
   官方 Tauri 桌面（Linux/Windows）只做托盘、Quick Chat、连接管理、Gateway 进程管理、更新和 WebView；所有业务界面复用 Gateway 提供的 Control UI。ClawX 则用 React 重新实现了 Chat、Agents、Channels、Cron、Models、Settings、Skills 等页面，Main 里还重写了配置清洗、插件安装、渠道配置等约 8.2k 行。
2. **最值得借的是“连接层”和“原生外壳能力”，不是 UI 代码本身。**
   官方把 Gateway 当作唯一事实源，并提供可复用的 `@openclaw/gateway-client` / `@openclaw/gateway-protocol` npm 包；ClawX 仍在自维护 WS 客户端与设备签名。官方还有 ClawX 完全缺失的 Gateway Profile、远程/SSH/Tailscale、Quick Chat 全局快捷键、原生权限引导、keep-awake、pending approvals 等。
3. **可以立即删除的代码量不大，但都是“确定死代码 + 冗余依赖”。**
   可达性扫描发现 6 个未被入口引用的文件；其中 3 个是明确的死模块/重复实现。另有约 12 个直接依赖在源码中零引用（部分是上游传递依赖，删除直接声明即可）。
4. **真正的大头是“重复功能”和“重复打包”，不是小文件。**
   - 页面层约 6.7k 行与官方 Control UI 功能重叠（Cron、Skills、Models、Agents、Settings、通用 Channels）。
   - Main 配置/插件层约 8.2k 行与 OpenClaw 自身 schema/插件管理器重叠。
   - 打包体积：单架构 App 里同时带了 **arm64 + x64 两套 CUA 原生 SDK（约 103MB 冗余）**、**58MB Control UI 静态资源**、**21MB 文档**、**170MB bundled extensions**。
5. **不要为了“删代码”删掉 ClawX 的差异化能力**：中文渠道（企微/微信/钉钉/飞书/QQ）、一键安装/更新、Provider 引导、Issue Report、文件预览、CUA、i18n。

---

## 1. 证据来源与口径

### 1.1 官方源码/文档

通过 GitHub API 与 raw 文件读取（2026-10-19，`openclaw/openclaw@main`）：

- `apps/macos/README.md`、`apps/ios/README.md`、`apps/android/README.md`、`apps/linux/README.md`
- `apps/macos/Sources/OpenClaw/*`（Swift 原生模块清单）
- `apps/linux/src-tauri/src/*`（Tauri 壳的 47 个 Rust 模块清单）
- `apps/linux/src-tauri/tauri.conf.json`、`ui/package.json`、`ui/src/api/gateway.ts`
- `ui/src/pages/*`（44 个页面目录）、`ui/src/api/*`
- 本地 `node_modules/openclaw/docs/platforms/macos.md`、`docs/web/control-ui.md`

### 1.2 ClawX 侧

- 入口图可达性扫描（`src/main.tsx`、`electron/main/index.ts`、`electron/preload/index.ts`）：
  360 个 TS/TSX 文件中 6 个不可达。
- `pnpm why <pkg>` 与源码引用扫描：确认直接依赖是否真正使用。
- `wc -l` / `du -sh`：页面、Main 模块、bundle、打包产物体积。
- 现有构建结果：`build/openclaw`、`release/mac/ClawX.app`、`release/linux-arm64-unpacked`、`release/win-arm64-unpacked`。

---

## 2. 官方客户端架构

### 2.1 四类客户端

| 客户端 | 形态 | 关键职责 |
| --- | --- | --- |
| macOS | Swift 原生菜单栏 App + WKWebView 内嵌 Dashboard | 托盘/菜单栏、Quick Chat（⌥Space）、通知、权限、语音、Canvas、Camera、Mac node 工具、Gateway Profile、远程/SSH/Tailscale/Cloudflare Access、Sparkle 更新 |
| Linux/Windows | Tauri v2 薄壳 + 内嵌 Control UI | 托盘、Quick Chat、Gateway 发现/安装/启停、Gateway Profile、远程 SSH 隧道、pending approvals、keep-awake、原生浏览器、更新 |
| iOS | 原生 Swift App，作为 `role: node` | 聊天、语音、审批、通知、设备能力、Watch 伴侣 |
| Android | 原生 Kotlin App，作为 companion node | 配对、聊天、模型/推理选择、会话权限、主题、语音、Wear OS |
| Control UI | SolidJS + Vite SPA，由 Gateway 直接托管 | 聊天、Agents、Channels、Config、Systems、Logs、Sessions、Cron、Skills、Models、Devices、Approvals、Usage、Worktrees、Terminal、Workboard 等 40+ 页面 |

### 2.2 官方薄壳的功能清单（ClawX 可直接对照）

`apps/linux/src-tauri/src/` 的模块本身就是一份“桌面端职责清单”：

- 连接与 Gateway：`gateway.rs`、`gateway_ws.rs`、`gateway_profiles.rs`、`remote_gateway.rs`、`discovery.rs`、`gateway_sleep.rs`、`first_run.rs`
- 原生能力：`tray.rs`、`quickchat.rs`、`quickchat_widgets.rs`、`notify.rs`、`keep_awake.rs`、`native_browser.rs`、`chrome_setup.rs`、`window_chrome*.rs`
- 运行时与更新：`bundled_runtime*.rs`、`installer.rs`、`updater.rs`、`runtime_action.rs`
- 安全/审批：`pending_approvals.rs`、`gateway_control_auth*.rs`、`gateway_device_identity.rs`

### 2.3 官方“复用优先”的具体证据

- Tauri `tauri.conf.json` 的 `frontendDist` 直接指向 `../ui`（Control UI 构建产物），没有第二套业务 UI。
- `ui/src/api/gateway.ts` 直接依赖已发布的 `@openclaw/gateway-client/browser`，使用其连接、重连、scope upgrade、设备 token 逻辑。
- `@openclaw/gateway-client@2026.10.5`、`@openclaw/gateway-protocol@2026.10.5` 已在 npm 发布。
- macOS App 把 Dashboard 作为 WKWebView 内容，原生层只补系统能力（权限、通知、语音、Canvas、摄像头、CLI 安装）。

---

## 3. ClawX 架构与重复面

### 3.1 规模

| 区域 | 行数 |
| --- | ---: |
| `src/pages` | 12,817 |
| `src/components` | 11,262 |
| `src/lib` | 6,996 |
| `electron/services` | 12,013 |
| `electron/gateway` | 6,801 |
| `electron/utils` | 20,206 |
| `shared` | 2,864 |
| `tests/unit` | 65,187 |
| `tests/e2e` | 17,618 |

### 3.2 页面与官方 Control UI 的重叠

| ClawX 页面 | LOC | 官方对应 | 判断 |
| --- | ---: | --- | --- |
| Chat | 5,168 | `ui/pages/chat` | 核心体验，保留；但可借用官方 streaming/outbox/restart 处理 |
| Cron | 1,953 | `ui/pages/cron` | 高度重复，可在内嵌 Control UI 后退役 |
| Settings | 1,157 | `config` / `systems` / `profile` / `secrets` | 大部分重复，仅保留 App 偏好/更新/开发者入口 |
| Channels | 1,001（+ 1,015 modal） | `ui/pages/channels` | 通用渠道重复；中文渠道配置是差异化，保留 |
| Models | 893（+ 1,804 ProvidersSettings） | `model-providers` / `model-setup` | 通用模型/Provider 重复；中文 Provider/OAuth 引导保留 |
| Agents | 880 | `agents` / `agents-home` | 重复，可退役 |
| Skills | 804 | `skills` / `skill-workshop` | 重复，可退役 |
| Setup | 870 | `connection` / `first-run` | 一键安装是差异化，保留 |
| ComputerUse | 91（+ CUA runtime） | `device(s)` / `systems` | 本地 CUA 是差异化，保留 |

### 3.3 Main 进程的重复实现

| 模块 | 行数 | 与 OpenClaw 的重叠 |
| --- | ---: | --- |
| `electron/utils/openclaw-auth.ts` | 4,159 | 配置 schema、Provider 迁移、配置清洗 |
| `electron/utils/channel-config.ts` | 1,931 | 渠道配置 schema/规范化 |
| `electron/utils/plugin-install.ts` | 1,151 | 插件安装、版本解析、install 记录 |
| `electron/utils/agent-config.ts` | 988 | Agent 配置写入 |
| `electron/services/providers/**` | 2,668 | Provider 目录、校验、运行时同步 |
| `electron/gateway/ws-client.ts` + `device-identity.ts` | 501 | Gateway 连接、设备签名、重连 |

> OpenClaw 2026.10.5 已提供 `gateway-client`/`gateway-protocol`、插件版本自动匹配、配置 schema、Control UI 配置编辑；这些重复实现有明确的收敛空间。

---

## 4. 可以借鉴的清单（按价值排序）

### P0：连接层与桌面壳能力

1. **采用官方 Gateway 客户端包**
   - 依赖：`@openclaw/gateway-client@2026.10.5`、`@openclaw/gateway-protocol@2026.10.5`（均已发布）。
   - 替换：`electron/gateway/ws-client.ts`（354 行）、`device-identity.ts`（147 行）中的 challenge/重连/scope/设备 token 逻辑，以及分散在 `manager.ts` 的连接错误处理。
   - 收益：协议漂移风险下降；重连/scope upgrade/设备认证与官方 UI 一致；减少自维护测试。

2. **连接管理升级为“Gateway Profiles + 远程连接”**
   - 官方能力：保存多个 Gateway、远程 SSH 隧道、Tailscale、Cloudflare Access、Bonjour 发现、连接/诊断窗口。
   - ClawX 现状：只管理本机 Gateway，`gateway.remote` / SSH / profile 均无实现。
   - 收益：支持“桌面 App + 远程 Gateway/服务器”这一官方主推用法，直接扩大使用场景。

3. **Quick Chat（全局快捷键 + 轻量输入窗）**
   - 官方：macOS ⌥Space；Tauri `quickchat.rs` + `quickchat_widgets.rs`。
   - ClawX 现状：有托盘菜单 “Open Chat”，无全局快捷键/轻量窗。
   - 收益：日常高频入口，明显提升桌面端体验。

4. **原生权限/节点能力引导**
   - 官方 macOS：屏幕录制、辅助功能、通知、摄像头、桌面共享等权限引导与 node 工具。
   - ClawX：有 CUA 与权限相关代码，但缺少统一的“本机能力”设置页与授权引导。
   - 收益：降低 CUA/桌面自动化的首次使用失败率。

5. **keep-awake / pending approvals / tray 快捷操作**
   - 官方 Tauri 已有独立模块；ClawX 无 keep-awake，托盘仅少量菜单。
   - 收益：长任务不被系统睡眠打断；审批在托盘/通知中可见。

### P1：会话与 UI 行为

6. **重启/断线期间的 UI 状态机**
   - 官方 Control UI：重启期间暂停读请求、会话列表保持、outbox/draft 恢复、指数退避、`Starting up` 占位。
   - ClawX 已有部分恢复逻辑，但可对照官方文档逐项补齐（draft/outbox、session groups、restart banner）。

7. **会话管理能力**
   - 官方：session snooze、颜色、分组、worktrees、subagents/processes 面板、device/approval 页面。
   - ClawX：`snooze`/`session group` 零实现，`worktree` 仅少量引用。
   - 收益：长会话/多任务用户可管理性显著提升。

8. **每会话 Browser/Terminal/Desktop 面板**
   - 官方 Control UI 把 Browser/Terminal/Desktop 绑定到会话；ClawX 只有独立 ComputerUse 页面。
   - 收益：减少上下文切换；与官方能力对齐。

9. **内嵌 Control UI 作为“高级设置/诊断”入口**
   - 官方 Tauri/macOS 都内嵌 Dashboard；ClawX 仅提供外部浏览器打开。
   - 建议：Electron 用 `WebContentsView`/`BrowserView` 内嵌本地 Control UI，处理 token/导航；App 偏好类页面保留 React。
   - 收益：Config、Logs、Systems、Devices、Usage、Plugins、Worktrees 等页面无需继续自研。

### P2：工程与更新

10. **更新模型对齐官方 appcast/updater 语义**（ClawX 已有 electron-updater，可借鉴签名/通道/回滚策略，而非重写）。
11. **共享 UI 基础包**：`@openclaw/libterminal@0.3.10` 已发布，可用于终端面板；其余 UI 包未发布，不能直接复用。
12. **测试策略**：官方按协议包做契约测试；ClawX 已有 220 个单测文件 / 194 个 E2E，保持即可，重点是把运行时补丁的白盒测试上移为协议/行为测试。

---

## 5. 可以删除/收敛的清单

### 5.1 立即可删（已用可达性 + 引用扫描验证）

| 文件 | 证据 | 处理 |
| --- | --- | --- |
| `electron/utils/openrouter-headers-preload.cjs` | 全仓零引用；`process-launcher.ts` 已有同样的内联 fetch patch | 删除 |
| `electron/main/provider-model-sync.ts` | 仅 `tests/unit/provider-model-sync.test.ts` 引用；生产路径使用 `provider-runtime-sync.ts` | 删除模块与对应测试 |
| `src/lib/acp/subagent-lineage.ts` | 5 行重复 re-export；生产代码零引用，仅 `tests/unit/acp-subagent-lineage.test.ts` 引用 | 删除，测试改为直接引用 shared |
| `src/extensions/index.ts` | 未被任何入口引用（消费者直接 import `registry`/`types`） | 可删；如作为公共 API 则保留 |
| `electron/extensions/index.ts` | 同上 | 可删；如作为公共 API 则保留 |
| `shared/acp-chat/contract-assertions.ts` | 仅测试引用 | 移到 `tests/fixtures/` 或 `tests/unit` 辅助目录 |

### 5.2 冗余直接依赖（源码零引用；`pnpm why` 显示均为上游传递依赖）

| 依赖 | 证据 | 处理 |
| --- | --- | --- |
| `chart.js` | 仅 `pptxviewjs` 传递依赖；源码无 import | 删除直接声明 |
| `chokidar` | 实际由 `tailwindcss` 传递引入 | 删除直接声明 |
| `ms` | 由 `debug` 等传递引入 | 删除直接声明 |
| `undici` | 由 `node-gyp` 传递引入 | 删除直接声明 |
| `@homebridge/ciao` | 源码零引用；openclaw 自带 1.3.12 | 删除直接声明 |
| `zod` | 源码零引用；openclaw/lark 自带 | 删除直接声明 |
| `@sinclair/typebox` | 源码零引用；lark 自带 | 删除直接声明 |
| `pdfjs-dist` | 源码零引用 | 删除直接声明 |
| `@radix-ui/react-select` / `react-radio-group` / `react-toast` | 源码零引用 | 删除直接声明 |
| `@types/diff` | `diff@9` 自带类型（npm 已标记废弃） | 删除 |

> 注意：删除后必须跑 `pnpm install`、`typecheck`、`test`、`build:vite`、`bundle-openclaw`，确认没有隐式 peer/hoist 依赖。

### 5.3 体积优化（单架构打包可省约 120MB+）

| 项目 | 当前体积 | 证据 | 处理 |
| --- | ---: | --- | --- |
| CUA 双架构 SDK | openclaw 侧 54MB×2；asar 侧 49MB×2 | `build/openclaw/node_modules/@trycua/*`、`app.asar.unpacked/node_modules/@trycua/*` | 打包时按目标架构裁剪；单架构可省约 **103MB** |
| Control UI 静态资源 | 58MB | `Resources/openclaw/dist/control-ui` | 保留“打开 Control UI”就保留；若改为内嵌可复用同一份；若删除该入口则移除 |
| OpenClaw 文档 | 21MB | `build/openclaw/docs` | 仅保留 prompt 模板所需文件，可省约 19MB |
| bundled extensions | 170MB | `dist/extensions/*`（browser 33M、agentsapi 16M、telegram 10M、workboard 8.9M…） | 不建议盲删；按 ClawX 实际暴露能力做 allowlist，可省 50–100MB |
| `npm` 运行时 | 13MB | `build/openclaw/node_modules/npm` | 若禁用 OpenClaw 自更新可移除；需确认 doctor/update 路径 |
| 两套插件打包管线 | `bundle-openclaw-plugins.mjs` 250 行 + `after-pack.cjs` 1,099 行 | 两者都做插件镜像/依赖复制 | 合并为一条管线，减少重复逻辑与打包时间 |

### 5.4 功能级重复（需要产品决策，不建议直接删）

在“内嵌 Control UI”落地后，可退役或降级：

- **Cron 页面 + `cron-api`**：1,953 + 676 行。
- **Skills 页面 + 本地 skill 管理**：804 + `skill-config` 549 + `skill-quick-access` 415 行。
- **Models 页面 + ProvidersSettings + provider services**：893 + 1,804 + 2,668 行（保留中文 Provider/OAuth 引导）。
- **Agents 页面 + `agent-config`**：880 + 988 行。
- **Settings 的高级/诊断部分**：1,157 行中的 Config/Logs/Systems 部分。
- **通用渠道配置**（Telegram/Discord/WhatsApp）保留渠道接入但可复用 Control UI；中文渠道配置保留。
- **Main 配置清洗/插件安装**：`openclaw-auth` 4,159 + `channel-config` 1,931 + `plugin-install` 1,151 + `agent-config` 988 = **8,229 行**，可改为“读取 OpenClaw plugin manifest/schema 自动生成表单 + 调用 CLI/Control UI 写入”。
- **运行时补丁**：`patches/openclaw@2026.10.5.patch` 1,029 行；把通用部分（compaction id、ambient streaming）提交上游，ClawX 只保留中文/产品特化补丁。

### 5.5 不要删（ClawX 的差异化）

- 中文渠道生态：WeCom / 微信 / 钉钉（含 `dws`）/ 飞书 / QQ。
- 一键安装、内置运行时、启动/更新提示、离线可用。
- Provider 引导（含 TokenDance OAuth、中文 Provider 目录）。
- CUA 本地 computer-use。
- 文件预览（docx/pptx/pdf/Markdown）、Issue Report、语音听写、i18n（en/zh/ja/ru）。
- 现有 220 个单测文件 / 194 个 E2E 的回归保护。

---

## 5.6 Phase 1 执行记录（2026-10-19）

本轮已落地以下低风险项，并完成验证：

- 删除死代码：`electron/utils/openrouter-headers-preload.cjs`、`electron/main/provider-model-sync.ts`、`src/lib/acp/subagent-lineage.ts`，以及仅覆盖死模块的 `tests/unit/provider-model-sync.test.ts`。
- `tests/unit/acp-subagent-lineage.test.ts` 改为直接引用 `@shared/acp-chat/subagent-lineage`。
- 删除 12 个冗余直接依赖：`chart.js`、`chokidar`、`ms`、`undici`、`@homebridge/ciao`、`zod`、`@sinclair/typebox`、`pdfjs-dist`、`@radix-ui/react-select`、`@radix-ui/react-radio-group`、`@radix-ui/react-toast`、`@types/diff`。
- `scripts/after-pack.cjs` 增加 `@trycua` 平台包裁剪，openclaw 运行时与 `app.asar.unpacked` 两处都只保留目标架构；macOS arm64 包从 1.3GB 降到 1.2GB（约省 103MB）。
- 保留 `src/extensions/index.ts`、`electron/extensions/index.ts` 作为潜在公共 API（当前无引用，删除与否可再评估）。
- 验证：`typecheck` 通过；单元测试 219 files / 2627 passed / 3 skipped；`build:vite` 与 `bundle-openclaw.mjs` 通过；macOS `--dir` 打包裁剪日志确认 `Removed 7 non-target native platform packages` 与 `Removed 1 non-target native package(s) from app.asar.unpacked`。

## 6. 建议路线图

| 阶段 | 内容 | 预计收益 | 风险 |
| --- | --- | --- | --- |
| 1（1–2 天） | 删除 5.1 死代码 + 5.2 冗余依赖；按架构裁剪 CUA SDK；精简 docs | 约 -120MB 包体，-500 行死代码，依赖更干净 | 低 |
| 2（1–2 周） | 接入 `@openclaw/gateway-client`/`gateway-protocol`；补 Gateway Profiles + 远程/SSH/Tailscale；Quick Chat | 连接稳定性/场景扩展/桌面体验 | 中 |
| 3（2–4 周） | 内嵌 Control UI，退役 Cron/Skills/Agents/通用 Models/Settings 高级页 | 约 -5k~7k 行页面代码 + 大量维护成本 | 中高（双 UI 过渡） |
| 4（持续） | 配置/插件层 schema 化；运行时补丁上游化；插件打包管线合并 | 约 -8k 行 Main 代码，补丁面缩小 | 高（需兼容性回归） |

### 验证命令

```bash
pnpm install
pnpm run typecheck
pnpm test
pnpm run build:vite
npx zx scripts/bundle-openclaw.mjs
npx zx scripts/bundle-openclaw-plugins.mjs
pnpm exec playwright test --project=exclusive --project=parallel --workers=1
```

---

## 7. 附：本次扫描的“不可达文件”原始结果

```
electron/extensions/index.ts
electron/main/provider-model-sync.ts
electron/utils/openrouter-headers-preload.cjs
shared/acp-chat/contract-assertions.ts
src/extensions/index.ts
src/lib/acp/subagent-lineage.ts
```

扫描入口：`src/main.tsx`、`electron/main/index.ts`、`electron/preload/index.ts`；排除测试/声明文件/构建产物。
