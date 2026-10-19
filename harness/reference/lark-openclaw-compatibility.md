# Lark/Feishu 与 OpenClaw 2026.10.5 兼容性评估

本文记录 `@larksuite/openclaw-lark` 在 ClawX 升级到 OpenClaw 2026.10.5 后的实测结果，
以及参考腾讯 WeCom/Weixin 的 CLI + skill 方案做兼容的可行性。

## 结论

| 问题 | 结论 |
| --- | --- |
| `@larksuite/openclaw-lark@2026.7.16` 支持 OpenClaw 2.0+ 吗？ | **不支持 2026.8.1 及以后**。实际可用范围是 **OpenClaw >=2026.5.4 且 <=2026.7.35**。 |
| 支持 2026.10.5 吗？ | **不支持**。Gateway 加载时报 `ERR_PACKAGE_PATH_NOT_EXPORTED`。 |
| 支持 2026.2.x 吗？ | 不支持；插件声明的 peer 下限是 `openclaw >=2026.5.4`。 |
| 有更新的 Lark 插件版本吗？ | 没有。npm `latest` 是 2026.7.16，`beta` 是 2026.8.5-beta.0，二者仍使用旧 SDK 入口。 |
| CLI + skill 方案可行吗？ | **可行**，`@larksuite/cli` 已提供官方二进制、事件流、IM 收发和内置 skills；但需要新增一个薄通道桥接层。 |

## 实测证据

### 1. 直接加载插件

```text
$ node -e "require('./node_modules/@larksuite/openclaw-lark/index.js')"
ERR_PACKAGE_PATH_NOT_EXPORTED: Package subpath './plugin-sdk' is not defined by
"exports" in .../openclaw/package.json
```

### 2. 在 2026.10.5 Gateway 中加载

把插件镜像放入临时 state 的 `extensions/feishu-openclaw-plugin`，配置
`plugins.entries.openclaw-lark.enabled=true` 和 `channels.feishu.enabled=true` 后启动 Gateway：

```text
[plugins] openclaw-lark failed during load ...:
Error [ERR_PACKAGE_PATH_NOT_EXPORTED]: Package subpath './plugin-sdk' is not defined
by "exports" in .../openclaw/package.json
```

`openclaw plugins list` 仍会把插件列为 `loaded`（manifest 发现成功，tools 来自 manifest 契约），
但运行时注册失败，`toolNames` 为空，Feishu 通道无法启动。这一点容易误判，必须以 Gateway 启动日志为准。

### 3. 缺失的 SDK 入口

插件引用了 18 个 plugin-sdk 子路径，其中 5 个在 2026.10.5 已不存在：

| 子路径 | 插件使用的符号 | 2026.10.5 替代 |
| --- | --- | --- |
| `openclaw/plugin-sdk`（旧根 barrel） | `emptyPluginConfigSchema` | `plugin-sdk/core` |
| `openclaw/plugin-sdk/channel-runtime` | `createReplyPrefixContext`、`createTypingCallbacks` | `plugin-sdk/channel-outbound` |
| `openclaw/plugin-sdk/config-runtime` | `loadSessionStore`、`resolveSessionStoreEntry`、`resolveStorePath` | 部分符号无公开导出 |
| `openclaw/plugin-sdk/command-auth` | `resolveSenderCommandAuthorization` | 无同名公开导出 |
| `openclaw/plugin-sdk/...`（其余 13 个） | — | 仍存在 |

### 4. SDK barrel 的移除边界

| OpenClaw 版本 | `./plugin-sdk` | `channel-runtime` | `command-auth` | `config-runtime` |
| --- | --- | --- | --- | --- |
| 2026.7.1-2 | ✓ | ✓ | ✓ | ✓ |
| 2026.7.35 | ✓ | ✓ | ✓ | ✓ |
| 2026.8.1 | ✗ | ✗ | ✓ | ✓ |
| 2026.9.33 | ✗ | ✗ | ✓ | ✓ |
| 2026.10.1 / 2026.10.5 | ✗ | ✗ | ✗ | ✗ |

OpenClaw 的兼容性文档说明：2026 年 7 月的 sweep 移除了过期的 root SDK 等别名。
Lark 插件最后一次发布（2026.7.16）在该 sweep 之前，之后未再更新。

### 5. 补 shim 后的第二层阻断

仅补回上述 5 个入口后，插件可以继续加载，但出现第二个不兼容：

```text
ReferenceError: exports is not defined in ES module scope
```

