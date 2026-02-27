# OpenClaw 嵌入模式下的更新/卸载兼容性深度分析

## 1. 核心架构理解

### 1.1 ClawX 如何嵌入 openclaw

```
ClawX (Electron app)
  ├── package.json 声明 devDependency: "openclaw": "2026.2.26"（精确版本）
  ├── pnpm install → node_modules/openclaw/
  ├── scripts/bundle-openclaw.mjs
  │     BFS 遍历 pnpm 虚拟存储，收集所有传递依赖
  │     → 输出 build/openclaw/ (扁平化 node_modules)
  ├── electron-builder.yml extraResources
  │     build/openclaw/ → resources/openclaw/ (打包到 app 内)
  └── scripts/after-pack.cjs
        手动复制 node_modules（因为 electron-builder 遵守 .gitignore 跳过它）
```

**打包后的布局：**
```
macOS:  ClawX.app/Contents/Resources/openclaw/
          ├── openclaw.mjs          # CLI 入口
          ├── package.json          # 含 name: "openclaw", version: "2026.2.26"
          ├── dist/                  # 编译后的 JS chunks
          └── node_modules/         # 传递依赖

Windows: ClawX/resources/openclaw/   （同上）
Linux:   /opt/ClawX/resources/openclaw/（同上）
```

### 1.2 ClawX 如何启动 Gateway

在 `electron/gateway/manager.ts` 中：

```typescript
// 生产环境：使用 Electron 二进制作为 Node.js
command = getNodeExecutablePath();  // Electron binary 或 macOS Helper
args = [entryScript, 'gateway', '--port', port, '--token', token, '--allow-unconfigured'];

// 环境变量
spawnEnv['ELECTRON_RUN_AS_NODE'] = '1';
spawnEnv['OPENCLAW_NO_RESPAWN'] = '1';
```

- `ELECTRON_RUN_AS_NODE=1` 让 Electron 二进制充当 Node.js 运行时
- `OPENCLAW_NO_RESPAWN=1` 阻止 openclaw 的 entry.ts 重新 spawn 自身
- 入口脚本即 `resources/openclaw/openclaw.mjs`

### 1.3 openclaw 对自身安装方式的感知

openclaw 通过 `resolveOpenClawPackageRoot()` 检测自身安装根目录：

```javascript
// openclaw-root-PhSD0wUu.js
async function resolveOpenClawPackageRoot(opts) {
  for (const candidate of buildCandidates(opts)) {
    // 向上遍历目录，查找 package.json 中 name === "openclaw" 的目录
    const found = await findPackageRoot(candidate);
    if (found) return found;
  }
  return null;
}
```

候选路径来源：
1. `opts.moduleUrl` → 当前模块文件所在目录
2. `opts.argv1` → `process.argv[1]`（即 `openclaw.mjs` 的路径）
3. `opts.cwd` → 当前工作目录

**嵌入模式下**：`process.argv[1]` = `resources/openclaw/openclaw.mjs`，会正确解析到 `resources/openclaw/` 作为 package root。

---

## 2. `openclaw update` 在嵌入模式下的行为分析

### 2.1 更新检测流程

`runGatewayUpdate()` 的核心逻辑（`update-runner-BXxMBAQK.js`）：

```
1. 构建候选目录列表（cwd, argv1, process.cwd()）
2. findPackageRoot() → 找到 package root
3. resolveGitRoot() → 尝试找 git 仓库
4. 如果是 git 仓库且 package root 匹配 → 走 git 更新流程
5. 如果不是 git → detectGlobalInstallManagerForRoot() → 尝试匹配 npm/pnpm/bun 全局安装
6. 如果匹配全局包管理器 → 走全局包更新流程 (npm i -g openclaw@latest)
7. 都不匹配 → 返回 { status: "skipped", mode: "unknown", reason: "not-git-install" }
```

### 2.2 嵌入模式下的结果

当用户从 ClawX 安装的 CLI wrapper 运行 `openclaw update` 时：

| 检测步骤 | 结果 | 原因 |
|---------|------|------|
| findPackageRoot | ✅ 找到 `resources/openclaw/` | package.json 中 `name: "openclaw"` |
| resolveGitRoot | ❌ 不是 git 仓库 | app 资源目录没有 `.git` |
| detectGlobalInstallManagerForRoot | ❌ 不匹配 | `npm root -g` 返回的路径 ≠ `resources/openclaw/` |
| **最终结果** | **`status: "skipped", reason: "not-git-install"`** | 无法更新 |

**影响**：用户会看到类似 "Skipped: this OpenClaw install isn't a git checkout, and the package manager couldn't be detected" 的提示，建议用户手动通过 npm 更新。

### 2.3 Gateway 自动更新器

openclaw 内建了可选的 Gateway 自动更新器（默认**关闭**）：

```json
{
  "update": {
    "auto": { "enabled": false }
  }
}
```

- ClawX 当前**不**在 `openclaw.json` 中写入 `update` 配置
- 因此默认行为是**不自动更新**

**潜在风险**：如果用户手动在 `~/.openclaw/openclaw.json` 中启用了 `update.auto.enabled: true`：
- Gateway 会尝试检查 npm registry 获取最新版本
- 但 `detectGlobalInstallManagerForRoot` 会失败（嵌入安装不被识别为全局包）
- 自动更新**不会生效**，但可能产生无意义的日志警告

