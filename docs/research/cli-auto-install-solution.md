# OpenClaw CLI 自动安装方案深度调研

## 1. 现状分析

### 1.1 当前 ClawX CLI 安装机制

| 平台 | 当前状态 | 用户体验 |
|------|---------|---------|
| **macOS** | Settings 页面一键安装按钮，写入 shell 脚本到 `~/.local/bin/openclaw` | ⚠️ 需手动操作，且 `~/.local/bin` 不一定在 PATH 中 |
| **Linux (deb)** | 仅创建 `/usr/local/bin/clawx` 指向 app 二进制，**不安装 openclaw CLI** | ❌ 完全缺失 |
| **Linux (AppImage)** | 无任何 CLI 安装 | ❌ 完全缺失 |
| **Windows** | 显示 PowerShell 命令供手动复制 | ❌ 极差，需要复制长命令 |

### 1.2 核心文件

```
electron/utils/openclaw-cli.ts    # CLI 命令生成 & macOS 安装逻辑
electron/utils/paths.ts           # 路径解析
scripts/installer.nsh             # Windows NSIS 卸载脚本（仅处理卸载）
scripts/linux/after-install.sh    # Linux deb 后安装脚本
scripts/linux/after-remove.sh     # Linux deb 后卸载脚本
electron-builder.yml              # 打包配置
```

### 1.3 当前 CLI wrapper 原理

macOS 当前的 shell wrapper 内容：
```bash
#!/bin/sh
ELECTRON_RUN_AS_NODE=1 "/Applications/ClawX.app/Contents/MacOS/ClawX" \
  "/Applications/ClawX.app/Contents/Resources/openclaw/openclaw.mjs" "$@"
```

Windows 手动命令：
```powershell
$env:ELECTRON_RUN_AS_NODE=1; & 'D:\clawx\ClawX.exe' 'D:\clawx\resources\openclaw\openclaw.mjs'
```

---

## 2. 行业方案调研

### 2.1 VS Code（`code` 命令）——行业标杆

VS Code 是 Electron CLI 安装的黄金标准，各平台方案如下：

#### macOS
- **包内预置 shell wrapper**：`resources/darwin/bin/code.sh` 随 app 一起打包
- **用户触发安装**：Command Palette > "Shell Command: Install 'code' command in PATH"
- **安装行为**：创建 symlink `/usr/local/bin/code` → `.app` 包内的 `bin/code.sh`
- **需要 sudo**：因为 `/usr/local/bin/` 需要管理员权限
- wrapper 脚本通过 `readlink` 自动解析 symlink 回到 `.app` 包内找到 Electron 二进制

#### Linux
- **deb/rpm 后安装脚本自动完成**，用户完全无感
- 创建 symlink `/usr/bin/code` → `/usr/share/code/bin/code`
- 使用 `update-alternatives` 系统注册
- 后卸载脚本自动清理

#### Windows
- **使用 Inno Setup 安装器**（非 NSIS）
- 安装时可选 "Add to PATH" 任务（checkbox，默认选中）
- 将 `bin\` 目录追加到注册表 PATH（`HKCU\Environment\Path`）
- 设置 `ChangesEnvironment=yes` 触发 `WM_SETTINGCHANGE` 广播
- 预置 `code.cmd` 批处理文件和无后缀 `code` shell 脚本（供 Git Bash 使用）

`code.cmd` 内容：
```cmd
@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\Code.exe" "%~dp0..\resources\app\out\cli.js" %*
endlocal
```

### 2.2 Cursor（VS Code 分支）

- 继承 VS Code 方案，Command Palette "Install 'cursor' command in PATH"
- macOS：symlink `/usr/local/bin/cursor`
- Windows：Inno Setup + PATH
- 额外：提供独立 `curl | bash` 安装器用于 agent CLI

### 2.3 Atom（已归档，方案参考价值大）

- macOS/Linux：首次启动时自动安装到 `/usr/local/bin/atom`
- 关键教训：**symlink 必须指向 shell wrapper 脚本而非二进制文件**（v1.18 曾因直接链接二进制导致 bug）
- 卸载时自动清理

### 2.4 Hyper Terminal

- macOS/Linux：`ln -sf` 到 `/usr/local/bin/hyper`
- Windows：注册表 PATH 修改（有 `WM_SETTINGCHANGE` 已知问题）

### 2.5 共性模式总结

| 要素 | 行业共识 |
|------|---------|
| CLI 入口 | **Shell wrapper 脚本**（非直接 symlink 到二进制），使用 `ELECTRON_RUN_AS_NODE=1` |
| macOS 安装位置 | `/usr/local/bin/`（需 sudo）或 `~/.local/bin/`（无需 sudo） |
| Linux 安装位置 | `/usr/bin/` 或 `/usr/local/bin/`（包管理器后安装脚本） |
| Windows 方案 | `.cmd` 批处理 + PATH 注册（注册表 + `WM_SETTINGCHANGE`） |
| 自动更新兼容 | Wrapper 脚本使用间接引用（`%~dp0`、`readlink`），app 原地更新不影响 CLI |

---

## 3. 推荐方案

### 3.1 总体架构

```
安装包内预置 CLI wrapper 文件（随 app 一起打包）
   ├── macOS:   resources/bin/openclaw.sh
   ├── Linux:   resources/bin/openclaw.sh（同一文件）
   └── Windows: resources/bin/openclaw.cmd + resources/bin/openclaw.ps1

