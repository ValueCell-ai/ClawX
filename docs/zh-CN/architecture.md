# ClawX 系统架构

本文档是 README「系统架构」一节的详细说明。

ClawX 采用 **双进程 + Host API 统一接入架构**。渲染进程只调用统一客户端抽象，协议选择与进程生命周期由 Electron 主进程统一管理：

OpenClaw 配置交付也统一由 Electron Main 管理。Gateway 运行时，ClawX 以 `config.get` 返回的权威快照为基线，并通过 `config.set` 提交修改；Gateway 停止或启动中时，同一个协调器只更新解析后的 JSON5 配置文件，不会因此启动 Gateway。因此，普通的 Provider、Agent、Channel、绑定、Skill 和模型修改不会替换 Gateway 进程。完整重启仅保留给代理等进程启动环境变化和用户显式操作。已确认的进程退出与 WebSocket 关闭继续使用现有的自动重连路径。连续前 3 次 WebSocket 心跳无响应只更新诊断，不会因短暂的 pong 延迟中断长时间运行的任务；收到 pong 或任意消息会重置计数，连续第 4 次无响应时，只有在生命周期处于可自动恢复的 running 状态时，才会请求受保护的 Gateway 自动恢复。认证配置写入 SQLite 后，ClawX 会调用 OpenClaw 的 `secrets.reload`，让运行中的 Agent 无需重启即可读取新凭据。

Chat 使用由 Electron Main 持有的 ACP stdio bridge。Main 通过私有进程环境把同一份应用管理的 Gateway token 传给本地子进程，因此运行时配置重载后 ACP 历史回放仍能完成认证。如果受保护的 Gateway 恢复中断了已接收的主会话 run，补丁后的 OpenClaw 运行时会启动独立的恢复 run，并显式携带被中断 run id 作为 lineage。Chat 和 agent events 会保留该 lineage；重连后的 ACP bridge 据此将 pending prompt 接续到新 run，重置该 run 的流式游标，并订阅会话级 tool events。Renderer 不感知 Gateway 运行实例身份，仍通过类型化 host events 渲染同一个内存 ACP timeline。Gateway 继续负责 providers、models、skills、workspace、settings、diagnostics 和 media configuration 等非 Chat 能力。

### ACP 语义权威

对于 ACP 能够提供的每一种 Chat 语义和上下文，ACP 都是优先的语义权威。这包括适用时的 session identity 与路由、工作空间和执行 `cwd`、prompt 与 timeline 状态，以及标准 resource 或附件语义。ACP 提供值或事件时，Main 和 Renderer 必须使用 ACP 的结果，不得用 Gateway 快照、transcript 推断、本地配置或另一套并行投影替代。

只有在上游 ACP 没有对应能力时，才允许绕过 ACP。此类兼容性路径必须保持狭窄、有界，并绑定 session 和 generation；同时必须在相关 Harness reference 或 rule 中记录其原因、事实来源、限制、协调行为和移除条件，不得悄悄演变为竞争性的权威来源。

### ACP 历史权威与有界 transcript 补充

ACP `session/load` 回放是 Chat 历史的首要事实来源。ClawX 不会持久化第二套 ACP ledger、精简 timeline、回放缓存或重建的工具历史。当 OpenClaw 的结构化 ACP event ledger 不可用时，其 ACP adapter 会按 transcript 顺序把持久化的 `toolCall` 和 `toolResult` 记录重建为原生工具更新，并保留 text-tool-text 边界；ClawX 本身不会推断这些记录。OpenClaw 的部分能力目前还没有完全对应的 ACP 实现；例如，assistant 媒体可能不会出现在 ACP 中，Gateway 处理也可能从可见的实时回复中移除 assistant `MEDIA:` 指令。因此，ClawX 只保留有界、带标记、仅存于内存的兼容性补充路径：

- 只有在同一 session 中存在已确认的 `image_generate` 上下文，且完成证据可信或来自获准 transcript 证据时，才可以恢复异步图像生成结果。
- 普通附件可以从持久化的 assistant `__openclaw.media` 规范事实或明确的行首 assistant `MEDIA:` 指令中恢复。这只恢复附件引用和声明的元数据，不恢复周围的 assistant 消息。
- 由于 ACP 回放不提供原始事件时间戳，Main 可以从有界的 transcript JSONL 记录中补充仅包含元数据的整轮耗时，但只能标注已经由 ACP 回放恢复出的回合。
- 如果 cron session 的 ACP 回放完全为空，Main 的类型化 cron-history API 可以提供计划提示词和完成摘要。当已识别的运行摘要带有 OpenClaw 截断标记时，只有在对应 run 的 transcript 更长且共享完整的已持久化摘要前缀时，Main 才可以恢复最终 assistant 文本。

