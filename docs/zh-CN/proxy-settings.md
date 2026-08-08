# ClawX 代理设置

本文档是 README「代理设置」一节的详细说明。

- 只填写 `host:port` 时，会按 HTTP 代理处理。
- 高级代理项留空时，会自动回退到“代理服务器”。
- 保存代理设置后，Electron 网络层会立即重新应用代理，并自动重启 Gateway。
- 如果启用了 Telegram，ClawX 还会把代理同步到 OpenClaw 的 Telegram 频道配置中。
- 当 ClawX 代理处于关闭状态时，Gateway 的常规重启会保留已有的 Telegram 频道代理配置。
- 如果你要明确清空 OpenClaw 中的 Telegram 代理，请在关闭代理后点一次“保存代理设置”。
- 在 **设置 → 高级 → 开发者** 中，可以直接运行 **OpenClaw Doctor**，执行 `openclaw doctor --json` 并在应用内查看诊断输出。
- 在 Windows 打包版本中，内置的 `openclaw` CLI/TUI 会通过随包分发的 `node.exe` 入口运行，以保证终端输入行为稳定。