安装时自动将 CLI 注册到 PATH（用户无感）
   ├── macOS:   写入 ~/.local/bin/openclaw（或首次启动时安装）
   ├── Linux:   deb/rpm 后安装脚本 → /usr/local/bin/openclaw symlink
   └── Windows: NSIS 安装器修改注册表 PATH + 放置 .cmd shim
```

### 3.2 方案 A（推荐）：安装时自动 + 首次启动补全

**核心理念：让用户安装完就能用 `openclaw` 命令，无需任何手动操作**

---

#### 3.2.1 macOS 方案

**时机：首次启动 app 时自动安装**（而非安装时——因为 DMG 安装就是拖拽 .app 到 Applications）

**实现步骤：**

1. **随 app 打包一个 shell wrapper 脚本**

新增文件 `resources/bin/openclaw`（随 extraResources 打包）：
```bash
#!/bin/sh
# OpenClaw CLI - installed by ClawX
# This script delegates to the ClawX Electron binary running in Node mode.

# Resolve the real path of this script (follow symlinks)
SCRIPT="$0"
while [ -L "$SCRIPT" ]; do
  SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT")" && pwd)"
  SCRIPT="$(readlink "$SCRIPT")"
  [ "${SCRIPT#/}" = "$SCRIPT" ] && SCRIPT="$SCRIPT_DIR/$SCRIPT"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT")" && pwd)"

if [ "$(uname)" = "Darwin" ]; then
  # macOS: .app bundle structure
  # resources/bin/openclaw → ../../MacOS/ClawX (Electron binary)
  CONTENTS_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
  ELECTRON="$CONTENTS_DIR/MacOS/ClawX"
  CLI="$CONTENTS_DIR/Resources/openclaw/openclaw.mjs"
else
  # Linux: flat directory structure
  # resources/bin/openclaw → ../../clawx (Electron binary)
  INSTALL_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
  ELECTRON="$INSTALL_DIR/clawx"
  CLI="$INSTALL_DIR/resources/openclaw/openclaw.mjs"
fi

