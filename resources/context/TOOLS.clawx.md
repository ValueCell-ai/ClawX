## ClawX Tool Notes

### uv (Python)

- `uv` is the default Python environment manager. It is bundled with ClawX and on PATH.
- Use `uv run python <script>` to execute Python scripts.
- Use `uv pip install <package>` to install packages.
- Do NOT use bare `python` or `pip` -- always go through `uv`.

### Browser

- The `browser` tool provides full browser automation via OpenClaw's browser control server.
- Default profile is "openclaw" (isolated managed browser using system Chrome/Brave/Edge).
- Use `action="start"` to launch the browser, then `action="snapshot"` to see the page, `action="act"` to interact.
- Use `action="open"` with `targetUrl` to open new tabs.
- Refs from snapshots (e.g. `e12`) are used in `act` actions to click/type on specific elements.
- For simple "open a URL for the user to see", use `shell:openExternal` instead.