---

## 3. `openclaw uninstall` 在嵌入模式下的行为分析

### 3.1 卸载命令的作用范围

`openclaw uninstall` 支持分段卸载：
- `--service`：移除 daemon（launchd / systemd / schtasks）
- `--state`：删除 `~/.openclaw/`（配置、凭证、工作区）
- `--workspace`：删除工作区目录
- `--app`：macOS 删除 `/Applications/OpenClaw.app`
- `--all`：以上全部

### 3.2 嵌入模式下的影响

| 卸载范围 | 影响 ClawX？ | 严重程度 | 说明 |
|---------|------------|---------|------|
| `--service` | ⚠️ 间接影响 | 中 | ClawX 自己管理 Gateway 进程，不依赖系统服务。但如果用户同时也有独立 openclaw 服务运行，会被停止 |
| `--state` | ❗ 直接影响 | 高 | **删除 `~/.openclaw/`**，这是 ClawX 和 openclaw 共用的配置目录。包含 API key 配置、gateway token、channel 配置等 |
| `--workspace` | ⚠️ 间接影响 | 低 | 删除 agent 工作区，可重新创建 |
| `--app` | ❌ 不影响 ClawX | 无 | 只删除 `/Applications/OpenClaw.app`，不是 ClawX |
| CLI 本身 | ❌ 不触及 | 无 | `openclaw uninstall` **不删除 CLI 二进制本身**，只是建议用户 `npm rm -g openclaw` |

**关键风险**：`openclaw uninstall --state` 或 `--all` 会删除 `~/.openclaw/openclaw.json`，导致 ClawX 丢失：
- AI Provider API keys 配置
- Gateway token
- Channel 配置
- 其他运行时配置

---

## 4. 更新场景矩阵

### 4.1 ClawX 更新时（openclaw 版本随 ClawX 更新）

```
用户操作：ClawX 检测到新版本 → 下载 → 安装
```

| 平台 | 更新机制 | CLI wrapper 命运 | 分析 |
|------|---------|-----------------|------|
| **macOS** | Squirrel.Mac 替换 `.app` bundle | **symlink 目标被替换但路径不变** ✅ | `.app` 在同一路径原地更新，`~/.local/bin/openclaw` → `.app/Contents/Resources/cli/openclaw` 仍然有效 |
| **Windows** | NSIS 差分更新，同一安装目录 | **PATH 和 .cmd 不受影响** ✅ | `resources\cli\openclaw.cmd` 被新版覆盖，PATH 条目不变 |
| **Linux deb** | dpkg 更新，重新运行 after-install.sh | **symlink 被重新创建** ✅ | 后安装脚本重建 `/usr/local/bin/openclaw` symlink |
| **Linux AppImage** | 用户手动替换文件 | **wrapper 中硬编码路径可能失效** ⚠️ | 如果 AppImage 被移动到新位置，CLI wrapper 会断裂 |

**结论**：macOS、Windows、Linux deb 的更新都是安全的。CLI 会自动指向新版本的 openclaw。

### 4.2 openclaw 上游更新（ClawX 未更新）

| 场景 | 会发生什么 | 影响 |
|------|----------|------|
| npm 发布了 openclaw 新版 | **什么都不会发生** | ClawX 内嵌版本固定，不受 npm 发布影响 |
| 用户运行 `openclaw update` | **返回 "skipped"** | 嵌入安装不被识别，命令无效 |
| 用户手动 `npm i -g openclaw` | **创建了第二个 openclaw** | 系统中同时存在 ClawX 嵌入版和全局版，`which openclaw` 取决于 PATH 顺序 |

### 4.3 用户同时拥有 ClawX 和独立 openclaw

这是最复杂的场景：

```
PATH 优先级（以 macOS 为例）：
  ~/.local/bin/openclaw         ← ClawX 安装的 wrapper
  /usr/local/bin/openclaw       ← npm -g 安装的
  $(npm root -g)/../bin/openclaw ← npm -g 安装的（可能同上）
```

| 用户操作 | ClawX CLI | npm CLI | 期望行为 |
|---------|----------|---------|---------|
| `openclaw gateway` | 启动 ClawX 嵌入的 gateway | 启动独立 gateway | 取决于 PATH 哪个在前 |
| `openclaw update` | **skipped** | 正常更新 npm 全局包 | 混乱！用户不知道哪个被更新 |
| `openclaw uninstall --state` | 删除共用的 `~/.openclaw/` | 同上 | 影响所有安装 |
| `openclaw --version` | 显示 ClawX 嵌入版本 | 显示 npm 版本 | 取决于 PATH |

---

## 5. 风险评级与解决方案

### 🔴 P0 — `openclaw update` 在嵌入模式下误导用户

**风险**：用户从 ClawX CLI 运行 `openclaw update`，得到含糊的 "skipped" 信息，不知道如何更新。

**解决方案（二选一）**：

**方案 A — 环境变量标记嵌入模式（推荐）**：

