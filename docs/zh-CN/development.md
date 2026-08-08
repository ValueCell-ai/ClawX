# ClawX 开发文档

本文档是 README「开发指南」一节的详细说明。

### 前置要求

- **Node.js**：对应主版本范围内的 22.22.3+、24.15.0+ 或 25.9.0+（推荐 Node 24 LTS）
- **包管理器**：pnpm 9+（推荐）或 npm
- **Linux（Ubuntu/Debian）**：运行 Electron 前，请先安装所需系统库：
  ```bash
  sudo apt-get install -y libnss3 libgtk-3-0 libxss1 libxtst6 libatspi2.0-0 libnotify4 xdg-utils
  ```
  在 Ubuntu 24.04+ 上，部分软件包使用 `t64` 后缀，运行上述命令后 `apt` 会自动选择正确版本。

### 项目结构

```ClawX/
├── electron/                 # Electron 主进程
│   ├── services/            # 类型化 Host API、Provider、Secrets 与运行时服务
│   │   ├── providers/       # Provider/account 模型同步逻辑
│   │   └── secrets/         # 系统钥匙串与密钥存储
│   ├── shared/              # 共享 Provider schema/常量
│   │   └── providers/
│   ├── main/                # 应用入口、窗口、IPC 注册
│   ├── gateway/             # OpenClaw 网关进程管理
│   ├── preload/             # 安全 IPC 桥接
│   └── utils/               # 工具模块（存储、认证、路径）
├── src/                      # React 渲染进程
│   ├── lib/                 # 前端统一 API 与错误模型
│   ├── stores/              # Zustand 状态仓库（settings/chat/gateway）
│   ├── components/          # 可复用 UI 组件
│   ├── pages/               # Setup/Dashboard/Chat/Channels/Skills/Cron/Settings
│   ├── i18n/                # 国际化资源
│   └── types/               # TypeScript 类型定义
├── tests/
│   ├── e2e/                 # Playwright Electron 端到端冒烟测试
│   └── unit/                # Vitest 单元/集成型测试
├── resources/                # 静态资源（图标、图片）
└── scripts/                  # 构建与工具脚本
```
### 常用命令

```bash
# 开发
pnpm run init             # 安装依赖并下载捆绑二进制（uv、agent-browser）
pnpm dev                  # 以热重载模式启动（若缺失会自动准备预装技能包）

# 代码质量
pnpm lint                 # 运行 ESLint 检查
pnpm typecheck            # TypeScript 类型检查

# 测试
pnpm test                 # 运行单元测试
pnpm run test:e2e         # 运行 Electron E2E 冒烟测试
pnpm run test:e2e:headed  # 以可见窗口运行 Electron E2E 测试
pnpm run perf:chat        # 采集合成 Chat 场景的 Renderer/Main CPU Profile
pnpm run profile:main     # 启动构建产物并在 9229 端口调试 Main
pnpm run comms:replay     # 计算通信回放指标
pnpm run comms:baseline   # 刷新通信基线快照
pnpm run comms:compare    # 将回放指标与基线阈值对比

# 构建与打包
pnpm run build:vite       # 仅构建前端
pnpm build                # 完整生产构建（含打包资源）
pnpm package              # 为当前平台打包（包含预装技能资源）
pnpm package:mac          # 为 macOS 打包
pnpm package:win          # 为 Windows 打包
pnpm package:linux        # 为 Linux 打包
```

在无头 Linux 环境下，Electron 测试需要显示服务；可使用 `xvfb-run -a pnpm run test:e2e`。

Electron E2E 功能测试在本地和 CI 中默认使用两个 Playwright worker；可通过 `CLAWX_E2E_WORKERS=<正整数>` 按机器能力调整普通并行通道。访问操作系统全局状态的测试进入单 worker 的 `exclusive` project，主机性能采样则在功能测试结束后独占运行。新增 E2E 测试默认并行；若测试使用真实剪贴板或其他机器级共享资源，请应用 `tests/e2e/parallel-policy.ts` 中的 `E2E_EXCLUSIVE_TAG`。

如果只需运行一个不依赖独占前置阶段的普通 spec，可使用 `pnpm exec playwright test <spec> --project=parallel --no-deps`。

### Electron 性能诊断

`pnpm run perf:chat` 会运行隔离的合成 ACP 负载，分别覆盖流式响应，以及富 Markdown 静态会话中的侧栏和滚动交互，并在 Playwright 的 `test-results/` 目录输出版本化指标与 Renderer/Main CPU Profile。Renderer Profile 覆盖生产 store/render 路径和帧节奏；流式 Main Profile 测量 Main 到 Renderer 的 IPC fanout，交互 Main Profile 用于确认 Renderer 交互期间 Main 是否保持空闲。两者都不包含上游 OpenClaw/ACP 子进程或 GPU 进程路径。CPU Profile 可直接用 Chrome DevTools 打开；其中只包含生成的测试文本，不会上报为产品遥测。性能数据依赖硬件，应在同一机器上多次运行后对比，不应使用统一的跨平台绝对阈值。

录制真实 Renderer 时，使用 `CLAWX_REMOTE_DEBUGGING_PORT=9223 pnpm dev` 启动开发环境，再让 Playwright 或 Chrome DevTools 连接 `localhost:9223`。录制真实 Electron Main 时，运行 `pnpm run profile:main`，在 `chrome://inspect` 中配置 `localhost:9229` 并选择 Electron Main target。除非正在测量 WebSocket trace 本身，否则不要设置 `CLAWX_GATEWAY_WS_TRACE`。

ClawX 默认保留 Chromium 硬件加速，使长文档、滚动和布局动画能够使用 GPU 合成与光栅化。若某台机器的显卡驱动存在问题，仍可使用 Chromium 原生的 `--disable-gpu` 命令行参数作为排障回退。

### 通信回归检查

当 PR 涉及通信链路（Gateway 事件、ACP Chat bridge 收发流程、Channel 投递、传输回退）时，建议执行：

```bash
pnpm run comms:replay
pnpm run comms:compare
```

CI 中的 `comms-regression` 会校验必选场景与阈值。

### 技术栈

| 层级 | 技术 |
|------|------|
| 运行时 | Electron 40+ |
| UI 框架 | React 19 + TypeScript |
| 样式 | Tailwind CSS + shadcn/ui |
| 状态管理 | Zustand |
| 构建工具 | Vite + electron-builder |
| 测试 | Vitest + Playwright |
| 动画 | Framer Motion |
| 图标 | Lucide React |
