
<p align="center">
  <img src="src/assets/logo.svg" width="128" height="128" alt="ClawX Logo" />
</p>

<h1 align="center">ClawX</h1>

<p align="center">
  <strong>The Desktop Interface for OpenClaw AI Agents</strong>
</p>

<p align="center">
  <a href="#why-clawx">Why ClawX</a> •
  <a href="#getting-started">Getting Started</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#development">Development</a> •
  <a href="#contributing">Contributing</a>
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
  English | <a href="README.zh-CN.md">简体中文</a> | <a href="README.ja-JP.md">日本語</a> | <a href="README.ru-RU.md">Русский</a>
</p>

---

## Overview

**ClawX** bridges the gap between powerful AI agents and everyday users. Built on top of [OpenClaw](https://github.com/OpenClaw), it transforms command-line AI orchestration into an accessible, beautiful desktop experience - no terminal required.

Whether you're automating workflows, managing AI-powered channels, or scheduling intelligent tasks, ClawX provides the interface you need to harness AI agents effectively.

ClawX comes pre-configured with best-practice model providers and natively supports Windows as well as multi-language settings. You can also fine-tune advanced configurations via **Settings -> Advanced -> Developer Mode**.

<p align="center"><strong style="font-size:1.1em; text-decoration: underline;">For a full enterprise edition, dedicated service support, or tailored deployment guidance for your business scenario, contact us at <a href="mailto:public@valuecell.ai">public@valuecell.ai</a>.</strong></p>

## Screenshots

<table>
  <tr>
    <td align="center"><img src="resources/screenshot/en/chat.png" alt="Chat"><br><em>Chat</em></td>
    <td align="center"><img src="resources/screenshot/en/cron.png" alt="Cron"><br><em>Scheduled tasks</em></td>
  </tr>
  <tr>
    <td align="center"><img src="resources/screenshot/en/skills.png" alt="Skills"><br><em>Skills</em></td>
    <td align="center"><img src="resources/screenshot/en/channels.png" alt="Channels"><br><em>Channels</em></td>
  </tr>
  <tr>
    <td align="center"><img src="resources/screenshot/en/models.png" alt="Models"><br><em>Models</em></td>
    <td align="center"><img src="resources/screenshot/en/settings.png" alt="Settings"><br><em>Settings</em></td>
  </tr>
</table>

## Why ClawX

Building AI agents shouldn't require mastering the command line. ClawX was designed with a simple philosophy: **powerful technology deserves an interface that respects your time.** ClawX is built directly upon the official **OpenClaw** core. Instead of requiring a separate installation, we embed the runtime within the application for a seamless, battery-included experience. We stay closely aligned with upstream OpenClaw so you can benefit from the latest official capabilities, stability improvements, and ecosystem compatibility.

| Challenge | ClawX Solution |
|-----------|----------------|
| Complex CLI setup | One-click installation with a guided setup wizard |
| Configuration files | Visual settings with real-time validation |
| Process management | Automatic Gateway lifecycle management |
| App updates | Startup update checks with a prompt before downloading or installing |
| Multiple AI providers | Unified provider configuration panel |
| Skill/plugin installation | Local-first skill management with an optional extension-provided marketplace |

### Features

- **🎯 Zero Configuration Barrier**: Complete setup through an intuitive graphical interface - no terminal commands, YAML files, or environment-variable hunting.
- **💬 Intelligent Chat Interface**: Multi-session context and history, streaming Markdown with syntax highlighting, CJK-aware parsing, tables, KaTeX math, direct `@agent` routing, inline `/skill` cards, workspace-first sessions, and read-only previews for Markdown, `.docx`, `.pptx`, and local HTML.
- **📡 Multi-Channel Management**: Configure and monitor independent AI channels with multiple accounts, per-account agent binding, default-account switching, and the bundled official Tencent personal WeChat channel plugin.
- **⏰ Cron-Based Automation**: Define recurring or one-time schedules, insert skills into scheduled prompts, and deliver results to external channels.
- **🧩 Extensible Skill System**: Manage skills locally without depending on the Gateway, discover skills from multiple OpenClaw sources, and use bundled document-processing skills for `pdf`, `xlsx`, `docx`, and `pptx`.
- **🔐 Secure Provider Integration**: Connect OpenAI, Anthropic, Z.AI / GLM, and other providers with credentials stored in the native system keychain; supports OAuth, custom providers, image-generation endpoints, and compatibility fallbacks.
- **🌙 Adaptive Theming**: Choose light mode, dark mode, or system-synchronized themes.
- **🚀 Startup Launch Control**: Enable **Launch at system startup** in **Settings -> General**.
- **🔔 Update Prompts**: Check for new versions at startup and choose whether to download or install them.

> For full feature details, see [docs/en-US/features.md](docs/en-US/features.md).

### Typical Use Cases

- **🤖 Personal AI Assistant**: Configure a general-purpose AI agent to answer questions, draft emails, summarize documents, and help with everyday tasks from a clean desktop interface.
- **📊 Automated Monitoring**: Schedule agents to monitor news feeds, track prices, or watch for specific events, with results delivered to your preferred notification channel.
- **💻 Developer Productivity**: Integrate AI into your development workflow for code review, documentation generation, and repetitive coding tasks.
- **🔄 Workflow Automation**: Chain multiple skills into visual automation pipelines that process data, transform content, and trigger actions.

## Getting Started

### System Requirements

- **Operating System**: macOS 11+, Windows 10+, or Linux (Ubuntu 20.04+)
- **Memory**: 4GB RAM minimum (8GB recommended)
- **Storage**: 1GB available disk space

### Installation

#### Pre-built Releases (Recommended)

Download the latest release for your platform from the [Releases](https://github.com/ValueCell-ai/ClawX/releases) page.

#### Build from Source

```bash
# Clone the repository
git clone https://github.com/ValueCell-ai/ClawX.git
cd ClawX

# Initialize the project
pnpm run init

# Start in development mode
pnpm dev
```

### First Launch

When you launch ClawX for the first time, the **Setup Wizard** will guide you through:

1. **Language & Region** - Configure your preferred locale
2. **AI Provider** - Add providers with API keys or OAuth for providers that support browser or device login
3. **Skill Bundles** - Select pre-configured skills for common use cases
4. **Verification** - Test your configuration before entering the main interface

The wizard preselects your system language when it is supported, and falls back to English otherwise.

> Web search note: ClawX disables OpenClaw's general-purpose `web_search` tool at both the agent and Gateway policy layers. This includes Moonshot (Kimi) search; managed browser automation and `web_fetch` remain available.
>
> Internal tool note: ClawX also disables `gateway`, `nodes`, `create_goal`, `get_goal`, and `update_goal` for agents at both policy layers. Application-owned Gateway RPCs remain available, as do messaging, session orchestration, and agent discovery tools.

### Proxy Settings

ClawX includes built-in proxy settings for Electron, the OpenClaw Gateway, and channels such as Telegram that need to reach the internet through a local proxy client.

Open **Settings -> Gateway -> Proxy** to configure the default proxy, bypass rules, and optional developer-mode overrides for HTTP, HTTPS, and `ALL_PROXY` / SOCKS. A local example is `http://127.0.0.1:7890`.

> For proxy fallback behavior, Telegram synchronization, and **OpenClaw Doctor**, see [docs/en-US/proxy-settings.md](docs/en-US/proxy-settings.md).

## Architecture

ClawX uses a **dual-process architecture with a unified Host API layer**: the React renderer calls one client abstraction, while Electron Main owns protocol selection, Gateway lifecycle, and the ACP Chat stdio bridge.

- **Process model**: Electron Main owns the window, Gateway supervision, system integration, and updates; the OpenClaw Gateway provides AI orchestration, channel, and skill capabilities; the renderer does not access local endpoints directly.
- **Configuration delivery**: Main uses `config.get`/`config.set` while the Gateway is running and updates the resolved JSON5 config while it is stopped or starting; ordinary provider, agent, skill, and model changes do not replace the process, credentials are hot-reloaded through `secrets.reload`, and guarded recovery starts after four consecutive heartbeat misses.
- **ACP Chat**: Chat UI talks to OpenClaw via [ACP (Agent Client Protocol)](https://agentclientprotocol.com), providing a relatively stable chat protocol surface in front of the rapidly iterating OpenClaw. ACP runs through a Main-owned stdio bridge, supporting authenticated history replay after config reloads, streaming across navigation, and Main-validated media, attachments, and file activity. When a guarded Gateway restart interrupts an accepted turn, the patched OpenClaw runtime explicitly links its recovery run to the original ACP prompt so subsequent text and tool activity continue in the same in-memory turn; later history replay restores persisted tool boundaries as native ACP updates.
- **Design principles**: One frontend entry point, Main-owned transport, graceful recovery with reconnect/timeout/backoff, secure storage, and CORS-safe boundaries.

> For the process diagram, configuration coordination, ACP file activity semantics, and Gateway troubleshooting, see [docs/en-US/architecture.md](docs/en-US/architecture.md).

## Development

### Prerequisites

- **Node.js**: 22.22.3+, 24.15.0+, or 25.9.0+ within the corresponding supported major line (Node 24 LTS recommended)
- **Package Manager**: pnpm 9+ (npm is also supported)
- **Linux (Ubuntu/Debian)**: Install required system libraries before running Electron; see [docs/en-US/development.md](docs/en-US/development.md)

### Common Commands

```bash
pnpm run init        # Install dependencies and download bundled runtimes
pnpm dev             # Start in development mode with hot reload
pnpm lint            # Run ESLint
pnpm typecheck       # TypeScript validation
pnpm test            # Run unit tests
pnpm run test:e2e    # Run Electron E2E smoke tests
pnpm build           # Full production build
pnpm package         # Package for the current platform (:mac / :win / :linux)
```

> For the project structure, complete command list, E2E parallel policy, performance diagnostics, communication regression checks, and tech stack, see [docs/en-US/development.md](docs/en-US/development.md).

## Contributing

We welcome contributions from the community! Whether it's bug fixes, new features, documentation improvements, or translations, every contribution helps make ClawX better.

### How to Contribute

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes with clear messages
4. **Push** to your branch
5. **Open** a Pull Request

### Guidelines

- Follow the existing code style (ESLint + Prettier)
- Write tests for new functionality
- Update documentation as needed
- Keep commits atomic and descriptive

## Acknowledgments

ClawX is built on the shoulders of excellent open-source projects:

- [OpenClaw](https://github.com/OpenClaw) - The AI agent runtime
- [Electron](https://www.electronjs.org/) - Cross-platform desktop framework
- [React](https://react.dev/) - UI component library
- [shadcn/ui](https://ui.shadcn.com/) - Beautifully designed components
- [Zustand](https://github.com/pmndrs/zustand) - Lightweight state management

## Community

Join our community to connect with other users, get support, and share your experiences.

| Enterprise WeChat | Feishu Group | Discord |
| :---: | :---: | :---: |
| <img src="src/assets/community/wecom-qr.png" width="150" alt="WeChat QR Code" /> | <img src="src/assets/community/feishu-qr.png" width="150" alt="Feishu QR Code" /> | <img src="src/assets/community/20260212-185822.png" width="150" alt="Discord QR Code" /> |

### ClawX Partner Program

We're launching the ClawX Partner Program and looking for partners who can help introduce ClawX to more clients, especially those with custom AI agent or automation needs.

Partners help connect us with potential users and projects, while the ClawX team provides full technical support, customization, and integration. If you work with clients interested in AI tools or automation, we'd love to collaborate.

DM us or email [public@valuecell.ai](mailto:public@valuecell.ai) to learn more.

## Star History

<p align="center">
  <img src="https://api.star-history.com/svg?repos=ValueCell-ai/ClawX&type=Date" alt="Star History Chart" />
</p>

## License

ClawX is released under the [MIT License](LICENSE). You're free to use, modify, and distribute this software.

<hr>

<p align="center">
  <sub>Built with ❤️ by the ValueCell Team</sub>
</p>