在 CLI wrapper 脚本中设置环境变量：
```bash
# resources/cli/openclaw (POSIX)
OPENCLAW_EMBEDDED_IN=ClawX
OPENCLAW_EMBEDDED_VERSION="$(cat "$CONTENTS_DIR/Resources/app/package.json" | ...)"
ELECTRON_RUN_AS_NODE=1 exec "$ELECTRON" "$CLI" "$@"
```

然后在 ClawX 侧（或未来与 openclaw 协作）检测此变量。当 `OPENCLAW_EMBEDDED_IN=ClawX` 时：
- `openclaw update` 输出清晰信息："openclaw is managed by ClawX. Update ClawX to update openclaw."
- `openclaw update status` 显示嵌入版本和 ClawX 版本

> 注意：这需要 openclaw 上游支持（添加对 `OPENCLAW_EMBEDDED_IN` 的检测）。短期内可以先在 wrapper 脚本中拦截 `update` 子命令。

**方案 B — Wrapper 脚本拦截特定命令**：

在 shell wrapper 中拦截危险命令：
```bash
#!/bin/sh
# OpenClaw CLI (managed by ClawX)

case "$1" in
  update)
    echo "⚠️  openclaw is bundled with ClawX. To update, please update ClawX."
    echo "   Current openclaw version: $(ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" --version 2>/dev/null)"
    echo "   Update ClawX via: ClawX Settings > Check for Updates"
    exit 0
    ;;
esac

ELECTRON_RUN_AS_NODE=1 exec "$ELECTRON" "$CLI" "$@"
```

Windows 版 `openclaw.cmd`：
```cmd
@echo off
if /i "%1"=="update" (
    echo WARNING: openclaw is bundled with ClawX. To update, please update ClawX.
    exit /b 0
)
setlocal
set ELECTRON_RUN_AS_NODE=1
"%~dp0..\..\ClawX.exe" "%~dp0..\..\resources\openclaw\openclaw.mjs" %*
endlocal
```

**推荐方案 A + B 结合**：短期用方案 B 拦截，长期推动方案 A 与 openclaw 上游协作。

### 🟡 P1 — `openclaw uninstall` 可能删除共享状态

**风险**：用户运行 `openclaw uninstall --all`，删除 `~/.openclaw/` 配置目录，影响 ClawX。

**解决方案**：

1. **Wrapper 拦截**（同上）：对 `uninstall` 命令也添加警告
2. **ClawX 侧备份**：ClawX 在关键配置变更时自动备份 `openclaw.json` 到 `electron-store`
3. **恢复机制**：ClawX 启动时检测 `~/.openclaw/openclaw.json` 是否存在，如不存在则从备份恢复

```bash
# Wrapper 拦截
case "$1" in
  update)
    echo "⚠️  openclaw is bundled with ClawX..."
    exit 0
    ;;
  uninstall)
    echo "⚠️  This openclaw is managed by ClawX."
    echo "   To uninstall ClawX: use system uninstaller or drag to Trash."
    echo "   To uninstall just openclaw data: openclaw uninstall --state"
    echo ""
    echo "   Proceeding with openclaw uninstall..."
    # 仍然执行，但给出警告
    ;;
esac
```

### 🟡 P1 — 双重安装冲突

**风险**：用户同时有 ClawX 嵌入 CLI 和 npm 全局 CLI，PATH 冲突。

**解决方案**：

1. **安装时检测**：ClawX 首次启动安装 CLI 时，检测是否已有全局 `openclaw`
   - 如果存在：弹窗告知用户 "检测到已有 openclaw CLI 安装，ClawX 版本将优先"
   - 或者：不覆盖，让用户决定
2. **Wrapper 添加标识**：`openclaw --version` 输出带 `(ClawX embedded)` 后缀
3. **设置页面显示**：Settings 中显示检测到的所有 openclaw 安装

### 🟢 P2 — Gateway 自动更新器在嵌入模式下的无效尝试

**风险**：用户手动启用了 `update.auto.enabled`，Gateway 尝试自动更新但失败。

**解决方案**：

1. ClawX 在写入 `openclaw.json` 时，强制设置 `update.auto.enabled: false`
2. 或在启动 Gateway 时，通过环境变量禁用：`OPENCLAW_DISABLE_AUTO_UPDATE=1`

### 🟢 P2 — AppImage 路径不稳定

**风险**：AppImage 被用户移动后 CLI wrapper 断裂。

**解决方案**：

1. AppImage CLI 采用不同策略：每次启动检查 symlink 有效性，必要时更新
2. 或使用 `$APPDIR` 环境变量（AppImage 运行时设置）——但这只在 AppImage 进程内有效，CLI wrapper 无法使用
3. **最实用**：对 AppImage 不自动安装 CLI，在 Settings 中提供手动安装按钮

---

## 6. 推荐实现方案（修订版）

基于以上分析，对之前的 CLI 自动安装方案做如下修订：

### 6.1 CLI Wrapper 脚本需要增加命令拦截层

**POSIX wrapper (macOS + Linux)**：

