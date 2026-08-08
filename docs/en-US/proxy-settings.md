# ClawX Proxy Settings

This document provides the detailed version of the Proxy Settings section in the README.

- A bare `host:port` value is treated as an HTTP proxy.
- If advanced proxy fields are left empty, ClawX falls back to **Proxy Server**.
- Saving proxy settings reapplies Electron networking immediately and restarts the Gateway automatically.
- When Telegram is enabled, ClawX also syncs the proxy to OpenClaw's Telegram channel configuration.
- When the ClawX proxy is disabled, a normal Gateway restart preserves an existing Telegram channel proxy.
- To explicitly clear the Telegram proxy from OpenClaw configuration, disable the proxy and save the proxy settings once.
- In **Settings -> Advanced -> Developer**, you can run **OpenClaw Doctor**, which executes `openclaw doctor --json` and displays the diagnostic output in the app.
- In packaged Windows builds, the bundled `openclaw` CLI/TUI runs through the shipped `node.exe` entry point to keep terminal input behavior stable.