历史读取最多读取最近 1000 条 transcript 消息。一次成功的实时 prompt 会立即读取一次，并在 1500ms 后重试一次。每个补充路径都必须绑定精确的 session、ACP generation、补充操作，并在适用时绑定当前的用户回合；过期、缺失、重复或有歧义的匹配都会被丢弃。这些路径不得重建普通 assistant 消息、thought、tool、plan、permission、文件活动、缺失回合或另一套 Chat 历史，Main 也不得根据 transcript 伪造原生 ACP 事件。标准 ACP resource 仍是首选；上游提供等价内容后，这些兼容性例外应当移除。

打开其它会话或页面时，尚未完成的 ACP 回复仍会继续流式接收。若在回复完成前返回，ClawX 会恢复最新的内存 timeline 并继续显示实时输出；回复完成后，普通 ACP 历史回放仍是唯一事实来源。

ACP assistant 回合会显示整轮耗时。Live 计时跟随客户端观测到的 prompt 生命周期，并在应用内导航后保持连续；历史耗时由 Electron Main 根据有界的 OpenClaw transcript 时间戳计算，而且只能标注 ACP 回放已经恢复出的回合。

ACP Chat 会将标准 ACP resource 渲染为附件。用户选择的图片会显示为缩略图，并在悬停蒙层中显示文件名；其它可用的附件卡片会显示文件名，以及灰色、可截断的来源路径。当前 OpenClaw ACP adapter 遗漏 assistant 媒体时，OpenClaw 持久化的规范媒体事实和显式 assistant `MEDIA:` 指令也可恢复为附件卡片，且不会显示仅用于 transcript 的元数据。现有本地文件引用（包括当前 workspace 外的路径）在每次预览或打开前，都会由 Electron Main 按精确的 session 和 generation 重新验证。AI 生成且可预览的本地附件（包括不超过 20 MB 的 `.docx` 和 `.pptx` 文件）会保留主要的只读应用内预览操作，并提供次级菜单，可通过兼容应用打开，或在 Finder、文件资源管理器或系统文件管理器中显示。对于本地 HTML 附件，该菜单第一项会在右侧预览中打开文件。Office 预览在此处也有相同限制：`.doc` 和 `.ppt` 仍通过系统应用打开，DOCX 的分页效果可能与 Microsoft Word 不同，PPTX 的动画、切换效果和媒体播放不受支持。兼容应用发现仅在 macOS 和 Windows 上可用；在 Linux 上或发现失败时，会静默降级为仅显示文件位置。其它本地文件（包括超过 20 MB 的 Office 文件）会在用户点击后通过系统应用打开。用户选择的文件夹附件在发送后也会保持可用，点击后交给系统文件管理器打开；ClawX 不会读取或预览其中内容。远程 HTTP 和 HTTPS 附件会在用户点击后从外部打开。没有规范媒体事实佐证的普通文本裸路径或行内路径不会被当作附件。

ACP Chat 也可在 runtime 以可信结构化媒体投递图像生成结果时显示生成图片预览。对于可信的 OpenClaw internal-UI 投递和与生图任务关联的最终回复，ClawX 会保留原始的用户可见完成文案，包括只有文本的失败说明，而不会统一替换成通用图片文案。历史 OpenClaw 回放中，assistant 的图片 `MEDIA:` 标记只有在同一会话已记录图像生成任务启动后才会进入内联图片体验。ClawX 通过 Electron Main 的主机媒体处理加载预览，而不是让 Renderer 任意访问文件系统。标准 ACP 图片和 resource 内容仍是首选路径，并会直接渲染。

### ACP 文件活动语义