```bash
#!/bin/sh
# OpenClaw CLI — managed by ClawX
# Do not edit manually. This file is regenerated on ClawX updates.

# ─── Resolve paths ───
SCRIPT="$0"
while [ -L "$SCRIPT" ]; do
  SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT")" && pwd)"
  SCRIPT="$(readlink "$SCRIPT")"
  [ "${SCRIPT#/}" = "$SCRIPT" ] && SCRIPT="$SCRIPT_DIR/$SCRIPT"
done
SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT")" && pwd)"

if [ "$(uname)" = "Darwin" ]; then
  CONTENTS_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
  ELECTRON="$CONTENTS_DIR/MacOS/ClawX"
  CLI="$CONTENTS_DIR/Resources/openclaw/openclaw.mjs"
else
  INSTALL_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
  ELECTRON="$INSTALL_DIR/clawx"
  CLI="$INSTALL_DIR/resources/openclaw/openclaw.mjs"
fi

# ─── Intercept commands that don't work in embedded mode ───
case "$1" in
  update)
    echo "openclaw is managed by ClawX (bundled version)."
    echo ""
    echo "To update openclaw, update ClawX:"
    echo "  • Open ClawX → Settings → Check for Updates"
    echo "  • Or download the latest version from https://clawx.app"
    echo ""
    ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" --version 2>/dev/null
    exit 0
    ;;
esac

# ─── Embedded mode markers ───
export OPENCLAW_EMBEDDED_IN="ClawX"

# ─── Execute ───
ELECTRON_RUN_AS_NODE=1 exec "$ELECTRON" "$CLI" "$@"
```

**Windows CMD wrapper**：

```cmd
@echo off
setlocal

if /i "%1"=="update" (
    echo openclaw is managed by ClawX ^(bundled version^).
    echo.
    echo To update openclaw, update ClawX:
    echo   - Open ClawX ^> Settings ^> Check for Updates
    echo   - Or download the latest version from https://clawx.app
    exit /b 0
)

set ELECTRON_RUN_AS_NODE=1
set OPENCLAW_EMBEDDED_IN=ClawX
"%~dp0..\..\ClawX.exe" "%~dp0..\..\resources\openclaw\openclaw.mjs" %*
endlocal
```

### 6.2 ClawX 配置保护

在 ClawX 启动时，确保 `openclaw.json` 中的自动更新被禁用：

```typescript
// 在 gateway manager 或 app ready handler 中
function ensureEmbeddedUpdateConfig(): void {
  const configPath = join(homedir(), '.openclaw', 'openclaw.json');
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    if (config.update?.auto?.enabled) {
      config.update.auto.enabled = false;
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      logger.info('Disabled openclaw auto-update (managed by ClawX)');
    }
  } catch {
    // 配置文件不存在或解析失败，忽略
  }
}
```

### 6.3 安装时冲突检测

```typescript
async function checkExistingOpenClawInstall(): Promise<'none' | 'npm' | 'other'> {
  // 检查 PATH 中是否已有 openclaw
  try {
    const { stdout } = await execAsync('which openclaw || where openclaw');
    if (stdout.trim()) {
      // 判断是 npm 全局安装还是其他
      try {
        const { stdout: npmRoot } = await execAsync('npm root -g');
        if (stdout.trim().includes(npmRoot.trim())) return 'npm';
      } catch {}
      return 'other';
    }
  } catch {}
  return 'none';
}
```

### 6.4 版本标识

修改 CLI wrapper 使 `openclaw --version` 的输出更清晰：

可以在 wrapper 中追加标识，或通过环境变量让 openclaw 自身识别。短期方案：

```bash
# 在 wrapper 中
if [ "$1" = "--version" ] || [ "$1" = "-v" ]; then
  VERSION=$(ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI" --version 2>/dev/null)
  echo "$VERSION (ClawX embedded)"
  exit 0
fi
```

---

## 7. 与 openclaw 上游协作建议

为了长期的最佳体验，建议向 openclaw 上游提出以下 feature request 或 PR：

### 7.1 嵌入模式感知（Embedded Mode）

提议 openclaw 支持 `OPENCLAW_EMBEDDED_IN` 环境变量：
- 当设置时，`openclaw update` 显示友好提示而非通用 "skipped"
- `openclaw --version` 自动追加 `(embedded in $OPENCLAW_EMBEDDED_IN)`
- 自动禁用 Gateway 自动更新器

### 7.2 更新 API 扩展

提议 `runGatewayUpdate()` 添加新的 install mode 识别：
- `mode: "embedded"` — 当检测到 `OPENCLAW_EMBEDDED_IN` 时
- 返回结构化的 "managed by external app" 状态

### 7.3 卸载安全性

提议 `openclaw uninstall` 在检测到 `OPENCLAW_EMBEDDED_IN` 时：
- 添加额外警告："This openclaw is managed by $APP_NAME"
- `--all` 和 `--state` 需要额外确认

---

## 8. 各更新场景的完整 Timeline

### 场景 1：正常 ClawX 更新