2026.10.5 的外部插件加载路径按 ESM 执行，而 Lark 插件是 CommonJS 产物且没有 `"type": "commonjs"`。
补 shim 只能解决第一层，还需要处理模块格式（或在加载器层恢复 CJS 加载），因此**不建议**把
"补 SDK 别名"作为长期兼容方案。

## 腾讯 CLI + skill 方案拆解

| 项目 | 组成 | 说明 |
| --- | --- | --- |
| WeCom `@wecom/wecom-openclaw-plugin` | 官方插件 + `wecom-cli` tool + 10 个 `wecomcli-*` skills | 插件注册一个通用 CLI tool；skills 是纯 Markdown，告诉 agent 如何调用该 tool。 |
| WeCom 安装器 `@wecom/wecom-openclaw-cli` | `npx ... install` | 负责安装插件、写入配置、引导设置。 |
| Weixin `@tencent-weixin/openclaw-weixin` | 独立 semver 插件 + 安装器 CLI | 安装器内置兼容矩阵，按宿主 OpenClaw 版本选择插件 dist-tag；插件启动时再次校验宿主版本。 |

共同点：**通道传输由插件负责，业务能力尽量收敛到 CLI + skill**，从而降低对宿主插件 API 的耦合。

## Lark 的 CLI + skill 现状

`@larksuite/cli` 是 Lark 官方、MIT 许可的独立 CLI（当前 npm `latest` 1.0.98）：

- 按平台分发预编译二进制（darwin/linux/windows，amd64/arm64/riscv64），带 `checksums.txt`；
- `lark-cli im +messages-send` / `+messages-reply`：以 user/bot 身份发送文本、Markdown、富文本、媒体；
- `lark-cli event consume <EventKey>`：连接事件总线，输出 NDJSON；`im.message.receive_v1` 包含 chat_id、sender、content 等；
- `lark-cli skills list/read`：读取编译进二进制的官方 skills；
- `lark-cli config init/auth login`：应用配置与 OAuth，支持 keychain。

因此业务能力（文档、表格、日历、IM、邮件、妙记等）可以直接复用官方 CLI + skills，
不需要依赖 OpenClaw 的插件 SDK。

## 推荐架构

### 方案 A：ClawX 侧 CLI 通道桥（短期、改动最小）

1. 按平台下载并校验 `lark-cli`（新增 `scripts/download-bundled-lark-cli.mjs`，模式同 `cua-driver`）；
2. Electron Main 为每个 Lark 账号启动 `lark-cli event consume im.message.receive_v1 --as bot`；
3. 把事件映射为 OpenClaw 会话输入（Gateway RPC / `openclaw agent`），按 `chat_id` 维护 session key；
4. 出站由 agent 通过 `lark-cli im +messages-reply` 完成（skill 驱动），或 Main 监听会话终态后调用 CLI；
5. 将 lark-cli 的官方 skills 预置到 agent workspace。

优点：不依赖 OpenClaw 插件 API，升级宿主时只需验证 CLI 行为；可覆盖文档/日历等大部分能力。
风险：附件/卡片/流式回复、消息去重、多账号隔离、权限与 allowlist 需要 ClawX 自己实现。

### 方案 B：薄 OpenClaw 通道插件 + CLI 后端（长期、最干净）

用 2026.10.5 仍导出的 focused SDK 子路径写一个薄插件：
- 入站：`lark-cli event consume` 子进程；
- 出站：`lark-cli im`；
- 业务能力：注册 `lark-cli` tool + 官方 skills（与 WeCom 的 `wecom-cli` 模式一致）。

优点：会话路由、回复投递、权限、目录等继续由 OpenClaw 管理；CLI 只做传输/工具。
风险：需要维护一个独立插件包，并跟随 OpenClaw 的通道 SDK 演进。

### 方案 C：补 SDK 别名（不推荐）

只补 5 个入口不足以解决 ESM/CJS 加载差异，且后续通道 API 仍可能漂移；适合作为临时止血，不适合发布。

## 建议

1. **版本门控**：ClawX 在 OpenClaw <=2026.7.35 使用原生 Lark 插件；>=2026.8.1 切换到方案 A 或 B。
2. **短期**先做方案 A 的 MVP（文本消息 + 文档/日历 skills），验证真实租户；
3. **中期**把方案 A 收敛为方案 B 的薄插件，避免 ClawX 自己实现通道语义；
4. 在切换完成前，升级到 2026.10.5 的 ClawX 应显式提示 Feishu 通道不可用，而不是静默加载失败。

## 未做事项

本次仅完成兼容性确认与方案评估，未实现 CLI 桥接或新插件。上述实测均在本地
macOS arm64 + OpenClaw 2026.10.5 + `@larksuite/openclaw-lark@2026.7.16` 上完成。
