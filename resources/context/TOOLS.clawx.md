## ClawX Tool Notes

### uv (Python)

- `uv` is the default Python environment manager. It is bundled with ClawX and on PATH.
- Use `uv run python <script>` to execute Python scripts.
- Use `uv pip install <package>` to install packages.
- Do NOT use bare `python` or `pip` -- always go through `uv`.

### Browser

- Use the `browser` tool to open URLs in the user's default browser.
- When the user asks to "open" a link, default to opening it in the browser.