```
T0: ClawX v1.0 运行中 (内嵌 openclaw v2026.2.26)
    CLI wrapper: ~/.local/bin/openclaw → ClawX.app/Contents/Resources/cli/openclaw
    用户可以运行: openclaw --version → "2026.2.26 (ClawX embedded)"

T1: ClawX v1.1 发布 (内嵌 openclaw v2026.3.1)
    用户：ClawX 提示更新 → 点击更新 → 自动下载安装

T2: ClawX v1.1 安装完成
    macOS: .app 原地替换，symlink 不变，自动生效
    Windows: NSIS 覆盖安装，PATH 和 .cmd 不变，自动生效
    Linux deb: dpkg 更新，after-install.sh 重建 symlink
    
    用户打开新终端：openclaw --version → "2026.3.1 (ClawX embedded)"
    ✅ 无缝更新，用户无感
```

### 场景 2：用户尝试 `openclaw update`

```
$ openclaw update
openclaw is managed by ClawX (bundled version).

To update openclaw, update ClawX:
  • Open ClawX → Settings → Check for Updates
  • Or download the latest version from https://clawx.app

openclaw 2026.2.26
```

✅ 清晰的引导信息，无混淆

### 场景 3：用户 `openclaw uninstall --state`

```
$ openclaw uninstall --state
⚠️  This openclaw is managed by ClawX.
    Removing state data will affect ClawX configuration.
    
Proceed? (y/N): y
→ 删除 ~/.openclaw/

下次 ClawX 启动：
→ 检测到 ~/.openclaw 不存在
→ 重新创建默认配置
→ 用户需要重新配置 API keys
```

⚠️ 有数据丢失风险，但有警告

### 场景 4：ClawX 卸载

```
macOS: 用户拖 ClawX.app 到废纸篓
  → .app 被删除
  → ~/.local/bin/openclaw symlink 断裂
  → 用户运行 openclaw: "No such file or directory"
  → 需要用户手动删除 symlink

Windows: 用户运行卸载程序
  → NSIS customUnInstall 宏执行
  → 从 PATH 移除 cli 目录
  → 删除安装目录
  → 清理完成

Linux deb: apt remove clawx
  → after-remove.sh 删除 /usr/local/bin/openclaw symlink
  → 清理完成
```

**macOS 遗留问题**：需要在 ClawX 中添加卸载清理逻辑，或者文档告知用户手动删除 `~/.local/bin/openclaw`。

---

---

## 9. Shell Completions 兼容性分析

### 9.1 openclaw 补全机制概述

openclaw 使用**自定义补全生成器**（非 tabtab/omelette 等第三方库），基于 Commander.js 程序结构递归生成。

**补全文件存储位置**：`$OPENCLAW_STATE_DIR/completions/`（默认 `~/.openclaw/completions/`）

```
~/.openclaw/completions/
  ├── openclaw.zsh        # Zsh 补全脚本
  ├── openclaw.bash       # Bash 补全脚本
  ├── openclaw.fish       # Fish 补全脚本
  └── openclaw.ps1        # PowerShell 补全脚本
```

**支持的 shell**：zsh、bash、fish、PowerShell

### 9.2 补全生命周期

```
生成 → 缓存 → 安装到 shell profile → 用户使用
```

**1. 生成 (`openclaw completion --write-state`)**

eagerly 加载所有命令树（core CLI + sub-CLIs），遍历 Commander.js program 结构，为每个 shell 生成对应格式的补全脚本。

关键代码：
```javascript
async function writeCompletionCache(params) {
  const cacheDir = resolveCompletionCacheDir(); // ~/.openclaw/completions/
  await fs.mkdir(cacheDir, { recursive: true });
  for (const shell of params.shells) {
    const script = getCompletionScript(shell, params.program);
    const targetPath = resolveCompletionCachePath(shell, params.binName);
    await fs.writeFile(targetPath, script, "utf-8");
  }
}
```

**文件名**由 `binName` 决定，而 `binName` 来自 `resolveCliName()`：

```javascript
function resolveCliName(argv = process.argv) {
  const argv1 = argv[1];
  if (!argv1) return "openclaw";  // 默认
  const base = path.basename(argv1).trim();
  if (KNOWN_CLI_NAMES.has(base)) return base; // 只认 "openclaw"
  return "openclaw";
}
```

**嵌入模式下**：`process.argv[1]` = `resources/openclaw/openclaw.mjs`，`basename` = `openclaw.mjs`，不在 `KNOWN_CLI_NAMES` 中 → **回退到 `"openclaw"`**。所以文件名不会变，仍然是 `openclaw.zsh` 等。

**2. 安装 (`openclaw completion --install`)**

在用户的 shell profile 中插入一个 source 块：

```
# OpenClaw Completion
source "/Users/xxx/.openclaw/completions/openclaw.zsh"
```

支持的 profile 文件：
- zsh: `~/.zshrc`
- bash: `~/.bashrc`（fallback `~/.bash_profile`）
- fish: `~/.config/fish/config.fish`
- PowerShell: `~/.config/powershell/Microsoft.PowerShell_profile.ps1`

**3. Doctor 集成**

`openclaw doctor` 会：
- 检测慢速动态补全模式 `source <(openclaw completion ...)` 并升级为缓存版
- 如果 profile 中有补全配置但缓存文件缺失，自动重新生成
- 首次安装时（onboarding），提示是否启用补全

缓存重新生成的关键代码：
```javascript
async function generateCompletionCache() {
  const root = await resolveOpenClawPackageRoot({ ... });
  const binPath = path.join(root, "openclaw.mjs");
  return spawnSync(process.execPath, [binPath, "completion", "--write-state"], {
    cwd: root, env: process.env
  }).status === 0;
}
```