ELECTRON_RUN_AS_NODE=1 exec "$ELECTRON" "$CLI" "$@"
```

2. **首次启动时自动创建 symlink**

修改 `electron/utils/openclaw-cli.ts`，新增自动安装逻辑：

```typescript
export async function autoInstallCliIfNeeded(): Promise<void> {
  if (process.platform !== 'darwin' || !app.isPackaged) return;

  const targetDir = join(homedir(), '.local', 'bin');
  const target = join(targetDir, 'openclaw');

  // 已存在且指向当前 app → 跳过
  if (existsSync(target)) return;

  // 获取包内 wrapper 脚本路径
  const wrapperSrc = join(process.resourcesPath, 'bin', 'openclaw');
  if (!existsSync(wrapperSrc)) return;

  try {
    mkdirSync(targetDir, { recursive: true });
    // 创建 symlink 指向包内 wrapper
    symlinkSync(wrapperSrc, target);
    ensureLocalBinInPath(); // 检查并提示 PATH
  } catch {
    // 静默失败，不影响 app 启动
  }
}
```

3. **确保 `~/.local/bin` 在 PATH 中**

如果检测到 `~/.local/bin` 不在 PATH 中，可以：
- **方案 A（静默）**：写入 shell profile（`~/.zshrc` / `~/.bashrc`）追加 `export PATH="$HOME/.local/bin:$PATH"`
- **方案 B（交互）**：弹出通知提示用户

推荐**方案 A + 方案 B 结合**：静默写入 profile 文件，同时用 notification 告知用户"重新打开终端即可使用 `openclaw` 命令"。

```typescript
function ensureLocalBinInPath(): void {
  const localBin = join(homedir(), '.local', 'bin');
  const pathEnv = process.env.PATH || '';

  if (pathEnv.split(':').includes(localBin)) return;

  // 追加到 shell profile
  const shell = process.env.SHELL || '/bin/zsh';
  const profileFile = shell.includes('zsh')
    ? join(homedir(), '.zshrc')
    : join(homedir(), '.bashrc');

  const line = `\nexport PATH="$HOME/.local/bin:$PATH"  # Added by ClawX\n`;

  try {
    const content = readFileSync(profileFile, 'utf-8');
    if (!content.includes('.local/bin')) {
      appendFileSync(profileFile, line);
    }
  } catch {
    // profile 文件不存在时创建
    writeFileSync(profileFile, line);
  }
}
```

**更新兼容性**：
- symlink 指向 `.app` 包内文件，auto-update 更新 `.app` 内容后 symlink 仍有效
- 只要安装路径不变（通常 `/Applications/ClawX.app`），CLI 始终可用

---

#### 3.2.2 Linux 方案

**时机：deb/rpm 安装时自动完成**（后安装脚本）

**实现步骤：**

1. **复用同一个 shell wrapper 脚本**（与 macOS 共享 `resources/bin/openclaw`）

2. **修改 `scripts/linux/after-install.sh`**：

```bash
#!/bin/bash
set -e

# ... existing desktop database / icon cache updates ...

# Create openclaw CLI symlink
OPENCLAW_WRAPPER="/opt/ClawX/resources/bin/openclaw"
if [ -x "$OPENCLAW_WRAPPER" ] || [ -f "$OPENCLAW_WRAPPER" ]; then
    ln -sf "$OPENCLAW_WRAPPER" /usr/local/bin/openclaw 2>/dev/null || true
    chmod +x "$OPENCLAW_WRAPPER" 2>/dev/null || true
fi

# Keep existing clawx symlink
if [ -x /opt/ClawX/clawx ]; then
    ln -sf /opt/ClawX/clawx /usr/local/bin/clawx 2>/dev/null || true
fi
```

3. **修改 `scripts/linux/after-remove.sh`**：

```bash
#!/bin/bash
set -e

rm -f /usr/local/bin/openclaw 2>/dev/null || true
rm -f /usr/local/bin/clawx 2>/dev/null || true

# ... existing cleanup ...
```

4. **AppImage 特殊处理**：AppImage 是自包含的，无安装脚本。两个选择：
   - **选项 1**：AppImage 首次启动时自动安装（类似 macOS）
   - **选项 2**：提供 `--install-cli` 命令行参数，用户运行 `./ClawX.AppImage --install-cli`
   - **推荐选项 1**：行为与 macOS 一致

---

#### 3.2.3 Windows 方案（重点改进）

**时机：NSIS 安装器安装时自动完成**

**需要做的事情：**

1. **预置 CLI wrapper 文件**（随 app 打包）

新增 `resources/bin/openclaw.cmd`：
```cmd
@echo off
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\ClawX.exe" "%~dp0..\..\resources\openclaw\openclaw.mjs" %*
endlocal
```

新增 `resources/bin/openclaw.ps1`（供 PowerShell 用户使用，可选）：
```powershell
#!/usr/bin/env pwsh
$env:ELECTRON_RUN_AS_NODE = "1"
$clawxDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
& "$clawxDir\ClawX.exe" "$clawxDir\resources\openclaw\openclaw.mjs" @args
```

新增 `resources/bin/openclaw`（无后缀，供 Git Bash / WSL 使用）：
```bash
#!/bin/sh
# OpenClaw CLI wrapper for Git Bash / WSL on Windows
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ELECTRON_RUN_AS_NODE=1 exec "$INSTALL_DIR/ClawX.exe" "$INSTALL_DIR/resources/openclaw/openclaw.mjs" "$@"
```

2. **修改 NSIS 安装脚本** `scripts/installer.nsh`

添加 `customInstall` 宏，在安装时将 `resources/bin` 加入用户 PATH：

```nsis
!macro customInstall
  ; Add resources\bin to user PATH for openclaw CLI
  ; Read current user PATH
  ReadRegStr $0 HKCU "Environment" "Path"

  ; Check if our bin dir is already in PATH
  ${StrContains} $1 "$INSTDIR\resources\bin" $0
  StrCmp $1 "" 0 _skipAddPath

  ; Append to PATH
  StrCpy $0 "$0;$INSTDIR\resources\bin"
  WriteRegExpandStr HKCU "Environment" "Path" $0

  ; Broadcast WM_SETTINGCHANGE so running apps pick up the change
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=500

  _skipAddPath:
