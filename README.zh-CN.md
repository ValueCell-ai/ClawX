
<p align="center">
  <img src="src/assets/logo.svg" width="128" height="128" alt="ClawX Logo" />
</p>

<h1 align="center">ClawX</h1>

<p align="center">
  <strong>OpenClaw AI 智能体的桌面客户端</strong>
</p>

<p align="center">
  <a href="#为什么选择-clawx">为什么选择 ClawX</a> •
  <a href="#快速上手">快速上手</a> •
  <a href="#系统架构">系统架构</a> •
  <a href="#开发指南">开发指南</a> •
  <a href="#参与贡献">参与贡献</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-MacOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-40+-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react" alt="React" />
  <a href="https://discord.com/invite/84Kex3GGAh" target="_blank">
  <img src="https://img.shields.io/discord/1399603591471435907?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb" alt="chat on Discord" />
  </a>
  <img src="https://img.shields.io/github/downloads/ValueCell-ai/ClawX/total?color=%23027DEB" alt="Downloads" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

<p align="center">
  <a href="README.md">English</a> | 简体中文 | <a href="README.ja-JP.md">日本語</a> | <a href="README.ru-RU.md">Русский</a>
</p>

---

## 概述

**ClawX** 是连接强大 AI 智能体与普通用户之间的桥梁。基于 [OpenClaw](https://github.com/OpenClaw) 构建，它将命令行式的 AI 编排转变为易用、美观的桌面体验——无需使用终端。

无论是自动化工作流、连接通讯软件，还是调度智能定时任务，ClawX 都能提供高效易用的图形界面，帮助你充分发挥 AI 智能体的能力。

ClawX 预置了最佳实践的模型供应商配置，原生支持 Windows 平台以及多语言设置。当然，你也可以通过 **设置 → 高级 → 开发者模式** 来进行精细的高级配置。

<p align="center"><strong style="font-size:1.1em; text-decoration: underline;">如需完整的企业版、专属服务支持或面向您业务场景的定制化落地辅导，请联系 <a href="mailto:public@valuecell.ai">public@valuecell.ai</a>。</strong></p>

## 截图预览

<table>
  <tr>
    <td align="center"><img src="resources/screenshot/zh/chat.png" alt="Chat"><br><em>聊天界面</em></td>
    <td align="center"><img src="resources/screenshot/zh/cron.png" alt="Cron"><br><em>定时任务</em></td>
  </tr>
  <tr>
    <td align="center"><img src="resources/screenshot/zh/skills.png" alt="Skills"><br><em>技能管理</em></td>
    <td align="center"><img src="resources/screenshot/zh/channels.png" alt="Channels"><br><em>频道管理</em></td>
  </tr>
  <tr>
    <td align="center"><img src="resources/screenshot/zh/models.png" alt="Models"><br><em>模型配置</em></td>
    <td align="center"><img src="resources/screenshot/zh/settings.png" alt="Settings"><br><em>设置</em></td>
  </tr>
</table>
## 为什么选择 ClawX

构建 AI 智能体不应该需要精通命令行。ClawX 的设计理念很简单：**强大的技术值得拥有一个尊重用户时间的界面**。ClawX 直接基于官方 OpenClaw 核心构建。无需单独安装，我们将运行时嵌入应用内部，提供开箱即用的无缝体验，并致力于与上游 OpenClaw 项目保持严格同步，确保你始终可以使用官方发布的最新功能、稳定性改进和生态兼容性。

| 痛点 | ClawX 解决方案 |
|------|----------------|
| 复杂的命令行配置 | 一键安装，配合引导式设置向导 |
| 手动编辑配置文件 | 可视化设置界面，实时校验 |
| 进程管理繁琐 | 自动管理网关生命周期 |
| 应用更新 | 启动时检查新版本，并在下载或安装前提示确认 |
| 多 AI 供应商切换 | 统一的供应商配置面板 |
| 技能/插件安装复杂 | 内置技能市场与管理界面 |

### 功能特性

- **🎯 零配置门槛**：从安装到第一次 AI 对话，全程指引式图形界面，无需终端命令、YAML 配置或环境变量。
- **💬 智能聊天界面**：多会话上下文与历史记录，流式 Markdown 渲染（语法高亮、CJK 排版、表格、KaTeX 公式）、`@agent` 直接路由与 `/技能` 内联卡片，工作空间优先的会话侧边栏，以及 Markdown、`.docx`、`.pptx` 和本地 HTML 的只读预览。
- **📡 多频道管理**：同时配置和监控多个 AI 频道，每个频道独立运行并支持多账号；内置腾讯官方个人微信渠道插件。
- **⏰ 定时任务自动化**：可视化定义触发器与时间间隔，让 AI 智能体 7×24 小时自动运行；支持周期（每小时/每天/工作日/每周/自定义 cron）与单次执行，并可将结果自动投递到外部频道。
- **🧩 可扩展技能系统**：本地优先的技能管理，扫描托管与 workspace 技能目录，无需依赖 Gateway 即可启用或停用技能；预装文档处理技能（`pdf`、`xlsx`、`docx`、`pptx`）。
- **🔐 安全的供应商集成**：支持 OpenAI、Anthropic、Z.AI / GLM 等供应商，凭证经系统原生密钥链安全存储；提供自定义 Provider、OAuth 登录、图像生成端点与兼容网关的降级探测。
- **🌙 自适应主题**：支持浅色、深色与跟随系统主题。
- **🚀 开机启动控制**：在 设置 → 通用 中开启开机自动启动。
- **🔔 更新提示**：启动时自动检查新版本，由你决定是否下载或安装更新。

> 对于功能细节的完整说明，请参阅 [docs/zh-CN/features.md](docs/zh-CN/features.md)。

### 典型使用场景

- **🤖 个人 AI 助手**：配置一个通用 AI 智能体，可以回答问题、撰写邮件、总结文档并协助处理日常任务——全部通过简洁的桌面界面完成。
- **📊 自动化监控**：设置定时智能体来监控新闻动态、追踪价格变动或监听特定事件，结果将推送到你偏好的通知渠道。
- **💻 开发者效率工具**：将 AI 融入你的开发工作流，使用智能体进行代码审查、生成文档或自动化重复性编码任务。
- **🔄 工作流自动化**：将多个技能串联起来，创建复杂的自动化流水线——处理数据、转换内容、触发操作，全部通过可视化方式编排。

## 快速上手

### 系统要求

- **操作系统**：macOS 11+、Windows 10+ 或 Linux（Ubuntu 20.04+）
- **内存**：最低 4GB RAM（推荐 8GB）
- **存储空间**：1GB 可用磁盘空间

### 安装方式

#### 预构建版本（推荐）

从 [Releases](https://github.com/ValueCell-ai/ClawX/releases) 页面下载适用于你平台的最新版本。

#### 从源码开始

```bash
# 克隆仓库
git clone https://github.com/ValueCell-ai/ClawX.git
cd ClawX

# 初始化项目
pnpm run init

# 以开发模式启动
pnpm dev
```
### 首次启动

首次启动 ClawX 时，**设置向导** 将引导你完成以下步骤：

1. **语言与区域** – 配置你的首选语言和地区
2. **AI 供应商** – 通过 API 密钥或 OAuth（支持浏览器/设备登录的供应商）添加账号
3. **技能包** – 选择适用于常见场景的预配置技能
4. **验证** – 在进入主界面前测试你的配置

> Web search 说明：ClawX 会在 Agent 和 Gateway 两层策略中禁用 OpenClaw 的通用 `web_search` 工具。
> 这也包括 Moonshot（Kimi）搜索；受管浏览器自动化和 `web_fetch` 仍然可用。
>
> 内部工具说明：ClawX 还会在两层策略中对 Agent 禁用 `gateway`、`nodes`、`create_goal`、`get_goal` 和 `update_goal`。ClawX 应用自身的 Gateway RPC 不受影响，消息、会话编排和 Agent 发现工具仍然可用。

### 代理设置

ClawX 内置了代理设置，适用于需要通过本地代理客户端访问外网的场景，包括 Electron 本身、OpenClaw Gateway，以及 Telegram 这类频道的联网请求。

打开 **设置 → 网关 → 代理**，配置以下内容：

- **代理服务器**：所有请求默认使用的代理，填写例如 `http://127.0.0.1:7890`
- **绕过规则**：需要直连的主机，使用分号、逗号或换行分隔
- 在 **开发者模式** 下，还可以单独覆盖：HTTP 代理、HTTPS 代理、ALL_PROXY / SOCKS

> 开发者模式覆盖项、Telegram 代理同步与 **OpenClaw Doctor** 等详细行为说明，请参阅 [docs/zh-CN/proxy-settings.md](docs/zh-CN/proxy-settings.md)。

## 系统架构

ClawX 采用 **双进程 + Host API 统一接入架构**：React 渲染进程只通过统一的 host-api/api-client 抽象与后端交互，协议选择、Gateway 生命周期与 ACP Chat stdio bridge 全部由 Electron 主进程统一管理。

- **进程模型**：Electron 主进程负责窗口、网关进程监控、系统集成与自动更新；OpenClaw Gateway 作为独立运行时进程提供 AI 编排、频道和技能能力；渲染层不直接访问本地端点。
- **配置交付**：Gateway 运行时由 Main 使用 `config.get` / `config.set`，停止或启动中则更新解析后的 JSON5 配置；普通 Provider/Agent/Skill/模型修改不会替换进程，凭据通过 `secrets.reload` 热更新；连续 4 次心跳无响应后才会请求受生命周期保护的自动恢复。
- **ACP Chat**：Chat UI 基于 ACP ([Agent Client Protocol](https://agentclientprotocol.com)) 与 OpenClaw 交互，从而在高速迭代的 OpenClaw 前找到相对稳定的聊天协议面。ACP 走 Main 持有的 stdio bridge，支持配置热重载后的历史回放认证、跨页面持续流式输出，以及由 Main 验证和加载的媒体/附件/文件活动（Changes）展示。当受保护的 Gateway 重启中断已接收的对话轮次时，补丁后的 OpenClaw 运行时会将恢复 run 显式关联到原 ACP prompt，使后续文本和工具活动继续进入同一个内存轮次；之后的历史回放也会以原生 ACP 更新恢复持久化的工具边界。
- **设计原则**：前端调用单一入口、Main 掌控传输策略、优雅恢复（重连/超时/退避）、安全存储与 CORS 安全。

> 完整架构说明（进程图、配置协调、ACP 文件活动语义与 Gateway 排障）请参阅 [docs/zh-CN/architecture.md](docs/zh-CN/architecture.md)。

## 开发指南

### 前置要求

- **Node.js**：22.22.3+ / 24.15.0+（推荐） / 25.9.0+
- **包管理器**：pnpm 9+
- **Linux（Ubuntu/Debian）**：运行 Electron 前需先安装系统库，见 [docs/zh-CN/development.md](docs/zh-CN/development.md)

### 常用命令

```bash
pnpm run init        # 初始化开发环境（安装依赖并下载捆绑运行时）
pnpm dev             # 以热重载模式启动
pnpm lint            # ESLint 检查
pnpm typecheck       # TypeScript 类型检查
pnpm test            # 单元测试
pnpm run test:e2e    # Electron E2E 冒烟测试
pnpm build           # 完整生产构建
pnpm package         # 为当前平台打包（可用 :mac / :win / :linux 后缀）
```

> 项目结构、技术栈、完整命令列表、E2E 并行策略、性能诊断与通信回归检查等细节，请参阅 [docs/zh-CN/development.md](docs/zh-CN/development.md)。

## 参与贡献

我们欢迎社区的各种贡献！无论是修复 Bug、开发新功能、改进文档还是翻译——每一份贡献都让 ClawX 变得更好。

### 如何贡献

1. **Fork** 本仓库
2. **创建** 功能分支（`git checkout -b feature/amazing-feature`），进行开发
3. **提交** 清晰描述的变更，**推送** 到你的分支，并**创建** Pull Request

### 贡献规范

- 遵循现有代码风格（ESLint + Prettier）
- 为新功能编写测试
- 按需更新文档
- 保持提交原子化且描述清晰


## 致谢

ClawX 构建于以下优秀的开源项目之上：

- [OpenClaw](https://github.com/OpenClaw) – AI 智能体运行时
- [Electron](https://www.electronjs.org/) – 跨平台桌面框架
- [React](https://react.dev/) – UI 组件库
- [shadcn/ui](https://ui.shadcn.com/) – 精美设计的组件库
- [Zustand](https://github.com/pmndrs/zustand) – 轻量级状态管理


## 社区

加入我们的社区，与其他用户交流、获取帮助、分享你的使用体验。

| 企业微信 | 飞书群组 | Discord |
| :---: | :---: | :---: |
| <img src="src/assets/community/wecom-qr.png" width="150" alt="企业微信二维码" /> | <img src="src/assets/community/feishu-qr.png" width="150" alt="飞书二维码" /> | <img src="src/assets/community/20260212-185822.png" width="150" alt="Discord 二维码" /> |

### ClawX 合作伙伴计划 🚀

我们正在启动 ClawX 合作伙伴计划，寻找能够帮助我们将 ClawX 介绍给更多客户的合作伙伴，尤其是那些有定制化 AI 智能体或自动化需求的客户。

合作伙伴负责帮助我们连接潜在用户和项目，ClawX 团队则提供完整的技术支持、定制开发与集成服务。如果你服务的客户对 AI 工具或自动化方案感兴趣，欢迎与我们合作。

欢迎私信我们，或发送邮件至 [public@valuecell.ai](mailto:public@valuecell.ai) 了解更多。


## Stars 历史

<p align="center">
  <img src="https://api.star-history.com/svg?repos=ValueCell-ai/ClawX&type=Date" alt="Stars 历史图表" />
</p>


## 许可证

ClawX 基于 [MIT 许可证](LICENSE) 发布。你可以自由地使用、修改和分发本软件。

<hr>


<p align="center">
  <sub>由 ValueCell 团队用 ❤️ 打造</sub>
</p>