### 9.3 嵌入模式下的补全兼容性分析

| 环节 | 兼容性 | 说明 |
|------|--------|------|
| 文件名 | ✅ 兼容 | `resolveCliName()` 回退到 `"openclaw"`，文件名不变 |
| 缓存位置 | ✅ 兼容 | 使用 `resolveStateDir()` → `~/.openclaw/completions/`，与独立版相同 |
| 生成内容 | ⚠️ 需注意 | 补全脚本中硬编码 `compdef _openclaw_root_completion openclaw`，命令名为 `openclaw` ✅ |
| shell profile | ✅ 兼容 | source 行指向 `~/.openclaw/completions/openclaw.zsh`，不依赖安装路径 |
| doctor 重新生成 | ⚠️ 需注意 | `generateCompletionCache()` 使用 `process.execPath`（Electron 二进制）来 spawn，在嵌入模式下这个路径正确（因为设置了 `ELECTRON_RUN_AS_NODE=1`） |
| `openclaw completion --install` | ✅ 兼容 | 直接运行即可安装到 profile |

**关键发现：补全机制在嵌入模式下基本可直接工作！**

唯一需要注意的是 `generateCompletionCache()` 的 spawn 行为：

```javascript
spawnSync(process.execPath, [binPath, "completion", "--write-state"], { ... })
```

在嵌入模式下：
- `process.execPath` = Electron 二进制（如 `/Applications/ClawX.app/Contents/MacOS/ClawX`）
- **但**：spawn 时**没有设置 `ELECTRON_RUN_AS_NODE=1`**！
- **结果**：这个 spawn 会启动一个 GUI Electron 窗口而非 Node.js CLI

这是一个 **bug**：doctor 的 `generateCompletionCache()` 在嵌入模式下会失败。

### 9.4 补全相关的最小改动方案

**需要做的（ClawX 侧）**：

1. **CLI 安装时自动生成补全缓存**：在首次安装 CLI wrapper 后，主动运行一次 `openclaw completion --write-state` 生成缓存文件

2. **CLI 安装时自动安装补全**：运行 `openclaw completion --install -y` 将 source 行写入 shell profile

两步可合并为：在 CLI wrapper 首次安装后，ClawX main process 中执行：
```typescript
import { spawn } from 'child_process';

function installCompletions(): void {
  const entryPath = getOpenClawEntryPath();
  const execPath = getNodeExecutablePath();
  
  // 生成补全缓存
  spawn(execPath, [entryPath, 'completion', '--write-state'], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', OPENCLAW_NO_RESPAWN: '1' },
    stdio: 'ignore',
  }).on('close', (code) => {
    if (code !== 0) return;
    // 安装到 shell profile
    spawn(execPath, [entryPath, 'completion', '--install', '-y'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', OPENCLAW_NO_RESPAWN: '1' },
      stdio: 'ignore',
    });
  });
}
```

3. **ClawX 更新后重新生成补全缓存**：因为新版本可能添加了新命令

**不需要做的**：
- 不需要修改 openclaw 上游补全代码
- 不需要修改缓存位置
- 不需要修改 profile 写入逻辑

---

## 10. 内置插件/扩展路径兼容性分析

### 10.1 openclaw 插件发现机制

插件按以下优先顺序被发现（`discoverOpenClawPlugins()`）：

```
1. 用户配置路径:  plugins.load.paths (openclaw.json)
2. 工作区扩展:    <workspaceDir>/.openclaw/extensions/
3. 全局扩展:      ~/.openclaw/extensions/
4. 内置插件:      resolveBundledPluginsDir()
```

### 10.2 `resolveBundledPluginsDir()` 路径解析

```javascript
function resolveBundledPluginsDir() {
  // 1. 环境变量覆盖
  const override = process.env.OPENCLAW_BUNDLED_PLUGINS_DIR?.trim();
  if (override) return override;
  
  // 2. process.execPath 同级目录的 extensions/
  const execDir = path.dirname(process.execPath);
  const sibling = path.join(execDir, "extensions");
  if (fs.existsSync(sibling)) return sibling;
  
  // 3. 从 import.meta.url 向上遍历 6 层找 extensions/
  let cursor = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(cursor, "extensions");
    if (fs.existsSync(candidate)) return candidate;
    cursor = path.dirname(cursor);
  }
}
```

**独立安装（npm -g）**：
- `process.execPath` = `/usr/local/bin/node`（或 Node.js 的位置）
  - `path.join(dirname(node), "extensions")` → 通常不存在
- `import.meta.url` = `file:///usr/local/lib/node_modules/openclaw/dist/manifest-registry-xxx.js`
  - 向上遍历：`dist/` → `openclaw/` → 找到 `openclaw/extensions/` ✅

**嵌入模式（ClawX）**：
- `process.execPath` = Electron 二进制路径
  - macOS: `/Applications/ClawX.app/Contents/MacOS/ClawX`
    - `path.join(dirname(...), "extensions")` → `.../MacOS/extensions` → 不存在
  - Windows: `C:\...\ClawX.exe`
    - `path.join(dirname(...), "extensions")` → 不存在