!macroend
```

并修改 `customUnInstall` 宏，在卸载时移除 PATH 条目：

```nsis
; In customUnInstall macro, before existing cleanup:
  ; Remove from PATH
  ReadRegStr $0 HKCU "Environment" "Path"
  ${un.StrRmDir} $0 "$INSTDIR\resources\bin"
  WriteRegExpandStr HKCU "Environment" "Path" $0
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=500
```

3. **NSIS 辅助方法**

需要引入 NSIS 的字符串操作函数。electron-builder 的 NSIS 默认不含 `StrContains` 等函数，有两种方式：
- 使用 `EnvVarUpdate.nsh` 插件（社区广泛使用）
- 手动实现字符串查找/删除

推荐使用 `EnvVarUpdate.nsh`，这是 NSIS 社区标准方案：
```nsis
!include "EnvVarUpdate.nsh"

!macro customInstall
  ${EnvVarUpdate} $0 "PATH" "A" "HKCU" "$INSTDIR\resources\bin"
!macroend

!macro customUnInstall
  ${un.EnvVarUpdate} $0 "PATH" "R" "HKCU" "$INSTDIR\resources\bin"
  ; ... existing cleanup code ...
!macroend
```

**更新兼容性**：
- `.cmd` 文件使用 `%~dp0` 相对路径，不受安装路径硬编码影响
- PATH 条目指向安装目录，原地更新不影响

---

### 3.3 方案 B（备选）：VS Code 风格，安装器 + 首次启动组合

如果担心自动修改用户 shell profile 太激进，可以采用 VS Code 模式：

| 平台 | 行为 |
|------|-----|
| macOS | 首次启动提示："Install 'openclaw' command for terminal use?" → 创建 symlink（可需要 sudo 密码） |
| Linux deb/rpm | 后安装脚本自动安装（与方案 A 相同） |
| Windows | NSIS 安装时 checkbox："Add openclaw to PATH"（默认勾选） |

**对比：**
| | 方案 A（推荐） | 方案 B（VS Code 风格） |
|---|---|---|
| 用户感知 | 完全无感 | macOS 需确认一次 |
| 侵入性 | 自动修改 shell profile | 不修改 shell profile |
| PATH 问题 | 自动处理 | macOS 可能需用户自行确认 PATH |
| Windows | 完全自动 | 安装时选择 |

---

## 4. 实现路径图

### Phase 1: 预置 CLI wrapper 文件

**改动文件：**
- 新增 `resources/bin/openclaw`（POSIX shell wrapper，macOS + Linux 共用）
- 新增 `resources/bin/openclaw.cmd`（Windows CMD wrapper）
- 新增 `resources/bin/openclaw.ps1`（Windows PowerShell wrapper，可选）
- 修改 `electron-builder.yml`：确认 `resources/bin/` 不在 `extraResources` 的排除列表中

**目前 `electron-builder.yml` 中有排除 `!bin/**`**，这行需要修改：
```yaml
extraResources:
  - from: resources/
    to: resources/
    filter:
      - "**/*"
      - "!icons/*.md"
      - "!icons/*.svg"
-     - "!bin/**"           # ← 移除此行（或改为只排除平台二进制）
+     - "!bin/darwin-*/**"   # 排除 uv 等平台二进制，保留 CLI wrappers
+     - "!bin/linux-*/**"
+     - "!bin/win32-*/**"
```

注意：当前 `resources/bin/` 目录存放的是平台特定的二进制文件（如 uv），通过 `mac.extraResources` / `win.extraResources` / `linux.extraResources` 单独按平台打包。CLI wrapper 脚本可以放在 `resources/bin/` 根级别（不在 `darwin-*/linux-*/win32-*` 子目录中），或者放在独立目录如 `resources/cli/` 以避免冲突。

**推荐：使用 `resources/cli/` 目录**
```yaml
extraResources:
  - from: resources/cli/${os}/
    to: cli/