- 文件活动由成功且已完成的 OpenClaw `write`、`edit` 和 `apply_patch` 调用投影而来。工具识别方式与 OpenClaw 官方 Chat UI 保持一致；仅接收已完成调用的筛选规则是 ClawX 特有的。
- 已创建和已修改的活动行与可预览的 assistant 附件共用同一种文件卡片外壳和**打开方式**菜单，同时保留状态文字及可用的 `+/-` 统计。对于 HTML 文件，菜单第一项会在右侧**预览**中打开文件；已删除的活动行只保留 **Changes** 操作。应用列表、指定应用打开和显示文件位置都会由 Electron Main 根据 workspace 根目录与相对路径分别重新验证；工具路径不会因此变成附件，Renderer 也不会获得规范化系统路径。
- `write` 按工具声明的语义显示：视为创建，并展示为全部新增的差异，即使该路径可能已经存在。
- **Changes** 是按时间顺序记录工具声明活动的会话级记录，不是 Git 输出，也不是相对于已验证源码基线的差异。
- 对每个文件，Changes 在每轮助手回复中最多展示一个 diff 编辑器。可安全串联的片段会合并，独立片段会拼接到同一个编辑器中，但不会被描述为基于完整文件基线的差异。
- Shell 命令、脚本、用户或 IDE 产生的副作用不会被检测。
- 完整的 ACP 回放可以恢复已记录的文件活动；如果回放不完整，ClawX 不会通过回退推断来补造缺失活动。

```
┌───────────────────────────────────────────────────────────────────┐
│                        ClawX 桌面应用                              │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │              Electron 主进程                                 │  │
│  │  • 窗口与应用生命周期管理                                       │  │
│  │  • 网关进程监控                                               │  │
│  │  • 系统集成（托盘、通知、密钥链）                                │  │
│  │  • 自动更新编排                                               │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              │ IPC (权威控制面)                     │
│                              ▼                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │              React 渲染进程                                  │  │
│  │  • 现代组件化 UI（React 19）                                  │  │
│  │  • Zustand 状态管理                                          │  │
│  │  • 统一 host-api/api-client 调用                             │  │
│  │  • 回复使用 Markdown，用户输入按原文显示                         │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬───────────────────────────────────┘
                               │
                               │ 类型化 IPC 请求
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  主进程 Host Services 与 Gateway Manager          │
│                                                                 │
│  • host:invoke 类型化服务分发                                      │
│  • 设置、文件、会话、技能、供应商、诊断服务                           │
│  • 主进程持有 Gateway WebSocket 并负责进程监控                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ 主进程持有 WebSocket
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw 网关                                │
│                                                                 │
│  • AI 智能体运行时与编排                                           │
│  • 消息频道管理                                                   │
│  • 技能/插件执行环境                                               │
│  • 供应商抽象层                                                   │
└─────────────────────────────────────────────────────────────────┘
```
### 设计原则

- **进程隔离**：AI 运行时在独立进程中运行，确保即使在高负载计算期间 UI 也能保持响应
- **前端调用单一入口**：渲染层统一走 host-api/api-client，不感知底层协议细节
- **主进程掌控传输策略**：ACP Chat stdio bridge 与 Gateway 传输都由 Electron Main 持有，渲染进程通过类型化 IPC 调用 Main
- **扩展 IPC 贡献点**：主进程扩展通过类型化 IPC 注册表贡献 host-api action，而不是挂载 HTTP route
- **优雅恢复**：内置重连、超时、退避逻辑，自动处理瞬时故障
- **安全存储**：API 密钥和敏感数据利用操作系统原生的安全存储机制
- **CORS 安全**：渲染进程不直接请求本地 Gateway 或 Host API HTTP 端点

### 进程模型与 Gateway 排障

- ClawX 基于 Electron，**单个应用实例出现多个系统进程是正常现象**（main/renderer/zygote/utility）。
- 单实例保护同时使用 Electron 自带锁与本地进程文件锁回退机制，可在桌面会话总线异常时避免重复启动。
- 滚动升级期间若新旧版本混跑，单实例保护仍可能出现不对称行为。为保证稳定性，建议桌面客户端尽量统一升级到同一版本。
- 但 OpenClaw Gateway 监听应始终保持**单实例**：`127.0.0.1:18789` 只能有一个监听者。
- Gateway readiness 以 OpenClaw 的 `system-presence`、`health`、`status` 等核心信号为准；memory 或频道失败会显示为能力降级，而不是全局 Gateway 故障。
- 可用以下命令确认监听进程：
  - macOS/Linux：`lsof -nP -iTCP:18789 -sTCP:LISTEN`
  - Windows（PowerShell）：`Get-NetTCPConnection -LocalPort 18789 -State Listen`
- 点击窗口关闭按钮（`X`）默认只是最小化到托盘，并不会完全退出应用。请在托盘菜单中选择 **Quit ClawX** 执行完整退出。