- `import.meta.url` = `file:///Applications/ClawX.app/Contents/Resources/openclaw/dist/manifest-registry-xxx.js`
  - 向上遍历：`dist/` → `openclaw/` → 找到 `openclaw/extensions/` ✅

**结论**：**内置插件路径在嵌入模式下可以正确解析**，因为 `import.meta.url` 指向 `resources/openclaw/dist/` 内的文件，向上遍历能找到 `resources/openclaw/extensions/`。

### 10.3 `resolveBundledSkillsDir()` 路径解析

```javascript
function resolveBundledSkillsDir(opts = {}) {
  // 1. 环境变量覆盖
  const override = process.env.OPENCLAW_BUNDLED_SKILLS_DIR?.trim();
  if (override) return override;
  
  // 2. process.execPath 同级 skills/
  const sibling = path.join(path.dirname(process.execPath), "skills");
  if (fs.existsSync(sibling)) return sibling;
  
  // 3. resolveOpenClawPackageRootSync() → 找到 package root → skills/
  const packageRoot = resolveOpenClawPackageRootSync({ argv1: process.argv[1], ... });
  if (packageRoot) {
    const candidate = path.join(packageRoot, "skills");
    if (looksLikeSkillsDir(candidate)) return candidate;
  }
  
  // 4. 从 import.meta.url 向上遍历 6 层
  ...
}
```

**嵌入模式分析**：
- 策略 2（`process.execPath` 同级）→ 不存在
- 策略 3（package root）→ `resolveOpenClawPackageRootSync` 通过 `process.argv[1]`（`openclaw.mjs`）找到 `resources/openclaw/`，然后 `resources/openclaw/skills/` ✅
- 策略 4（fallback）→ 从 `dist/` 向上也能找到

**结论**：**内置 skills 路径在嵌入模式下也可以正确解析。**

### 10.4 嵌入模式 vs 独立安装的路径差异

| 路径类型 | 独立安装 (npm -g) | 嵌入模式 (ClawX) | 兼容？ |
|---------|-------------------|------------------|--------|
| 内置插件 | `node_modules/openclaw/extensions/` | `resources/openclaw/extensions/` | ✅ |
| 内置 skills | `node_modules/openclaw/skills/` | `resources/openclaw/skills/` | ✅ |
| 用户插件 | `~/.openclaw/extensions/` | `~/.openclaw/extensions/` | ✅ 共享 |
| 工作区插件 | `<workspace>/.openclaw/extensions/` | `<workspace>/.openclaw/extensions/` | ✅ 共享 |
| 插件配置 | `~/.openclaw/openclaw.json` | `~/.openclaw/openclaw.json` | ✅ 共享 |
| npm 安装的插件 | `~/.openclaw/extensions/<id>/` | `~/.openclaw/extensions/<id>/` | ✅ 共享 |

**关键发现**：插件系统在嵌入模式下**完全兼容**，不需要任何额外改动。原因：
1. 所有路径解析都使用 `import.meta.url` 或 `process.argv[1]` 作为锚点，不依赖 `process.execPath` 必须是 Node.js
2. 用户安装的插件存储在 `~/.openclaw/`，两种安装模式共享

### 10.5 `openclaw plugins install` 在嵌入模式下的行为

当用户从 ClawX CLI 运行 `openclaw plugins install <plugin>` 时：
- 插件被安装到 `~/.openclaw/extensions/<plugin-id>/`（用户目录）
- 配置写入 `~/.openclaw/openclaw.json` 的 `plugins.installs`
- **与安装模式无关，完全兼容** ✅

但需注意：
- 如果插件需要 `npm install` 自身依赖，会使用 `process.execPath` 来运行 npm
- 嵌入模式下 `process.execPath` 是 Electron 二进制，不是 `node`
- 但 openclaw 的插件安装使用 `runCommandWithTimeout()` 直接调用 `npm`/`pnpm` 命令，不依赖 `process.execPath`
- **所以也是兼容的** ✅

### 10.6 版本升级时内置插件的更新

| 升级场景 | 内置插件行为 | 用户安装插件行为 |
|---------|------------|---------------|
| ClawX 更新（内嵌 openclaw 新版） | 内置插件**自动随 app 更新** ✅ | 不受影响 |
| 用户 `openclaw plugins update` | 只更新 `~/.openclaw/extensions/` 中的 npm 安装插件 | ✅ 正常工作 |
| openclaw 新版添加了新内置插件 | 需 ClawX 更新才能获得 | N/A |
| openclaw 新版修改了内置插件 | 需 ClawX 更新才能获得 | N/A |

**结论**：内置插件的更新完全与 ClawX 更新绑定，这是**预期行为**。用户安装的第三方插件可独立更新。

---

## 11. `OPENCLAW_BUNDLED_*` 环境变量（可选优化）

openclaw 提供了三个环境变量覆盖内置资源路径：