```

或者更简单地在打包时将 wrapper 放入正确位置：
```yaml
# 在各平台 extraResources 中追加
mac:
  extraResources:
    - from: resources/bin/darwin-${arch}
      to: bin
    - from: resources/cli/posix/
      to: cli/

win:
  extraResources:
    - from: resources/bin/win32-${arch}
      to: bin
    - from: resources/cli/win32/
      to: cli/

linux:
  extraResources:
    - from: resources/bin/linux-${arch}
      to: bin
    - from: resources/cli/posix/
      to: cli/
```

### Phase 2: 各平台安装逻辑

#### macOS
- 修改 `electron/main/index.ts`（或 app ready handler）：调用 `autoInstallCliIfNeeded()`
- 修改 `electron/utils/openclaw-cli.ts`：
  - 新增 `autoInstallCliIfNeeded()` 函数
  - 新增 `ensureLocalBinInPath()` 函数
  - 改进 `installOpenClawCliMac()` 改为创建 symlink（而非写入脚本内容）

#### Linux
- 修改 `scripts/linux/after-install.sh`：新增 openclaw symlink
- 修改 `scripts/linux/after-remove.sh`：新增 openclaw symlink 清理
- 新增 `electron/utils/openclaw-cli.ts` 中 Linux AppImage 的首次启动自动安装

#### Windows
- 新增 `resources/cli/win32/openclaw.cmd`
- 新增 `resources/cli/win32/openclaw.ps1`（可选）
- 新增 `resources/cli/win32/openclaw`（Git Bash wrapper，可选）
- 修改 `scripts/installer.nsh`：添加 `customInstall` 宏写入 PATH
- 修改 `scripts/installer.nsh`：添加 PATH 清理到 `customUnInstall`

### Phase 3: UI 更新
- 修改 Settings 页面：所有平台都显示 CLI 状态（已安装/未安装）
- macOS：保留手动安装按钮作为备选，但首选自动
- Windows：移除手动复制命令，改为显示安装状态
- Linux：显示安装状态

### Phase 4: 自动更新兼容性测试
- 验证 auto-update 后 CLI 仍然工作
- 验证安装路径变更后 CLI 行为
- 验证卸载后 PATH 清理干净

---

## 5. 目录结构变更预览

```
resources/
├── cli/
│   ├── posix/
│   │   └── openclaw          # Shell wrapper (macOS + Linux)
│   └── win32/
│       ├── openclaw.cmd      # CMD wrapper
│       ├── openclaw.ps1      # PowerShell wrapper (可选)
│       └── openclaw          # Git Bash wrapper (可选)
├── bin/
│   ├── darwin-arm64/         # (existing) platform binaries
│   ├── darwin-x64/
│   ├── linux-arm64/
│   ├── linux-x64/
│   └── win32-x64/
└── ...
```

打包后在用户机器上的布局：

**macOS** (`/Applications/ClawX.app/Contents/Resources/`)：
```
Resources/
├── cli/
│   └── openclaw              # Shell wrapper
├── openclaw/
│   ├── openclaw.mjs          # 实际 CLI 入口
│   └── node_modules/
└── bin/
    └── uv                    # uv binary
```

`~/.local/bin/openclaw` → symlink → `/Applications/ClawX.app/Contents/Resources/cli/openclaw`

**Linux** (`/opt/ClawX/resources/`)：
```
resources/
├── cli/
│   └── openclaw
├── openclaw/
│   ├── openclaw.mjs
│   └── node_modules/
└── bin/
    └── uv
```

`/usr/local/bin/openclaw` → symlink → `/opt/ClawX/resources/cli/openclaw`

**Windows** (`C:\Users\xxx\AppData\Local\Programs\ClawX\resources\`)：
```
resources\
├── cli\
│   ├── openclaw.cmd
│   ├── openclaw.ps1
│   └── openclaw
├── openclaw\
│   ├── openclaw.mjs
│   └── node_modules\
└── bin\
    └── uv.exe
