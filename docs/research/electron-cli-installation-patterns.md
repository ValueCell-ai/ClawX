# Electron App CLI Installation Patterns — Research

> Research into how popular Electron-based desktop apps install CLI commands across platforms.

## Table of Contents

- [1. Cursor Editor](#1-cursor-editor-cursor-cli)
- [2. VS Code](#2-vs-code-code-cli--the-gold-standard)
- [3. Atom Editor](#3-atom-editor-atom-and-apm-cli--archived)
- [4. Hyper Terminal](#4-hyper-terminal-hyper-cli)
- [5. Slack Desktop](#5-slack-desktop)
- [6. Other Electron Apps](#6-other-electron-apps-with-cli-integration)
- [Cross-Platform Technical Details](#cross-platform-technical-details)
- [How Apps Handle Updates](#how-apps-handle-updates-symlink-stability)
- [Best Practices](#best-practices-for-seamless-cli-installation)

---

## 1. Cursor Editor (`cursor` CLI)

Cursor is a VS Code fork and inherits VS Code's approach almost identically.

### macOS

- Uses the **Command Palette** approach: `Cmd+Shift+P` → "Install 'cursor' command in PATH"
- Creates a symlink or adds the bin directory to PATH
- Bin directory lives at `/Applications/Cursor.app/Contents/Resources/app/bin`
- Users can also manually add to shell profile:
  - Bash: `export PATH="/Applications/Cursor.app/Contents/Resources/app/bin:$PATH"` in `~/.bashrc`
  - Zsh: same export in `~/.zshrc`
  - Fish: `set -gx PATH /Applications/Cursor.app/Contents/Resources/app/bin $PATH` in `~/.config/fish/config.fish`

### Linux

- For AppImage: `sudo ln -s /opt/cursor.AppImage /usr/local/bin/cursor`
- Manual symlink creation is the primary approach

### Windows

- Installer adds the bin directory to the user/system PATH environment variable (inherited from VS Code's Inno Setup approach)

### Standalone CLI Installer (separate from desktop app)

```bash
# macOS/Linux/WSL
curl https://cursor.com/install -fsS | bash
# Installs to ~/.local/bin

# Windows PowerShell
irm 'https://cursor.com/install?win32=true' | iex
```

---

## 2. VS Code (`code` CLI) — The Gold Standard

VS Code's approach is the most well-documented and serves as the template for most Electron editor CLI integrations.

### macOS

**Shell script wrapper:** `resources/darwin/bin/code.sh`

Key implementation details:

```bash
# app_realpath function — resolves symlinks to find the actual .app bundle
function app_realpath() {
    SOURCE=$1
    while [ -h "$SOURCE" ]; do
        DIR=$(cd -P "$(dirname "$SOURCE")" && pwd)
        SOURCE=$(readlink "$SOURCE")
        [[ $SOURCE != /* ]] && SOURCE=$DIR/$SOURCE
    done
    SOURCE_DIR="$(cd -P "$(dirname "$SOURCE")" && pwd)"
    echo "${SOURCE_DIR%%'/Contents/'*}"
}
```

The script:

1. Detects remote terminal environments via `VSCODE_IPC_HOOK_CLI` and routes to remote CLI if available
2. Resolves symlinks using `app_realpath` to find the `.app` bundle
3. Constructs path to Electron at `$APP_PATH/Contents/MacOS/Electron`
4. Launches with `ELECTRON_RUN_AS_NODE=1` to run `Contents/Resources/app/out/cli.js`
5. Manages `VSCODE_NODE_OPTIONS` and `VSCODE_NODE_REPL_EXTERNAL_MODULE` env vars

**Installation mechanism:** The "Shell Command: Install 'code' command in PATH" command creates a symlink at `/usr/local/bin/code` pointing to the shell script inside the `.app` bundle.

**Known issues:**

- Bash 5.3+ breaks `app_realpath` due to shell parameter expansion changes (GitHub issue #254824)
- macOS App Translocation can make symlinks point to temporary paths that break after reboot (issue #209356)

### Windows

**Inno Setup installer** at `build/win32/code.iss` (1758 lines):

- Uses `ChangesEnvironment=yes` directive
- Creates `code.cmd` batch file in the `bin/` subdirectory
- Adds `{app}\bin` to user PATH via registry:

```iss
[Setup]
ChangesEnvironment=yes

[Registry]
Root: HKLM; Subkey: "SYSTEM\CurrentControlSet\Control\Session Manager\Environment";
    ValueType: expandsz; ValueName: "Path";
    ValueData: "{olddata};{app}\bin";
    Check: NeedsAddPath('{app}\bin')
```

- Also registers `App Paths` registry key: `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\code.exe`
- `code.cmd` wrapper avoids DLL conflicts by keeping the main executable in a separate directory
- Default install path: `C:\Users\{Username}\AppData\Local\Programs\Microsoft VS Code\bin`

**`NeedsAddPath()` Pascal function** prevents duplicate PATH entries:

```pascal
function NeedsAddPath(Param: string): boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue(HKEY_LOCAL_MACHINE,
    'SYSTEM\CurrentControlSet\Control\Session Manager\Environment',
    'Path', OrigPath) then begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + UpperCase(Param) + ';', ';' + UpperCase(OrigPath) + ';') = 0;
end;
```

### Linux

- Deb/RPM packages install to `/usr/share/code/` and create a symlink at `/usr/bin/code`
- Uses the standard electron-builder `after-install.tpl` approach (see below)

---

## 3. Atom Editor (`atom` and `apm` CLI) — Archived

### macOS

- On first launch, Atom attempted to **automatically install** `atom` and `apm` commands
- Fallback: Command Palette → "Window: Install Shell Commands" (prompts for admin password)
- Created symlinks at `/usr/local/bin/atom` and `/usr/local/bin/apm`
- Target: `/Applications/Atom.app/Contents/Resources/app/atom.sh` (a shell wrapper script)

**Notable bug (issue #15857):** In v1.18.0+, the installer incorrectly symlinked to the `atom` binary instead of `atom.sh`, breaking terminal invocation. This demonstrates that the symlink **must point to the shell wrapper script, not the binary directly**.

Workaround:

```bash
sudo ln -s -f /Applications/Atom.app/Contents/Resources/app/atom.sh /usr/local/bin/atom
```

### Source Code References

- `src/register-default-commands.coffee` — command registration
- `src/main-process/win-shell.js` — Windows shell integration
- `atom/apm` GitHub repo — package manager CLI

### Windows

- Used registry entries for PATH and shell integration, similar to VS Code

---

## 4. Hyper Terminal (`hyper` CLI)

### macOS

- Creates symlink: `/usr/local/bin/hyper` → `/Applications/Hyper.app/Contents/Resources/bin/hyper`
- Known issue: fails silently if `/usr/local/bin` doesn't exist (addressed in PR #5328)

### Linux

Post-install template (`build/linux/after-install.tpl`):

```bash
ln -sf '/opt/${productFilename}/resources/bin/${executable}' '/usr/local/bin/${executable}'
```

### Windows

- Adds CLI path to Windows registry user PATH environment variable
- Known issue (#2823): environment variable changes are cached; requires manual "Edit environment variables" refresh or full reboot (no broadcast of `WM_SETTINGCHANGE` message)

### Source Code References

- CLI code lives in `/cli` directory in `vercel/hyper` repo
- Installation utilities in `app/utils/`
- Config paths: macOS `~/Library/Application Support/Hyper/.hyper.js`, Linux `~/.config/Hyper/.hyper.js`, Windows `$Env:AppData/Hyper/.hyper.js`

---

## 5. Slack Desktop

Slack does **not** install a traditional CLI command. Instead:

- Uses `slack://` deep link protocol for integration (`slack://open`, channel links via `app_redirect`)
- The **Slack CLI** (`slack`) is a separate developer tool, not part of the desktop Electron app
- Desktop app registers as a protocol handler for `slack://` URLs via `app.setAsDefaultProtocolClient()`

---

## 6. Other Electron Apps with CLI Integration

### Warp Terminal

- Provides `oz` CLI (formerly `warp-cli`) bundled with the desktop app
- Automatically available inside the Warp terminal; can be installed separately for other terminals
- Auto-updates: old `warp-cli` binary auto-updates to `oz`

---

## Cross-Platform Technical Details

### Windows: NSIS Approach (electron-builder)

Create `build/installer.nsh`:

```nsis
!include "EnvVarUpdate.nsh"

!macro customInstall
  ${EnvVarUpdate} $0 "PATH" "HKLM" "A" "$INSTDIR\bin"
!macroend

!macro customUnInstall
  ${un.EnvVarUpdate} $0 "PATH" "HKLM" "R" "$INSTDIR\bin"
!macroend
```

electron-builder configuration in `package.json`:

```json
{
  "build": {
    "nsis": {
      "include": "build/installer.nsh"
    }
  }
}
```

**Important caveats:**

- NSIS default string limit is 1024 bytes; use "large strings" NSIS build for PATH manipulation (8192 bytes)
- `EnvVarUpdate.nsh` must be placed in `build/` directory (auto-added as `addincludedir`)
- Available NSIS variables: `$INSTDIR`, `BUILD_RESOURCES_DIR`, `PROJECT_DIR`
- After modifying PATH, broadcast `WM_SETTINGCHANGE` so running Explorer shells pick up the change
- For protocol registration, use registry writes in `customInstall` macro

### Windows: Inno Setup Approach (VS Code)

```iss
[Setup]
ChangesEnvironment=yes

[Registry]
Root: HKLM; Subkey: "SYSTEM\CurrentControlSet\Control\Session Manager\Environment";
    ValueType: expandsz; ValueName: "Path";
    ValueData: "{olddata};{app}\bin";
    Check: NeedsAddPath('{app}\bin')
```

Also registers in App Paths:

```
HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\<app>.exe
  (Default) = full path to exe
  Path      = directory containing exe
```

### macOS: Symlink to Wrapper Script (VS Code / Atom / Hyper pattern)

```bash
# Created by "Install Shell Command" action in the app
sudo ln -sf "/Applications/MyApp.app/Contents/Resources/app/bin/myapp" "/usr/local/bin/myapp"
```

The target is a **shell wrapper script** (not the binary!) that:

1. Resolves its own symlinks to find the `.app` bundle
2. Sets `ELECTRON_RUN_AS_NODE=1`
3. Launches Electron with the CLI JavaScript entry point (e.g., `out/cli.js`)

### macOS: PKG Installer Post-Install Script (electron-builder)

Create `build/pkg-scripts/postinstall`:

```bash
#!/bin/sh
ln -sf "/Applications/MyApp.app/Contents/Resources/app/bin/myapp" "/usr/local/bin/myapp"
```

Configuration:

```json
{
  "build": {
    "pkg": {
      "scripts": "build/pkg-scripts"
    }
  }
}
```

**Known issue:** electron-builder PKG build requires explicit `BundlePostInstallScriptPath` in the `.plist` for the postinstall to actually execute (GitHub issue #8063).

### Linux: electron-builder Default Template (`after-install.tpl`)

```bash
#!/bin/bash

# Prefer update-alternatives for managed symlinks
if hash update-alternatives 2>/dev/null; then
    update-alternatives --install '/usr/bin/${executable}' '${executable}' \
        '/opt/${sanitizedProductName}/${executable}' 100
    # Remove any previous direct symlink that doesn't use alternatives
    if [ -L '/usr/bin/${executable}' ] && \
       [ "$(readlink '/usr/bin/${executable}')" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
else
    # Fallback: direct symlink
    ln -sf '/opt/${sanitizedProductName}/${executable}' '/usr/bin/${executable}'
fi

# Chrome sandbox permissions
CHROME_SANDBOX="/opt/${sanitizedProductName}/chrome-sandbox"
if [ -f "$CHROME_SANDBOX" ]; then
    if sysctl kernel.unprivileged_userns_clone 2>/dev/null | grep -q ' = 1'; then
        chmod 0755 "$CHROME_SANDBOX"
    else
        chmod 4755 "$CHROME_SANDBOX"
    fi
fi

# Update databases
update-mime-database /usr/share/mime || true
update-desktop-database /usr/share/applications || true
```

Custom override in electron-builder config:

```json
{
  "build": {
    "linux": {
      "target": ["deb", "rpm"],
      "afterInstall": "installer/linux/after-install.sh"
    }
  }
}
```

---

## How Apps Handle Updates (Symlink Stability)

The key insight is the **indirection pattern**: symlinks and wrapper scripts survive updates because they point to a **stable path inside the app bundle**, not a versioned binary.

| Platform | Update-safe approach | Why it works |
|----------|---------------------|--------------|
| macOS | Symlink → `/Applications/App.app/.../bin/cli` | The `.app` bundle is replaced in-place; path stays the same |
| Windows | PATH entry → `{app}\bin\cli.cmd` | Install directory doesn't change between updates |
| Linux (deb/rpm) | `update-alternatives` or symlink → `/opt/appname/appname` | Package manager handles re-linking; `update-alternatives` is designed for this |
| Linux (AppImage) | Symlink → `/opt/app.AppImage` or user-chosen path | AppImage auto-updater replaces file in-place |

**Potential breakage scenarios:**

- macOS App Translocation moves apps to temporary paths, breaking symlinks
- Manually moving the app to a different directory breaks symlinks
- Squirrel.Windows (deprecated) changes install directories on update, breaking PATH entries; NSIS avoids this by using a stable `$INSTDIR`

---

## Best Practices for "Seamless" CLI Installation

### 1. Use a wrapper shell script, not a direct binary symlink

The script resolves its own path at runtime, making it resilient to app bundle updates. This is the single most important pattern — every major app (VS Code, Atom, Hyper, Cursor) uses it.

### 2. Three-tier installation strategy

| Platform | Strategy | Mechanism |
|----------|----------|-----------|
| Windows | **Automatic** during install | Installer adds `{app}\bin` to PATH |
| macOS | **Prompted** in-app | Command Palette action creates `/usr/local/bin/X` symlink |
| Linux deb/rpm | **Automatic** during install | `after-install.tpl` uses `update-alternatives` or direct symlink |

### 3. Windows specifics

- Use `ChangesEnvironment=yes` (Inno Setup) or `EnvVarUpdate.nsh` (NSIS)
- Broadcast `WM_SETTINGCHANGE` after modifying PATH so running Explorer shells pick up the change
- Register in `App Paths` registry key for `Win+R` discoverability
- Use a `.cmd` wrapper file, not a direct `.exe` reference, to avoid DLL path issues
- Implement `NeedsAddPath()` check to prevent duplicate entries

### 4. macOS specifics

- Target the symlink at the shell wrapper script (e.g., `myapp.sh`), **never** the Electron binary
- The shell script should use `ELECTRON_RUN_AS_NODE=1` to invoke the CLI JS entry point
- Handle the admin password prompt gracefully when writing to `/usr/local/bin`
- Also offer "add to shell profile" alternative for users who prefer not to use `sudo`
- Be aware of App Translocation — warn users to drag the app to `/Applications` before installing the shell command

### 5. Linux specifics

- Prefer `update-alternatives` over direct symlinks for better package manager integration
- Use `/usr/bin` (not `/usr/local/bin`) for system-packaged (deb/rpm) installations
- Handle both install and uninstall (after-remove template)

### 6. Updates

- Use stable install paths; never version the install directory
- The app binary changes in-place; the CLI entry point (symlink/PATH/wrapper script) remains at a fixed location
- On Linux, `update-alternatives` with a priority value allows seamless version transitions

### 7. Uninstallation cleanup

- Windows: Remove PATH entry in `customUnInstall` NSIS macro
- macOS: Remove `/usr/local/bin` symlink (or document manual removal)
- Linux: `after-remove.tpl` handles `update-alternatives --remove`

---

## Source Code References

| App | File | Description |
|-----|------|-------------|
| VS Code | `resources/darwin/bin/code.sh` | macOS shell wrapper script |
| VS Code | `build/win32/code.iss` | Windows Inno Setup installer (1758 lines) |
| VS Code | `cli/` directory | Rust-based CLI implementation |
| Atom | `src/register-default-commands.coffee` | Command registration |
| Atom | `src/main-process/win-shell.js` | Windows shell integration |
| Hyper | `build/linux/after-install.tpl` | Linux post-install symlink |
| Hyper | `cli/` directory | CLI implementation |
| electron-builder | `packages/app-builder-lib/templates/linux/after-install.tpl` | Default Linux post-install template |
| electron-builder | `packages/app-builder-lib/templates/linux/after-remove.tpl` | Default Linux post-remove template |
| electron-builder | `packages/app-builder-lib/src/options/linuxOptions.ts` | Linux packaging options |