| 环境变量 | 作用 | ClawX 是否需要设置 |
|---------|------|-------------------|
| `OPENCLAW_BUNDLED_PLUGINS_DIR` | 覆盖内置插件目录 | ❌ 不需要（`import.meta.url` 已能正确解析） |
| `OPENCLAW_BUNDLED_SKILLS_DIR` | 覆盖内置 skills 目录 | ❌ 不需要（同上） |
| `OPENCLAW_BUNDLED_HOOKS_DIR` | 覆盖内置 hooks 目录 | ❌ 不需要（同上） |
| `OPENCLAW_BUNDLED_VERSION` | 覆盖版本号 | ⚠️ 可选（但 package.json 中已有 version） |

**建议**：暂时不设置这些环境变量。如果将来遇到路径解析问题，再作为 escape hatch 使用。在 CLI wrapper 中预留位置即可：

```bash
# 如需覆盖，取消注释以下行
# export OPENCLAW_BUNDLED_PLUGINS_DIR="$RESOURCES_DIR/openclaw/extensions"
# export OPENCLAW_BUNDLED_SKILLS_DIR="$RESOURCES_DIR/openclaw/skills"
```

---

## 12. 最小改动兼容方案总结

基于以上所有分析，实现 ClawX CLI 自动安装的**最小改动集**如下：

### 改动清单

| # | 文件 | 改动 | 目的 |
|---|------|------|------|
| 1 | `resources/cli/posix/openclaw` (新增) | POSIX shell wrapper | macOS + Linux CLI 入口 |
| 2 | `resources/cli/win32/openclaw.cmd` (新增) | Windows CMD wrapper | Windows CLI 入口 |
| 3 | `electron-builder.yml` | 添加 cli/ 到 extraResources | 打包 CLI wrapper |
| 4 | `scripts/linux/after-install.sh` | 添加 openclaw symlink | Linux deb 自动安装 |
| 5 | `scripts/linux/after-remove.sh` | 添加 openclaw symlink 清理 | Linux deb 卸载清理 |
| 6 | `scripts/installer.nsh` | 添加 `customInstall` 宏写入 PATH | Windows NSIS 自动安装 |
| 7 | `electron/utils/openclaw-cli.ts` | 添加 `autoInstallCliIfNeeded()` + `installCompletions()` | macOS/AppImage 首次启动安装 + 补全 |
| 8 | `electron/main/index.ts` (或 app ready) | 调用 `autoInstallCliIfNeeded()` | 触发自动安装 |

### 不需要改动的（因为已兼容）

| 组件 | 原因 |
|------|------|
| 内置插件路径解析 | `import.meta.url` + 向上遍历已能正确找到 `resources/openclaw/extensions/` |
| 内置 skills 路径解析 | 同上，找到 `resources/openclaw/skills/` |
| 用户安装的插件 | 存储在 `~/.openclaw/extensions/`，与安装方式无关 |
| 补全文件名 | `resolveCliName()` 回退到 `"openclaw"`，不受入口文件名影响 |
| 补全缓存位置 | `~/.openclaw/completions/`，与安装方式无关 |
| 补全 shell profile 写入 | source 行指向用户目录下的缓存文件，不含安装路径 |
| `openclaw.json` 配置 | 存储在 `~/.openclaw/`，两种模式共享 |
| `openclaw plugins install` | 安装到 `~/.openclaw/extensions/`，不依赖 `process.execPath` |

### CLI Wrapper 应该拦截的命令

| 命令 | 处理方式 |
|------|---------|
| `openclaw update` | 拦截，显示"请更新 ClawX" |
| 其他所有命令 | 透传，包括 `completion`、`doctor`、`plugins`、`gateway` 等 |

**`openclaw uninstall` 不需要拦截**——它本身有交互确认，且不会删除 CLI 本身。

### ClawX 首次启动后自动执行

```
1. 安装 CLI wrapper (symlink / PATH)
2. 生成补全缓存: openclaw completion --write-state
3. 安装补全到 profile: openclaw completion --install -y
```

### ClawX 更新后自动执行

```
1. 重新生成补全缓存: openclaw completion --write-state
   （因为新版可能有新命令）
```

---

## 13. 修订后的实施优先级

| 优先级 | 任务 | 解决的问题 |
|-------|------|----------|
| **P0** | 新增 CLI wrapper 脚本（POSIX + CMD），含 `update` 命令拦截 | CLI 入口 + 防止用户困惑 |
| **P0** | Windows NSIS `customInstall` 宏写入 PATH | 当前 Windows 体验最差 |
| **P0** | Linux deb `after-install.sh` 添加 openclaw symlink | 一行代码修复 |
| **P1** | macOS 首次启动自动安装 CLI + 补全 | 无感安装 |
| **P1** | ClawX 更新后重新生成补全缓存 | 新命令补全 |
| **P1** | 设置 `OPENCLAW_EMBEDDED_IN` 环境变量 | 嵌入模式标识（为上游协作预留） |
| **P2** | 安装时检测已有 openclaw 并警告 | 避免双重安装混乱 |
| **P2** | 版本输出添加 "(ClawX embedded)" | 辅助调试 |
| **P2** | macOS 卸载时清理 symlink | 避免遗留 |
| **P3** | 向 openclaw 上游提 embedded mode feature request | 长期最佳体验 |
| **P3** | `openclaw.json` 备份/恢复机制 | 防止 uninstall 数据丢失 |