```

PATH 中新增 `C:\Users\xxx\AppData\Local\Programs\ClawX\resources\cli`

---

## 6. 关键技术细节

### 6.1 ELECTRON_RUN_AS_NODE 模式

所有 wrapper 的核心：设置 `ELECTRON_RUN_AS_NODE=1` 让 Electron 二进制以纯 Node.js 模式运行。这避免了打包独立的 Node.js 运行时。

VS Code 正在探索替代方案 `--ms-enable-electron-run-as-node`（通过命令行参数而非环境变量），以避免子进程继承该环境变量导致意外行为。ClawX 可以暂时继续使用环境变量方案，后续按需迁移。

### 6.2 Windows PATH 修改的注意事项

1. **使用 `HKCU\Environment\Path`**（per-user 安装）或 `HKLM\...\Environment\Path`（per-machine）
2. **必须广播 `WM_SETTINGCHANGE`**，否则已打开的 Explorer/terminal 不会感知到 PATH 变更
3. 即便广播了，**已打开的 CMD/PowerShell 窗口仍不会自动更新**——这是 Windows 的已知限制，用户需要新开终端
4. 安装器应检查是否已存在相同 PATH 条目，避免重复追加
5. 卸载时必须清理 PATH 条目

### 6.3 macOS `~/.local/bin` vs `/usr/local/bin`

| | `~/.local/bin` | `/usr/local/bin` |
|---|---|---|
| 需要 sudo | ❌ 不需要 | ✅ 需要 |
| 默认在 PATH 中 | ⚠️ 部分 shell 不在 | ✅ 大多数 shell 都在 |
| 用户感知 | 可能需追加 PATH | 无感 |
| 多用户 | 仅当前用户 | 所有用户 |

**推荐**：
- 默认使用 `~/.local/bin`（无需 sudo，用户权限友好）
- 自动检测并追加 PATH 到 shell profile
- 保留 Settings 中的手动按钮，允许高级用户选择安装到 `/usr/local/bin`

### 6.4 AppImage 特殊性

AppImage 是自包含可执行文件，没有安装过程。处理方式：
1. 首次启动时检测是否已安装 CLI
2. 如未安装，写入 wrapper 到 `~/.local/bin/openclaw`
3. wrapper 脚本需要知道 AppImage 的路径——可以在 wrapper 中硬编码（但 AppImage 可能被移动）
4. **更好的方案**：wrapper 使用 `$APPIMAGE` 环境变量（AppImage 运行时自动设置），但这只在 AppImage 进程内有效
5. **最实用方案**：首次启动时提示用户将 AppImage 移到固定位置（如 `~/Applications/`），然后安装 CLI

---

## 7. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| macOS 修改 shell profile 被用户视为侵入 | 添加明确注释 `# Added by ClawX`，提供卸载/还原说明 |
| Windows NSIS PATH 操作与其他软件冲突 | 使用成熟的 `EnvVarUpdate.nsh` 插件，卸载时清理 |
| AppImage 路径不固定 | 提示用户固定路径，或接受此限制 |
| 自动更新后 symlink 断裂 | 使用相对路径 wrapper（而非 symlink 到会变的路径），或更新后重新创建 |
| `~/.local/bin` 不在 PATH 中 | 自动追加到 shell profile + notification 提醒 |
| 企业 IT 策略阻止 PATH 修改 | 静默失败，不影响 app 本身功能 |

---

## 8. 实现优先级建议

1. **P0 — Windows NSIS 自动安装**（当前体验最差，提升最大）
   - 预置 `openclaw.cmd` + 修改 `installer.nsh`
   - 预计工作量：1-2 天

2. **P0 — Linux deb 自动安装**（改动最小，一行 symlink）
   - 修改 `after-install.sh` / `after-remove.sh`
   - 预计工作量：0.5 天

3. **P1 — macOS 首次启动自动安装**（当前已有 UI 按钮，提升为自动）
   - 修改启动逻辑 + PATH 检测
   - 预计工作量：1 天

4. **P2 — UI 更新**（显示 CLI 安装状态，全平台一致体验）
   - 修改 Settings 页面
   - 预计工作量：0.5 天

5. **P3 — AppImage 支持**（用户量较少）
   - 首次启动逻辑
   - 预计工作量：0.5 天

---

## 9. 参考资源

- [VS Code CLI source (resources/darwin/bin/code.sh)](https://github.com/microsoft/vscode/blob/main/resources/darwin/bin/code.sh)
- [VS Code Windows installer (build/win32/code.iss)](https://github.com/microsoft/vscode/blob/main/build/win32/code.iss)
- [VS Code Linux postinst template](https://github.com/microsoft/vscode/blob/main/resources/linux/debian/postinst.template)
- [NSIS EnvVarUpdate plugin](https://nsis.sourceforge.io/Environmental_Variables:_append,_prepend,_and_remove_entries)
- [electron-builder NSIS customInstall macro](https://www.electron.build/nsis)
- [Atom shell command install](https://github.com/atom/atom/blob/master/src/main-process/atom-application.js)
